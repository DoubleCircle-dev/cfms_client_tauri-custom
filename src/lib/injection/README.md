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

## Merge checklist for an upstream bump

- `src/lib/i18n/messages/*.ts`, `src/lib/fluent/icon-map.ts` and
  `src/lib/icons.ts` should show **no** fork diff. Fork strings live in
  `messages/`, fork icon slugs in `icon-map.ts` and fork icon helpers in
  `icons.ts`, all under `src/lib/injection/`.
- `src/lib/fluent/icons.generated.ts` is generated: resolve any conflict by
  running `pnpm assets:fluent`.
- `Cargo.toml`, `Cargo.lock`, `package.json`, `tauri.conf.json`, the iOS
  `Info.plist` and `CHANGELOG.md` are covered by the Git merge drivers in
  `.gitattributes`; after the merge, restore the Custom version with
  `pnpm app:version custom <upstream-base>`.
- Remaining fork hunks in upstream files should only be the seam lines above
  and `SettingsPlatformScope`'s `'desktop'` value.
