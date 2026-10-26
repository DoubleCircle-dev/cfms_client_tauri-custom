# Menu duotone icons

These SVGs are derived from the Regular outlines of `folder_add`,
`folder_arrow_up`, `folder_arrow_right`, `copy`, `shield_settings`,
`password_reset`, and `person_circle` in the pinned
`@fluentui/svg-icons` 1.1.344 package ([Microsoft Fluent System Icons](https://github.com/microsoft/fluentui-system-icons)).
They retain the original geometry and split the neutral body and accent detail
into two explicit paths. Both 20px and 24px outlines are used where available;
`password_reset` retains its upstream 48px viewBox and scales to either size.
Relative initial moves in extracted details are expressed as equivalent
absolute moves so they can stand alone. Counter paths stay with their outlines.

The body inherits `currentColor`; the folder badge, front copy sheet, settings
gear, reset arrow, or person uses `--cfms-icon-accent`, falling back to
`currentColor`. `Icon.svelte` supplies the theme accent only when opted
into duotone and restores monochrome in forced colors. Menus opt out for disabled
and dangerous actions. These are locally composed duotone variants, not official
Fluent Color artwork.

Keep both sizes in sync when updating the pinned upstream outlines. The icon
generator imports these authored files without inspecting or splitting paths.
Microsoft's MIT license is included in this directory.
