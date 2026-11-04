import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ExtensionOverview,
  ExtensionScheduleTask,
} from '$lib/injection/modules/extensions/api';

const mocks = vi.hoisted(() => ({
  getExtensionOverview: vi.fn(),
  installExtensionFromCatalog: vi.fn(),
  refreshExtensionCatalog: vi.fn(),
  recordExtensionScheduleRun: vi.fn(),
  setExtensionEnabled: vi.fn(),
  updateExtensionSchedule: vi.fn(),
  listen: vi.fn(),
  runExtensionWorkflow: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('$lib/injection/modules/extensions/api', () => ({
  getExtensionOverview: mocks.getExtensionOverview,
  installExtensionFromCatalog: mocks.installExtensionFromCatalog,
  refreshExtensionCatalog: mocks.refreshExtensionCatalog,
  recordExtensionScheduleRun: mocks.recordExtensionScheduleRun,
  setExtensionEnabled: mocks.setExtensionEnabled,
  updateExtensionSchedule: mocks.updateExtensionSchedule,
}));
vi.mock('$lib/injection/modules/extensions/workflows', () => ({
  runExtensionWorkflow: mocks.runExtensionWorkflow,
}));
vi.mock('$lib/injection/modules/extensions/trust', () => ({
  canAutoUpdateExtension: vi.fn(),
}));
vi.mock('$lib/stores.svelte', () => ({
  notificationStore: { error: vi.fn(), success: vi.fn() },
}));

import { extensionsStore } from './store.svelte';

const extensionId = 'org.example.scheduler';

function task(id: string, workflow: string): ExtensionScheduleTask {
  return {
    id,
    name: id,
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
    workflow,
    created_at: 0,
    last_run_at: null,
    last_status: 'never',
    last_summary: null,
  };
}

function overview(tasks: ExtensionScheduleTask[]): ExtensionOverview {
  return {
    installed: [{
      manifest: {
        schema_version: 1,
        id: extensionId,
        name: 'Scheduler',
        description: '',
        publisher: 'Tests',
        version: '1.0.0',
        host_api: '1.0.0',
        min_client_version: '0.0.0',
        platforms: [],
        entrypoints: { navigation: [], settings: [], workflows: [] },
        requested_capabilities: [],
        background_triggers: [],
        content_hashes: {},
      },
      package_digest: '',
      signing_key_id: null,
      install_epoch: '',
      state: 'installed',
      installed_at: 0,
      previous_version: null,
      last_error: null,
      disk_bytes: 0,
    }],
    accountStates: {
      [extensionId]: {
        enabled: true,
        installEpoch: '',
        grantedCapabilities: [],
        settings: null,
        staleInstallation: false,
      },
    },
    schedules: { [extensionId]: tasks },
    catalog: null,
    trustedKeysConfigured: false,
    hostApiVersion: '1.0.0',
    supportedHostApiVersions: ['1.0.0'],
  };
}

describe('extension schedule runner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T10:00:00'));
    vi.clearAllMocks();
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.getExtensionOverview.mockResolvedValue(overview([task('task-a', 'run-a')]));
    mocks.recordExtensionScheduleRun.mockImplementation(async (
      _extensionId: string,
      taskId: string,
      status: string,
      summary: string | null,
    ) => ({
      ...task(taskId, `run-${taskId}`),
      last_run_at: Date.now(),
      last_status: status,
      last_summary: summary,
    }));
    mocks.runExtensionWorkflow.mockResolvedValue({ ok: true, output: 'completed' });
  });

  afterEach(async () => {
    await extensionsStore.activateForAccount(null);
    vi.useRealTimers();
  });

  it('runs due tasks as background workflows with their task as input', async () => {
    await extensionsStore.activateForAccount('account-a');
    await vi.waitFor(() => expect(mocks.runExtensionWorkflow).toHaveBeenCalledTimes(1));

    expect(mocks.runExtensionWorkflow).toHaveBeenCalledWith(
      extensionId,
      'run-a',
      expect.objectContaining({ background: true, input: { task: expect.objectContaining({ id: 'task-a' }) } }),
    );
    expect(mocks.recordExtensionScheduleRun).toHaveBeenCalledWith(
      extensionId,
      'task-a',
      'success',
      'completed',
    );
  });

  it('records concurrently due tasks as skipped and retries them on the next tick', async () => {
    let finishFirst!: (value: unknown) => void;
    mocks.getExtensionOverview.mockResolvedValue(overview([
      task('task-a', 'run-a'),
      task('task-b', 'run-b'),
    ]));
    mocks.runExtensionWorkflow.mockImplementation((_id: string, workflow: string) => {
      if (workflow === 'run-a') {
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve({ ok: true, output: 'completed' });
    });

    await extensionsStore.activateForAccount('account-b');
    await vi.waitFor(() => expect(mocks.runExtensionWorkflow).toHaveBeenCalledTimes(1));
    expect(mocks.recordExtensionScheduleRun).toHaveBeenCalledWith(
      extensionId,
      'task-b',
      'skipped',
      'Deferred while another task was running',
    );

    finishFirst({ ok: true, output: 'first complete' });
    await vi.waitFor(() => expect(mocks.recordExtensionScheduleRun).toHaveBeenCalledWith(
      extensionId,
      'task-a',
      'success',
      'first complete',
    ));
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(mocks.runExtensionWorkflow).toHaveBeenCalledTimes(2));
    expect(mocks.runExtensionWorkflow).toHaveBeenLastCalledWith(
      extensionId,
      'run-b',
      expect.objectContaining({ background: true }),
    );
  });
});
