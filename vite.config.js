import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), sveltekit()],

  // iconv-lite (encoding conversion tool) depends on Node's `buffer` module.
  // Alias it to the browser-safe npm package so the webview bundle contains a
  // real Buffer implementation instead of an externalized Node builtin.
  resolve: {
    alias: {
      buffer: fileURLToPath(new URL("./node_modules/buffer/", import.meta.url)),
    },
  },

  // Pre-bundle dependencies at dev-server startup so Vite NEVER discovers a
  // new one mid-session. Without this, Vite optimizes lazily-discovered route
  // imports (e.g. `@tanstack/svelte-virtual` on the files page,
  // `@tauri-apps/api/webview`, `@tauri-apps/plugin-dialog`, `qrcode`,
  // `lottie-web`, `markdown-it`/`dompurify`, …) and triggers a full-page
  // reload ("new dependencies optimized … reloading"). That reload wipes the
  // frontend's in-memory auth/connection state, and the auth guard then
  // redirects to /connect, whose onMount calls `disconnect()` — kicking the
  // user out of an otherwise healthy session ("Disconnected" / "Connection
  // closed" in logs). `noDiscovery` disables the runtime re-scan entirely so
  // no reload can ever be triggered; every runtime dependency is listed here
  // so they are all pre-bundled. When adding a new dependency, add it below.
  optimizeDeps: {
    noDiscovery: true,
    include: [
      // `buffer` (CJS) must be pre-bundled for `import { Buffer } from
      // 'buffer'` in src/lib/tools/encodings.ts to resolve — pre-bundling
      // performs the CJS→ESM interop that raw serving does not.
      "buffer",
      "iconv-lite",
      "@tanstack/svelte-virtual",
      "@tauri-apps/api/app",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/webview",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-biometric",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-log",
      "@tauri-apps/plugin-notification",
      "@tauri-apps/plugin-opener",
      "@tauri-apps/plugin-os",
      "@tauri-apps/plugin-process",
      "@tauri-apps/plugin-updater",
      "dompurify",
      "lottie-web/build/player/lottie_light",
      "markdown-it",
      "markdown-it/lib/token.mjs",
      "qrcode",
      "svelte-i18n",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1909,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1910,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // Production source maps expose implementation details and are not shipped.
    sourcemap: false
  },
}));
