---
version: 1
slug: "src-routes-login-page-svelte"
primary_target: "src/routes/login/+page.svelte"
related_targets: ["src/routes/connect/+page.svelte"]
---

# Sign-in

- Visitor mode: Operate. Authenticate with password or public key, with the existing recovery and additional-verification flows.
- Authority: Fluent Operations Workspace in DESIGN.md; all platforms share Fluent with input-aware density.
- Phase-one implementation: Keep the 38.196601125% desktop panel and existing image at 1024px+, image push from the right and reverse retreat with the same decelerating cubic-bezier(0.2, 0, 0, 1) easing in both directions, 600ms timing and direct-entry behavior. Keep avatars, method switch, copy and action order. Username uses the non-sensitive Fluent adapter; passwords/passphrases stay native.
- Preserve authentication, permissions, connection state, screen protection and English/Simplified Chinese. Support both themes, reduced motion, keyboard, touch and narrow/short windows.
- Form material: extend the existing astronomy picture behind the form and use an independent paint layer with the shared 84% neutral account tint, 20px blur and 1.2 saturation. Preserve the desktop clear right-hand image and form/image choreography. Below 1024px, fill the scene with the picture and material behind the full-width form; fade the opaque cover out on connect-to-login navigation and back in on return, using the shared 600ms duration and easing without image movement, scaling or panel resizing. Direct entry shows the destination state; viewport changes do not restart the animation. Without blur support, with reduced transparency or in forced colors, keep the form solid; forced colors uses Canvas. Do not filter or fade the form or its overlay-containing ancestors.
- Brand moment: the circular action and image choreography belong only to authentication; ordinary controls use restrained Fluent feedback.
- Business-page migration is tracked in FLUENT-MIGRATION.md. All platforms use bundled Noto Sans / Noto Sans SC; existing serif text uses Noto Serif / Noto Serif SC.
- Unresolved design decisions: none. Native and cross-platform validation results must be reported separately from implementation.
