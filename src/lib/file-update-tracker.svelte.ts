// CFMS Client - File Update Tracker
//
// Tracks server-side file changes via periodic polling with snapshot
// comparison.  Maintains a cached snapshot of `last_modified` timestamps
// and compares new server data against it to detect new, modified, and
// deleted items.  Also tracks which files / folders are "not updated"
// (stale) for visual indicators.

import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
import { deniedDocuments } from '$lib/denied-documents.svelte';
import {
  ensureDownloadPlaceholder,
  makeDownloadPath,
  readLocalDocumentStates,
} from '$lib/sync-all.svelte';

/** How long (in ms) an item stays flagged as "recently updated" before the indicator fades. */
const UPDATE_VISIBILITY_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Default polling interval: 1 hour. */
const DEFAULT_POLL_INTERVAL_MS = 60 * 60 * 1000;

/** Keep up to this many check history records in local persistence and UI. */
const CHECK_HISTORY_MAX = 20;

/** Keep up to this many file names inside one check record. */
const CHECK_HISTORY_ITEM_MAX = 50;

/**
 * LocalStorage key prefix for persisted check history.
 *
 * History is stored **per account** as `<prefix>:<server>:<username>`: switching
 * server or user must not mix their logs, and a single unscoped key would report
 * one account's directory counts inside another account's session.
 */
const CHECK_HISTORY_KEY_PREFIX = 'cfms:file-check-history:v1';

/** Files with `last_modified` older than this are considered "not updated" (stale). */
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectorySnapshot {
  /** Map of document ID → last_modified timestamp (or null). */
  documents: Map<string, number | null>;
  /** Map of folder ID → created_time timestamp (or null). */
  folders: Map<string, number | null>;
  /** When this snapshot was taken. */
  capturedAt: number;
}

export interface PollChangeResult {
  newDocuments: string[];
  modifiedDocuments: string[];
  deletedDocuments: string[];
  newFolders: string[];
  modifiedFolders: string[];
  deletedFolders: string[];
  /** Human-readable summary of changes. */
  summary: string | null;
}

interface UpdateEntry {
  id: string;
  type: 'folder' | 'document';
  timestamp: number;
}

/** Why a check flagged one document. */
export type CheckHistoryItemKind = 'added' | 'modified' | 'unverifiable' | 'denied';

/** One document a check flagged, kept so the record can name it later. */
export interface CheckHistoryItem {
  id: string;
  title: string;
  /** Download-root-relative path, which is what the user recognises. */
  path: string;
  kind: CheckHistoryItemKind;
}

export interface CheckHistoryEntry {
  time: number;
  changed: number;
  dirs: number;
  docs: number;
  summary: string;
  /** The flagged documents, capped at `CHECK_HISTORY_ITEM_MAX`. */
  items: CheckHistoryItem[];
  /** How many more were flagged than `items` holds. */
  hidden: number;
  /** Documents the server refuses to hand over. */
  denied: number;
}

/** Account a piece of per-user state belongs to. */
export interface CheckHistoryScope {
  serverAddress: string | null | undefined;
  username: string | null | undefined;
}

/** Storage key for one account, or `null` while the account is unknown. */
function checkHistoryKey(scope: CheckHistoryScope | null | undefined): string | null {
  const serverAddress = scope?.serverAddress?.trim();
  const username = scope?.username?.trim();
  if (!serverAddress || !username) return null;
  return `${CHECK_HISTORY_KEY_PREFIX}:${encodeURIComponent(serverAddress)}:${encodeURIComponent(username)}`;
}

export interface PendingUpdateItem {
  id: string;
  title: string;
  /** Human-readable path, for display. */
  path: string;
  /** Destination inside the download root (sanitised) — the actual write target. */
  downloadPath: string;
  sha256?: string | null;
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

class FileUpdateTracker {
  // --- recently-updated entries (drives visual indicators) ---
  private entries = $state<Map<string, UpdateEntry>>(new Map());
  private parentMap = $state<Map<string, Set<string>>>(new Map());
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  // --- server snapshots per directory ---
  private snapshots = new Map<string, DirectorySnapshot>();

  // --- stale (not-updated) tracking ---
  private staleDocumentIds = $state<Set<string>>(new Set());
  private staleFolderIds = $state<Set<string>>(new Set());
  private foldersWithStaleChildren = $state<Set<string>>(new Set());

  // --- polling state ---
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollCallback: (() => Promise<void>) | null = null;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  lastCheckTime = $state<number>(0);
  nextCheckTime = $state<number>(0);
  /**
   * Whether the account's one post-login check has already been spent.
   *
   * Scoped to the account rather than to the process: the option promises a
   * check at start *and* at login, and signing in as somebody else within the
   * same run is a new session for them.
   */
  initialScanDone = $state(false);

  // --- check history ---
  /** Storage key of the account whose history is currently loaded. */
  private historyKey: string | null = null;

  checkHistory = $state<CheckHistoryEntry[]>([]);

  // --- pending update queue (diff results auto-enqueue) ---
  pendingUpdateQueue = $state<Map<string, PendingUpdateItem>>(new Map());

  // =========================================================================
  // Snapshot & polling
  // =========================================================================

  /**
   * Start periodic polling for server changes on a directory.
   * `pollFn` should re-fetch the directory listing and call `compareSnapshot`.
   *
   * The countdown is anchored at start (or at the last manual reset). Normal
   * poll ticks fire every `intervalMs` from that anchor — they never rebase it.
   */
  startPolling(pollFn: () => Promise<void>, intervalMs = DEFAULT_POLL_INTERVAL_MS) {
    this.stopPolling();
    this.pollCallback = pollFn;
    this.pollIntervalMs = intervalMs;
    // Show countdown immediately — first poll fires after intervalMs
    this.lastCheckTime = Date.now();
    this.nextCheckTime = this.lastCheckTime + this.pollIntervalMs;
    this.scheduleNext();
  }

  /**
   * Keep an existing poll schedule running with the same interval, only
   * swapping in a fresh callback (used when a page remounts after navigation).
   * Returns true when the existing schedule was preserved.
   */
  adoptPolling(pollFn: () => Promise<void>, intervalMs: number): boolean {
    if (!this.isPolling || this.pollIntervalMs !== intervalMs) return false;
    this.pollCallback = pollFn;
    return true;
  }

  /** Rebase polling countdown from "now" (used by manual checks). */
  resetPollingCountdown() {
    this.lastCheckTime = Date.now();
    this.nextCheckTime = this.lastCheckTime + this.pollIntervalMs;
    // Reschedule so the next tick actually fires a full interval from now —
    // without this the pending fixed-delay timer would fire early.
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
      this.scheduleNext();
    }
  }

  private scheduleNext() {
    // Fixed-rate anchored to nextCheckTime: if a tick ran late (heavy scan),
    // the following tick fires sooner to stay on schedule instead of drifting.
    const delay = Math.max(0, this.nextCheckTime - Date.now());
    this.pollTimer = setTimeout(() => {
      void this.pollCallback?.().then(() => {
        this.lastCheckTime = Date.now();
        this.nextCheckTime += this.pollIntervalMs;
        this.scheduleNext();
      });
    }, delay);
  }

  /** Stop periodic polling. */
  stopPolling() {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollCallback = null;
    this.nextCheckTime = 0;
  }

  /** Whether polling is active. */
  get isPolling(): boolean {
    return this.pollCallback !== null;
  }

  // =========================================================================
  // Shared recursive check (used by auto-poll, manual button, devtool)
  // =========================================================================

  /**
   * Recursively walk the directory tree starting from `dirId` (null = root).
   *
   * Each level is checked two ways:
   *
   *  * against the previous in-session listing (`compareSnapshot`) — only ever
   *    drives the "recently updated" indicators, since those snapshots live in
   *    memory and start empty on every page load;
   *  * against the local download root — this is what "are there updates?" is
   *    really asking, and what `outdated` reports.
   *
   * `listFn` should be the `listDirectory` API function.
   * `maxDepth` controls recursion depth (default 20).
   * `delayMs` throttles between requests (default 200).
   */
  async recursiveCheck(
    listFn: (id: string | null) => Promise<{ folders: ServerDirectoryEntry[]; documents: ServerDocumentEntry[] }>,
    dirId: string | null = null,
    maxDepth = 20,
    delayMs = 200,
    onDirectoryDiff?: (ctx: {
      directoryId: string | null;
      pathParts: string[];
      documents: ServerDocumentEntry[];
      /** Movement since the previous in-session listing. Indicators only. */
      diff: PollChangeResult;
      /** Server documents missing locally or superseded by a newer revision. */
      outdated: ServerDocumentEntry[];
      /** Documents the server refuses to hand over. */
      denied: ServerDocumentEntry[];
    }) => void,
  ): Promise<{ outdated: number; denied: number; dirs: number; docs: number }> {
    let outdatedDocs = 0;
    let deniedDocs = 0;
    let checkedDirs = 0;
    let checkedDocs = 0;
    const findings: CheckHistoryItem[] = [];
    let hidden = 0;

    const walk = async (id: string | null, depth: number, pathParts: string[]): Promise<void> => {
      if (depth > maxDepth) return;
      await new Promise((r) => setTimeout(r, delayMs));
      let resp: { folders: ServerDirectoryEntry[]; documents: ServerDocumentEntry[] };
      try {
        resp = await listFn(id);
      } catch {
        return;
      }

      const diff = this.compareSnapshot(id, resp.folders, resp.documents);

      const outdated: ServerDocumentEntry[] = [];
      const denied: ServerDocumentEntry[] = [];
      const record = (doc: ServerDocumentEntry, kind: CheckHistoryItemKind) => {
        if (findings.length < CHECK_HISTORY_ITEM_MAX) {
          findings.push({
            id: doc.id,
            title: doc.title,
            path: makeDownloadPath([...pathParts, doc.title]),
            kind,
          });
        } else {
          hidden += 1;
        }
      };
      try {
        for (const state of await readLocalDocumentStates(resp.documents, pathParts)) {
          if (state.isCurrent) continue;
          const path = makeDownloadPath([...pathParts, state.doc.title]);
          // Asking costs one metadata round trip and answers with the same
          // access rule that would block the download, so a refused document is
          // never offered as an update — not even the first time it is seen.
          // The answer is re-taken on every check, so restored access is picked
          // up on its own; nothing is excluded for good. This is cheaper than
          // the download it replaces, so it needs no pacing of its own: the
          // per-directory delay already paced the walk.
          if (await deniedDocuments.probeDocumentAccess(state.doc.id)) {
            deniedDocuments.clear(state.doc.id);
            outdated.push(state.doc);
            record(state.doc, state.mismatched ? 'modified' : state.existsLocally ? 'unverifiable' : 'added');
            continue;
          }
          deniedDocuments.mark({ docId: state.doc.id, path });
          // A refused document still has a place in the local tree: the same
          // name, kept as a stand-in, so the folder mirrors the server and the
          // user can see what they are missing. The write happens here because
          // this is where the refusal is discovered — such a document is never
          // queued for download, so no later step could create it.
          await ensureDownloadPlaceholder(path);
          denied.push(state.doc);
          record(state.doc, 'denied');
        }
      } catch (err) {
        // Never guess: a directory we could not verify contributes nothing, and
        // says so, rather than reporting a phantom pile of updates.
        console.warn(
          `[cfms:check] Could not read local state for ${pathParts.join('/') || '/'}:`,
          err,
        );
      }
      outdatedDocs += outdated.length;
      deniedDocs += denied.length;

      onDirectoryDiff?.({
        directoryId: id,
        pathParts,
        documents: resp.documents,
        diff,
        outdated,
        denied,
      });

      checkedDirs += resp.folders.length;
      checkedDocs += resp.documents.length;
      for (const f of resp.folders) {
        await walk(f.id, depth + 1, [...pathParts, f.name]);
      }
    };

    await walk(dirId, 0, []);
    this.addCheckHistory({
      outdated: outdatedDocs,
      denied: deniedDocs,
      dirs: checkedDirs,
      docs: checkedDocs,
      items: findings,
      hidden,
    });
    return { outdated: outdatedDocs, denied: deniedDocs, dirs: checkedDirs, docs: checkedDocs };
  }

  /** Queue changed/new documents for user-confirmed update. */
  enqueuePendingUpdates(items: PendingUpdateItem[]) {
    if (items.length === 0) return;
    const next = new Map(this.pendingUpdateQueue);
    for (const item of items) {
      next.set(item.id, item);
    }
    this.pendingUpdateQueue = next;
  }

  /** Remove queued items by document id. */
  removePendingUpdates(ids: string[]) {
    if (ids.length === 0 || this.pendingUpdateQueue.size === 0) return;
    const next = new Map(this.pendingUpdateQueue);
    for (const id of ids) next.delete(id);
    this.pendingUpdateQueue = next;
  }

  /** Clear all queued pending updates. */
  clearPendingUpdates() {
    this.pendingUpdateQueue = new Map();
  }

  /** Snapshot pending updates as a stable array for UI. */
  get pendingUpdates(): PendingUpdateItem[] {
    return [...this.pendingUpdateQueue.values()];
  }

  /**
   * Register a devtool hook on `window.__cfms_check_updates__` that runs
   * a recursive check and prints the full file tree to the console.
   *
   * `listFn` should be the `listDirectory` API function.
   * `getCurrentDirId` returns the folder ID currently being viewed (or null).
   */
  registerDevtoolHook(
    listFn: (id: string | null) => Promise<{ folders: ServerDirectoryEntry[]; documents: ServerDocumentEntry[] }>,
    getCurrentDirId: () => string | null,
  ) {
    const tracker = this;
    (window as any).__cfms_check_updates__ = async () => {
      const MAX_DEPTH = 20;
      const DELAY_MS = 300;
      let totalChanges = 0;
      let totalOutdated = 0;
      let totalDirs = 0;
      let totalDocs = 0;
      let totalHidden = 0;
      let totalErrors = 0;
      const startTime = performance.now();

      // Download-root paths can only be reconstructed when the walk starts at
      // the tree root. The Files page hook starts at the current folder, where
      // the path from the root is unknown — skip the local check there rather
      // than report paths that do not exist.
      const scanRoot = getCurrentDirId();
      const localCheckAvailable = scanRoot === null;

      console.group('%c📁 CFMS Update Check %c(devtools — recursive)', 'font-weight:bold', 'color:#888');

      async function walkDir(dirId: string | null, dirLabel: string, depth: number, pathParts: string[]) {
        if (depth > MAX_DEPTH) return;
        const prefix = '  '.repeat(depth);
        await new Promise((r) => setTimeout(r, DELAY_MS));

        let resp: { folders: ServerDirectoryEntry[]; documents: ServerDocumentEntry[] };
        try {
          resp = await listFn(dirId);
        } catch (err: any) {
          const msg = String(err);
          if (/403|404|access denied/i.test(msg)) {
            totalHidden++;
            console.log(`%c%s🔒 %s %c(hidden)`, 'color:#ef9a9a', prefix, dirLabel, 'color:#888');
          } else {
            totalErrors++;
            console.log(`%c%s❌ %s %c— %s`, 'color:#f44336', prefix, dirLabel, 'color:#888', msg);
          }
          return;
        }

        const result = tracker.compareSnapshot(dirId, resp.folders, resp.documents);
        if (result.summary) {
          totalChanges++;
          console.log(`%c🔔 [%s] %s`, 'color:#ffb74d', dirLabel, result.summary);
        }

        // What the update check actually acts on: files missing locally or
        // behind the server revision. The snapshot diff above only describes
        // movement since this session started watching the directory.
        const outdatedIds = new Set<string>();
        if (localCheckAvailable) {
          try {
            for (const state of await readLocalDocumentStates(resp.documents, pathParts)) {
              if (!state.isCurrent) outdatedIds.add(state.doc.id);
            }
          } catch (err) {
            console.warn('[cfms:check] devtools hook could not read local state:', err);
          }
        }
        totalOutdated += outdatedIds.size;

        totalDirs += resp.folders.length;
        totalDocs += resp.documents.length;

        const staleCount =
          resp.folders.filter((f) => tracker.notUpdatedFolderIds.has(f.id)).length +
          resp.documents.filter((d) => tracker.notUpdatedDocumentIds.has(d.id)).length;

        console.group(`%c%s📂 %s %c(%d f, %d d%c%s%c)`,
          'font-weight:bold;color:#4fc3f7', prefix, dirLabel, 'color:#888',
          resp.folders.length, resp.documents.length,
          staleCount > 0 ? ';color:#ffb74d' : '', staleCount > 0 ? `, ${staleCount} stale` : '', ';color:#888');

        for (const d of resp.documents) {
          const stale = tracker.notUpdatedDocumentIds.has(d.id);
          const updated = tracker.recentlyUpdatedDocumentIds.has(d.id);
          const outdated = outdatedIds.has(d.id);
          const flags = [stale ? '⚠' : '', updated ? '🆕' : '', outdated ? '📥' : ''].filter(Boolean).join(' ');
          console.log(`%c%s📄 %s %c${flags}%c  %s  %s`,
            stale ? 'color:#ffb74d' : 'color:#c8e6c9', prefix, d.title, '',
            'color:#888', d.size != null ? `${(d.size / 1024).toFixed(1)} KB` : '—',
            d.last_modified ? new Date(d.last_modified * 1000).toLocaleString() : '—');
        }

        for (const f of resp.folders) {
          const isDot = f.name.startsWith('.');
          await walkDir(f.id, `${isDot ? '👻' : ''}${f.name}`, depth + 1, [...pathParts, f.name]);
        }
        console.groupEnd();
      }

      if (!localCheckAvailable) {
        console.warn('[cfms:check] Scan starts below the root — local download state is not checked.');
      }

      try {
        await walkDir(scanRoot, scanRoot ?? '/ (root)', 0, []);
        console.log('%c✅ Scan complete: %d dir(s), %d doc(s), %d snapshot change(s), %d file(s) need update in %sms',
          'color:#4caf50;font-weight:bold', totalDirs, totalDocs, totalChanges, totalOutdated,
          (performance.now() - startTime).toFixed(0));
      } catch (err) {
        console.error('%c❌ Scan failed:', 'color:#f44336', err);
      }
      console.groupEnd();
    };
  }

  /**
   * Take a snapshot of the current directory listing and compare it against
   * the previous snapshot for the same directory.  Returns detected changes.
   *
   * Call this after each `listDirectory` response (manual or polled).
   */
  compareSnapshot(
    directoryId: string | null,
    currentFolders: ServerDirectoryEntry[],
    currentDocuments: ServerDocumentEntry[],
  ): PollChangeResult {
    const key = this.snapshotKey(directoryId);
    const previous = this.snapshots.get(key);
    const now = Date.now();

    // Build current maps
    const currentDocMap = new Map<string, number | null>();
    for (const doc of currentDocuments) {
      currentDocMap.set(doc.id, doc.last_modified);
    }
    const currentFolderMap = new Map<string, number | null>();
    for (const folder of currentFolders) {
      currentFolderMap.set(folder.id, folder.created_time);
    }

    // Store new snapshot
    this.snapshots.set(key, {
      documents: currentDocMap,
      folders: currentFolderMap,
      capturedAt: now,
    });

    // If no previous snapshot, everything is "new" — don't flag as changes
    if (!previous) {
      this.updateStaleTracking(currentFolders, currentDocuments, directoryId);
      return {
        newDocuments: [],
        modifiedDocuments: [],
        deletedDocuments: [],
        newFolders: [],
        modifiedFolders: [],
        deletedFolders: [],
        summary: null,
      };
    }

    const diff = this.diffSnapshots(previous, {
      documents: currentDocMap,
      folders: currentFolderMap,
      capturedAt: now,
    });

    // Mark changed items as recently updated (drives visual indicators)
    for (const id of diff.newDocuments) {
      this.markUpdated(id, 'document', directoryId);
    }
    for (const id of diff.modifiedDocuments) {
      this.markUpdated(id, 'document', directoryId);
    }
    for (const id of diff.newFolders) {
      this.markUpdated(id, 'folder', directoryId);
    }
    for (const id of diff.modifiedFolders) {
      this.markUpdated(id, 'folder', directoryId);
    }
    if (diff.deletedDocuments.length > 0 || diff.deletedFolders.length > 0) {
      if (directoryId) this.markFolderHasUpdates(directoryId);
    }

    // Build human-readable summary
    const parts: string[] = [];
    if (diff.newDocuments.length) parts.push(`${diff.newDocuments.length} new file(s)`);
    if (diff.modifiedDocuments.length) parts.push(`${diff.modifiedDocuments.length} modified file(s)`);
    if (diff.deletedDocuments.length) parts.push(`${diff.deletedDocuments.length} deleted file(s)`);
    if (diff.newFolders.length) parts.push(`${diff.newFolders.length} new folder(s)`);
    if (diff.modifiedFolders.length) parts.push(`${diff.modifiedFolders.length} modified folder(s)`);
    if (diff.deletedFolders.length) parts.push(`${diff.deletedFolders.length} deleted folder(s)`);

    const result: PollChangeResult = {
      ...diff,
      summary: parts.length > 0 ? parts.join(', ') : null,
    };

    this.updateStaleTracking(currentFolders, currentDocuments, directoryId);

    return result;
  }

  /** Forget cached snapshots (e.g. on logout). */
  clearSnapshots() {
    this.snapshots.clear();
  }

  // =========================================================================
  // Recently-updated indicators
  // =========================================================================

  /** Mark a file or folder as recently updated (also used by client-side actions). */
  markUpdated(id: string, type: 'folder' | 'document', parentId?: string | null) {
    const key = this.entryKey(type, id);
    this.entries.set(key, { id, type, timestamp: Date.now() });

    if (parentId) {
      const children = this.parentMap.get(parentId) ?? new Set();
      children.add(key);
      this.parentMap.set(parentId, children);
    }

    this.scheduleExpiry();
  }

  /** Mark a folder as having recently updated children. */
  markFolderHasUpdates(folderId: string) {
    const key = this.entryKey('folder', folderId);
    if (!this.entries.has(key)) {
      this.entries.set(key, { id: folderId, type: 'folder', timestamp: Date.now() });
    }
    this.scheduleExpiry();
  }

  /** Get the set of recently updated document IDs. */
  get recentlyUpdatedDocumentIds(): Set<string> {
    const ids = new Set<string>();
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.type === 'document' && now - entry.timestamp < UPDATE_VISIBILITY_MS) {
        ids.add(entry.id);
      }
    }
    return ids;
  }

  /** Get the set of recently updated folder IDs. */
  get recentlyUpdatedFolderIds(): Set<string> {
    const ids = new Set<string>();
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.type === 'folder' && now - entry.timestamp < UPDATE_VISIBILITY_MS) {
        ids.add(entry.id);
      }
    }
    return ids;
  }

  // =========================================================================
  // Stale (not-updated) indicators
  // =========================================================================

  /** Document IDs that are considered "not updated" (stale). */
  get notUpdatedDocumentIds(): Set<string> {
    return this.staleDocumentIds;
  }

  /** Folder IDs that are considered "not updated" (stale). */
  get notUpdatedFolderIds(): Set<string> {
    return this.staleFolderIds;
  }

  /** Folder IDs that contain stale children. */
  get foldersWithNotUpdatedChildren(): Set<string> {
    return this.foldersWithStaleChildren;
  }

  // =========================================================================
  // Clear
  // =========================================================================

  // =========================================================================
  // Check history
  // =========================================================================

  /**
   * Point the check history at an account.
   *
   * Called whenever the session changes. The log is dropped when the account
   * changes so a history entry can never be attributed to the wrong server or
   * user. Passing an empty scope (logged out) clears the log and stops it being
   * persisted at all.
   */
  useAccountScope(scope: CheckHistoryScope | null | undefined) {
    const key = checkHistoryKey(scope);
    if (key === this.historyKey) return;
    this.historyKey = key;
    this.checkHistory = [];
    this.initialScanDone = false;
    if (key) this.loadPersistedCheckHistory(key);
  }
  /**
   * Record a completed update check in the history log.
   *
   * `outdated` counts documents that are missing locally or behind the server
   * revision — i.e. what a sync would fetch. It is not "what changed since the
   * last poll", which would report nothing on the first check of a session.
   *
   * `items` names those documents, so a record can answer "which files?" long
   * after the check that found them. It is capped: the log keeps twenty records,
   * and a first sync of a large tree can flag thousands of files.
   */
  addCheckHistory(result: {
    outdated: number;
    denied: number;
    dirs: number;
    docs: number;
    items: CheckHistoryItem[];
    hidden: number;
  }) {
    const { outdated, denied, dirs, docs, items, hidden } = result;
    const entry: CheckHistoryEntry = {
      time: Date.now(),
      changed: outdated,
      dirs,
      docs,
      summary: outdated > 0 ? `${outdated} file(s) need update` : 'no changes',
      items: items.slice(0, CHECK_HISTORY_ITEM_MAX),
      hidden,
      denied,
    };
    this.checkHistory = [...this.checkHistory, entry].slice(-CHECK_HISTORY_MAX);
    this.persistCheckHistory();
  }

  /** Load persisted check history for one account. */
  private loadPersistedCheckHistory(key: string) {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const restored: CheckHistoryEntry[] = parsed
        .filter((it) => it && typeof it.time === 'number')
        .map((it) => ({
          time: Number(it.time),
          changed: Number(it.changed ?? 0),
          dirs: Number(it.dirs ?? 0),
          docs: Number(it.docs ?? 0),
          summary: String(it.summary ?? ''),
          items: Array.isArray(it.items)
            ? it.items
                .filter((item: unknown): item is CheckHistoryItem =>
                  !!item && typeof (item as CheckHistoryItem).id === 'string'
                  && typeof (item as CheckHistoryItem).path === 'string')
                .slice(0, CHECK_HISTORY_ITEM_MAX)
            : [],
          hidden: Number(it.hidden ?? 0),
          denied: Number(it.denied ?? 0),
        }))
        .slice(-CHECK_HISTORY_MAX);
      this.checkHistory = restored;
    } catch {
      // ignore malformed local state
    }
  }

  private persistCheckHistory() {
    if (typeof window === 'undefined' || !this.historyKey) return;
    try {
      window.localStorage.setItem(
        this.historyKey,
        JSON.stringify(this.checkHistory.slice(-CHECK_HISTORY_MAX)),
      );
    } catch {
      // ignore storage errors
    }
  }

  /** Clear all entries, snapshots, stop polling, and reset history. */
  clear() {
    this.entries = new Map();
    this.parentMap = new Map();
    this.staleDocumentIds = new Set();
    this.staleFolderIds = new Set();
    this.foldersWithStaleChildren = new Set();
    this.clearPendingUpdates();
    this.clearSnapshots();
    this.stopPolling();
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  /**
   * Check whether a folder is stale by examining its children (documents
   * and sub-folders).  Folders don't carry `last_modified` — staleness
   * must be inferred from the items they contain.
   *
   * `listFn` should call `listDirectory(folderId)` and return the response.
   * Pass the same `listDirectory` import the caller already uses.
   */
  async checkFolderStaleness(
    folderId: string,
    listFn: (id: string) => Promise<{ folders: ServerDirectoryEntry[]; documents: ServerDocumentEntry[] }>,
  ) {
    try {
      const { folders: childFolders, documents: childDocs } = await listFn(folderId);
      const now = Date.now();

      // If the folder is completely empty, fall back to its snapshot created_time
      if (childFolders.length === 0 && childDocs.length === 0) {
        const snapshot = this.snapshots.get(this.snapshotKey(null));
        // Try current-directory snapshots too
        for (const [, snap] of this.snapshots) {
          const ct = snap.folders.get(folderId);
          if (ct !== undefined) {
            if (ct === null || now - ct * 1000 > STALE_THRESHOLD_MS) {
              this.markFolderStale(folderId);
            }
            return;
          }
        }
        return;
      }

      // Check if ANY child document is recently updated
      const hasRecentChild = childDocs.some((doc) => {
        const lm = doc.last_modified;
        return lm !== null && now - lm * 1000 <= STALE_THRESHOLD_MS;
      });

      // Check if ANY child folder is NOT stale (we check optimistically —
      // subfolders that have been explicitly marked as non-stale)
      const hasNonStaleSubfolder = childFolders.some((f) => !this.staleFolderIds.has(f.id));

      if (!hasRecentChild && !hasNonStaleSubfolder) {
        // All children appear stale → mark this folder as stale
        this.markFolderStale(folderId);
      } else {
        // At least one child is fresh → this folder is NOT stale
        this.unmarkFolderStale(folderId);
      }
    } catch {
      // If we can't list the folder (e.g. permission denied), don't mark it
    }
  }

  private markFolderStale(folderId: string) {
    const next = new Set(this.staleFolderIds);
    next.add(folderId);
    this.staleFolderIds = next;
  }

  private unmarkFolderStale(folderId: string) {
    if (!this.staleFolderIds.has(folderId)) return;
    const next = new Set(this.staleFolderIds);
    next.delete(folderId);
    this.staleFolderIds = next;
  }

  private snapshotKey(directoryId: string | null): string {
    return directoryId ?? '__root__';
  }

  private entryKey(type: 'folder' | 'document', id: string): string {
    return `${type}:${id}`;
  }

  private diffSnapshots(
    prev: DirectorySnapshot,
    curr: DirectorySnapshot,
  ): Omit<PollChangeResult, 'summary'> {
    const newDocuments: string[] = [];
    const modifiedDocuments: string[] = [];
    const deletedDocuments: string[] = [];
    const newFolders: string[] = [];
    const modifiedFolders: string[] = [];
    const deletedFolders: string[] = [];

    // Documents: detect new & modified
    for (const [id, lastModified] of curr.documents) {
      const prevModified = prev.documents.get(id);
      if (prevModified === undefined) {
        newDocuments.push(id);
      } else if (
        lastModified !== null
        && prevModified !== null
        && lastModified > prevModified
      ) {
        modifiedDocuments.push(id);
      } else if (lastModified !== null && prevModified === null) {
        modifiedDocuments.push(id);
      }
    }
    // Documents: detect deleted
    for (const id of prev.documents.keys()) {
      if (!curr.documents.has(id)) {
        deletedDocuments.push(id);
      }
    }

    // Folders: detect new & modified
    for (const [id, createdTime] of curr.folders) {
      const prevTime = prev.folders.get(id);
      if (prevTime === undefined) {
        newFolders.push(id);
      } else if (
        createdTime !== null
        && prevTime !== null
        && createdTime > prevTime
      ) {
        modifiedFolders.push(id);
      }
    }
    // Folders: detect deleted
    for (const id of prev.folders.keys()) {
      if (!curr.folders.has(id)) {
        deletedFolders.push(id);
      }
    }

    return {
      newDocuments,
      modifiedDocuments,
      deletedDocuments,
      newFolders,
      modifiedFolders,
      deletedFolders,
    };
  }

  private updateStaleTracking(
    folders: ServerDirectoryEntry[],
    documents: ServerDocumentEntry[],
    parentId: string | null,
  ) {
    const now = Date.now();
    const staleDocs = new Set<string>();

    for (const doc of documents) {
      const lm = doc.last_modified;
      if (lm === null || now - lm * 1000 > STALE_THRESHOLD_MS) {
        staleDocs.add(doc.id);
      }
    }
    // Folders are NOT marked stale here — they don't have `last_modified`.
    // Their staleness is determined by `checkFolderStaleness()` which
    // inspects child documents and sub-folders.

    this.staleDocumentIds = staleDocs;

    if (parentId && staleDocs.size > 0) {
      const next = new Set(this.foldersWithStaleChildren);
      next.add(parentId);
      this.foldersWithStaleChildren = next;
    }
  }

  private scheduleExpiry() {
    if (this.expiryTimer !== null) return;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.pruneExpired();
    }, UPDATE_VISIBILITY_MS + 60_000);
  }

  private pruneExpired() {
    const now = Date.now();
    const expiredKeys: string[] = [];
    for (const [key, entry] of this.entries) {
      if (now - entry.timestamp >= UPDATE_VISIBILITY_MS) {
        expiredKeys.push(key);
      }
    }
    for (const key of expiredKeys) {
      this.entries.delete(key);
    }
    for (const [, children] of this.parentMap) {
      for (const key of expiredKeys) {
        children.delete(key);
      }
    }
    if (this.entries.size > 0) {
      this.scheduleExpiry();
    }
  }
}

export const fileUpdateTracker = new FileUpdateTracker();

