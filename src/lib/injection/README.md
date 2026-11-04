# Fork injection seams

The `custom` branch must keep merging upstream releases. Rather than writing
fork code into upstream files, every fork feature registers a **contribution**
here, and the upstream file keeps one stable line that reads it.

```
src/lib/injection/
├── types.ts              the contract (contribution points)
├── registry.ts           what seam files import
├── modules/
│   ├── index.ts          the fork's module list — append new modules here
│   ├── custom-messages.ts
│   ├── desktop-shell.ts
│   ├── file-sync.ts
│   ├── notifications.ts
│   ├── chat.ts
│   ├── tools.ts
│   └── runtime-services.ts
├── messages/{en,zh-CN}.ts  fork strings, layered over the upstream catalogs
├── icon-map.ts             fork Fluent icon slugs, merged in by the generator
└── icons.ts                fork icon helpers (e.g. `isIconName`)
```

The Rust backend mirrors this split under
[`src-tauri/src/custom/`](../../../src-tauri/src/custom/); see
[Backend seams](#backend-seams).

## Contribution points

| Point | Upstream seam | Shape |
|---|---|---|
| `messages` | `src/lib/i18n.ts` — `mergeCustomMessages` | `{ en, zh_CN, suppress }` |
| `settingsEntries` | `src/lib/settings-entries.ts` — `mergeSettingsEntries` | `{ entry, after }` |
| `publicUtilityRoutes` | `src/lib/public-utility-navigation.ts` | `string[]` |
| `navigationItems` | `src/routes/home/+layout.svelte` | `CustomNavigationItem[]` |
| `routeTitles` | `src/routes/home/+layout.svelte` | `{ path, titleKey }[]` |
| `startup` / `dispose` | `src/routes/+layout.svelte` — `runCustomStartup` / `disposeCustomModules` | hook |
| icon slugs | `scripts/generate-fluent-icons.mjs` — merges `icon-map.ts` into `$lib/fluent/icon-map.ts` | `slug` map |

## Merging an upstream release

```sh
git merge <upstream-ref>        # version fields and the changelog merge on their own
# resolve whatever is left, then:
pnpm merge:prepare              # regenerates Fluent artifacts and re-stamps the Custom version
git commit
```

## Adding a feature

1. Create `modules/<feature>.ts` exporting a `CustomModule`.
2. Append it to `modules/index.ts`.
3. Add its strings to `messages/en.ts` and `messages/zh-CN.ts`.

Data contributions (`messages`, `settingsEntries`, `navigationItems`,
`routeTitles`, `publicUtilityRoutes`) must stay **inert plain values**: seam
files read them while they evaluate their own module body. Behaviour goes in
`startup`/`dispose`, and reaches feature code only through a dynamic
`import()` inside the hook — that is what keeps `settings-entries.ts` and
`i18n.ts` free of the fork's Tauri and store graph.

## Backend seams

The Rust side follows the same rule; the module-level contract lives in
[`src-tauri/src/custom/mod.rs`](../../../src-tauri/src/custom/mod.rs).

- `src-tauri/src/custom/` — fork-owned backend surface: `CustomState` (the one
  field added to `AppHandleState`), `wiring.rs` (start-up, window, and service
  hooks), `diagnostics.rs`, and the `invoke_handler!` macro listing every fork
  IPC command.
- `src-tauri/src/commands/injection/` — fork command adapters. `commands.rs`
  includes `commands/injection/mod.rs` once, which splices them into the
  upstream `commands` module so they keep sharing its private helpers.
- Upstream seams: `lib.rs` keeps one call per start-up concern, the
  `custom: CustomState` field, and the `custom::invoke_handler![..]` line;
  `commands.rs` keeps the single `include!` (plus the fork update-source
  constants).

Adding a backend feature:

1. IPC command — one line in `custom::invoke_handler!` plus an adapter under
   `commands/injection/`.
2. Managed state — one field on `CustomState`.
3. Start-up or window behaviour — one function in `custom/wiring.rs`.

No other hunks in upstream `lib.rs` / `commands.rs` are expected.

## Merge checklist for an upstream bump

- `src/lib/i18n/messages/*.ts`, `src/lib/fluent/icon-map.ts` and
  `src/lib/icons.ts` should show **no** fork diff. Fork strings live in
  `messages/`, fork icon slugs in `icon-map.ts` and fork icon helpers in
  `icons.ts`, all under `src/lib/injection/`.
- Upstream also *deletes* strings the fork still renders (v0.58.0 dropped every
  `settings.extensions.*` entry). Copy them into `messages/{en,zh-CN}.ts`; the
  `src/lib/i18n-keys.test.ts` coverage test fails until they are there.
- `src/lib/fluent/icons.generated.ts` is generated: resolve any conflict by
  running `pnpm assets:fluent`.
- `Cargo.toml`, `Cargo.lock`, `package.json`, `tauri.conf.json`, the iOS
  `Info.plist` and `CHANGELOG.md` are covered by the Git merge drivers in
  `.gitattributes`; `pnpm merge:prepare` re-stamps the Custom version and the
  generated Fluent artifacts.
- Remaining fork hunks in upstream files should only be the seam lines above,
  the backend seams listed under [Backend seams](#backend-seams), and
  `SettingsPlatformScope`'s `'desktop'` value.
