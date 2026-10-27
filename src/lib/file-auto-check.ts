// CFMS Client — Automatic file-update check bridge
//
// The recurring check runs in the Rust `file_auto_check` service, not in this
// Webview: the platform throttles (or freezes) Webview timers as soon as the app
// leaves the foreground, which is exactly when a background check is supposed to
// happen. The service owns the interval, the recursive comparison and — when the
// user enabled it — the downloads.
//
// This module is the typed surface the UI uses to read that state and to follow
// the events the service publishes.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauriRuntime } from '$lib/tauri-runtime';

/** Emitted with a {@link FileAutoCheckReport} when a background check finishes. */
export const FILE_AUTO_CHECK_EVENT = 'cfms:file-auto-check';

/** Emitted with a {@link FileAutoCheckSchedule} when the timer moves. */
export const FILE_AUTO_CHECK_SCHEDULE_EVENT = 'cfms:file-auto-check-schedule';

/** One document the background check found to be missing or outdated locally. */
export interface FileAutoCheckItem {
  id: string;
  title: string;
  /** Download-root-relative path, which is also the display path. */
  path: string;
  sha256: string | null;
  /** `true` when a local file already occupies `path` (a replacement). */
  existedLocally: boolean;
}

/** Result of one background check. */
export interface FileAutoCheckReport {
  /** Account the check ran for. */
  account: string;
  checkedAt: number;
  nextCheckAt: number;
  outdated: number;
  denied: number;
  dirs: number;
  docs: number;
  items: FileAutoCheckItem[];
  deletions: string[];
  deleted: number;
  /** Whether "download updates immediately" was enabled for this run. */
  autoDownload: boolean;
  downloaded: number;
  downloadFailed: number;
  skipped: number;
}

/** Timer state of the background checker (Unix milliseconds, `0` when idle). */
export interface FileAutoCheckSchedule {
  lastCheckAt: number;
  nextCheckAt: number;
}

/** Everything the UI needs to mirror the background checker. */
export interface FileAutoCheckState {
  report: FileAutoCheckReport | null;
  schedule: FileAutoCheckSchedule;
}

/** Read the last report and the current timer state. */
export async function getFileAutoCheckState(): Promise<FileAutoCheckState | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<FileAutoCheckState>('get_file_auto_check_state');
  } catch (error) {
    console.warn('[cfms:check] Could not read the background check state:', error);
    return null;
  }
}

/**
 * Restart the background countdown from now.
 *
 * Used after a manual check, which runs in the Webview: without this the
 * scheduler would fire its own check moments later.
 */
export async function rebaseFileAutoCheckSchedule(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('rebase_file_auto_check_schedule');
  } catch (error) {
    console.warn('[cfms:check] Could not rebase the background check schedule:', error);
  }
}

/**
 * Subscribe to the background checker's events.
 *
 * Returns the unsubscribe functions, or `null` when the host has no event bridge
 * (a plain browser, or the browser preview's mock IPC).
 */
export async function subscribeFileAutoCheck(
  onReport: (report: FileAutoCheckReport) => void,
  onSchedule: (schedule: FileAutoCheckSchedule) => void,
): Promise<UnlistenFn[] | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await Promise.all([
      listen<FileAutoCheckReport>(FILE_AUTO_CHECK_EVENT, (event) => onReport(event.payload)),
      listen<FileAutoCheckSchedule>(FILE_AUTO_CHECK_SCHEDULE_EVENT, (event) => onSchedule(event.payload)),
    ]);
  } catch (error) {
    console.warn('[cfms:check] Could not subscribe to the background checker:', error);
    return null;
  }
}
