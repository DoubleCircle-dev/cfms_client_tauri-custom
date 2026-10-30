# CFMS extension packages

CFMS extensions are signed data packages. Declarative v1 packages cannot contain executable code.
The `api-custom-v2` preview adds a constrained WebAssembly page renderer; it does not add WASI,
host imports, JavaScript, native libraries, scripts, symbolic links, or arbitrary files.

## API versions

- **Declarative v1** uses `schema_version: 1` and a v1 `host_api` value such as `1.x`.
- **WASM preview v2** uses `schema_version: 2`, `host_api: "api-custom-v2"`, and a `runtime`
  declaration that points to a single `.wasm` module under `wasm/`.
- Existing v1 packages remain installable. New packages must use the exact v2 API marker.

Example v2 manifest:

```json
{
  "schema_version": 2,
  "id": "org.example.wasm-page",
  "name": "WASM page example",
  "description": "A generated declarative page",
  "publisher": "Example publisher",
  "version": "1.0.0",
  "host_api": "api-custom-v2",
  "min_client_version": "0.57.0",
  "platforms": ["windows", "linux", "android"],
  "entrypoints": {
    "navigation": [{ "id": "overview", "label": "Overview", "icon": "extensions", "page": "overview" }],
    "settings": [],
    "workflows": []
  },
  "requested_capabilities": [],
  "background_triggers": [],
  "content_hashes": {},
  "runtime": { "kind": "wasm", "module": "wasm/main.wasm" }
}
```

### WASM runtime ABI

The module exports `memory`, `cfms_alloc(i32) -> i32`, and
`cfms_invoke(i32, i32) -> i64`. The host writes a UTF-8 JSON request to the memory returned by
`cfms_alloc`, then passes its pointer and byte length to `cfms_invoke`. Page entrypoints receive
`{"page":"overview"}`; workflow nodes receive their resolved JSON `input`. The return value packs
the output pointer in the high 32 bits and the output byte length in the low 32 bits. A page
entrypoint must return a declarative page with `schema_version: 1` and a `blocks` array. The client
renders it using its own trusted UI components. A workflow invocation may return any JSON value.

Pages may group blocks under one `tabs` block using each block's `tab: { group, id }` reference.
Forms support `textarea` and single-digit `digit` controls in addition to text, number, toggle, and
select fields. A workflow action can name a `result_id`; its `result` block displays a returned
`{ "ok": true, "output": "...", "form_values": { ... } }` value inline. Updates are applied only to
fields declared by that page, with select, toggle, number, and digit values checked against their
field types. A `kind: "clear"` action clears only its declared form fields and linked result.

Pages may include an optional `styles` array. Style rules target only class selectors attached to
that page's blocks, fields, and actions; every rule is automatically scoped to its extension page.
Custom classes must use the `plugin-` prefix. Selectors support descendant/child relationships and
the `hover`, `focus`, `focus-visible`, `active`, `disabled`, and `checked` states. Optional media
conditions are limited to a single `min-width` or `max-width` pixel/rem/em query.

Styles are constrained to at most 64 rules and 16 KiB, with up to 16 declarations per rule. Only
layout, spacing, sizing, borders, colors, and typography properties are accepted. Positioning,
stacking, visibility, arbitrary selectors, at-rules, custom-property declarations, animations, and
external resources are rejected. CSS values are validated by the client before rendering;
unsupported values fail page loading instead of being silently ignored.

The initial ABI provides no imports, WASI, filesystem, network, or native access. Modules cannot
run a start function. A declarative workflow can invoke the module with a JSON `wasm` node; its
`input` is passed to the same ABI and the returned JSON is stored at the node's `result` key.
Workflow `host_call` nodes remain the way to request client capabilities, and each capability is
still checked by the client; sensitive operations retain user confirmation. A module can process
host-call results by receiving the workflow context as a later `wasm` node's input.

Example workflow node that sends submitted form values to the module:

```json
{
  "id": "process-form",
  "type": "wasm",
  "input": "$input",
  "result": "processed",
  "next": "finish"
}
```

The workflow context contains `input` and `results`; for example, use `"$results.downloads"` to
pass a previous host-call result to a later module invocation.
Runtime limits are enforced for module size (8 MiB), linear memory (16 MiB), stack (512 KiB),
execution fuel (10 million units), and JSON input/output (1 MiB).

The extension settings page is in preview. Desktop builds can import a signed `.cfmsext` file;
mobile builds install only through the signed catalog. Builds without a configured trusted key can
inspect extension metadata but cannot install packages.

The release build receives trusted public keys at compile time:

```powershell
$env:CFMS_EXTENSION_TRUSTED_KEYS = "official-2026:<64 hex characters>"
cargo tauri build --ci
```

The corresponding private key is never stored in this repository. Supply its 32-byte Ed25519 seed
through `CFMS_EXTENSION_SIGNING_KEY` only in the protected publishing environment:

```powershell
$env:CFMS_EXTENSION_SIGNING_KEY = "<64 hex characters>"
cargo run -p cfms-service --bin cfms-extension -- public-key
cargo run -p cfms-service --bin cfms-extension -- pack extensions/examples/file-stats dist/file-stats.cfmsext official-2026
cargo run -p cfms-service --bin cfms-extension -- sign-catalog catalog.json catalog.json.sig official-2026
```

V2 package source directories may also contain the manifest-declared `wasm/*.wasm` module.

The exact bytes of `catalog.json` must be published with the generated `catalog.json.sig`.
Changing whitespace after signing invalidates the signature. Production clients do not have an
unsigned-extension bypass.
