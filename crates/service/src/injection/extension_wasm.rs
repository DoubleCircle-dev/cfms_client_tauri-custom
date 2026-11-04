use wasmi::{Config, Engine, Instance, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

const MAX_MODULE_BYTES: usize = 8 * 1024 * 1024;
const MAX_JSON_BYTES: usize = 1024 * 1024;
const MAX_MEMORY_BYTES: usize = 16 * 1024 * 1024;
const MAX_FUEL: u64 = 50_000_000;
const MAX_STACK_BYTES: usize = 512 * 1024;

struct RuntimeState {
    limits: StoreLimits,
}

pub(super) fn validate_module(bytes: &[u8]) -> Result<(), String> {
    let (_, module) = compile(bytes)?;
    validate_abi(&module)
}

pub(super) fn execute(
    bytes: &[u8],
    input: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (engine, module) = compile(bytes)?;
    validate_abi(&module)?;

    let input =
        serde_json::to_vec(input).map_err(|e| format!("Failed to encode extension input: {e}"))?;
    if input.len() > MAX_JSON_BYTES {
        return Err("Extension input exceeds the runtime limit".into());
    }

    let linker = Linker::<RuntimeState>::new(&engine);
    let mut store = Store::new(
        &engine,
        RuntimeState {
            limits: StoreLimitsBuilder::new()
                .memory_size(MAX_MEMORY_BYTES)
                .table_elements(1024)
                .instances(1)
                .memories(1)
                .tables(1)
                .trap_on_grow_failure(true)
                .build(),
        },
    );
    store.limiter(|state| &mut state.limits);
    store
        .set_fuel(MAX_FUEL)
        .map_err(|e| format!("Failed to configure extension execution fuel: {e}"))?;

    let instance = linker
        .instantiate_and_start(&mut store, &module)
        .map_err(|e| format!("Failed to instantiate extension module: {e}"))?;
    invoke(&mut store, &instance, &input)
}

fn compile(bytes: &[u8]) -> Result<(Engine, Module), String> {
    if bytes.is_empty() || bytes.len() > MAX_MODULE_BYTES {
        return Err(format!(
            "Extension WebAssembly module must be between 1 byte and {MAX_MODULE_BYTES} bytes"
        ));
    }
    let mut config = Config::default();
    config
        .consume_fuel(true)
        .allow_start_fn(false)
        .set_max_stack_height(MAX_STACK_BYTES);
    let engine = Engine::new(&config);
    let module = Module::new(&engine, bytes)
        .map_err(|e| format!("Invalid extension WebAssembly module: {e}"))?;
    if module.imports().next().is_some() {
        return Err(
            "Extension WebAssembly modules cannot import host functions or resources".into(),
        );
    }
    Ok((engine, module))
}

fn validate_abi(module: &Module) -> Result<(), String> {
    let exports = module
        .exports()
        .map(|export| export.name())
        .collect::<Vec<_>>();
    for required in ["memory", "cfms_alloc", "cfms_invoke"] {
        if !exports.contains(&required) {
            return Err(format!(
                "Extension WebAssembly module is missing the {required} ABI export"
            ));
        }
    }
    Ok(())
}

fn invoke(
    store: &mut Store<RuntimeState>,
    instance: &Instance,
    input: &[u8],
) -> Result<serde_json::Value, String> {
    let memory = instance
        .get_memory(&*store, "memory")
        .ok_or_else(|| "Extension WebAssembly module did not export memory".to_string())?;
    let alloc = instance
        .get_typed_func::<i32, i32>(&*store, "cfms_alloc")
        .map_err(|e| format!("Invalid extension allocator ABI: {e}"))?;
    let invoke = instance
        .get_typed_func::<(i32, i32), i64>(&*store, "cfms_invoke")
        .map_err(|e| format!("Invalid extension invocation ABI: {e}"))?;

    let input_len = i32::try_from(input.len())
        .map_err(|_| "Extension input exceeds the runtime limit".to_string())?;
    let input_ptr = alloc
        .call(&mut *store, input_len)
        .map_err(|e| format!("Extension input allocation failed: {e}"))?;
    let input_offset = usize::try_from(input_ptr)
        .map_err(|_| "Extension allocator returned an invalid input pointer".to_string())?;
    memory
        .write(&mut *store, input_offset, input)
        .map_err(|e| format!("Failed to write extension input: {e}"))?;

    let packed = invoke
        .call(&mut *store, (input_ptr, input_len))
        .map_err(|e| format!("Extension page execution failed: {e}"))? as u64;
    let output_ptr = (packed >> 32) as u32;
    let output_len = (packed & u64::from(u32::MAX)) as u32;
    let output_len = usize::try_from(output_len)
        .map_err(|_| "Extension output length is invalid".to_string())?;
    if output_len == 0 || output_len > MAX_JSON_BYTES {
        return Err("Extension output is empty or exceeds the runtime limit".into());
    }
    let output_ptr = usize::try_from(output_ptr)
        .map_err(|_| "Extension output pointer is invalid".to_string())?;
    let mut output = vec![0; output_len];
    memory
        .read(&*store, output_ptr, &mut output)
        .map_err(|e| format!("Failed to read extension output: {e}"))?;
    serde_json::from_slice(&output).map_err(|e| format!("Extension output is not valid JSON: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_module(result: &str, body: &str) -> Vec<u8> {
        let output = result
            .bytes()
            .map(|byte| format!("\\{byte:02x}"))
            .collect::<String>();
        let ptr = 4096_u64;
        let packed = (ptr << 32) | result.len() as u64;
        let source = format!(
            r#"(module
                (memory (export "memory") 1 4)
                (data (i32.const {ptr}) "{output}")
                (func (export "cfms_alloc") (param i32) (result i32) i32.const 16)
                (func (export "cfms_invoke") (param i32 i32) (result i64) {body} i64.const {packed})
            )"#
        );
        wat::parse_str(source).expect("test module is valid WAT")
    }

    #[test]
    fn executes_module_and_returns_json() {
        let module = test_module(
            r#"{"schema_version":1,"title":"WASM page","blocks":[]}"#,
            "",
        );
        let page = execute(
            &module,
            &serde_json::json!({ "page": "overview", "input": { "answer": 42 } }),
        )
        .expect("module runs");
        assert_eq!(page["title"], "WASM page");
    }

    #[test]
    fn rejects_modules_with_imports() {
        let module = wat::parse_str(
            r#"(module
                (import "env" "host" (func))
                (memory (export "memory") 1)
                (func (export "cfms_alloc") (param i32) (result i32) i32.const 0)
                (func (export "cfms_invoke") (param i32 i32) (result i64) i64.const 0)
            )"#,
        )
        .expect("test module is valid WAT");
        let error = validate_module(&module).expect_err("imports are forbidden");
        assert!(error.contains("cannot import"));
    }

    #[test]
    fn traps_when_guest_exhausts_fuel() {
        let module = test_module(
            r#"{"schema_version":1,"title":"never returned","blocks":[]}"#,
            "(loop $forever (br $forever))",
        );
        let error = execute(&module, &serde_json::json!({ "page": "overview" }))
            .expect_err("loop is fuel limited");
        assert!(error.contains("fuel") || error.contains("execution failed"));
    }
}
