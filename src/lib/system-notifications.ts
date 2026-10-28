// CFMS Client — best-effort OS notifications for transfers that finish while
// the window is in the background.
//
// Transfers keep running either way; these notifications only exist so the user
// learns about completed work without the app stealing focus. Every failure is
// swallowed on purpose: a missing permission or an unsupported platform must
// never affect the transfer itself.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';
import { isTauriRuntime } from './tauri-runtime';

/** Downloads frequently finish in bursts; report the burst as one notification. */
const COMPLETION_WINDOW_MS = 1500;

let permission: boolean | null = null;
let pendingPaths: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function windowIsInBackground(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * Resolves the OS notification permission once. Windows grants it silently;
 * Android shows a system prompt the first time.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (permission !== null) return permission;
  if (!isTauriRuntime()) {
    permission = false;
    return permission;
  }

  try {
    permission = await isPermissionGranted();
    if (!permission) permission = (await requestPermission()) === 'granted';
  } catch {
    permission = false;
  }

  return permission;
}

async function flushCompletions(): Promise<void> {
  flushTimer = null;
  const names = pendingPaths;
  pendingPaths = [];
  if (names.length === 0) return;
  if (!windowIsInBackground()) return;
  if (!(await ensureNotificationPermission())) return;

  const count = names.length;
  const title = String(get(t)('downloads.notifyCompleteTitle'));
  const body =
    count === 1
      ? names[0]
      : String(get(t)('downloads.notifyCompleteMany', { values: { count } }));

  try {
    sendNotification({ title, body });
  } catch {
    // Ignored on purpose: notifications are an extra, never a requirement.
  }
}

/** Queues a finished download for one coalesced background notification. */
export function notifyDownloadCompleted(filePath: string): void {
  pendingPaths.push(fileNameOf(filePath));
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void flushCompletions();
  }, COMPLETION_WINDOW_MS);
}

/**
 * Drops queued completions and forgets the cached permission, so a later
 * listener restart re-checks whether the user revoked notifications meanwhile.
 */
export function resetSystemNotifications(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingPaths = [];
  permission = null;
}
