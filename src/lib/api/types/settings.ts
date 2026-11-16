import type { ServerObjectType } from './files';

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// User preference types
// ---------------------------------------------------------------------------

/** Per-user application preferences stored as an encrypted file.
 *
 *  Mirrors the Python `UserPreference` dataclass. */
export interface UserPreference {
  appearance: AppearancePreference;
  favourites: Favourites;
  recent_visits: RecentVisitPreferenceRecord[];
  record_recent_visits: boolean;
  use_external_storage: boolean;
  external_storage_path: string;
  file_auto_update_enabled?: boolean;
  file_auto_update_interval_minutes?: number;
  file_auto_update_auto_download?: boolean;
  file_auto_detect_on_startup?: boolean;
  sync_git_tracking_enabled?: boolean;
  sync_overwrite_strategy?: SyncOverwriteStrategy;
  /** App-lock verifier material is never exposed through general preferences. */
  app_lock?: null;
  root_back_button_behavior?: "background" | "exit" | null;
  privacy?: PrivacyPreference;
  task_concurrency: TaskConcurrencyPreference;
  transfer: TransferPreference;
}

export type ColorSchemePreference = 'light' | 'dark' | 'system';

export type ReduceMotionPreference = 'always' | 'never' | 'system';

export interface AppearancePreference {
  color_scheme: ColorSchemePreference;
  reduce_motion: ReduceMotionPreference;
}

export interface PrivacyPreference {
  version: 1;
  screenshot_protection_enabled: boolean;
}

export interface TaskConcurrencyPreference {
  max_downloads: number;
  max_uploads: number;
}

export interface TransferPreference {
  max_download_chunk_size: number;
}

export type SyncOverwriteStrategy = 'force_overwrite' | 'backup_rename' | 'skip';

export interface Favourites {
  files: Record<string, string>;
  directories: Record<string, string>;
}

export interface RecentVisitPreferenceRecord {
  type: ServerObjectType;
  id: string;
  name: string;
  parentId?: string | null;
  visitedAt: number;
}
