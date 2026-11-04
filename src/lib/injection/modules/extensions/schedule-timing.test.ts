import { describe, expect, it } from 'vitest';

import type { ExtensionScheduleTask } from '$lib/injection/modules/extensions/api';
import { getScheduleDueAt, isScheduleOccurrenceMissed } from './schedule-timing';

function task(overrides: Partial<ExtensionScheduleTask> = {}): ExtensionScheduleTask {
  return {
    id: 'sched_test',
    name: 'Test schedule',
    kind: 'interval',
    interval_minutes: 5,
    time_of_day: null,
    days: [1, 2, 3, 4, 5, 6, 7],
    scope: 'all',
    folder_path: null,
    action: 'check',
    update_policy: 'download_only',
    notify: 'problems_only',
    catch_up: true,
    enabled: true,
    workflow: 'task-check',
    created_at: 1_000,
    last_run_at: null,
    last_status: 'never',
    last_summary: null,
    ...overrides,
  };
}

describe('schedule timing', () => {
  it('uses the creation time for the first interval and last run afterward', () => {
    expect(getScheduleDueAt(task(), 300_999)).toBeNull();
    expect(getScheduleDueAt(task(), 301_000)).toBe(301_000);
    expect(getScheduleDueAt(task({ last_run_at: 10_000 }), 310_000)).toBe(310_000);
  });

  it('finds the latest enabled local weekday occurrence after its last run', () => {
    const now = new Date(2026, 10, 4, 9, 15).getTime();
    const due = new Date(2026, 10, 4, 9, 0).getTime();
    expect(getScheduleDueAt(task({
      kind: 'fixed_time',
      interval_minutes: null,
      time_of_day: '09:00',
      days: [3],
      created_at: due - 86_400_000,
    }), now)).toBe(due);
    expect(getScheduleDueAt(task({
      kind: 'fixed_time',
      interval_minutes: null,
      time_of_day: '09:00',
      days: [2],
      created_at: due - 86_400_000,
    }), now)).toBeNull();
  });

  it('reports whether a fixed-time occurrence is outside the tick grace period', () => {
    expect(isScheduleOccurrenceMissed(1_000, 61_000)).toBe(false);
    expect(isScheduleOccurrenceMissed(1_000, 61_001)).toBe(true);
  });
});
