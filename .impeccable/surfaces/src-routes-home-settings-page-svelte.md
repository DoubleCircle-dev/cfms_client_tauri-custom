---
version: 1
slug: "src-routes-home-settings-page-svelte"
primary_target: "src/routes/home/settings/+page.svelte"
related_targets: ["src/lib/components/SettingsPageHeader.svelte", "src/lib/fluent/surfaces.css"]
---

# Settings

- Mode: Operate. Find and change device/account preferences while understanding security and persistence scope.
- Authority: DESIGN.md. Overview entries use two equal columns within each group at workspace widths of 800px and above, and one column below, in row-major order. Wrap status and descriptive text inside each entry. Shared page hierarchy, 8px sections, 4px fields, semantic states and bundled Noto fonts remain authoritative. Preserve existing serif locations, autosave and reset behavior.
- Shared headings separate titles and descriptions by 8px. Language uses Local Language Globe; selected radio artwork includes a Filled center dot in language, appearance, motion, behavior and update-channel options.
- Every settings subpage follows the shared section/row/field contract. Non-sensitive paths use the Fluent text adapter. Passwords, tokens, PINs, verification data and potentially credential-bearing proxy URLs remain native.
- Preserve connection/account scoping, unavailable/permission states and extension feature gates. Compact desktop layout adapts to touch and narrow windows without hiding explanatory or security copy.
- Implementation/validation inventory: FLUENT-MIGRATION.md.
