---
version: 1
slug: "src-lib-components-authenticationmanagement-svelte"
primary_target: "src/lib/components/AuthenticationManagement.svelte"
related_targets: ["src/routes/home/settings/authentication/+page.svelte","src/lib/components/authentication/AuthenticationFlowGraph.svelte"]
---

# Identity verification management

- Mode: Operate. Account owners and authorized administrators review verification methods and configure when they are required.
- Structure: methods first, flows in a second tab. Each purpose has parallel alternatives and ordered steps, with a clickable diagram and one structured editor. Drafts persist across tabs and purposes; all edited policies save atomically.
- Visual authority: existing PRODUCT.md and DESIGN.md; Fluent controls, semantic theme tokens and bundled Noto typography. Neutral tonal surfaces, restrained selection accent, no new visual identity or graph-library dependency.
- Technical details are disclosed on demand. Multiple steps are offered for public keys only; key identities must be distinct across steps. Server capabilities and this client's execution support are described separately.
- Password and authenticator management share this entry point. Self-service and administrator permissions stay distinct. Setup secrets and newly issued recovery codes stay in component memory, never persisted.
- Narrow layouts put the editor below the graph and stack ordered steps. Preserve light/dark parity, keyboard access, touch targets, and reduced-motion behavior.
