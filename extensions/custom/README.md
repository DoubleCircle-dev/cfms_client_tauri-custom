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
select fields; every field renders its label above the control. A workflow action can name a
`result_id`; its `result` block displays a returned
`{ "ok": true, "output": "...", "form_values": { ... } }` value inline and applies `form_values` to
the named form. `variant: "banner"` renders the value as a success/danger banner instead of a
readonly textarea. Updates are applied only to fields declared by that page, with select, toggle,
number, and digit values checked against their field types. A `kind: "clear"` action clears only
its declared form fields and linked result; a `kind: "copy"` action copies the linked result to the
clipboard and is disabled until that result has content.

The initial ABI provides no imports, WASI, filesystem, network, or native access. Modules cannot
run a start function. A declarative workflow can invoke the module with a JSON `wasm` node; its
`input` is passed to the same ABI and the returned JSON is stored at the node's `result` key.
Workflow `host_call` nodes remain the way to request client capabilities, and each capability is
still checked by the client; sensitive operations retain user confirmation. A module can process
host-call results by receiving the workflow context as a later `wasm` node's input.

### Controlled page styling

Declarative pages returned by v1 JSON or the v2 renderer may declare `class_name` on the page,
blocks, form fields, and actions, plus a page-level `styles` array of selector/declaration rules.
They may also include a non-visual CSS block such as
`{ "type": "css", "css": ".plugin-form { gap: 1rem; }" }`; its text is parsed into the same
controlled rules and is never inserted as raw CSS.
The host provides no default layout or decorative styling for extension page content. Plugins
describe those styles themselves; the host retains styling only for loading/error states and its
trusted controls.
Rules are scoped to that extension page and accept only declared `plugin-*` classes and renderer
`extension-*` classes, including page title/header, tabs, controls, and result-heading hooks. A
page-level `class_name` is rendered but is not registered for selectors, so style rules must target
declared block, field, action, or renderer classes instead.
The renderer applies an allowlist of layout, spacing, typography, border,
and color properties; selectors are limited to class-based descendant/child relationships and
bounded `min-width`/`max-width` media conditions. Global selectors, comments, unknown at-rules,
external resources, `display: none`, positioning, and script-bearing values are rejected. CSS
customizes the layout and appearance of the host-rendered controls; it cannot add arbitrary HTML.
The page-wide limit is 64 rules and 16 KiB across CSS blocks and `styles`.

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
cargo run -p cfms-service --bin cfms-extension -- pack extensions/custom/examples/file-stats dist/file-stats.cfmsext official-2026
cargo run -p cfms-service --bin cfms-extension -- sign-catalog catalog.json catalog.json.sig official-2026
```

V2 package source directories may also contain the manifest-declared `wasm/*.wasm` module.

The exact bytes of `catalog.json` must be published with the generated `catalog.json.sig`.
Changing whitespace after signing invalidates the signature. Production clients do not have an
unsigned-extension bypass.

## Publishing the custom-v2 catalog

The custom client reads the signed catalog from the `plugins` release in
`DoubleCircle-dev/cfms-plugin`:

`https://github.com/DoubleCircle-dev/cfms-plugin/releases/download/plugins/catalog.json`

Attach `catalog.json`, `catalog.json.sig`, and each `.cfmsext` package as release assets. The
client fetches the detached signature from the catalog URL with `.sig` appended. Each catalog
entry's `download_url` must point to its corresponding HTTPS package asset, for example:

`https://github.com/DoubleCircle-dev/cfms-plugin/releases/download/plugins/<extension-id>-<version>.cfmsext`

The catalog itself keeps `schema_version: 1`; a WASM v2 extension selects its runtime with
`host_api: "api-custom-v2"`.

The custom release workflow trusts the publisher key below at build time:

```powershell
cfms-plugin:cf721edd3d63a06f07c1be2099e7dfbf407c11a4726ad422415314ce6ab961de
```

Use `cfms-plugin` as the key ID when signing the packages and catalog. The release workflow also
appends any additional trusted publisher keys configured in the repository variable
`CFMS_EXTENSION_TRUSTED_KEYS`, whose format is comma-separated
`key-id:64-hex-public-key` entries. Keep the private signing key only in the protected publishing
environment. After changing the catalog, sign its exact final bytes and upload the package assets,
`catalog.json`, and `catalog.json.sig` to the `plugins` release. Do not edit the catalog after
signing; that invalidates its signature.

The client identifies a package's source by its verified signing key ID, not by the self-reported
`manifest.publisher` value. Packages signed by `cfms-plugin` may update automatically when they
request no new capabilities. Packages signed by any other trusted key require explicit user
confirmation for each catalog install or update; their updates are never installed in the
background. Enabling an updated package still requires the account's capability authorization.
