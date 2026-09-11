// SvelteKit client hooks.
//
// Runs before the app boots — exactly what the dev-only browser preview bridge
// needs: it installs its mock IPC globals and resolves the real session before
// any component (or the root layout's auth guard) evaluates. SvelteKit's client
// entry statically imports this module, so the top-level await is honoured
// before `start()` runs.

import { installBrowserPreview } from '$lib/dev/browser-preview';

await installBrowserPreview();
