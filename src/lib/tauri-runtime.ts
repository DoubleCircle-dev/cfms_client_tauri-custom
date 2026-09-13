// CFMS Client — Runtime environment detection
//
// The frontend runs in three situations:
//   1. The Tauri webview (native shell) — full IPC, plugins and window APIs.
//   2. A plain browser pointed at the Vite dev server (`pnpm dev`), with the
//      dev-only preview bridge installed (see `$lib/dev/browser-preview`).
//   3. A plain browser without the bridge — every `@tauri-apps/*` call throws
//      *synchronously* (not a rejected promise) and must be guarded by
//      `isTauriRuntime()`.
//
// `__TAURI_INTERNALS__` alone cannot separate case 1 from case 2: the preview
// bridge injects its own mock copy of that global, so the preview flag wins.

declare global {
  interface Window {
    /** Set by the dev-only browser preview bridge. */
    __CFMS_BROWSER_PREVIEW__?: boolean;
    /** Where the preview bridge gets its data from. */
    __CFMS_PREVIEW_MODE__?: 'live' | 'fixtures';
  }
}

/** `true` when the dev-only mock IPC bridge + mock session is installed. */
export function isBrowserPreview(): boolean {
  return typeof window !== 'undefined' && window.__CFMS_BROWSER_PREVIEW__ === true;
}

/**
 * How the preview bridge answers commands, or `null` when it is not active.
 *
 * `live` forwards to the running app's backend (real data); `fixtures` uses the
 * in-memory mock.
 */
export function browserPreviewMode(): 'live' | 'fixtures' | null {
  if (!isBrowserPreview()) return null;
  return window.__CFMS_PREVIEW_MODE__ ?? 'fixtures';
}

/** `true` only inside the real Tauri webview. */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (isBrowserPreview()) return false;
  return '__TAURI_INTERNALS__' in window;
}
