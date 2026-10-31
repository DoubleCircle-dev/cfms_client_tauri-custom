import type { CustomModule } from '../types';

/** Logs the addresses a peer would use to reach this client, for diagnostics. */
async function logLocalAddresses(): Promise<void> {
  try {
    const { getLocalIpAddresses } = await import('$lib/api');
    const addresses = await getLocalIpAddresses();
    if (addresses.length > 0) {
      console.info(`[cfms] Local IP address(es): ${addresses.join(', ')}`);
    } else {
      console.warn('[cfms] Unable to determine local IP address(es)');
    }
  } catch (error) {
    console.warn('[cfms] Failed to query local IP address(es)', error);
  }
}

/**
 * Fork services that run for the lifetime of the Webview: the background
 * file-update checker (its Rust scheduler keeps running while the app is
 * backgrounded, so the UI only mirrors what it publishes) and the desktop
 * shell's close prompt plus localized tray menu.
 *
 * The feature modules are imported lazily so that reading the registry's data
 * contributions never loads `$lib/api` or the Tauri event bridge.
 */
export const runtimeServices: CustomModule = {
  id: 'runtime-services',
  async startup() {
    const [{ initFileAutoCheck }, { initDesktopShell }] = await Promise.all([
      import('$lib/file-auto-check-events'),
      import('$lib/desktop-shell'),
    ]);
    await initFileAutoCheck();
    await initDesktopShell();
    await logLocalAddresses();
  },
  async dispose() {
    const { disposeFileAutoCheck } = await import('$lib/file-auto-check-events');
    disposeFileAutoCheck();
  },
};
