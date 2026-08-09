// CFMS Client — Shared "Sync All Files" logic.
//
// Used by the Files page (manual "Sync all files" button) and by the
// Overview page (automatic sync when polling detects server changes).
// Keeping it here means the auto-sync can run regardless of which page
// is currently mounted.

import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';
import {
  computeLocalSha256,
  deleteDownloadFile,
  downloadGitCommit,
  downloadGitInit,
  getDocument,
  listDirectory,
  listDownloadFiles,
} from '$lib/api/files';
import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api/types';
import { dialogStore } from '$lib/dialogs.svelte';
import { notificationStore } from '$lib/stores.svelte';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function sanitizeDownloadPathSegment(part: string) {
  return part
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeDownloadPath(parts: string[]) {
  const safeParts = parts.map(sanitizeDownloadPathSegment).filter(Boolean);
  return safeParts.length > 0 ? safeParts.join('/') : 'download';
}

// ---------------------------------------------------------------------------
// Sync-all state (shared across pages)
// ---------------------------------------------------------------------------

class SyncAllCoordinator {
  /** Whether a full sync is currently running (shared across all pages). */
  busy = $state(false);
}

export const syncAllCoordinator = new SyncAllCoordinator();

// ---------------------------------------------------------------------------
// Sync-all implementation
// ---------------------------------------------------------------------------

const DOWNLOAD_BATCH_SIZE = 25;
const DOWNLOAD_BATCH_DELAY_MS = 2500;

export interface SyncAllOptions {
  /** Overwrite existing local files even when hashes match server. Default false. */
  overwriteLocal?: boolean;
  /** Ask for confirmation before deleting stale local files. Default true. */
  confirmDeletes?: boolean;
  /** Called with a status message when the sync summary is ready. */
  onStatus?: (message: string) => void;
  /** Called with an error message on failure. */
  onError?: (message: string) => void;
  /** Called when downloaded-file indicators should be refreshed. */
  onRefresh?: () => Promise<void> | void;
}

export interface SyncAllResult {
  queued: number;
  updated: number;
  deleted: number;
  moved: number;
  skipped: number;
  changed: boolean;
}

export async function syncAllFiles(options: SyncAllOptions = {}): Promise<SyncAllResult> {
  if (syncAllCoordinator.busy) return emptyResult();
  syncAllCoordinator.busy = true;
  const overwriteLocal = options.overwriteLocal ?? false;
  const confirmDeletes = options.confirmDeletes ?? true;
  const { onStatus, onError, onRefresh } = options;

  let queued = 0;
  let skipped = 0;
  let updated = 0;
  let deleted = 0;
  let moved = 0;
  let requestCount = 0;
  const serverPaths = new Set<string>();          // all server file paths
  const startTime = performance.now();
  console.log('%c[cfms:sync] Full recursive sync starting (throttled: %d per %ds)…', 'color:#4fc3f7', DOWNLOAD_BATCH_SIZE, DOWNLOAD_BATCH_DELAY_MS / 1000);

  async function throttleDownload() {
    requestCount++;
    if (requestCount > 0 && requestCount % DOWNLOAD_BATCH_SIZE === 0) {
      console.log(`%c[cfms:sync] Throttling — %d requests sent, pausing %ds…`, 'color:#ffb74d', requestCount, DOWNLOAD_BATCH_DELAY_MS / 1000);
      await new Promise(r => setTimeout(r, DOWNLOAD_BATCH_DELAY_MS));
    }
  }

  async function downloadWithRetry(docId: string, path: string, overwrite: boolean): Promise<{ already_exists?: boolean } | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await throttleDownload();
        return await getDocument(docId, path, undefined, overwrite);
      } catch (err) {
        const msg = String(err);
        if (msg.includes('429') && attempt === 0) {
          const match = msg.match(/retry_after_seconds["']?\s*:\s*(\d+)/);
          const waitSec = match ? parseInt(match[1], 10) : 3;
          console.log(`%c[cfms:sync] Rate limited, retrying in ${waitSec}s…`, 'color:#ffb74d');
          await new Promise(r => setTimeout(r, waitSec * 1000 + 500));
          continue;
        }
        throw err;
      }
    }
    return null;
  }

  async function walk(dirId: string | null, pathParts: string[]) {
    let resp: { folders: ServerDirectoryEntry[]; documents: ServerDocumentEntry[] };
    try {
      resp = await listDirectory(dirId);
    } catch {
      return;
    }
    // Compute local SHA-256 for all files in this directory
    const filenames = resp.documents.map(d => makeDownloadPath([...pathParts, d.title]));
    let localHashes: Record<string, string> = {};
    try {
      localHashes = await computeLocalSha256(filenames);
    } catch { /* ignore */ }

    for (const doc of resp.documents) {
      const downloadPath = makeDownloadPath([...pathParts, doc.title]);
      serverPaths.add(downloadPath);
      const localHash = localHashes[downloadPath];
      const serverHash = doc.sha256;
      // File is "downloaded" if SHA-256 matches
      const isDownloaded = localHash != null && serverHash != null && localHash === serverHash;
      // If server has no hash, fall back to file existence
      const existsLocally = !!localHash;
      const needsDownload = !isDownloaded && (!existsLocally || overwriteLocal);

      if (needsDownload) {
        try {
          await downloadWithRetry(doc.id, downloadPath, overwriteLocal && existsLocally);
          if (existsLocally) updated++; else queued++;
        } catch { /* skip */ }
      } else if (isDownloaded) {
        skipped++;
      } else if (existsLocally && !isDownloaded && !overwriteLocal) {
        // File exists but hash doesn't match (or server lacks hash) and overwrite is off
        skipped++;
      }
    }
    for (const f of resp.folders) {
      await walk(f.id, [...pathParts, f.name]);
    }
  }

  try {
    await walk(null, []);

    // --- Sync deletions: remove local files no longer on server ---
    try {
      const allLocalFiles = await listDownloadFiles();
      const toDelete: string[] = [];
      for (const localPath of allLocalFiles) {
        if (serverPaths.has(localPath)) continue;
        // Preserve hidden folders/files (e.g. .debugging) — only reachable via search,
        // not the regular directory tree, so they naturally won't be in serverPaths.
        if (localPath.split('/').some(seg => seg.startsWith('.'))) continue;
        toDelete.push(localPath);
      }
      if (toDelete.length > 0) {
        const fileList = toDelete.slice(0, 8).join('\n')
          + (toDelete.length > 8 ? `\n… +${toDelete.length - 8} more` : '');
        let confirmed = !confirmDeletes;
        if (confirmDeletes) {
          confirmed = await dialogStore.confirm({
            title: get(t)('files.syncDeleteTitle'),
            message: `${get(t)('files.syncDeleteMessage', { values: { count: toDelete.length } })}\n\n${fileList}`,
            confirmLabel: get(t)('common.delete'),
            cancelLabel: get(t)('common.cancel'),
            danger: true,
          });
        }
        if (confirmed) {
          for (const localPath of toDelete) {
            try {
              await deleteDownloadFile(localPath);
              console.log(`%c[cfms:sync] Removed: ${localPath}`, 'color:#ef9a9a');
              deleted++;
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore scan errors */ }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    const parts: string[] = [];
    if (queued > 0) parts.push(`${queued} downloaded`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (deleted > 0) parts.push(`${deleted} deleted`);
    if (moved > 0) parts.push(`${moved} moved`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    console.log(`%c[cfms:sync] Done in ${elapsed}s: ${parts.join(', ')}`, 'color:#4caf50');

    const changed = queued + updated + deleted + moved > 0;
    if (changed) {
      onStatus?.(
        get(t)('files.syncCompleted', { values: { downloaded: queued, updated } }),
      );
    } else {
      onStatus?.(get(t)('files.syncAllUpToDate'));
    }
    await onRefresh?.();

    // --- Git version tracking ---
    if (changed) {
      try {
        await downloadGitInit();
        const msgParts: string[] = [];
        if (queued > 0) msgParts.push(`+${queued}`);
        if (updated > 0) msgParts.push(`~${updated}`);
        if (deleted > 0) msgParts.push(`-${deleted}`);
        if (moved > 0) msgParts.push(`→${moved}`);
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const commitMsg = `sync ${timestamp}: ${msgParts.join(' ')}`;
        const hash = await downloadGitCommit(commitMsg);
        if (hash) {
          console.log(`%c[cfms:sync] Git commit: ${hash.slice(0, 7)} — ${commitMsg}`, 'color:#a5d6a7');
        }
      } catch (gitErr) {
        console.warn('%c[cfms:sync] Git tracking skipped:', 'color:#ffb74d', gitErr);
      }
    }

    return { queued, updated, deleted, moved, skipped, changed };
  } catch (err) {
    const message = String(err);
    onError?.(message);
    notificationStore.error(message, 5000);
    return emptyResult();
  } finally {
    syncAllCoordinator.busy = false;
  }
}

function emptyResult(): SyncAllResult {
  return { queued: 0, updated: 0, deleted: 0, moved: 0, skipped: 0, changed: false };
}
