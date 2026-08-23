// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { CaCertificateStatus, CaCertificateUpdateResult, ConnectionSettings, FileEntry } from './types';
import { loadUserPreference, saveUserPreference } from './preferences';

export type RootBackButtonBehavior = 'background' | 'exit';

export interface FileAutoUpdateSettings {
  enabled: boolean;
  intervalMinutes: number;
  /** Download queued updates immediately after an automatic check detects them. */
  autoDownload: boolean;
}

export const DEFAULT_ROOT_BACK_BUTTON_BEHAVIOR: RootBackButtonBehavior = 'exit';
export const DEFAULT_FILE_AUTO_UPDATE_ENABLED = true;
export const DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES = 60;
export const DEFAULT_FILE_AUTO_UPDATE_AUTO_DOWNLOAD = false;

/** Scan a local directory recursively. */
export async function scanDirectory(
  path: string,
  pattern?: string,
): Promise<FileEntry[]> {
  return invoke("scan_directory", { path, pattern: pattern ?? null });
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

/** Read a user setting by key. */
export async function getSetting(key: string): Promise<string | null> {
  return invoke("get_setting", { key });
}

/** Write a user setting. */
export async function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

/** Load the configured behavior for pressing Android back on a root page. */
export async function getRootBackButtonBehavior(): Promise<RootBackButtonBehavior> {
  try {
    const preferences = await loadUserPreference();
    return normalizeRootBackButtonBehavior(preferences.root_back_button_behavior);
  } catch {
    return DEFAULT_ROOT_BACK_BUTTON_BEHAVIOR;
  }
}

/** Persist the configured behavior for pressing Android back on a root page. */
export async function setRootBackButtonBehavior(behavior: RootBackButtonBehavior): Promise<void> {
  const preferences = await loadUserPreference();
  await saveUserPreference({
    ...preferences,
    root_back_button_behavior: behavior,
  });
}

export function normalizeRootBackButtonBehavior(
  value: string | null | undefined,
): RootBackButtonBehavior {
  return value === 'background' ? 'background' : DEFAULT_ROOT_BACK_BUTTON_BEHAVIOR;
}

export function normalizeFileAutoUpdateIntervalMinutes(
  value: number | null | undefined,
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES;
  }
  return Math.max(5, Math.min(24 * 60, Math.floor(value)));
}

/** Load automatic file-update detection settings. */
export async function getFileAutoUpdateSettings(): Promise<FileAutoUpdateSettings> {
  try {
    const preferences = await loadUserPreference();
    return {
      enabled: preferences.file_auto_update_enabled ?? DEFAULT_FILE_AUTO_UPDATE_ENABLED,
      intervalMinutes: normalizeFileAutoUpdateIntervalMinutes(
        preferences.file_auto_update_interval_minutes,
      ),
      autoDownload: preferences.file_auto_update_auto_download ?? DEFAULT_FILE_AUTO_UPDATE_AUTO_DOWNLOAD,
    };
  } catch {
    return {
      enabled: DEFAULT_FILE_AUTO_UPDATE_ENABLED,
      intervalMinutes: DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES,
      autoDownload: DEFAULT_FILE_AUTO_UPDATE_AUTO_DOWNLOAD,
    };
  }
}

/** Persist automatic file-update detection settings. */
export async function setFileAutoUpdateSettings(
  settings: FileAutoUpdateSettings,
): Promise<void> {
  const preferences = await loadUserPreference();
  await saveUserPreference({
    ...preferences,
    file_auto_update_enabled: settings.enabled,
    file_auto_update_interval_minutes: normalizeFileAutoUpdateIntervalMinutes(settings.intervalMinutes),
    file_auto_update_auto_download: settings.autoDownload,
  });
}

/** Get the active backend locale. */
export async function getLocale(): Promise<string> {
  return invoke("get_locale");
}

/** Set the active frontend/backend locale. */
export async function setLocale(language: string): Promise<string> {
  return invoke("set_locale", { language });
}

/** Translate a backend Fluent message key using the active locale. */
export async function translateBackend(key: string): Promise<string> {
  return invoke("translate_backend", { key });
}

/** Load connection settings that are consumed by backend connections. */
export async function getConnectionSettings(): Promise<ConnectionSettings> {
  return invoke("get_connection_settings");
}

/** Save connection settings consumed by backend connections. */
export async function setConnectionSettings(
  settings: ConnectionSettings,
): Promise<void> {
  return invoke("set_connection_settings", { settings });
}

/** Get local CA certificate store status. */
export async function getCaCertificateStatus(): Promise<CaCertificateStatus> {
  return invoke("get_ca_certificate_status");
}

/** Check the remote CA repository and update the local CA certificate store. */
export async function updateCaCertificates(): Promise<CaCertificateUpdateResult> {
  return invoke("update_ca_certificates");
}

// ---------------------------------------------------------------------------
