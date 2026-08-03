// CFMS Client - File Update Tracker
//
// Tracks server-side file changes via periodic polling with snapshot
// comparison.  Maintains a cached snapshot of `last_modified` timestamps
// and compares new server data against it to detect new, modified, and
// deleted items.  Also tracks which files / folders are "not updated"
// (stale) for visual indicators.

import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';

/** How long (in ms) an item stays flagged as "recently updated" before the indicator fades. */
const UPDATE_VISIBILITY_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Default polling interval: 1 hour. */
const DEFAULT_POLL_INTERVAL_MS = 60 * 60 * 1000;

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

  // =========================================================================
  // Snapshot & polling
  // =========================================================================

  /**
   * Start periodic polling for server changes on a directory.
   * `pollFn` should re-fetch the directory listing and call `compareSnapshot`.
   */
  startPolling(pollFn: () => Promise<void>, intervalMs = DEFAULT_POLL_INTERVAL_MS) {
    this.stopPolling();
    this.pollCallback = pollFn;
    // Fire immediately on start
    void pollFn();
    this.pollTimer = setInterval(() => {
      void this.pollCallback?.();
    }, intervalMs);
  }

  /** Stop periodic polling. */
  stopPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollCallback = null;
  }

  /** Whether polling is active. */
  get isPolling(): boolean {
    return this.pollTimer !== null;
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

  /** Clear all entries, snapshots, and stop polling. */
  clear() {
    this.entries = new Map();
    this.parentMap = new Map();
    this.staleDocumentIds = new Set();
    this.staleFolderIds = new Set();
    this.foldersWithStaleChildren = new Set();
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

