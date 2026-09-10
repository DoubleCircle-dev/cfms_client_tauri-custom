// @vitest-environment jsdom

import '$lib/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore, serverStateStore } from '$lib/stores.svelte';
import SchedulesPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listScheduledTaskTypes: vi.fn(),
  getSchedule: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}));

vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  ...mocks,
}));

const schedule = {
  id: 'schedule-1',
  task_name: 'reports.weekly',
  task_contract_version: 1,
  task_available: true,
  payload: { format: 'pdf' },
  trigger: {
    type: 'cron' as const,
    data: { expression: '0 8 * * 1' },
    timezone: 'Asia/Shanghai',
  },
  enabled: true,
  status: 'active' as const,
  revision: 2,
  next_run_at: 1_789_000_000,
  active_execution_id: null,
  pending_scheduled_for: null,
  created_by: 'admin',
  created_at: 1_788_000_000,
  updated_by: 'admin',
  updated_at: 1_788_000_100,
};

const taskType = {
  name: 'reports.weekly',
  contract_version: 1,
  required_permission: 'manage_system',
  payload_schema: { type: 'object' },
  max_attempts: 3,
};

function signIn(permissions: string[]) {
  authStore.apply({
    username: 'admin',
    nickname: 'Administrator',
    has_token: true,
    token_exp: 1_900_000_000,
    permissions,
    groups: [],
  });
  serverStateStore.connected = true;
}

beforeEach(() => {
  locale.set('en');
  authStore.clear();
  serverStateStore.clear();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listSchedules.mockResolvedValue({
    items: [schedule],
    page_size: 64,
    next_cursor: null,
    has_more: false,
  });
  mocks.listScheduledTaskTypes.mockResolvedValue([taskType]);
  mocks.getSchedule.mockResolvedValue(schedule);
  mocks.createSchedule.mockResolvedValue({ ...schedule, id: 'schedule-2', revision: 1 });
});

afterEach(() => {
  cleanup();
  authStore.clear();
  serverStateStore.clear();
  vi.clearAllMocks();
});

describe('schedules page', () => {
  it('does not call scheduling actions without view permission', () => {
    signIn([]);
    render(SchedulesPage);

    expect(screen.getByRole('heading', { name: 'Schedules unavailable' })).toBeTruthy();
    expect(mocks.listSchedules).not.toHaveBeenCalled();
    expect(mocks.listScheduledTaskTypes).not.toHaveBeenCalled();
  });

  it('loads the core protocol 27 schedule ledger without an extension flag', async () => {
    signIn(['view_schedules']);
    render(SchedulesPage);

    await waitFor(() => expect(mocks.listSchedules).toHaveBeenCalledWith(null, 64, false));
    expect(await screen.findByText('reports.weekly')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New schedule' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /reports\.weekly/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'reports.weekly' })).toBeTruthy();
    expect(screen.getByText('schedule-1')).toBeTruthy();
  });

  it('offers the generic extension-backed editor to schedule managers', async () => {
    signIn(['view_schedules', 'manage_schedules', 'manage_system']);
    render(SchedulesPage);

    await screen.findByText('reports.weekly');
    await fireEvent.click(screen.getByRole('button', { name: 'New schedule' }));

    expect(screen.getByRole('heading', { level: 2, name: 'Create schedule' })).toBeTruthy();
    expect((screen.getByLabelText('Task type') as HTMLSelectElement).value).toBe('reports.weekly');
    expect((screen.getByLabelText('Task payload (JSON)') as HTMLTextAreaElement).value).toBe('{}');

    const createButtons = screen.getAllByRole('button', { name: 'New schedule' });
    await fireEvent.click(createButtons.at(-1)!);
    await waitFor(() => expect(mocks.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      taskName: 'reports.weekly',
      payload: {},
      enabled: true,
    })));
  });

  it('does not offer task mutations when the task-type permission is absent', async () => {
    mocks.listScheduledTaskTypes.mockResolvedValue([]);
    signIn(['view_schedules', 'manage_schedules']);
    render(SchedulesPage);

    await screen.findByText('reports.weekly');
    const createButton = screen.getByRole('button', { name: 'New schedule' }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    expect(createButton.getAttribute('aria-describedby')).toBe('schedule-create-unavailable');
    expect(screen.getByRole('button', { name: 'Why is New schedule unavailable?' }).getAttribute('aria-describedby')).toBe('schedule-create-unavailable');
    expect(screen.getByRole('tooltip').id).toBe('schedule-create-unavailable');
    expect(screen.getByText(/No schedulable task types are available to this account/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Toggle reports.weekly' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('delegates the search input focus ring to its composite field', async () => {
    signIn(['view_schedules']);
    render(SchedulesPage);

    await screen.findByText('reports.weekly');
    expect(screen.getByPlaceholderText('Search this page by task, ID, or owner').getAttribute('data-focus-ring')).toBe('delegated');
  });
});
