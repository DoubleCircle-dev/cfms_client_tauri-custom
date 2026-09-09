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
  createDownloadPlaceholder,
  deleteDownloadFile,
  downloadGitCommit,
  downloadGitInit,
  getDocument,
  listDirectory,
  listDownloadFiles,
  moveDownloadFile,
} from '$lib/api/files';
import { isAccessDeniedError } from '$lib/api/server-errors';
import { getSyncGitTrackingEnabled, type SyncOverwriteStrategy } from '$lib/api/settings';
import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api/types';
import { dialogStore } from '$lib/dialogs.svelte';
import { downloadStore, notificationStore } from '$lib/stores.svelte';

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

  /**
   * Atomically claim the sync lock. `syncAllFiles` used to do
   * `if (busy) return; busy = true` across an await boundary, which let two
   * syncs interleave — the automatic-download run would then silently no-op.
   */
  acquire(): boolean {
    if (this.busy) return false;
    this.busy = true;
    return true;
  }

  release() {
    this.busy = false;
  }
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
  /** Whether the download root is versioned with git. Overrides the stored setting. */
  gitTracking?: boolean;
  /** How to handle files whose server revision differs from the local copy.
   *  Automatic downloads pass the stored setting; manual syncs omit this and
   *  are prompted for a choice instead. */
  overwriteStrategy?: 'force_overwrite' | 'backup_rename' | 'skip';
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
  if (!syncAllCoordinator.acquire()) return emptyResult();
  const overwriteLocal = options.overwriteLocal ?? false;
  const confirmDeletes = options.confirmDeletes ?? true;
  const { onStatus, onError, onRefresh } = options;

  // Git version tracking is an explicit user setting (Settings > File Sync).
  // When enabled, every sync that downloads/updates files commits a snapshot.
  // The local repo is initialized lazily here; if init fails, tracking is
  // silently disabled for this run (the settings toggle itself reports the
  // failure and reverts).
  let hasGit = options.gitTracking ?? await getSyncGitTrackingEnabled().catch(() => false);
  if (hasGit) {
    try {
      await downloadGitInit();
    } catch (err) {
      console.warn('%c[cfms:sync] Git init failed, tracking disabled for this run:', 'color:#ffb74d', err);
      hasGit = false;
    }
  }

  // Overwrite strategy for files whose server revision differs from the local
  // copy. Git tracking implies force-overwrite (history lives in commits).
  // Callers pass the stored setting for automatic downloads; manual syncs omit
  // it and are prompted below once the differing files are known.
  let strategy: SyncOverwriteStrategy | null = hasGit
    ? 'force_overwrite'
    : (options.overwriteStrategy ?? null);
  const backupSuffix = `+${backupTimestamp()}`;

  let queued = 0;
  let skipped = 0;
  let updated = 0;
  let deleted = 0;
  let moved = 0;
  let requestCount = 0;
  const serverPaths = new Set<string>();          // all server file paths
  const walkedDirs = new Set<string>();           // relative dir paths that were listed successfully
  const failedDirs = new Set<string>();           // relative dir paths that failed to list (inaccessible)
  // Downloads are deferred until after the walk so we can detect server-side
  // moves/renames (same content at a different path) and avoid re-downloading.
  const pendingDownloads: { docId: string; path: string; serverHash: string | null | undefined; existsLocally: boolean }[] = [];
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

  async function listWithRetry(dirId: string | null): Promise<{ folders: ServerDirectoryEntry[]; documents: ServerDocumentEntry[] }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await throttleDownload();
        return await listDirectory(dirId);
      } catch (err) {
        const msg = String(err);
        if ((msg.includes('429') || msg.includes('503')) && attempt === 0) {
          const match = msg.match(/retry_after_seconds["']?\s*:\s*(\d+)/);
          const waitSec = match ? parseInt(match[1], 10) : 3;
          console.log(`%c[cfms:sync] Rate limited (list), retrying in ${waitSec}s…`, 'color:#ffb74d');
          await new Promise(r => setTimeout(r, waitSec * 1000 + 500));
          continue;
        }
        throw err;
      }
    }
    throw new Error('listDirectory failed after retries');
  }

  /**
   * Create a same-named empty placeholder file for a server item that exists
   * but is inaccessible (permission denied). The backend creates any missing
   * parent directories, so nested paths never surface "os error 3". Failures
   * are logged and ignored — a placeholder is best-effort only.
   */
  async function createPlaceholderSafe(relativePath: string) {
    if (!relativePath || relativePath === 'download') return;
    try {
      await createDownloadPlaceholder(relativePath);
    } catch (err) {
      console.warn(`%c[cfms:sync] Placeholder failed for ${relativePath}:`, 'color:#ffb74d', err);
    }
  }

  async function walk(dirId: string | null, pathParts: string[]) {
    let resp: { folders: ServerDirectoryEntry[]; documents: ServerDocumentEntry[] };
    try {
      resp = await listWithRetry(dirId);
    } catch (err) {
      // Never delete anything under a directory we could not list — otherwise
      // a transient failure would make the deletion step treat its files as gone.
      const dirPath = makeDownloadPath(pathParts);
      failedDirs.add(dirPath);
      // A folder that exists on the server but is inaccessible (permission
      // denied) is mirrored locally as a same-named empty placeholder file so
      // the local tree reflects the server instead of silently dropping it.
      if (isAccessDeniedError(err) && dirPath !== 'download') {
        await createPlaceholderSafe(dirPath);
        serverPaths.add(dirPath);
        console.warn(`%c[cfms:sync] Access denied — placeholder created: ${dirPath}`, 'color:#ef9a9a');
      } else {
        console.warn(`%c[cfms:sync] Skipping unreachable directory (files preserved): ${dirPath || '/'}`, 'color:#ffb74d');
      }
      return;
    }
    // Record that this directory was successfully enumerated, so the deletion
    // step only removes files whose parent directory we actually inspected.
    walkedDirs.add(makeDownloadPath(pathParts));
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
      const hasServerHash = serverHash != null;
      // Server version differs from local copy
      const mismatch = existsLocally && hasServerHash && localHash !== serverHash;
      // Skip strategy: leave outdated local files untouched.
      if (mismatch && strategy === 'skip') {
        skipped++;
        continue;
      }
      const needsDownload = !isDownloaded && (!existsLocally || mismatch || overwriteLocal || strategy === 'force_overwrite');

      if (needsDownload) {
        pendingDownloads.push({ docId: doc.id, path: downloadPath, serverHash, existsLocally });
      } else {
        skipped++;
      }
    }
    for (const f of resp.folders) {
      await walk(f.id, [...pathParts, f.name]);
    }
  }

  /**
   * Decide whether a local file must be preserved because its disappearance
   * from the server cannot be confirmed. Walks the ancestor chain upward:
   *  - any ancestor that failed to list (rate limit, access denied) → preserve;
   *  - no successfully listed ancestor at all (root list failed) → preserve;
   *  - otherwise the file's parent was listed directly (normal case) or is
   *    absent from a listed parent — i.e. its folder was deleted server-side,
   *    so the file becomes a deletion candidate.
   * The local directory structure itself is always preserved, even when a
   * folder ends up empty.
   */
  function shouldPreserveLocalFile(parentDir: string): boolean {
    let dir = parentDir;
    while (true) {
      if (failedDirs.has(dir)) return true;
      if (walkedDirs.has(dir)) return false;
      if (dir === 'download') return true; // root was never listed
      dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : 'download';
    }
  }

  try {
    await walk(null, []);

    // Manual syncs (no preset strategy, no git tracking) ask the user how to
    // handle local files whose server revision differs. Cancelling skips the
    // updates — the least destructive interpretation.
    if (!hasGit && strategy === null) {
      const conflicting = pendingDownloads.filter(d => d.existsLocally);
      if (conflicting.length > 0) {
        const choice = await dialogStore.choose<SyncOverwriteStrategy>({
          title: get(t)('files.syncOverwriteTitle'),
          message: get(t)('files.syncOverwriteMessage', { values: { count: conflicting.length } }),
          choices: [
            { value: 'backup_rename', label: get(t)('settings.fileSync.overwriteBackup'), description: get(t)('settings.fileSync.overwriteBackupHint'), icon: 'history', intent: 'primary' },
            { value: 'force_overwrite', label: get(t)('settings.fileSync.overwriteForce'), description: get(t)('settings.fileSync.overwriteForceHint'), icon: 'update', intent: 'danger' },
            { value: 'skip', label: get(t)('settings.fileSync.overwriteSkip'), description: get(t)('settings.fileSync.overwriteSkipHint'), icon: 'cancel', intent: 'neutral' },
          ],
        });
        strategy = choice?.value ?? 'skip';
        if (strategy === 'skip') {
          for (const d of conflicting) {
            const idx = pendingDownloads.indexOf(d);
            if (idx >= 0) pendingDownloads.splice(idx, 1);
            skipped++;
          }
        }
      } else {
        strategy = 'backup_rename';
      }
    }

    // --- Collect local files no longer on server ---
    const allLocalFiles = await listDownloadFiles();
    const deleteCandidates: string[] = [];
    for (const rawPath of allLocalFiles) {
      // Normalize separators — the backend may return '\' on Windows while
      // serverPaths always uses '/'. Normalize here so the comparison is
      // robust regardless of backend behavior.
      const localPath = rawPath.replace(/\\/g, '/');
      // Never treat git metadata as a syncable file, even if an older or
      // external listing surfaces it — deleting from .git destroys the repo,
      // and .gitignore keeps large downloads out of the repo.
      if (localPath === '.git' || localPath.startsWith('.git/') || localPath === '.gitignore') continue;
      if (serverPaths.has(localPath)) continue;
      const parentDir = localPath.includes('/')
        ? localPath.slice(0, localPath.lastIndexOf('/'))
        : 'download';
      if (shouldPreserveLocalFile(parentDir)) continue;
      deleteCandidates.push(localPath);
    }

    // Compute SHA-256 of deletion candidates so we can detect server-side moves
    // (same content at a different path) and avoid delete + re-download.
    let deleteHashes: Record<string, string> = {};
    if (deleteCandidates.length > 0) {
      try {
        deleteHashes = await computeLocalSha256(deleteCandidates);
      } catch { /* ignore */ }
    }

    // Match deletion candidates against brand-new server files by content hash.
    const toMove: { from: string; to: string; download: { docId: string; path: string; serverHash: string | null | undefined; existsLocally: boolean } }[] = [];
    const toDelete: string[] = [];
    const newDownloads = pendingDownloads.filter(d => !d.existsLocally);
    for (const candidate of deleteCandidates) {
      const hash = deleteHashes[candidate];
      if (hash) {
        const idx = newDownloads.findIndex(d => d.serverHash != null && d.serverHash === hash);
        if (idx >= 0) {
          const download = newDownloads.splice(idx, 1)[0];
          toMove.push({ from: candidate, to: download.path, download });
          continue;
        }
      }
      toDelete.push(candidate);
    }

    // Remaining downloads: unmatched new files + local files that need overwriting.
    const toDownload = [
      ...newDownloads,
      ...pendingDownloads.filter(d => d.existsLocally),
    ];

    // Execute moves first (non-destructive, no confirmation needed).
    for (const plan of toMove) {
      try {
        const ok = await moveDownloadFile(plan.from, plan.to);
        if (ok) {
          moved++;
          console.log(`%c[cfms:sync] Moved: ${plan.from} → ${plan.to}`, 'color:#4fc3f7');
        } else {
          // Source file vanished — fall back to delete + download.
          toDelete.push(plan.from);
          toDownload.push(plan.download);
        }
      } catch {
        // Move failed — fall back to delete + download.
        toDelete.push(plan.from);
        toDownload.push(plan.download);
      }
    }

    // Confirm and execute deletions.
    if (toDelete.length > 0) {
      const fileList = toDelete.slice(0, 8).join('\n')
        + (toDelete.length > 8 ? `\n… +${toDelete.length - 8} more` : '');
      // With git tracking, deletions are recorded in the sync commit, so they
      // apply directly without an extra confirmation prompt.
      let confirmed = !confirmDeletes || hasGit;
      if (confirmDeletes && !hasGit) {
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

    // Execute downloads.
    for (const d of toDownload) {
      try {
        let overwrite = d.existsLocally;
        if (strategy === 'backup_rename' && d.existsLocally) {
          // Preserve the outdated local copy under a timestamped name before
          // downloading the new revision.
          const backupPath = `${d.path}${backupSuffix}`;
          try {
            const renamed = await moveDownloadFile(d.path, backupPath);
            if (renamed) {
              overwrite = false;
              console.log(`%c[cfms:sync] Backup: ${d.path} → ${backupPath}`, 'color:#ffb74d');
            }
          } catch { /* rename failed — fall through and overwrite */ }
        }
        await downloadWithRetry(d.docId, d.path, overwrite);
        if (d.existsLocally) updated++; else queued++;
      } catch (err) {
        // A document that exists on the server but cannot be downloaded
        // (permission denied) is mirrored locally as a same-named empty
        // placeholder file instead of being silently skipped.
        if (isAccessDeniedError(err)) {
          await createPlaceholderSafe(d.path);
          serverPaths.add(d.path);
          console.warn(`%c[cfms:sync] Access denied — placeholder created: ${d.path}`, 'color:#ef9a9a');
        }
      }
    }

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
        get(t)('files.syncCompleted', { values: { downloaded: queued, updated, moved, deleted } }),
      );
    } else {
      onStatus?.(get(t)('files.syncAllUpToDate'));
    }
    await onRefresh?.();

    // --- Git version tracking (only when the user keeps a repo in the download root) ---
    if (changed && hasGit && (queued + updated > 0)) {
      // Wait for async download tasks to finish writing files to disk.
      // getDocument returns immediately — the actual download runs in the
      // background. Without waiting, git would snapshot incomplete files.
      const activeCount = downloadStore.activeTasks.length;
      if (activeCount > 0) {
        console.log('%c[cfms:sync] Waiting for %d active download(s) to finish before git commit…', 'color:#4fc3f7', activeCount);
        await waitForActiveDownloads();
      }
    }
    if (changed && hasGit) {
      try {
        const msgParts: string[] = [];
        if (queued > 0) msgParts.push(`+${queued}`);
        if (updated > 0) msgParts.push(`~${updated}`);
        if (deleted > 0) msgParts.push(`-${deleted}`);
        if (moved > 0) msgParts.push(`→${moved}`);
        const timestamp = localTimestamp();
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
    syncAllCoordinator.release();
  }
}

function emptyResult(): SyncAllResult {
  return { queued: 0, updated: 0, deleted: 0, moved: 0, skipped: 0, changed: false };
}

/** Format the current local time as `YYYY-MM-DD HH:mm:ss` (local timezone). */
function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Filename-safe timestamp (`YYYYMMDD-HHmmss`) for pre-update backup copies. */
function backupTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Wait until no active (pending/downloading/verifying) download tasks remain. */
function waitForActiveDownloads(maxWaitMs = 300_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  return new Promise<void>((resolve) => {
    const check = () => {
      const active = downloadStore.activeTasks.length;
      if (active === 0) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        console.warn('%c[cfms:sync] Timed out waiting for %d active download(s) to finish', 'color:#ffb74d', active);
        resolve();
        return;
      }
      setTimeout(check, 2000);
    };
    check();
  });
}
