import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({
  checkDownloadsExist: vi.fn(),
  deleteDownloadFile: vi.fn(),
  getDocumentInfo: vi.fn(),
}));
const sharedSettings = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));
// The tracker reaches out for the local comparison and, once per candidate, for
// the permission test that decides whether it is worth offering at all.
vi.mock('$lib/api/files', () => files);
vi.mock('$lib/api/settings', () => ({
  getSetting: sharedSettings.get,
  setSetting: sharedSettings.set,
}));
const placeholders = vi.hoisted(() => ({
  commitPendingFolderHistoryChanges: vi.fn(),
  ensureDownloadFolderPlaceholder: vi.fn(),
  ensureDownloadPlaceholder: vi.fn(),
  recordFolderHistoryMarker: vi.fn(),
}));
vi.mock('$lib/sync-all.svelte', () => ({
  DENIED_FOLDER_MARKER_FILENAME: '.cfms-no-folder-access',
  EMPTY_FOLDER_MARKER_FILENAME: '.cfms-empty-folder',
  makeDownloadPath: (p: string[]) => p.join('/'),
  commitPendingFolderHistoryChanges: placeholders.commitPendingFolderHistoryChanges,
  readLocalDocumentStates: vi.fn(),
  ensureDownloadFolderPlaceholder: placeholders.ensureDownloadFolderPlaceholder,
  ensureDownloadPlaceholder: placeholders.ensureDownloadPlaceholder,
  recordFolderHistoryMarker: placeholders.recordFolderHistoryMarker,
}));

import { deniedDocuments } from './denied-documents.svelte';
import { fileUpdateTracker } from './file-update-tracker.svelte';
import { readLocalDocumentStates } from '$lib/sync-all.svelte';

const HISTORY_KEY_PREFIX = 'cfms:file-check-history:v1';

function scopeFor(serverAddress: string, username: string) {
  return { serverAddress, username };
}

/** Serve one flat directory of documents. */
function serve(documents: { id: string; title: string; state?: Record<string, unknown> }[]) {
  const entries = documents.map((d) => ({
    id: d.id,
    title: d.title,
    size: 1,
    last_modified: null,
    sha256: 'H',
  }));
  vi.mocked(readLocalDocumentStates).mockResolvedValue(
    documents.map((d) => ({
      doc: entries.find((entry) => entry.id === d.id),
      path: d.title,
      localHash: null,
      existsLocally: false,
      isCurrent: false,
      mismatched: false,
      ...d.state,
    })) as never,
  );
  return async () => ({ folders: [], documents: entries });
}

beforeEach(() => {
  // Point the tracker at a dummy account first: switching scope always clears
  // the in-memory log, which gives every test the same empty starting point.
  fileUpdateTracker.useAccountScope(scopeFor('reset', 'reset'));
  window.localStorage.clear();
  deniedDocuments.useAccountScope(scopeFor('reset', 'reset'));
  deniedDocuments.clearAll();
  files.getDocumentInfo.mockReset();
  files.getDocumentInfo.mockResolvedValue(null);
  sharedSettings.get.mockReset();
  sharedSettings.get.mockResolvedValue(null);
  sharedSettings.set.mockReset();
  sharedSettings.set.mockResolvedValue(undefined);
  files.checkDownloadsExist.mockReset();
  files.checkDownloadsExist.mockResolvedValue([]);
  files.deleteDownloadFile.mockReset();
  files.deleteDownloadFile.mockResolvedValue(true);
  placeholders.commitPendingFolderHistoryChanges.mockReset();
  placeholders.commitPendingFolderHistoryChanges.mockResolvedValue(false);
  placeholders.ensureDownloadFolderPlaceholder.mockReset();
  placeholders.ensureDownloadFolderPlaceholder.mockResolvedValue(false);
  placeholders.ensureDownloadPlaceholder.mockReset();
  placeholders.ensureDownloadPlaceholder.mockResolvedValue(false);
  vi.mocked(readLocalDocumentStates).mockReset();
  vi.mocked(readLocalDocumentStates).mockResolvedValue([]);
});

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  Reflect.deleteProperty(window, '__CFMS_BROWSER_PREVIEW__');
  Reflect.deleteProperty(window, '__CFMS_PREVIEW_MODE__');
});

describe('check history scoping', () => {
  it('stores each account under its own key', () => {
    fileUpdateTracker.useAccountScope(scopeFor('wss://server.example:5104', 'alice'));
    fileUpdateTracker.addCheckHistory({ outdated: 1, denied: 0, dirs: 0, docs: 1, items: [], hidden: 0 });

    expect(Object.keys(window.localStorage)).toEqual([
      `${HISTORY_KEY_PREFIX}:${encodeURIComponent('wss://server.example:5104')}:alice`,
    ]);
  });

  it('never shows one account the history of another', () => {
    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'alice'));
    fileUpdateTracker.addCheckHistory({ outdated: 3, denied: 0, dirs: 1, docs: 5, items: [], hidden: 0 });

    // Same server, different user.
    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'bob'));
    expect(fileUpdateTracker.checkHistory).toEqual([]);
    fileUpdateTracker.addCheckHistory({ outdated: 0, denied: 0, dirs: 2, docs: 9, items: [], hidden: 0 });

    // Same user, different server.
    fileUpdateTracker.useAccountScope(scopeFor('wss://b', 'alice'));
    expect(fileUpdateTracker.checkHistory).toEqual([]);

    // Back to the first account: only its own entries come back.
    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'alice'));
    expect(fileUpdateTracker.checkHistory.map((e) => [e.changed, e.dirs, e.docs])).toEqual([
      [3, 1, 5],
    ]);
  });

  it('keeps a repeated scope call from wiping the loaded log', () => {
    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'alice'));
    fileUpdateTracker.addCheckHistory({ outdated: 2, denied: 0, dirs: 0, docs: 2, items: [], hidden: 0 });

    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'alice'));

    expect(fileUpdateTracker.checkHistory).toHaveLength(1);
  });

  it('records successful access-rule changes as account-scoped history entries', () => {
    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'alice'));
    fileUpdateTracker.addAccessRulesHistory([
      { id: 'document:d1', title: 'Report.md', path: 'Notes/Report.md', kind: 'permission_changed' },
    ]);

    expect(fileUpdateTracker.checkHistory.at(-1)).toMatchObject({
      eventType: 'access_rules',
      changed: 0,
      items: [
        { id: 'document:d1', title: 'Report.md', path: 'Notes/Report.md', kind: 'permission_changed' },
      ],
    });
    expect(JSON.parse(window.localStorage.getItem(
      `${HISTORY_KEY_PREFIX}:wss%3A%2F%2Fa:alice`,
    )!)).toMatchObject([{ eventType: 'access_rules' }]);

    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'bob'));
    expect(fileUpdateTracker.checkHistory).toEqual([]);
  });

  it('restores older history records as check entries', () => {
    const key = `${HISTORY_KEY_PREFIX}:wss%3A%2F%2Fold:alice`;
    window.localStorage.setItem(key, JSON.stringify([
      { time: 1, changed: 2, dirs: 1, docs: 3, items: [], hidden: 0, denied: 0 },
    ]));

    fileUpdateTracker.useAccountScope(scopeFor('wss://old', 'alice'));

    expect(fileUpdateTracker.checkHistory[0]?.eventType).toBe('check');
  });

  it('uses shared device settings in the native client instead of origin-local storage', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    const key = `${HISTORY_KEY_PREFIX}:wss%3A%2F%2Fshared:alice`;
    sharedSettings.get.mockResolvedValue(JSON.stringify([
      { time: 1, changed: 2, dirs: 1, docs: 3, items: [], hidden: 0, denied: 0 },
    ]));
    fileUpdateTracker.useAccountScope(scopeFor('wss://shared', 'alice'));
    await vi.waitFor(() => expect(fileUpdateTracker.checkHistory).toHaveLength(1));

    fileUpdateTracker.addAccessRulesHistory([
      { id: 'directory:d1', title: 'Docs', path: 'Docs', kind: 'permission_changed' },
    ]);
    await vi.waitFor(() => {
      expect(sharedSettings.set).toHaveBeenCalled();
      expect(JSON.parse(sharedSettings.set.mock.lastCall![1])).toHaveLength(2);
    });

    expect(sharedSettings.get).toHaveBeenCalledWith(key);
    expect(window.localStorage.getItem(key)).toBeNull();

    await fileUpdateTracker.setCheckHistoryLimit(42);
    expect(sharedSettings.set).toHaveBeenCalledWith(`${key}:limit`, '42');
    await fileUpdateTracker.clearCheckHistory();
    expect(sharedSettings.set).toHaveBeenCalledWith(key, '[]');
  });

  it('restores a customized retention limit from shared settings', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    const key = `${HISTORY_KEY_PREFIX}:wss%3A%2F%2Fretention:alice`;
    sharedSettings.get.mockImplementation(async (settingKey: string) =>
      settingKey === `${key}:limit` ? '42' : '[]');

    fileUpdateTracker.useAccountScope(scopeFor('wss://retention', 'alice'));
    await vi.waitFor(() => expect(fileUpdateTracker.checkHistoryLimit).toBe(42));

    fileUpdateTracker.addCheckHistory({
      outdated: 1,
      denied: 0,
      dirs: 0,
      docs: 1,
      items: [],
      hidden: 0,
    });
    await vi.waitFor(() => {
      expect(sharedSettings.set.mock.calls.some(([settingKey, value]) =>
        settingKey === key && JSON.parse(value).length === 1,
      )).toBe(true);
    });
  });

  it('merges browser history into the shared bridge history without duplicates', async () => {
    Object.defineProperty(window, '__CFMS_BROWSER_PREVIEW__', { configurable: true, value: true });
    Object.defineProperty(window, '__CFMS_PREVIEW_MODE__', { configurable: true, value: 'live' });
    const key = `${HISTORY_KEY_PREFIX}:wss%3A%2F%2Fbridge:alice`;
    const sharedEntry = { time: 1, eventType: 'check', changed: 1, dirs: 1, docs: 2, items: [], hidden: 0, denied: 0 };
    const legacyEntry = { time: 2, eventType: 'access_rules', changed: 0, dirs: 0, docs: 0, items: [], hidden: 0, denied: 0 };
    sharedSettings.get.mockResolvedValue(JSON.stringify([sharedEntry]));
    window.localStorage.setItem(key, JSON.stringify([sharedEntry, legacyEntry]));

    fileUpdateTracker.useAccountScope(scopeFor('wss://bridge', 'alice'));
    await vi.waitFor(() => expect(fileUpdateTracker.checkHistory).toHaveLength(2));
    await vi.waitFor(() => expect(sharedSettings.set).toHaveBeenCalled());

    expect(fileUpdateTracker.checkHistory.map((entry) => entry.time)).toEqual([1, 2]);
    expect(JSON.parse(sharedSettings.set.mock.lastCall![1])).toHaveLength(2);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('does not write history to a shared key while logged out', () => {
    fileUpdateTracker.useAccountScope(null);
    fileUpdateTracker.addCheckHistory({ outdated: 1, denied: 0, dirs: 1, docs: 1, items: [], hidden: 0 });

    expect(fileUpdateTracker.checkHistory).toHaveLength(1);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });

  it('applies a validated per-account limit and keeps the newest entries', async () => {
    const scope = scopeFor('wss://limit.example', 'alice');
    fileUpdateTracker.useAccountScope(scope);
    for (const changed of [1, 2, 3]) {
      fileUpdateTracker.addCheckHistory({
        outdated: changed,
        denied: 0,
        dirs: 0,
        docs: 0,
        items: [],
        hidden: 0,
      });
    }

    await fileUpdateTracker.setCheckHistoryLimit(2);

    expect(fileUpdateTracker.checkHistoryLimit).toBe(2);
    expect(fileUpdateTracker.checkHistory.map((entry) => entry.changed)).toEqual([2, 3]);
    expect(window.localStorage.getItem(
      `${HISTORY_KEY_PREFIX}:wss%3A%2F%2Flimit.example:alice:limit`,
    )).toBe('2');
    await expect(fileUpdateTracker.setCheckHistoryLimit(501)).rejects.toThrow(RangeError);
    expect(fileUpdateTracker.checkHistoryLimit).toBe(2);
  });

  it('clears only the current account log and preserves access-state tracking', async () => {
    const scope = scopeFor('wss://clear.example', 'alice');
    fileUpdateTracker.useAccountScope(scope);
    fileUpdateTracker.addCheckHistory({
      outdated: 1,
      denied: 0,
      dirs: 0,
      docs: 1,
      items: [],
      hidden: 0,
    });
    const key = `${HISTORY_KEY_PREFIX}:wss%3A%2F%2Fclear.example:alice`;
    const accessState = JSON.stringify({
      'document:d1': { status: 'accessible', title: 'report', path: 'report.txt' },
    });
    window.localStorage.setItem(`${key}:access-state`, accessState);

    await fileUpdateTracker.clearCheckHistory();

    expect(fileUpdateTracker.checkHistory).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual([]);
    expect(window.localStorage.getItem(`${key}:access-state`)).toBe(accessState);

    fileUpdateTracker.useAccountScope(scopeFor('wss://clear.example', 'bob'));
    expect(fileUpdateTracker.checkHistory).toEqual([]);
  });
});

describe('what a check reports', () => {
  it('counts an undownloadable document separately from the updates', async () => {
    // The whole point: a file the server refuses is not something the user can
    // confirm, so leaving it in "needs update" left one phantom entry forever.
    // Nothing is recorded yet — the very first check has to get this right.
    const listFn = serve([
      { id: 'fresh', title: 'fresh.txt', state: {} },
      { id: 'locked', title: 'locked.txt', state: {} },
    ]);
    files.getDocumentInfo.mockImplementation(async (docId: string) => {
      if (docId === 'locked') throw new Error('Server returned 403: access denied');
      return null;
    });

    const result = await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(result.outdated).toBe(1);
    expect(result.denied).toBe(1);
    expect(deniedDocuments.isDenied('locked')).toBe(true);
    expect(fileUpdateTracker.checkHistory.at(-1)).toMatchObject({ changed: 1, denied: 1 });
    expect(fileUpdateTracker.checkHistory.at(-1)?.items).toContainEqual(
      expect.objectContaining({ id: 'locked', kind: 'denied' }),
    );
    // The stand-in is what the user sees in place of the file they cannot have,
    // and since the check never queues it, the check has to write it.
    expect(placeholders.ensureDownloadPlaceholder).toHaveBeenCalledWith('locked.txt');
  });

  it('leaves the local tree alone for a document it can read', async () => {
    const listFn = serve([{ id: 'fresh', title: 'fresh.txt', state: {} }]);

    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(placeholders.ensureDownloadPlaceholder).not.toHaveBeenCalled();
  });

  it('records access revocation and restoration for a current local document', async () => {
    const scope = scopeFor('wss://access.example', 'transition');
    fileUpdateTracker.useAccountScope(scope);
    deniedDocuments.useAccountScope(scope);
    const listFn = serve([{
      id: 'd1',
      title: 'report.txt',
      state: { existsLocally: true, isCurrent: true },
    }]);
    const accessStateKey = `${HISTORY_KEY_PREFIX}:wss%3A%2F%2Faccess.example:transition:access-state`;

    files.getDocumentInfo.mockResolvedValue(null);
    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);
    expect(JSON.parse(window.localStorage.getItem(accessStateKey)!)).toMatchObject({
      'document:d1': { status: 'accessible', path: 'report.txt' },
    });
    expect(fileUpdateTracker.checkHistory.at(-1)?.items).toEqual([]);

    files.getDocumentInfo.mockRejectedValue(new Error('Server returned 403: access denied'));
    const revoked = await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(revoked).toMatchObject({ outdated: 0, denied: 1 });
    expect(fileUpdateTracker.checkHistory.at(-1)?.items).toContainEqual(
      expect.objectContaining({
        id: 'document:d1',
        path: 'report.txt',
        kind: 'access_revoked',
      }),
    );
    expect(fileUpdateTracker.checkHistory.at(-1)?.revoked).toBe(1);
    expect(placeholders.ensureDownloadPlaceholder).not.toHaveBeenCalled();

    files.getDocumentInfo.mockResolvedValue(null);
    const restored = await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(restored).toMatchObject({ outdated: 0, denied: 0 });
    expect(fileUpdateTracker.checkHistory.at(-1)?.items).toContainEqual(
      expect.objectContaining({
        id: 'document:d1',
        path: 'report.txt',
        kind: 'access_restored',
      }),
    );
    expect(fileUpdateTracker.checkHistory.at(-1)?.restored).toBe(1);
  });

  it('does not report access restoration when the probe only had a transient error', async () => {
    const scope = scopeFor('wss://unknown.example', 'transition');
    fileUpdateTracker.useAccountScope(scope);
    deniedDocuments.useAccountScope(scope);
    const listFn = serve([{
      id: 'd1',
      title: 'report.txt',
      state: { existsLocally: true, isCurrent: true },
    }]);
    files.getDocumentInfo.mockRejectedValue(new Error('Server returned 403: access denied'));
    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    files.getDocumentInfo.mockRejectedValue(new Error('WebSocket closed unexpectedly'));
    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(fileUpdateTracker.checkHistory.at(-1)?.items).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(
      `${HISTORY_KEY_PREFIX}:wss%3A%2F%2Funknown.example:transition:access-state`,
    )!)).toMatchObject({
      'document:d1': { status: 'denied' },
    });
  });

  it('records revoked and restored listing access for a folder', async () => {
    const scope = scopeFor('wss://folder-access.example', 'transition');
    fileUpdateTracker.useAccountScope(scope);
    deniedDocuments.useAccountScope(scope);
    let folderDenied = false;
    const listFn = vi.fn(async (id: string | null) => {
      if (id === null) {
        return { folders: [{ id: 'f1', name: 'Reports', created_time: null }], documents: [] };
      }
      if (folderDenied) throw new Error('Server returned 403: access denied');
      return { folders: [], documents: [] };
    });

    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);
    folderDenied = true;
    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(fileUpdateTracker.checkHistory.at(-1)?.items).toContainEqual(
      expect.objectContaining({ id: 'folder:f1', kind: 'access_revoked', path: 'Reports' }),
    );

    folderDenied = false;
    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(fileUpdateTracker.checkHistory.at(-1)?.items).toContainEqual(
      expect.objectContaining({ id: 'folder:f1', kind: 'access_restored', path: 'Reports' }),
    );
  });

  it('creates a marker for an empty server folder', async () => {
    const listFn = vi.fn(async (id: string | null) =>
      id === null
        ? { folders: [{ id: 'empty-folder', name: 'archive', created_time: null }], documents: [] }
        : { folders: [], documents: [] },
    );

    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(placeholders.ensureDownloadFolderPlaceholder).toHaveBeenCalledWith(
      'archive',
      '.cfms-empty-folder',
    );
  });

  it('records a folder whose listing is denied and creates its marker', async () => {
    const listFn = vi.fn(async (id: string | null) => {
      if (id === null) {
        return { folders: [{ id: 'locked-folder', name: 'locked', created_time: null }], documents: [] };
      }
      throw new Error('Server returned 403: access denied');
    });

    const result = await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(placeholders.ensureDownloadFolderPlaceholder).toHaveBeenCalledWith(
      'locked',
      '.cfms-no-folder-access',
    );
    expect(result.denied).toBe(1);
    expect(fileUpdateTracker.checkHistory.at(-1)).toMatchObject({
      denied: 1,
      items: [{ id: 'folder:locked-folder', title: 'locked', path: 'locked', kind: 'denied' }],
    });
    expect(placeholders.commitPendingFolderHistoryChanges).toHaveBeenCalledOnce();
  });

  it('records a restored folder permission and commits its history marker', async () => {
    const deniedMarker = 'locked/.cfms-no-folder-access';
    files.checkDownloadsExist.mockResolvedValue([deniedMarker]);
    const listFn = vi.fn(async (id: string | null) =>
      id === null
        ? { folders: [{ id: 'locked-folder', name: 'locked', created_time: null }], documents: [] }
        : { folders: [], documents: [] },
    );

    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(files.deleteDownloadFile).toHaveBeenCalledWith(deniedMarker);
    expect(placeholders.recordFolderHistoryMarker).toHaveBeenCalledWith(
      '* folder permission restored: locked',
    );
    expect(placeholders.commitPendingFolderHistoryChanges).toHaveBeenCalledOnce();
  });

  it('offers a document whose access check failed for reasons other than a refusal', async () => {
    // A dropped connection says nothing about permission. Hiding the update
    // would be a silent lie; the next check can ask again.
    const listFn = serve([{ id: 'd1', title: 'a.txt', state: {} }]);
    files.getDocumentInfo.mockRejectedValue(new Error('WebSocket closed unexpectedly'));

    const result = await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(result.outdated).toBe(1);
    expect(result.denied).toBe(0);
    expect(deniedDocuments.isDenied('d1')).toBe(false);
  });

  it('classifies why each document was flagged, and names it', async () => {
    const listFn = serve([
      { id: 'new', title: 'new.txt', state: {} },
      { id: 'edit', title: 'edit.txt', state: { existsLocally: true, mismatched: true } },
      { id: 'nohash', title: 'nohash.txt', state: { existsLocally: true } },
    ]);

    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(fileUpdateTracker.checkHistory.at(-1)?.items).toEqual([
      { id: 'new', title: 'new.txt', path: 'new.txt', kind: 'added' },
      { id: 'edit', title: 'edit.txt', path: 'edit.txt', kind: 'modified' },
      { id: 'nohash', title: 'nohash.txt', path: 'nohash.txt', kind: 'unverifiable' },
    ]);
  });

  it('re-tests a recorded denial on every check instead of trusting it', async () => {
    deniedDocuments.mark({ docId: 'locked', path: 'locked.txt' });
    files.getDocumentInfo.mockRejectedValue(new Error('Server returned 403: access denied'));
    // First check: still refused, so it stays in the denied bucket.
    const listFn = serve([{ id: 'locked', title: 'locked.txt', state: {} }]);
    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);
    expect(fileUpdateTracker.checkHistory.at(-1)?.denied).toBe(1);

    // Access granted in the meantime: the record must not outlive the refusal.
    files.getDocumentInfo.mockResolvedValue(null);
    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(deniedDocuments.isDenied('locked')).toBe(false);
    expect(fileUpdateTracker.checkHistory.at(-1)).toMatchObject({ changed: 1, denied: 0 });
  });
});
