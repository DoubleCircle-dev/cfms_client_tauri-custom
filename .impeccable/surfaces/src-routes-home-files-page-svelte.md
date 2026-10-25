---
version: 1
slug: "src-routes-home-files-page-svelte"
primary_target: "src/routes/home/files/+page.svelte"
related_targets: ["src/routes/home/trash/+page.svelte", "src/lib/components/files/FileTable.svelte", "src/lib/components/explorer/ExplorerCommandBar.svelte"]
---

# Document workspace

- Mode: Operate. Authorized staff browse and manage permission-governed documents.
- Authority: DESIGN.md. Opaque content, compact Fluent commands, semantic selection/status, bundled Noto typography; preserve original serif exceptions.
- Preserve address/history navigation, sorting, multi-selection, virtualization, viewport anchoring, marquee, drag/drop, revisions, recycle-bin and access-rule workflows.
- Desktop rows are 40px; coarse-pointer rows 48px. Rendering and all coordinate calculations share this density. Commands remeasure after fonts load; narrow command bars collapse labels and scroll.
- Tables and complex menus remain custom behavior components. Ordinary commands use the Fluent adapter; secret and special inputs remain native. Both themes, keyboard, forced colors, reduced motion and touch follow the shared contract.
- Implementation/validation inventory: FLUENT-MIGRATION.md. Native/device results are separate from browser fixtures.
