// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadTaskGroup } from '$lib/download-task-groups';
import DownloadTaskGroupHeader from './DownloadTaskGroupHeader.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string, options?: { values?: Record<string, unknown> }) => string) => void) {
      run((key, options) => {
        const values = options?.values
          ? `:${Object.values(options.values).join(',')}`
          : '';
        return `${key}${values}`;
      });
      return () => undefined;
    },
  },
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

afterEach(() => cleanup());

const noop = async () => undefined;

function group(overrides: Partial<DownloadTaskGroup> = {}): DownloadTaskGroup {
  return {
    id: 'batch-1',
    name: 'Evidence bundle',
    rootId: 'root-1',
    createdAt: 1,
    tasks: [],
    total: 39,
    pending: 0,
    scheduled: 0,
    rateLimited: 0,
    queueRateLimited: 0,
    rateLimitWaiting: false,
    running: 0,
    paused: 0,
    completed: 20,
    deleted: 0,
    failed: 0,
    cancelled: 0,
    discovered: 39,
    queued: 20,
    currentBytes: 20,
    totalBytes: 39,
    progress: 20 / 39,
    progressKnown: true,
    preparing: false,
    batchPaused: false,
    phase: null,
    ...overrides,
  };
}

function renderHeader(value: DownloadTaskGroup) {
  return render(DownloadTaskGroupHeader, {
    group: value,
    expanded: false,
    onToggle: vi.fn(),
    onPause: noop,
    onResume: noop,
    onRetry: noop,
    onCancel: noop,
    onDeleteFiles: noop,
    onRemoveRecords: noop,
  });
}

describe('DownloadTaskGroupHeader rate-limit feedback', () => {
  it('explains queue-time throttling instead of falling back to Preparing', () => {
    renderHeader(group({
      preparing: true,
      phase: 'queueing',
      failed: 19,
      queueRateLimited: 19,
    }));

    expect(screen.getByText(/tasks\.batchQueueRateLimitedCount:19/)).toBeTruthy();
    expect(screen.queryByText('tasks.batchProgressPending')).toBeNull();
  });

  it('explains that rate-limited scheduled tasks will retry automatically', () => {
    renderHeader(group({
      pending: 19,
      scheduled: 19,
      rateLimited: 19,
    }));

    expect(screen.getByText('tasks.batchRateLimitedCount:19')).toBeTruthy();
    expect(screen.queryByText('tasks.batchProgressPending')).toBeNull();
  });
});
