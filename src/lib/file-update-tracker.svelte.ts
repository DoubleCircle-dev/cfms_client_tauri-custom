// CFMS Client - File Update Tracker
//
// Tracks recently updated files and folders so the UI can display
// visual indicators (e.g., a "new" dot) next to recently changed items.
// Entries auto-expire after a configurable duration.

/** How long (in ms) an item stays "recently updated" before expiring. */
const UPDATE_VISIBILITY_MS = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateEntry {
  id: string;
  type: 'folder' | 'document';
  timestamp: number;
}

class FileUpdateTracker {
  private entries = $state<Map<string, UpdateEntry>>(new Map());
  private parentMap = $state<Map<string, Set<string>>>(new Map());
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Mark a file or folder as recently updated. */
  markUpdated(id: string, type: 'folder' | 'document', parentId?: string | null) {
    const key = this.entryKey(type, id);
    const now = Date.now();
    this.entries.set(key, { id, type, timestamp: now });

    // Track parent-child relationship for folder indicators
    if (parentId) {
      const children = this.parentMap.get(parentId) ?? new Set();
      children.add(key);
      this.parentMap.set(parentId, children);
    }

    this.scheduleExpiry();
  }

  /** Mark a folder as having recently updated children (for breadcrumb indicators). */
  markFolderHasUpdates(folderId: string) {
    const key = this.entryKey('folder', folderId);
    if (!this.entries.has(key)) {
      this.entries.set(key, { id: folderId, type: 'folder', timestamp: Date.now() });
    }
    this.scheduleExpiry();
  }

  /** Check if a file or folder was recently updated. */
  isRecentlyUpdated(id: string, type: 'folder' | 'document'): boolean {
    const key = this.entryKey(type, id);
    const entry = this.entries.get(key);
    if (!entry) return false;
    return Date.now() - entry.timestamp < UPDATE_VISIBILITY_MS;
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

  /** Check if a folder has recently updated children (documents or subfolders). */
  folderHasRecentlyUpdatedChildren(folderId: string): boolean {
    const children = this.parentMap.get(folderId);
    if (!children) return false;
    const now = Date.now();
    for (const key of children) {
      const entry = this.entries.get(key);
      if (entry && now - entry.timestamp < UPDATE_VISIBILITY_MS) return true;
    }
    return false;
  }

  /** Clear all entries. */
  clear() {
    this.entries = new Map();
    this.parentMap = new Map();
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private entryKey(type: 'folder' | 'document', id: string): string {
    return `${type}:${id}`;
  }

  private scheduleExpiry() {
    if (this.expiryTimer !== null) return;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.pruneExpired();
    }, UPDATE_VISIBILITY_MS + 60_000); // Check a minute after the max age
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
    // Clean up parent map
    for (const [parentId, children] of this.parentMap) {
      for (const key of expiredKeys) {
        children.delete(key);
      }
      if (children.size === 0) {
        this.parentMap.delete(parentId);
      }
    }
    if (this.entries.size > 0) {
      this.scheduleExpiry();
    }
  }
}

export const fileUpdateTracker = new FileUpdateTracker();
