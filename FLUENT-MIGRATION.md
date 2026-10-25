# Fluent migration inventory

The migration preserves routes, server protocols, preferences, permission checks and workflow semantics. Existing `md3` and `explorer` names remain aliases of the Fluent theme, not independent design systems.

## Implemented batches

- [x] Typography: local Noto Sans, Noto Sans SC, Noto Serif, Noto Serif SC and JetBrains Mono; variable WOFF2 400–800, dynamic character coverage and bundled OFL licenses. Inter and legacy TTF assets removed.
- [x] Shared foundations: Fluent action adapters, native sensitive/special fields, settings sections/rows, typography ramp, control radii, opaque business surfaces and Acrylic-style context menus. Ordinary ripple code removed. Host styles are isolated by owner; icon-only attributes and focus loops handle custom controls.
- [x] Files and recycle bin: command/address/status bars, details, table typography and surfaces, selection/search/sort/revision controls, move/picker/access-rule dialogs. Fixed row geometry and viewport anchoring share desktop/touch density.
- [x] Transfers and schedules: page headings, filters, tabs, progress/status labels, grouped actions, task rows and schedule editor. Virtualized keyboard targets include Fluent buttons; rows remeasure when fonts finish loading.
- [x] Settings: overview and account, activity, app-lock, appearance, authentication, behavior, connection, data, extensions, GitHub API, language, privacy, storage, tasks, two-factor and updates. Settings sections and native fields share styling; non-sensitive path fields use the Fluent adapter. Proxy URLs remain native because they can contain credentials. Feature gates remain unchanged.
- [x] Administration: account/group actions, security, audit filters, permission lists/editors and authentication policies. Existing metadata collapse, column sizing and permission gates remain in place.
- [x] Other surfaces: overview, more, about, diagnostics, extension renderer/host, initialization, recovery, app lock/PIN, lockdown, disclaimer, update prompt, release highlights and Markdown/changelog reading. Existing serif locations use Noto Serif.
- [x] Authentication/shell regression boundary: the circular connection action, login composition, 600ms image transition and native Mica logic are retained.

## Validation record

- `pnpm check`: zero errors and zero warnings; focus-ring and generated Fluent asset contracts pass.
- `pnpm test`: 775 tests across 114 files pass, including offline font coverage, custom-control interoperability, dialog focus wrapping and desktop/touch virtual-list anchoring.
- `pnpm build`: production static build passes.
- Browser fixtures: 1280×720 desktop and 390×844 narrow windows, light/dark themes, English/Simplified Chinese, fine/coarse pointers, reduced motion and forced colors. File/transfer/management data, settings, paths, about and overview surfaces were inspected; no document-level horizontal overflow, page errors or external asset requests were observed.
- Browser font inspection confirms locally supplied Noto Sans / Serif and SC semibold glyphs for Latin and dynamic Chinese text, including `龘`; Fluent shadow content inherits the same Noto stack.
- Browser previews use synthetic IPC fixtures and do not validate server integration. Native Mica behavior is preserved but was not revalidated in a native client during this pass. Android device/safe-area/soft-keyboard acceptance remains unverified; no Gradle compilation was attempted because host TUN mode was not confirmed.
- Temporary preview server and headless verification browsers are shut down after validation.
