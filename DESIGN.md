---
name: CFMS Client
description: "Fluent Operations Workspace — Windows 11 clarity, shared across platforms."
colors:
  operational-blue: "#0067c0"
  signal-cyan: "#60cdff"
  light-canvas: "#f3f3f3"
  light-content: "#ffffff"
  light-text: "#242424"
  light-muted: "#616161"
  dark-canvas: "#202020"
  dark-content: "#292929"
  dark-text: "#ffffff"
  dark-muted: "#d6d6d6"
typography:
  display:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, Microsoft YaHei UI, CFMS Noto Sans SC Subset, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "36px"
  headline:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, Microsoft YaHei UI, CFMS Noto Sans SC Subset, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
  title:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, Microsoft YaHei UI, CFMS Noto Sans SC Subset, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, Microsoft YaHei UI, CFMS Noto Sans SC Subset, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, Microsoft YaHei UI, CFMS Noto Sans SC Subset, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  small: "4px"
  medium: "8px"
  large: "12px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.operational-blue}"
    textColor: "{colors.light-content}"
    rounded: "{rounded.small}"
    height: "32px"
    padding: "0 12px"
  surface-content:
    backgroundColor: "{colors.light-content}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.medium}"
---

# Design System: CFMS Client

## Overview

**Creative North Star: "Fluent Operations Workspace"**

CFMS uses Fluent 2 with the calm hierarchy and working density of Windows 11 applications. It is an operational interface for authorized confidential-file work: familiar controls, explicit security feedback, keyboard navigation and readable information lead.

All platforms share Fluent. Native fonts, safe areas and input density adapt to the device; Android does not switch back to Material. Light, dark and system preferences remain user-controlled. Use pinned Fluent UI Web Components, retaining native/custom controls when sensitive data or established behavior requires them.

Phase one establishes the theme, shared controls, system icons, connection/sign-in and application shell. Complex file, task, administration and settings pages inherit the foundations but await individual migration. Inherited colors do not constitute a completed page redesign.

## Colors

The runtime theme module in src/lib/fluent is the authority. Extend the pinned Fluent token themes with operational blue/cyan brand states, Windows-like neutral surfaces and native fonts. Both themes define hover, pressed, selected and disabled states. Use semantic variables such as --colorNeutralForeground1, --colorNeutralBackground1, --colorBrandBackground and --colorStrokeFocus2.

The --color-md3-* and --explorer-* names are migration aliases only, never an independent palette. New shared controls use Fluent tokens. Destructive actions have dedicated tokens. Distinguish errors, warnings, disabled and selected states without color alone. Accent identifies focus, selection, links and primary actions; the circular connection action is the deliberate fluid-color exception.

## Typography

Use Segoe UI Variable / Segoe UI on Windows, native system UI fonts elsewhere, system Chinese fonts and bundled Noto Sans SC fallback. Do not distribute Segoe files. Standard UI is sans-serif; established long-form reading may retain the bundled serif. Technical values may use the existing JetBrains Mono stack.

Use the 12/16, 14/20, 16/22, 20/26 and 28/36 pixel ramp. Default text is regular 14/20; semibold supplies hierarchy. Touch inputs use 16px. Prefer sentence case, baseline alignment and restrained tracking.

## Layout

Preserve the existing top bar, 244px navigation region, flexible content and responsive breakpoints. Desktop navigation rows are about 36px and ordinary buttons 32px; coarse-pointer targets are at least 44px. Use the four-pixel grid, with 24px between major groups.

At 1024px and above, sign-in retains its 38.196601125% form / remaining image composition. Smaller screens hide the image. Preserve pictures, avatars, credential switching, action order and utilities. Above-field labels may improve clarity without rearranging the route.

## Elevation & Depth

Native Windows Mica belongs to the window base and persistent chrome. Expose it only after native code reports successful application. Content, forms and images stay stable. Other platforms and failed application use opaque theme-matched surfaces; forced colors disables Mica.

Acrylic-style CSS surfaces belong to transient menus, flyouts and mobile drawers, with opaque fallback. They are not native desktop Acrylic. Smoke dims content under blocking dialogs. Keep the native system title bar and decorations.

Floating layers use Fluent shadow tokens and fine edge strokes; resting content uses tones and borders. Text stays readable independently of wallpaper.

## Shapes

Use 4px corners for controls, 8px for content and 12px for large modal/flyout surfaces. Circle/pill forms suit avatars, switches and compact states.

**Brand exception:** preserve the circular connection action, fluid gradients, busy color transition, progress and cancellation. Do not copy its treatment to ordinary buttons. Reduced motion must retain understandable, operable states.

## Components

- Prefer official Web Components for buttons, icon buttons, switch, checkbox, radio, spinner and ordinary non-sensitive text input. Register only used components and bundle locally. Thin Svelte adapters own values, events and accessible names; pages never inspect third-party shadow roots.
- Passwords and private-key passphrases stay native. The pinned Text Input reflects its current value into attributes and must not receive secrets. Server history remains the established native combobox. Shared native fields have above-field labels, Fluent borders, validation and one delegated focus indicator.
- Keep the semantic IconName interface. Use local Fluent System Icons SVGs, Regular by default and Filled for selected states. Style .cfms-icon or data-icon rather than font implementation classes.
- Preserve ModalFrame, complex menus and file tables where they encode focus, resizing or business behavior. Restyle shared surfaces rather than replacing behavior for appearance alone.
- One owner paints each focus indicator. Native composites use data-focus-ring="delegated"; Fluent owns its internal focus. Shortcuts respect shadow-boundary editable targets and modal loops include enabled custom controls.
- Ordinary controls use fill/stroke/pressed feedback rather than Material ripples or pronounced spring bounce. State changes generally take 100–200ms; floating layers 200–300ms. Preserve authentication image push/retreat and panel choreography at 600ms, triggered only for route transitions. Honor app/OS reduced motion, including shadow-root animations.

## Do's and Don'ts

- Keep authentication, transfer, permission and security semantics unchanged. Preserve English and Simplified Chinese.
- Test keyboard, touch, both themes, forced colors, reduced motion and native material fallback. Browser previews cannot prove Mica works.
- Keep this global specification, its sidecar and route briefs aligned with implemented values. Record future business-page migration separately.
- Bundle fonts, icons and components locally. Do not add another palette or recreate Material defaults.

References: [tokens](https://fluent2.microsoft.design/design-tokens), [typography](https://fluent2.microsoft.design/typography), [shapes](https://fluent2.microsoft.design/shapes/), [layout](https://fluent2.microsoft.design/layout), [icons](https://fluent2.microsoft.design/iconography), [motion](https://fluent2.microsoft.design/motion), [Windows materials](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials).
