// CFMS Client — Background file-check glue
//
// Wires the Rust `file_auto_check` service to the reactive UI state: subscribes
// once for the lifetime of the Webview, seeds the tracker with whatever the
// service already knows, and surfaces a check that found something.
//
// Kept apart from `$lib/file-auto-check` (which is a pure IPC wrapper) and from
// the tracker (which must not depend on the layout) so neither side has to know
// about the other's imports.

import { _ as t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { notificationStore } from '$lib/stores.svelte';
import { fileUpdateTracker } from '$lib/file-update-tracker.svelte';
import {
  getFileAutoCheckState,
  subscribeFileAutoCheck,
  type FileAutoCheckReport,
} from '$lib/file-auto-check';

let unsubscribe: (() => void)[] | null = null;
let initialized = false;

/** Subscribe to the background checker and mirror its current state. */
export async function initFileAutoCheck(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const unlisten = await subscribeFileAutoCheck(
    (report) => applyReport(report),
    (schedule) => fileUpdateTracker.applySchedule(schedule),
  );
  unsubscribe = unlisten ? unlisten.map((fn) => () => fn()) : null;

  await refreshFileAutoCheckState();
}

/** Re-read the scheduler state, e.g. after the signed-in account changed. */
export async function refreshFileAutoCheckState(): Promise<void> {
  const state = await getFileAutoCheckState();
  if (!state) return;
  fileUpdateTracker.applySchedule(state.schedule);
  if (state.report) applyReport(state.report);
}

/** Stop listening (Webview teardown only; the service keeps running). */
export function disposeFileAutoCheck(): void {
  for (const off of unsubscribe ?? []) off();
  unsubscribe = null;
  initialized = false;
}

function applyReport(report: FileAutoCheckReport) {
  const recorded = fileUpdateTracker.applyAutoCheckReport(report);
  if (!recorded || (report.outdated === 0 && (report.deletions?.length ?? 0) === 0)) return;
  notificationStore.info(describeReport(report), 5000);
}

function describeReport(report: FileAutoCheckReport): string {
  const parts: string[] = [];
  if (report.outdated > 0) {
    parts.push(get(t)('files.checkHistoryUpdates', { values: { count: report.outdated } }));
  }
  if (report.denied > 0) {
    parts.push(get(t)('files.checkHistoryDenied', { values: { count: report.denied } }));
  }
  if ((report.deletions?.length ?? 0) > 0) {
    parts.push(get(t)('files.serverChangesDeletedFiles', {
      values: { count: report.deletions.length },
    }));
  }
  return get(t)('files.serverChangesDetected', { values: { changes: parts.join(', ') } });
}
