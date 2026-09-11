import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ getDocumentInfo: vi.fn() }));
// The tracker reaches out for the local comparison and, once per candidate, for
// the permission test that decides whether it is worth offering at all.
vi.mock('$lib/api/files', () => files);
const placeholders = vi.hoisted(() => ({ ensureDownloadPlaceholder: vi.fn() }));
vi.mock('$lib/sync-all.svelte', () => ({
  makeDownloadPath: (p: string[]) => p.join('/'),
  readLocalDocumentStates: vi.fn(),
  ensureDownloadPlaceholder: placeholders.ensureDownloadPlaceholder,
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
  placeholders.ensureDownloadPlaceholder.mockReset();
  placeholders.ensureDownloadPlaceholder.mockResolvedValue(false);
  vi.mocked(readLocalDocumentStates).mockReset();
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

  it('does not write history to a shared key while logged out', () => {
    fileUpdateTracker.useAccountScope(null);
    fileUpdateTracker.addCheckHistory({ outdated: 1, denied: 0, dirs: 1, docs: 1, items: [], hidden: 0 });

    expect(fileUpdateTracker.checkHistory).toHaveLength(1);
    expect(Object.keys(window.localStorage)).toEqual([]);
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
    // The stand-in is what the user sees in place of the file they cannot have,
    // and since the check never queues it, the check has to write it.
    expect(placeholders.ensureDownloadPlaceholder).toHaveBeenCalledWith('locked.txt');
  });

  it('leaves the local tree alone for a document it can read', async () => {
    const listFn = serve([{ id: 'fresh', title: 'fresh.txt', state: {} }]);

    await fileUpdateTracker.recursiveCheck(listFn, null, 3, 0);

    expect(placeholders.ensureDownloadPlaceholder).not.toHaveBeenCalled();
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
