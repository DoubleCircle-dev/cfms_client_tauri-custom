// The plain-browser host has no Tauri IPC at all: `invoke` throws synchronously.
// These tests deliberately leave `@tauri-apps/api/core` unmocked so the real
// fallbacks are exercised the way the dev preview hits them.
import { describe, expect, it } from 'vitest';
import { getCloseButtonBehavior, resolveCloseRequest, syncDesktopShellLabels } from './desktop-shell';

describe('desktop shell without a native host', () => {
  it('falls back to asking for the close behaviour', async () => {
    await expect(getCloseButtonBehavior()).resolves.toBe('ask');
  });

  it('does not throw when tray labels cannot be pushed', async () => {
    await expect(
      syncDesktopShellLabels({
        show: 'Show main window',
        hide: 'Hide to tray',
        quit: 'Quit CFMS Client',
        tooltip: 'CFMS Client',
      }),
    ).resolves.toBeUndefined();
  });

  it('still reports a failure when the answer cannot be delivered', async () => {
    await expect(resolveCloseRequest('quit', false)).rejects.toBeTruthy();
  });
});
