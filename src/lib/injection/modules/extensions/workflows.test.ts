import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeclarativeWorkflow } from '$lib/injection/modules/extensions/api';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/injection/modules/extensions/api', () => ({
  executeExtensionHostCall: vi.fn(),
  executeExtensionModule: vi.fn(),
  readExtensionWorkflow: vi.fn(),
}));
vi.mock('$lib/stores.svelte', () => ({
  notificationStore: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

import { executeExtensionHostCall, readExtensionWorkflow } from '$lib/injection/modules/extensions/api';
import { runExtensionWorkflow } from './workflows';

const extensionId = 'org.example.scheduler';

function document(expression: unknown): DeclarativeWorkflow {
  return {
    schema_version: 1,
    start: 'map',
    nodes: [
      { id: 'map', type: 'transform', expression, result: 'mapped', next: 'return' },
      { id: 'return', type: 'result', value: '$results.mapped' },
    ],
  };
}

describe('extension workflow expressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps arrays through object templates and evaluates nested if expressions', async () => {
    vi.mocked(readExtensionWorkflow).mockResolvedValue(document({
      op: 'map',
      args: [
        '$input.tasks',
        {
          name: '$item.name',
          kind: {
            op: 'if',
            args: [
              { op: 'eq', args: ['$item.kind', 'interval'] },
              '周期任务',
              '固定时间任务',
            ],
          },
        },
      ],
    }));

    await expect(runExtensionWorkflow(extensionId, 'list', {
      input: {
        tasks: [
          { name: 'Frequent check', kind: 'interval' },
          { name: 'Morning check', kind: 'fixed_time' },
        ],
      },
    })).resolves.toEqual([
      { name: 'Frequent check', kind: '周期任务' },
      { name: 'Morning check', kind: '固定时间任务' },
    ]);
  });

  it('evaluates only the selected if branch', async () => {
    vi.mocked(readExtensionWorkflow).mockResolvedValue(document({
      op: 'if',
      args: [true, 'selected', { op: 'unknown', args: [] }],
    }));

    await expect(runExtensionWorkflow(extensionId, 'branch')).resolves.toBe('selected');
  });

  it('rejects invalid map inputs and oversized arrays', async () => {
    vi.mocked(readExtensionWorkflow).mockResolvedValue(document({
      op: 'map',
      args: ['$input.tasks', '$item'],
    }));
    await expect(runExtensionWorkflow(extensionId, 'invalid', { input: { tasks: {} } }))
      .rejects.toThrow('requires an array');

    await expect(runExtensionWorkflow(extensionId, 'large', {
      input: { tasks: Array.from({ length: 1_025 }, (_, index) => index) },
    })).rejects.toThrow('cannot process more than 1024 items');
  });

  it('confirms batch operations that include update schedules', async () => {
    vi.mocked(readExtensionWorkflow).mockResolvedValue({
      schema_version: 1,
      start: 'save',
      nodes: [
        {
          id: 'save',
          type: 'host_call',
          capability: 'schedules.manage',
          arguments: {
            operation: 'batch',
            upsert: [{ action: 'update', update_policy: 'mirror' }],
            deleteTaskIds: [],
          },
          result: 'saved',
          next: 'return',
        },
        { id: 'return', type: 'result', value: '$results.saved' },
      ],
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(executeExtensionHostCall).mockResolvedValue({ tasks: [], deletedTaskIds: [] });

    await runExtensionWorkflow(extensionId, 'save-schedules');

    expect(confirm).toHaveBeenCalledOnce();
    expect(executeExtensionHostCall).toHaveBeenCalledWith(
      extensionId,
      'schedules.manage',
      expect.objectContaining({ operation: 'batch' }),
      true,
    );
  });
});
