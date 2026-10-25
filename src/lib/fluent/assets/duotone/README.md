# Menu duotone icons

These six SVGs are derived from the 20px and 24px Regular outlines of
`folder_add`, `folder_arrow_up`, and `folder_arrow_right` in the pinned
`@fluentui/svg-icons` 1.1.344 package ([Microsoft Fluent System Icons](https://github.com/microsoft/fluentui-system-icons)).
They retain the original geometry and split the folder and action badge into
two explicit paths. A relative initial move in the 20px add/upload badge is
expressed as an equivalent absolute move so it can stand alone.

The folder inherits `currentColor`; the badge uses `--cfms-icon-accent`, falling
back to `currentColor`. `Icon.svelte` supplies the theme accent only when opted
into duotone and restores monochrome in forced colors. Menus opt out for disabled
and dangerous actions. These are locally composed duotone variants, not official
Fluent Color artwork.

Keep both sizes in sync when updating the pinned upstream outlines. The icon
generator imports these authored files without inspecting or splitting paths.
Microsoft's MIT license is included in this directory.
