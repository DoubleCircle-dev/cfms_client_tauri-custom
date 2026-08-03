// CFMS Client - Credential persistence API (multi-account, scoped by server).
//
// Provides typed wrappers for saving and loading login credentials
// (server_hash + username + optionally password) across application restarts.
// Credentials are keyed by `(server_hash, username)` to avoid collisions
// when the same username exists on different servers.
// Supports multiple accounts so users can switch without re-typing.
// The password is encrypted at rest on the Rust side.

import { invoke } from '@tauri-apps/api/core';

export interface SavedCredentials {
  serverHash: string;
  username: string;
  password: string;
}

/** Lightweight summary returned when listing saved accounts. */
export interface CredentialSummary {
  serverHash: string;
  username: string;
  hasPassword: boolean;
  lastUsedAt: number;
}

/** Persist (or update) login credentials for a given username.
 *
 * When `rememberPassword` is true, the password is encrypted before storage.
 * When false, only the username is saved.
 * If an entry for this username already exists it is updated. */
export async function saveCredentials(
  username: string,
  password: string,
  rememberPassword: boolean,
): Promise<void> {
  return invoke('save_credentials', { username, password, rememberPassword });
}

/** Load previously saved credentials.
 *
 * When `username` is provided, returns that specific account.
 * When omitted, returns the most recently used account.
 * Returns `null` if no credentials have been saved.
 * The `password` field is only populated when it was originally saved
 * with `rememberPassword: true`. */
export async function loadCredentials(
  username?: string,
): Promise<SavedCredentials | null> {
  return invoke('load_credentials', { username: username ?? null });
}

/** List all saved credential summaries for the current server.
 *
 * Pass `serverHash` to filter by a specific server instead.
 * Passwords are never included. */
export async function listCredentials(serverHash?: string): Promise<CredentialSummary[]> {
  return invoke('list_credentials', { serverHash: serverHash ?? null });
}

/** Delete a single saved credential entry by username. */
export async function deleteCredential(username: string): Promise<void> {
  return invoke('delete_credential', { username });
}

/** Remove all saved credentials. */
export async function clearCredentials(): Promise<void> {
  return invoke('clear_credentials');
}

/** Check whether any credentials (at minimum a username) are saved. */
export async function hasSavedCredentials(): Promise<boolean> {
  return invoke('has_saved_credentials');
}
