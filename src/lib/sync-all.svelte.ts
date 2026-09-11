// CFMS Client — File sync engine.
//
// Every download goes through `syncFiles`. It executes a *plan*, which comes
// from one of two places:
//
//   * the whole server tree  → "sync all files"    (also reconciles deletions)
//   * the last update check  → "confirm updates"   (no re-scan)
//
// Both plans are compared against the download root by the same predicate and
// run through the same download loop, so the checker and the sync engine cannot
// disagree about which local files need fetching.

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
// Server-vs-local comparison
// ---------------------------------------------------------------------------

/**
 * Whether a local copy is *provably* the server revision.
 *
 * A server that reports no hash cannot prove a local copy is current, so such a
 * document counts as outdated and is fetched. Keeping this rule in one exported
 * predicate is what stops the checker and the two sync modes from disagreeing.
 */
export function isLocalCopyCurrent(
  localHash: string | null,
  serverHash: string | null | undefined,
): boolean {
  return localHash != null && serverHash != null && localHash === serverHash;
}

/** How one server document compares with its local copy in the download root. */
export interface LocalDocumentState {
  doc: ServerDocumentEntry;
  /** Path inside the download root. */
  path: string;
  /** SHA-256 of the local copy, or `null` when nothing is at `path` yet. */
  localHash: string | null;
  /** A local copy occupies `path`. */
  existsLocally: boolean;
  /** The server proved the local copy matches its revision. */
  isCurrent: boolean;
  /** Both hashes are known and differ — the local copy was edited or is stale. */
  mismatched: boolean;
}

/**
 * Compare one server directory's documents against the local download root.
 *
 * `compute_local_sha256` skips files it cannot read, so a path missing from the
 * response means "never downloaded" — one backend call covers both existence and
 * content. Throws only when the call itself fails; callers decide whether an
 * unreadable directory should stop the run or merely be reported.
 */
export async function readLocalDocumentStates(
  documents: ServerDocumentEntry[],
  pathParts: string[],
): Promise<LocalDocumentState[]> {
  if (documents.length === 0) return [];

  const paths = documents.map((doc) => makeDownloadPath([...pathParts, doc.title]));
  const localHashes = await computeLocalSha256(paths);

  return documents.map((doc, index) => describeLocalState(doc, paths[index], localHashes[paths[index]] ?? null));
}

/** Treat every document as absent locally — used when the hash pass itself fails. */
function assumeNothingIsLocal(documents: ServerDocumentEntry[], pathParts: string[]): LocalDocumentState[] {
  return documents.map((doc) => describeLocalState(doc, makeDownloadPath([...pathParts, doc.title]), null));
}

/** The single place a comparison result is turned into flags. */
function describeLocalState(
  doc: ServerDocumentEntry,
  path: string,
  localHash: string | null,
): LocalDocumentState {
  const serverHash = doc.sha256;
  return {
    doc,
    path,
    localHash,
    existsLocally: localHash != null,
    isCurrent: isLocalCopyCurrent(localHash, serverHash),
    mismatched: localHash != null && serverHash != null && localHash !== serverHash,
  };
}

// ---------------------------------------------------------------------------
// Sync state (shared across pages)
// ---------------------------------------------------------------------------

class SyncAllCoordinator {
  /** Whether a sync is currently running (shared across all pages). */
  busy = $state(false);

  /**
   * Atomically claim the sync lock. The sync used to do
   * `if (busy) return; busy = true` across an await boundary, which let two
   * runs interleave — the automatic-download run would then silently no-op.
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
// Download plumbing
// ---------------------------------------------------------------------------

const DOWNLOAD_BATCH_SIZE = 25;
const DOWNLOAD_BATCH_DELAY_MS = 2500;

interface DownloadRunner {
  /** Rate limit: pause every `DOWNLOAD_BATCH_SIZE` requests. */
  throttle(): Promise<void>;
  /** Fetch one document, retrying once when the server rate limits us. */
  download(docId: string, path: string, overwrite: boolean): Promise<{ already_exists?: boolean } | null>;
  /** Record an inaccessible server item as an empty local placeholder. */
  createPlaceholder(relativePath: string): Promise<void>;
}

/**
 * Rate-limited document fetcher.
 *
 * `getDocument` resolves as soon as the transfer is queued, so callers must not
 * assume the file is on disk yet — see `waitForActiveDownloads`.
 */
function createDownloadRunner(): DownloadRunner {
  let requestCount = 0;

  async function throttle() {
    requestCount++;
    if (requestCount > 0 && requestCount % DOWNLOAD_BATCH_SIZE === 0) {
      console.log(`%c[cfms:sync] Throttling — %d requests sent, pausing %ds…`, 'color:#ffb74d', requestCount, DOWNLOAD_BATCH_DELAY_MS / 1000);
      await new Promise(r => setTimeout(r, DOWNLOAD_BATCH_DELAY_MS));
    }
  }

  async function download(docId: string, path: string, overwrite: boolean) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await throttle();
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

  async function createPlaceholder(relativePath: string) {
    if (!relativePath || relativePath === 'download') return;
    try {
      await createDownloadPlaceholder(relativePath);
    } catch (err) {
      console.warn(`%c[cfms:sync] Placeholder failed for ${relativePath}:`, 'color:#ffb74d', err);
    }
  }

  return { throttle, download, createPlaceholder };
}

/** The overwrite prompt shown before replacing a locally modified file. */
async function chooseOverwriteStrategy(conflictingCount: number): Promise<SyncOverwriteStrategy> {
  const choice = await dialogStore.choose<SyncOverwriteStrategy>({
    title: get(t)('files.syncOverwriteTitle'),
    message: get(t)('files.syncOverwriteMessage', { values: { count: conflictingCount } }),
    choices: [
      { value: 'backup_rename', label: get(t)('settings.fileSync.overwriteBackup'), description: get(t)('settings.fileSync.overwriteBackupHint'), icon: 'history', intent: 'primary' },
      { value: 'force_overwrite', label: get(t)('settings.fileSync.overwriteForce'), description: get(t)('settings.fileSync.overwriteForceHint'), icon: 'update', intent: 'danger' },
      { value: 'skip', label: get(t)('settings.fileSync.overwriteSkip'), description: get(t)('settings.fileSync.overwriteSkipHint'), icon: 'cancel', intent: 'neutral' },
    ],
  });
  return choice?.value ?? 'skip';
}

/**
 * Resolve whether the download root is git-versioned and initialise the repo.
 *
 * Git tracking is an explicit user setting (Settings > File Sync); the repo is
 * created lazily, and a failed init only disables tracking for this run — the
 * settings toggle itself reports that failure and reverts.
 */
async function resolveGitTracking(override?: boolean): Promise<boolean> {
  let hasGit = override ?? await getSyncGitTrackingEnabled().catch(() => false);
  if (hasGit) {
    try {
      await downloadGitInit();
    } catch (err) {
      console.warn('%c[cfms:sync] Git init failed, tracking disabled for this run:', 'color:#ffb74d', err);
      hasGit = false;
    }
  }
  return hasGit;
}

/** Snapshot the download root once the transfers have landed on disk. */
async function commitSyncSnapshot(summary: string): Promise<void> {
  // `getDocument` resolves before the transfer finishes, so committing straight
  // away would snapshot half-written files.
  const activeCount = downloadStore.activeTasks.length;
  if (activeCount > 0) {
    console.log('%c[cfms:sync] Waiting for %d active download(s) to finish before git commit…', 'color:#4fc3f7', activeCount);
    await waitForActiveDownloads();
  }
  try {
    const commitMsg = `sync ${localTimestamp()}: ${summary}`;
    const hash = await downloadGitCommit(commitMsg);
    if (hash) {
      console.log(`%c[cfms:sync] Git commit: ${hash.slice(0, 7)} — ${commitMsg}`, 'color:#a5d6a7');
    }
  } catch (gitErr) {
    console.warn('%c[cfms:sync] Git tracking skipped:', 'color:#ffb74d', gitErr);
  }
}

// ---------------------------------------------------------------------------
// Plans
//
// A plan is everything the engine knows before it touches the disk. Building it
// is the only part that differs between the two sync modes; executing it is
// shared.
// ---------------------------------------------------------------------------

/** One cached check hit: fetch this document into this path. */
export interface QueuedDownload {
  /** Server document id. */
  docId: string;
  /** Destination inside the download root, already sanitised. */
  path: string;
  /** Server revision hash, when the server reports one. */
  sha256?: string | null;
}

/** One document a plan wants on disk. */
interface PlannedDownload {
  docId: string;
  path: string;
  /** A local file already occupies `path`. */
  existsLocally: boolean;
  /** Server revision hash, used to recognise a renamed document. */
  serverHash?: string | null;
}

interface SyncPlan {
  downloads: PlannedDownload[];
  /** Local files the server no longer has. */
  deletions: string[];
  /** Local files that are really the same document under a new name. */
  moves: { from: string; to: string; download: PlannedDownload }[];
  /** Documents left alone while planning. */
  skipped: number;
}

/**
 * Plan from the cached results of the last check.
 *
 * The check already walked the server tree and hashed the download root, so
 * this only hashes the queued paths — a single backend call. Deletions and
 * renames are left to a full sync: deciding those needs the complete tree,
 * which is exactly what this mode avoids.
 */
async function planQueuedSync(queued: readonly QueuedDownload[]): Promise<SyncPlan> {
  const plan: SyncPlan = { downloads: [], deletions: [], moves: [], skipped: 0 };

  let localHashes: Record<string, string> = {};
  try {
    localHashes = await computeLocalSha256(queued.map((item) => item.path));
  } catch {
    /* unreadable pass: treat every path as absent and fetch it */
  }

  for (const item of queued) {
    // The check may be minutes old, and the server reports no hash for some
    // documents — both cases are handled by the shared predicate.
    const localHash = localHashes[item.path] ?? null;
    if (isLocalCopyCurrent(localHash, item.sha256)) {
      plan.skipped++;
      continue;
    }
    plan.downloads.push({
      docId: item.docId,
      path: item.path,
      existsLocally: localHash != null,
      serverHash: item.sha256,
    });
  }

  return plan;
}

/**
 * Walk the whole server tree and plan against it, including the local files the
 * server no longer has.
 */
async function planServerSync(runner: DownloadRunner): Promise<SyncPlan> {
  const plan: SyncPlan = { downloads: [], deletions: [], moves: [], skipped: 0 };
  const serverPaths = new Set<string>();  // every path the server has
  const walkedDirs = new Set<string>();   // dirs that were listed successfully
  const failedDirs = new Set<string>();   // dirs that could not be listed

  async function listWithRetry(dirId: string | null) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await runner.throttle();
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
        await runner.createPlaceholder(dirPath);
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

    let states: LocalDocumentState[];
    try {
      states = await readLocalDocumentStates(resp.documents, pathParts);
    } catch {
      // A failing hash pass is treated as "nothing is local yet", so the sync
      // re-fetches instead of silently skipping files it could not verify.
      states = assumeNothingIsLocal(resp.documents, pathParts);
    }

    for (const state of states) {
      serverPaths.add(state.path);
      // Outdated means "the server could not prove the local copy is current" —
      // including documents the server reports no hash for.
      if (state.isCurrent) {
        plan.skipped++;
        continue;
      }
      plan.downloads.push({
        docId: state.doc.id,
        path: state.path,
        existsLocally: state.existsLocally,
        serverHash: state.doc.sha256,
      });
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

  await walk(null, []);

  // --- Local files the server no longer has ---
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
  const newDownloads = plan.downloads.filter(d => !d.existsLocally);
  for (const candidate of deleteCandidates) {
    const hash = deleteHashes[candidate];
    if (hash) {
      const idx = newDownloads.findIndex(d => d.serverHash != null && d.serverHash === hash);
      if (idx >= 0) {
        const download = newDownloads.splice(idx, 1)[0];
        plan.moves.push({ from: candidate, to: download.path, download });
        continue;
      }
    }
    plan.deletions.push(candidate);
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Execution — the one entry point
// ---------------------------------------------------------------------------

export interface SyncOptions {
  /**
   * Cached results from the last update check. When given, exactly those
   * documents are fetched and the server tree is **not** walked again;
   * deletions and renames are skipped because deciding them needs the complete
   * tree.
   */
  queue?: readonly QueuedDownload[];
  /** Ask for confirmation before deleting stale local files. Default true. */
  confirmDeletes?: boolean;
  /** Whether the download root is versioned with git. Overrides the stored setting. */
  gitTracking?: boolean;
  /**
   * How to handle files whose server revision differs from the local copy.
   * Automatic downloads pass the stored setting; manual syncs omit it and are
   * prompted once instead.
   */
  overwriteStrategy?: SyncOverwriteStrategy;
  /** Called with a status message when the summary is ready. */
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

/**
 * Fetch everything the current plan says is missing or outdated.
 *
 * Omit `queue` to reconcile against the whole server tree (deletions and
 * renames included); pass the cached check results to apply just those.
 */
export async function syncFiles(options: SyncOptions = {}): Promise<SyncAllResult> {
  const { queue, onStatus, onError, onRefresh } = options;
  const confirmDeletes = options.confirmDeletes ?? true;

  // Nothing queued → nothing to do, and no backend call at all.
  if (queue && queue.length === 0) return emptyResult();
  if (!syncAllCoordinator.acquire()) return emptyResult();

  const runner = createDownloadRunner();
  const backupSuffix = `+${backupTimestamp()}`;
  const startTime = performance.now();

  let queued = 0;
  let updated = 0;
  let deleted = 0;
  let moved = 0;
  let skipped = 0;

  try {
    const hasGit = await resolveGitTracking(options.gitTracking);

    // Git tracking keeps history in commits, so it always overwrites without
    // asking; otherwise a preset strategy wins over prompting.
    let strategy: SyncOverwriteStrategy | null = hasGit
      ? 'force_overwrite'
      : (options.overwriteStrategy ?? null);

    console.log(`%c[cfms:sync] ${queue ? 'Applying cached update check' : 'Full recursive sync'} starting (throttled: %d per %ds)…`, 'color:#4fc3f7', DOWNLOAD_BATCH_SIZE, DOWNLOAD_BATCH_DELAY_MS / 1000);

    const plan = queue ? await planQueuedSync(queue) : await planServerSync(runner);
    skipped += plan.skipped;

    // Manual syncs (no preset strategy) ask once for the files they would
    // replace. Cancelling skips them — the least destructive interpretation.
    const conflicting = plan.downloads.filter(d => d.existsLocally);
    if (strategy === null) {
      strategy = conflicting.length > 0
        ? await chooseOverwriteStrategy(conflicting.length)
        : 'backup_rename';
    }

    // "Skip" leaves existing local copies alone and only fills in what is missing.
    const outstanding = strategy === 'skip'
      ? plan.downloads.filter(d => !d.existsLocally)
      : [...plan.downloads];
    skipped += plan.downloads.length - outstanding.length;

    // Execute moves first (non-destructive, no confirmation needed).
    for (const move of plan.moves) {
      try {
        if (await moveDownloadFile(move.from, move.to)) {
          moved++;
          console.log(`%c[cfms:sync] Moved: ${move.from} → ${move.to}`, 'color:#4fc3f7');
          continue;
        }
      } catch { /* fall through: delete + download instead */ }
      // Source file vanished — fall back to delete + download.
      plan.deletions.push(move.from);
      outstanding.push(move.download);
    }

    // Confirm and execute deletions.
    if (plan.deletions.length > 0) {
      const fileList = plan.deletions.slice(0, 8).join('\n')
        + (plan.deletions.length > 8 ? `\n… +${plan.deletions.length - 8} more` : '');
      // With git tracking, deletions are recorded in the sync commit, so they
      // apply directly without an extra confirmation prompt.
      let confirmed = !confirmDeletes || hasGit;
      if (confirmDeletes && !hasGit) {
        confirmed = await dialogStore.confirm({
          title: get(t)('files.syncDeleteTitle'),
          message: `${get(t)('files.syncDeleteMessage', { values: { count: plan.deletions.length } })}\n\n${fileList}`,
          confirmLabel: get(t)('common.delete'),
          cancelLabel: get(t)('common.cancel'),
          danger: true,
        });
      }
      if (confirmed) {
        for (const localPath of plan.deletions) {
          try {
            await deleteDownloadFile(localPath);
            deleted++;
            console.log(`%c[cfms:sync] Removed: ${localPath}`, 'color:#ef9a9a');
          } catch { /* ignore */ }
        }
      }
    }

    // Execute downloads.
    for (const d of outstanding) {
      try {
        let overwrite = d.existsLocally;
        if (strategy === 'backup_rename' && d.existsLocally) {
          // Keep the outdated copy under a timestamped name before replacing it.
          const backupPath = `${d.path}${backupSuffix}`;
          try {
            if (await moveDownloadFile(d.path, backupPath)) {
              overwrite = false;
              console.log(`%c[cfms:sync] Backup: ${d.path} → ${backupPath}`, 'color:#ffb74d');
            }
          } catch { /* rename failed — fall through and overwrite */ }
        }
        await runner.download(d.docId, d.path, overwrite);
        if (d.existsLocally) updated++; else queued++;
      } catch (err) {
        // A document that exists on the server but cannot be downloaded
        // (permission denied) is mirrored locally as a same-named empty
        // placeholder file instead of being silently skipped.
        if (isAccessDeniedError(err)) {
          await runner.createPlaceholder(d.path);
          console.warn(`%c[cfms:sync] Access denied — placeholder created: ${d.path}`, 'color:#ef9a9a');
        } else {
          console.warn(`%c[cfms:sync] Failed to fetch ${d.path}:`, 'color:#f44336', err);
        }
      }
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    const counters: string[] = [];
    if (queued > 0) counters.push(`${queued} downloaded`);
    if (updated > 0) counters.push(`${updated} updated`);
    if (deleted > 0) counters.push(`${deleted} deleted`);
    if (moved > 0) counters.push(`${moved} moved`);
    if (skipped > 0) counters.push(`${skipped} skipped`);
    console.log(`%c[cfms:sync] Done in ${elapsed}s: ${counters.join(', ') || 'nothing to do'}`, 'color:#4caf50');

    const changed = queued + updated + deleted + moved > 0;
    if (changed) {
      onStatus?.(get(t)('files.syncCompleted', { values: { downloaded: queued, updated, moved, deleted } }));
    } else {
      onStatus?.(get(t)('files.syncAllUpToDate'));
    }
    await onRefresh?.();

    // --- Git version tracking (only when the user keeps a repo in the download root) ---
    if (changed && hasGit) {
      const msgParts: string[] = [];
      if (queued > 0) msgParts.push(`+${queued}`);
      if (updated > 0) msgParts.push(`~${updated}`);
      if (deleted > 0) msgParts.push(`-${deleted}`);
      if (moved > 0) msgParts.push(`→${moved}`);
      await commitSyncSnapshot(msgParts.join(' '));
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
