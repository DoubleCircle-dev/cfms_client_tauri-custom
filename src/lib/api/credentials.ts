// CFMS Client - Credential persistence API.
//
// Provides typed wrappers for saving and loading login credentials
// (username + optionally password) across application restarts.
// The password is encrypted at rest on the Rust side.

import { invoke } from '@tauri-apps/api/core';

export interface SavedCredentials {
  username: string;
  password: string;
}

/** Persist login credentials.
 *
 * When `rememberPassword` is true, the password is encrypted before storage.
 * When false, only the username is saved. */
export async function saveCredentials(
  username: string,
  password: string,
  rememberPassword: boolean,
): Promise<void> {
  return invoke('save_credentials', { username, password, rememberPassword });
}

/** Load previously saved credentials.
 *
 * Returns `null` if no credentials have been saved.  The `password` field is
 * only populated when it was originally saved with `rememberPassword: true`. */
export async function loadCredentials(): Promise<SavedCredentials | null> {
  return invoke('load_credentials');
}

/** Remove all saved credentials. */
export async function clearCredentials(): Promise<void> {
  return invoke('clear_credentials');
}

/** Check whether any credentials (at minimum a username) are saved. */
export async function hasSavedCredentials(): Promise<boolean> {
  return invoke('has_saved_credentials');
}
