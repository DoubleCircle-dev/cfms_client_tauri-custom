import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listScheduledTaskTypes,
  listSchedules,
  updateSchedule,
} from './schedules';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const trigger = {
  type: 'interval' as const,
  data: { seconds: 60, start_at: '2026-09-08T00:00:00Z' },
  timezone: 'UTC',
};

describe('schedule API', () => {
  beforeEach(() => invokeMock.mockReset());

  it('maps core protocol 27 reads to dedicated commands', async () => {
    invokeMock.mockResolvedValue([]);
    await listScheduledTaskTypes();
    expect(invokeMock).toHaveBeenLastCalledWith('list_scheduled_task_types');

    invokeMock.mockResolvedValue({ items: [], next_cursor: null, has_more: false, page_size: 64 });
    await listSchedules('cursor', 64, true);
    expect(invokeMock).toHaveBeenLastCalledWith('list_schedules', {
      cursor: 'cursor',
      pageSize: 64,
      includeDeleted: true,
    });

    invokeMock.mockResolvedValue({ id: 'schedule-1' });
    await getSchedule('schedule-1');
    expect(invokeMock).toHaveBeenLastCalledWith('get_schedule', { id: 'schedule-1' });
  });

  it('maps create, partial update, and revision-safe deletion', async () => {
    invokeMock.mockResolvedValue({ id: 'schedule-1' });
    await createSchedule({
      taskName: 'extension.report',
      payload: { format: 'pdf' },
      trigger,
      enabled: true,
    });
    expect(invokeMock).toHaveBeenLastCalledWith('create_schedule', {
      taskName: 'extension.report',
      payload: { format: 'pdf' },
      trigger,
      enabled: true,
    });

    await updateSchedule({ id: 'schedule-1', revision: 3, enabled: false });
    expect(invokeMock).toHaveBeenLastCalledWith('update_schedule', {
      id: 'schedule-1',
      revision: 3,
      taskName: null,
      payload: null,
      trigger: null,
      enabled: false,
    });

    invokeMock.mockResolvedValue(true);
    await deleteSchedule('schedule-1', 4);
    expect(invokeMock).toHaveBeenLastCalledWith('delete_schedule', {
      id: 'schedule-1',
      revision: 4,
    });
  });
});
