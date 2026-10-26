// CFMS Client — desktop shell IPC.
//
// The close-button policy is a device preference stored by the native shell, so
// the close handler can read it without waiting for the Webview. Menu labels run
// the other way: the Webview owns the translations and pushes them down.

import { invoke } from '@tauri-apps/api/core';

/** What clicking the window's close button does. */
export type CloseButtonBehavior = 'ask' | 'minimize_to_tray' | 'quit';

/** The answer a prompt can produce — `ask` is a policy, not an answer. */
export type CloseRequestAnswer = Exclude<CloseButtonBehavior, 'ask'>;

/** A fresh profile asks every time instead of guessing. */
export const DEFAULT_CLOSE_BUTTON_BEHAVIOR: CloseButtonBehavior = 'ask';

export function normalizeCloseButtonBehavior(value: unknown): CloseButtonBehavior {
  return value === 'minimize_to_tray' || value === 'quit'
    ? value
    : DEFAULT_CLOSE_BUTTON_BEHAVIOR;
}

/** Read the close-button policy, falling back to asking on any failure. */
export async function getCloseButtonBehavior(): Promise<CloseButtonBehavior> {
  try {
    return normalizeCloseButtonBehavior(await invoke('get_close_behavior'));
  } catch {
    return DEFAULT_CLOSE_BUTTON_BEHAVIOR;
  }
}

/** Persist the close-button policy. */
export async function setCloseButtonBehavior(behavior: CloseButtonBehavior): Promise<void> {
  await invoke('set_close_behavior', {
    behavior: normalizeCloseButtonBehavior(behavior),
  });
}

/**
 * Answer a pending "quit or minimize?" prompt.
 *
 * `remember` stores the answer as the new default, which is what the prompt's
 * "remember my choice" checkbox asks for.
 */
export async function resolveCloseRequest(
  action: CloseRequestAnswer,
  remember: boolean,
): Promise<void> {
  await invoke('resolve_close_request', { action, remember });
}

/**
 * Tell the shell the prompt was dismissed without an answer.
 *
 * Without this the shell would treat the window as "still waiting" and let the
 * next close click quit, which is not what dismissing a dialog means.
 */
export async function dismissCloseRequest(): Promise<void> {
  await invoke('resolve_close_request', { action: 'ask', remember: false });
}

export interface DesktopTrayLabels {  show: string;
  hide: string;
  quit: string;
  tooltip: string;
}

/** Push localized tray labels into the native menu. */
export async function syncDesktopShellLabels(labels: DesktopTrayLabels): Promise<void> {
  try {
    await invoke('sync_desktop_shell_labels', { labels });
  } catch (error) {
    // Hosts without a tray (mobile, or a tray that failed to build) are fine.
    console.debug('[cfms] Tray labels not applied', error);
  }
}
