---
version: 1
slug: "src-routes-home-manage-page-svelte"
primary_target: "src/routes/home/manage/+page.svelte"
related_targets: ["src/lib/components/SecurityManagement.svelte", "src/lib/components/PermissionEntriesDialog.svelte"]
---

# Administration

- Mode: Operate. Authorized administrators manage accounts, groups, security state and audit records.
- Authority: DESIGN.md. Fluent command/field/state vocabulary, Noto typography and restrained neutral content surfaces.
- Preserve all permission gates, identity-column sizing, responsive metadata/action disclosure, audit filtering, permission editing and authentication policy semantics. Tabs scroll in narrow layouts.
- Reuse the shared action and dialog infrastructure. Complex list/editor behavior remains custom; secrets remain in native inputs. Host styles are isolated from other editors and prompts.
- Implementation/validation inventory: FLUENT-MIGRATION.md; browser fixtures do not prove server integration.
