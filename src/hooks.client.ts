// SvelteKit client hooks.
//
// Runs before the app boots — exactly what the dev-only browser preview bridge
// needs: it installs its mock IPC globals and resolves the real session before
// any component (or the root layout's auth guard) evaluates. SvelteKit awaits
// the `init` hook before it parses routes and loads anything.
//
// This deliberately does NOT use a top-level `await`. The production bundle is
// transpiled for es2020, where top-level await is a syntax error, so
// `tauri build` failed on the app entry while `pnpm dev` (which never transpiles
// the entry for a browser target) stayed happy.

import { installBrowserPreview } from '$lib/dev/browser-preview';

/** Runs once, before the app starts; a no-op outside the dev browser preview. */
export async function init(): Promise<void> {
  await installBrowserPreview();
}
