---
version: 1
slug: "src-routes-home-tasks-page-svelte"
primary_target: "src/routes/home/tasks/+page.svelte"
related_targets: ["src/routes/home/schedules/+page.svelte", "src/lib/components/TaskActionButton.svelte", "src/lib/components/ScheduleEditor.svelte"]
---

# Transfers and schedules

- Mode: Operate. Review progress and recover ongoing or failed transfers; configure permitted schedules.
- Authority: DESIGN.md. Shared Fluent actions, readable Noto status/data typography, fixed type ramp, compact progress rows and explicit error/warning states.
- Preserve pause/resume/cancel/retry, grouped transfers, batching, conflict decisions, direct-ID downloads and schedule semantics. Filters/tabs stay keyboard operable and narrow tab strips scroll.
- Virtual list keyboard targets include native and Fluent actions; remeasure variable rows when fonts load. Coarse-pointer controls remain at least 44px.
- Transfer headings have 24px top spacing, reduced to 16px below 520px; titles use 28/36px, descriptions 14/20px with an 8px gap. Descriptions remain visible on narrow windows.
- Implementation/validation inventory: FLUENT-MIGRATION.md.
