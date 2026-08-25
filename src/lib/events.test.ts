// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadTaskDto, ServiceEvent } from './api';
import { initEventListeners, stopEventListeners } from './events';
import { downloadStore } from './stores.svelte';

const eventCallbacks = vi.hoisted(() => new Map<string, (payload: { payload: unknown }) => void>());

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (payload: { payload: unknown }) => void) => {
    eventCallbacks.set(name, callback);
    return () => eventCallbacks.delete(name);
  }),
}));

function task(taskId: string): DownloadTaskDto {
  return {
    task_id: taskId,
    file_id: 'document-1',
    filename: 'report.pdf',
    file_path: 'C:/Downloads/report.pdf',
    status: 'pending',
    progress: 0,
    current_bytes: 0,
    total_bytes: 0,
    message: null,
    error: null,
    created_at: 1,
    started_at: null,
    completed_at: null,
    priority: 2,
    retry_count: 0,
    max_retries: 3,
    scheduled_time: null,
    stage: 0,
    bandwidth_limit: null,
    pause_position: null,
    supports_resume: true,
    server_task_recreate_count: 1,
    batch_id: 'batch-1',
  };
}

afterEach(() => {
  stopEventListeners();
  eventCallbacks.clear();
  downloadStore.tasks.clear();
  downloadStore.activeBadgeCount = 0;
});

describe('download replacement events', () => {
  it('removes the stale id and inserts the recreated task without a ghost record', async () => {
    downloadStore.tasks.set('stale-task', task('stale-task'));
    await initEventListeners();

    const replacement = task('fresh-task');
    const event: ServiceEvent = {
      event: 'DownloadTaskReplaced',
      data: { old_task_id: 'stale-task', task: replacement },
    };
    eventCallbacks.get('cfms:event')?.({ payload: event });

    expect(downloadStore.tasks.has('stale-task')).toBe(false);
    expect(downloadStore.tasks.get('fresh-task')).toEqual(replacement);
    expect(downloadStore.tasks.size).toBe(1);
    expect(downloadStore.activeBadgeCount).toBe(1);
  });
});
