---
version: 1
slug: "src-routes-home-settings-account-page-svelte"
primary_target: "src/routes/home/settings/account/+page.svelte"
related_targets: ["src/lib/components/AccountPermissions.svelte"]
---

# My account

- Mode: Operate. Every signed-in user can inspect their own account without management permissions. Extend the existing account settings route; the top account menu and Settings lead to this one destination.
- Authority: DESIGN.md. Shared settings header and refresh action, 64px editable avatar, a 960px maximum reading area, two-column basic information becoming one column below 640px. Preserve nickname editing and the existing authentication-page link.
- Fetch only getUserInfo for the current authenticated user ID. Server, account and request sequencing isolate all results; first entry, re-entry, reconnect and manual refresh load data. Keep same-session stale data visibly marked on failed refresh. Never overwrite authentication permissions from the profile response.
- Present server effective permissions as the final result, separately from personal and group source sets. Collapsed inline details show read-only direct grants, revocations and time windows; never fetch group management data. Keep permission identifiers literal and long values wrapped.
- The avatar uses the shared permission helper and document picker. Saving has explicit busy feedback. Logout, server/account changes and unmount invalidate asynchronous updates; closing the picker restores avatar focus. An older profile read cannot undo a successful nickname write.
- Preserve bilingual content, local-zone timestamps, unknown-versus-empty states, focusable scroll regions, touch density and theme/accessibility fallbacks. Local browser QA used synthetic data at 1280px light Chinese and 390px dark English; it does not validate native Mica or Android hardware.
- Unresolved design decisions: none.
