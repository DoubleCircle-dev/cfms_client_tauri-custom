---
version: 1
slug: "src-routes-home-layout-svelte"
primary_target: "src/routes/home/+layout.svelte"
related_targets: []
---

# Application shell

- Visitor mode: Operate. Navigate permitted document workflows and account/session actions.
- Authority: Fluent Operations Workspace in DESIGN.md; all platforms share Fluent with input-aware density.
- Keep top bar, 244px navigation, route structure, existing keyboard regions, favorite entries and 820px drawer breakpoint. Mica appears in persistent Windows chrome and the shared workspace base only after native confirmation; content cards, forms and tables retain their readable fills. Menus and mobile drawer use Acrylic-style CSS.
- Preserve authentication, permissions, connection state, screen protection and English/Simplified Chinese. Support both themes, reduced motion, keyboard, touch and narrow/short windows.
- Brand moment: the circular action and image choreography belong only to authentication; ordinary controls use restrained Fluent feedback.
- Business-page migration is tracked in FLUENT-MIGRATION.md. All platforms use bundled Noto Sans / Noto Sans SC; existing serif text uses Noto Serif / Noto Serif SC.
- The content container exposes the same confirmed Mica base across the entire available area, including below or beside short/centered pages; route wrappers stay transparent. Without confirmed Mica it owns an opaque theme-matched background; forced colors uses a solid system canvas. Elevation uses icon-only geometry: 32px square on desktop, at least 44px on coarse pointers.
- Unresolved design decisions: none. Native and cross-platform validation results must be reported separately from implementation.
