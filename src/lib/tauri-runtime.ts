// CFMS Client — Runtime environment detection
//
// The frontend can run outside the native shell (a browser pointed at the Vite
// dev server, for instance). Every `@tauri-apps/*` call throws *synchronously*
// there — not a rejected promise — so native APIs must be guarded by
// `isTauriRuntime()`.

/** `true` only inside the real Tauri webview. */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
