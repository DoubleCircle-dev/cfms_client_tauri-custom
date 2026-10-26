// CFMS Client — desktop shell glue (close prompt + tray labels).
//
// The native shell owns the close policy, but it cannot translate anything and
// it has no idea which strings the user is currently seeing. So:
//   * the shell blocks the close and emits `cfms:close-requested`,
//   * this module asks through the shared choice dialog and reports the answer,
//   * and it pushes our translated tray labels down whenever the locale changes.
// Everything here is inert outside the Tauri runtime.

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { _ as t, locale } from 'svelte-i18n';
import { dialogStore } from '$lib/dialogs.svelte';
import {
  dismissCloseRequest,
  resolveCloseRequest,
  syncDesktopShellLabels,
  type CloseRequestAnswer,
  type DesktopTrayLabels,
} from '$lib/api';

/** Emitted by `desktop_shell::handle_window_event` when the policy is "ask". */
const CLOSE_REQUESTED_EVENT = 'cfms:close-requested';

let unlisten: UnlistenFn | null = null;
let unsubscribeLocale: (() => void) | null = null;
/** One prompt at a time; a queued second click would fight the first. */
let prompting = false;

function translate(key: string): string {
  return get(t)(key);
}

function readTrayLabels(): DesktopTrayLabels {
  return {
    show: translate('closeRequest.trayShow'),
    hide: translate('closeRequest.trayHide'),
    quit: translate('closeRequest.trayQuit'),
    tooltip: translate('closeRequest.trayTooltip'),
  };
}

async function promptForClose(): Promise<void> {
  if (prompting) return;
  prompting = true;
  try {
    const answer = await dialogStore.choose<CloseRequestAnswer>({
      title: translate('closeRequest.title'),
      message: translate('closeRequest.message'),
      cancelLabel: translate('common.cancel'),
      applyToAllLabel: translate('closeRequest.remember'),
      choices: [
        {
          value: 'minimize_to_tray',
          label: translate('closeRequest.minimize'),
          description: translate('closeRequest.minimizeHint'),
          icon: 'minimizeToTray',
          intent: 'primary',
        },
        {
          value: 'quit',
          label: translate('closeRequest.quit'),
          description: translate('closeRequest.quitHint'),
          icon: 'quit',
          intent: 'danger',
        },
      ],
    });

    // Dismissing the prompt leaves the window open — the safe default. The
    // shell has to be told, or it would treat the next close click as "quit".
    if (!answer) {
      await dismissCloseRequest();
      return;
    }
    await resolveCloseRequest(answer.value, answer.applyToAll);
  } catch (error) {
    console.warn('[cfms] Unable to resolve the close request', error);
  } finally {
    prompting = false;
  }
}

/** Mirror the current translations into the native tray menu. */
async function pushTrayLabels(): Promise<void> {
  await syncDesktopShellLabels(readTrayLabels());
}

/**
 * Subscribe to close requests and keep the tray menu translated.
 *
 * Safe to call on hosts without a shell (a plain browser, or the preview
 * bridge): `listen` throws synchronously there and the feature stays off.
 */
export async function initDesktopShell(): Promise<void> {
  if (!unlisten) {
    try {
      unlisten = await listen(CLOSE_REQUESTED_EVENT, () => {
        void promptForClose();
      });
    } catch (error) {
      console.warn('[cfms] Close requests are unavailable on this host', error);
    }
  }

  if (!unsubscribeLocale) {
    // Subscribing fires immediately, which is also the initial label push.
    unsubscribeLocale = locale.subscribe(() => {
      void pushTrayLabels();
    });
  }
}

/** Release the listeners (used when the layout tears down). */
export function stopDesktopShell(): void {
  unlisten?.();
  unlisten = null;
  unsubscribeLocale?.();
  unsubscribeLocale = null;
}
