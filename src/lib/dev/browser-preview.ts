// CFMS Client — dev-only browser preview bridge.
//
// `pnpm dev` (and `pnpm tauri dev`) serves the frontend on http://localhost:1909.
// A plain browser has no Tauri runtime, so the app would never get past the
// connect screen. This module closes that gap in one of two modes:
//
//   LIVE      the relay in `scripts/dev-ipc-bridge.mjs` is reachable, so every
//             command is forwarded to the *running app's* backend over the
//             WebView2 CDP debugger. Real connection, real account, real data.
//   FIXTURES  no relay, so a small in-memory mock answers instead. Enough to
//             build and inspect UI, obviously not real data.
//
// Either way the pages themselves are the untouched production routes — only the
// `invoke` responder differs.
//
// Installed from `src/hooks.client.ts`, which awaits it so the app boots with the
// right data source already in place. Inert inside the real Tauri webview and in
// production builds.

import type {
  AppearancePreference,
  AuthStatus,
  ConnectionSettings,
  ExtensionOverview,
  ListDirectoryPageResponse,
  ListDirectoryResponse,
  ServerDirectoryEntry,
  ServerDocumentEntry,
  ServerState,
  UserPreference,
} from '$lib/api';
import { authStore, serverStateStore } from '$lib/stores.svelte';

type MockArgs = Record<string, unknown>;
type MockHandler = (args: MockArgs) => unknown;
type PreviewMode = 'live' | 'fixtures';

// ---------------------------------------------------------------------------
// Relay (live mode)
// ---------------------------------------------------------------------------

const RELAY_BASE = 'http://127.0.0.1:1910';
const RELAY_PROBE_TIMEOUT_MS = 700;
const SESSION_SYNC_INTERVAL_MS = 3_000;

/**
 * Commands that must stay local to *this* page.
 *
 * Event subscription registers a callback id that only exists in the calling
 * page, so forwarding it would make the app's backend try to invoke a handler
 * that lives in a different realm. Events cannot cross the relay anyway, so the
 * preview simply answers them locally and relies on `syncSession` instead.
 */
function isWebviewLocal(command: string): boolean {
  return command.startsWith('plugin:event|') || command === 'plugin:app|register_listener';
}

async function relayInvoke<T = unknown>(command: string, args: MockArgs = {}): Promise<T> {
  const response = await fetch(`${RELAY_BASE}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: command, args: args ?? {} }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { ok: true; value: T }
    | { ok: false; error: string }
    | null;

  if (!payload) throw new Error(`relay returned ${response.status} with no JSON body`);
  if (!payload.ok) throw new Error(payload.error);
  return payload.value;
}

async function relayIsUp(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${RELAY_BASE}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Session mirroring (live mode)
//
// Backend events cannot cross the relay, so the preview polls the two session
// snapshots instead. Values are only written into the stores when they actually
// change, to avoid waking the app's reactive graph on every tick.
// ---------------------------------------------------------------------------

let lastAuthSignature = '';
let lastServerSignature = '';

function applyAuthStatus(next: AuthStatus): void {
  const signature = JSON.stringify(next);
  if (signature === lastAuthSignature) return;
  lastAuthSignature = signature;
  authStore.apply(next);
}

function applyServerState(next: ServerState): void {
  const signature = JSON.stringify(next);
  if (signature === lastServerSignature) return;
  lastServerSignature = signature;
  serverStateStore.apply(next);
}

async function syncSession(): Promise<boolean> {
  try {
    const [auth, server] = await Promise.all([
      relayInvoke<AuthStatus>('get_auth_status'),
      relayInvoke<ServerState>('get_server_state'),
    ]);
    if (auth) applyAuthStatus(auth);
    if (server) applyServerState(server);
    return true;
  } catch (error) {
    console.warn('[cfms preview] session sync failed:', error);
    return false;
  }
}

function startSessionSync(): void {
  const timer = window.setInterval(() => void syncSession(), SESSION_SYNC_INTERVAL_MS);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
}

// ---------------------------------------------------------------------------
// Fixture session (fallback mode)
// ---------------------------------------------------------------------------

const SERVER_ADDRESS = 'wss://preview.cfms.local:5104';
const SERVER_NAME = 'CFMS Preview Server';
const PROTOCOL_VERSION = 22;
const APP_VERSION = '0.0.0-preview';
const LOCALE = 'zh-CN';
const USERNAME = 'preview-user';
const NICKNAME = '预览用户';

/** Mirrors a well-provisioned administrator so every navigation entry shows up. */
const PERMISSIONS = [
  'apply_lockdown',
  'bypass_lockdown',
  'diagnostics',
  'list_deleted_items',
  'list_groups',
  'list_users',
  'manage_system',
  'purge',
  'restore',
  'set_passwd',
  'view_audit_logs',
];

const SERVER_STATE: ServerState = {
  connected: true,
  server_address: SERVER_ADDRESS,
  server_name: SERVER_NAME,
  protocol_version: PROTOCOL_VERSION,
  lockdown: false,
  lockdown_reason: null,
  extension_flags: [],
};

const AUTH_STATUS: AuthStatus = {
  username: USERNAME,
  nickname: NICKNAME,
  has_token: true,
  token_exp: null,
  permissions: PERMISSIONS,
  groups: ['preview'],
  avatar_path: null,
  requires_2fa: false,
};

const CONNECTION_SETTINGS: ConnectionSettings = {
  enable_proxy: false,
  follow_system_proxy: true,
  custom_proxy: '',
  force_ipv4: false,
  client_cert_path: '',
  client_key_path: '',
  remember_connection_addresses: true,
  recent_connection_addresses: [SERVER_ADDRESS],
};

const EXTENSION_OVERVIEW: ExtensionOverview = {
  installed: [],
  accountStates: {},
  catalog: null,
  trustedKeysConfigured: false,
  hostApiVersion: APP_VERSION,
};

/** Device settings the UI reads back after writing (e.g. the disclaimer flag). */
const mockSettings = new Map<string, string>([['disclaimer_accepted', 'true']]);

let mockAppearance: AppearancePreference = {
  color_scheme: 'system',
  reduce_motion: 'system',
};

function mockUserPreference(): UserPreference {
  return {
    appearance: { ...mockAppearance },
    favourites: { files: {}, directories: {} },
    recent_visits: [],
    record_recent_visits: true,
    use_external_storage: false,
    external_storage_path: '',
    root_back_button_behavior: null,
    file_auto_update_enabled: false,
    file_auto_update_interval_minutes: 30,
    file_auto_update_auto_download: false,
    file_auto_detect_on_startup: false,
    sync_git_tracking_enabled: false,
    sync_overwrite_strategy: 'fail',
    privacy: { version: 1, screenshot_protection_enabled: false },
    task_concurrency: { max_downloads: 3, max_uploads: 3 },
    transfer: { max_download_chunk_size: 1_048_576 },
    extensions: {},
  };
}

// Fixture file tree (root key is `root`, i.e. `folderId === null`).

const FOLDERS: Record<string, ServerDirectoryEntry[]> = {
  root: [
    { id: 'dir-projects', name: 'Projects', created_time: null },
    { id: 'dir-documents', name: 'Documents', created_time: null },
  ],
  'dir-projects': [{ id: 'dir-projects-archive', name: 'Archive', created_time: null }],
  'dir-documents': [],
  'dir-projects-archive': [],
};

const DOCUMENTS: Record<string, ServerDocumentEntry[]> = {
  root: [
    { id: 'doc-readme', title: 'README.md', size: 1_248, last_modified: null },
    { id: 'doc-notice', title: 'notice.txt', size: 320, last_modified: null },
  ],
  'dir-projects': [{ id: 'doc-spec', title: 'spec.md', size: 8_192, last_modified: null }],
  'dir-documents': [{ id: 'doc-schedule', title: 'schedule.md', size: 2_048, last_modified: null }],
  'dir-projects-archive': [],
};

const PARENT_IDS: Record<string, string | null> = {
  root: null,
  'dir-projects': 'root',
  'dir-documents': 'root',
  'dir-projects-archive': 'dir-projects',
};

function listDirectory(folderId: unknown): ListDirectoryResponse {
  const id = typeof folderId === 'string' && folderId.length > 0 ? folderId : 'root';
  const key = id in FOLDERS ? id : 'root';
  return {
    folders: FOLDERS[key],
    documents: DOCUMENTS[key],
    parent_id: PARENT_IDS[key],
  };
}

const FIXTURES: Record<string, MockHandler> = {
  // ---- session / bootstrap ------------------------------------------------
  ping: () => 'pong',
  protocol_version: () => PROTOCOL_VERSION,
  crypto_info: () => ({
    kdf_iterations: 180_000,
    salt_len: 16,
    key_len: 32,
    nonce_len: 12,
    tag_len: 16,
  }),
  local_ip_addresses: () => ['127.0.0.1'],
  get_service_status: () => [],
  validate_file_shortcuts: () => ({
    invalid_count: 0,
    invalid_files: [],
    invalid_directories: [],
    access_denied_files: [],
    access_denied_directories: [],
  }),
  get_auth_status: () => ({ ...AUTH_STATUS }),
  get_server_state: () => ({ ...SERVER_STATE }),
  get_local_data_reset_status: () => ({ pending: false, failures: [] }),
  get_2fa_status: () => ({ enabled: false, method: null, backup_codes_count: 0 }),

  // ---- device settings & preferences --------------------------------------
  get_setting: ({ key }) => mockSettings.get(String(key)) ?? null,
  set_setting: ({ key, value }) => {
    mockSettings.set(String(key), String(value));
  },
  get_locale: () => LOCALE,
  set_locale: () => LOCALE,
  translate_backend: ({ key }) => String(key),
  get_connection_settings: () => ({ ...CONNECTION_SETTINGS }),
  set_connection_settings: () => undefined,
  get_ca_certificate_status: () => ({ caDir: '', certificateCount: 0, lastChecked: null }),
  update_ca_certificates: () => ({
    added: [],
    updated: [],
    removed: [],
    unchanged: [],
    errors: [],
    lastChecked: null,
  }),
  load_user_preference: () => mockUserPreference(),
  save_user_preference: () => undefined,
  load_appearance_preference: () => ({ ...mockAppearance }),
  save_appearance_preference: ({ appearance: next }) => {
    if (next && typeof next === 'object') {
      mockAppearance = { ...mockAppearance, ...(next as AppearancePreference) };
    }
  },
  has_saved_credentials: () => false,
  load_credentials: () => null,
  list_credentials: () => [],

  // ---- file tree ----------------------------------------------------------
  list_directory: ({ folderId }) => listDirectory(folderId),
  list_directory_page: ({ folderId, pageSize }): ListDirectoryPageResponse => ({
    ...listDirectory(folderId),
    page_size: typeof pageSize === 'number' ? pageSize : 128,
    next_cursor: null,
    has_more: false,
  }),
  // The preview has no local download root, so nothing is ever on disk.
  check_downloads_exist: () => [],
  compute_local_sha256: () => ({}),

  // ---- transfers ----------------------------------------------------------
  get_download_tasks: () => [],
  get_upload_tasks: () => [],
  list_download_files: () => [],
  download_git_present: () => false,

  // ---- updates ------------------------------------------------------------
  // `null` means "already up to date" — the preview never hits an update server.
  check_app_update: () => null,

  // ---- extensions ---------------------------------------------------------
  get_extension_overview: () => EXTENSION_OVERVIEW,

  // ---- Tauri plugins ------------------------------------------------------
  'plugin:app|version': () => APP_VERSION,
  'plugin:app|name': () => 'CFMS Client',
  'plugin:app|tauri_version': () => '2.11.5',
  'plugin:app|register_listener': () => 0,
  'plugin:os|locale': () => LOCALE,
  'plugin:log|log': () => undefined,
  'plugin:event|listen': () => 0,
  'plugin:event|unlisten': () => undefined,
  'plugin:notification|is_permission_granted': () => false,
  'plugin:notification|notify': () => undefined,
  'plugin:updater|check': () => null,
  'plugin:dialog|open': () => null,
  'plugin:dialog|save': () => null,
  'plugin:dialog|message': () => undefined,
  'plugin:opener|open_url': ({ url }) => {
    if (typeof url === 'string') window.open(url, '_blank', 'noopener,noreferrer');
  },
};

const unhandled = new Map<string, number>();

function runFixture(command: string, args: MockArgs): unknown {
  const handler = FIXTURES[command];
  if (handler) return handler(args ?? {});

  const count = (unhandled.get(command) ?? 0) + 1;
  unhandled.set(command, count);
  if (count === 1) {
    console.debug(
      `[cfms preview] unmocked command "${command}" resolved to null — add a fixture in src/lib/dev/browser-preview.ts`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// IPC shim
// ---------------------------------------------------------------------------

function installIpcShim(mode: PreviewMode): void {
  let nextCallbackId = 1;

  function unregisterCallback(id: number): void {
    delete (window as unknown as Record<string, unknown>)[`_${id}`];
  }

  function transformCallback(callback?: (payload: unknown) => void, once = false): number {
    const id = nextCallbackId++;
    (window as unknown as Record<string, unknown>)[`_${id}`] = (payload: unknown) => {
      if (once) unregisterCallback(id);
      callback?.(payload);
    };
    return id;
  }

  function invoke(command: string, args: MockArgs = {}): Promise<unknown> {
    if (mode === 'fixtures' || isWebviewLocal(command)) {
      try {
        return Promise.resolve(runFixture(command, args));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return relayInvoke(command, args);
  }

  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke,
      transformCallback,
      unregisterCallback,
      convertFileSrc: (filePath: string) => filePath,
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main', windowLabel: 'main' },
      },
    },
    // `@tauri-apps/plugin-os` reads these as plain properties, not functions.
    __TAURI_OS_PLUGIN_INTERNALS__: {
      eol: '\n',
      platform: 'windows',
      version: '',
      family: 'windows',
      os_type: 'windows',
      arch: 'x86_64',
      exe_extension: 'exe',
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener: () => undefined,
    },
    __CFMS_PREVIEW_UNHANDLED__: unhandled,
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Install the preview bridge when the app runs in a plain browser during
 * development. No-op in the Tauri webview, in production builds, and if the
 * bridge is already installed.
 *
 * Awaited from `src/hooks.client.ts`, so the data source is decided before the
 * app (and its auth guard) boots.
 */
export async function installBrowserPreview(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!import.meta.env.DEV) return;
  // The real shell always wins — never shadow a genuine Tauri IPC bridge.
  if ('__TAURI_INTERNALS__' in window) return;
  if (window.__CFMS_BROWSER_PREVIEW__) return;

  const mode: PreviewMode = (await relayIsUp()) ? 'live' : 'fixtures';

  // Must be set before `__TAURI_INTERNALS__` exists, so that `isTauriRuntime()`
  // keeps reporting "not the native shell".
  window.__CFMS_BROWSER_PREVIEW__ = true;
  window.__CFMS_PREVIEW_MODE__ = mode;

  installIpcShim(mode);

  if (mode === 'live') {
    const hydrated = await syncSession();
    startSessionSync();
    console.info(
      hydrated
        ? '[cfms preview] LIVE — commands are forwarded to the running app over CDP; data is real.'
        : '[cfms preview] LIVE — relay attached, but the first session read failed. '
          + 'Is the app past its start-up screen? Retrying every few seconds.',
    );
    return;
  }

  serverStateStore.apply(SERVER_STATE);
  authStore.apply(AUTH_STATUS);
  console.info(
    '[cfms preview] FIXTURES — no relay on :1910, showing mock data. '
    + 'Run "node scripts/dev-ipc-bridge.mjs" (with the app started in debug mode) for real data.',
  );
}
