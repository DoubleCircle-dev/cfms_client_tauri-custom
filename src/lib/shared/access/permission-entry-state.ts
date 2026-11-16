import type { PermissionEntry } from '$lib/api';

export type PermissionEntryState = 'active' | 'scheduled' | 'expired';

export function permissionEntryState(
  entry: PermissionEntry,
  nowSeconds = Date.now() / 1000,
): PermissionEntryState {
  if (entry.start_time > nowSeconds) return 'scheduled';
  if (entry.end_time !== null && entry.end_time < nowSeconds) return 'expired';
  return 'active';
}
