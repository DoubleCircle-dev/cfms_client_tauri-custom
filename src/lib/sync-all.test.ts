import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerDocumentEntry } from '$lib/api';
import { makeDownloadPath, readLocalDocumentStates } from './sync-all.svelte';

const { computeLocalSha256 } = vi.hoisted(() => ({ computeLocalSha256: vi.fn() }));

vi.mock('$lib/api/files', () => ({
  computeLocalSha256,
  createDownloadPlaceholder: vi.fn(),
  deleteDownloadFile: vi.fn(),
  downloadGitCommit: vi.fn(),
  downloadGitInit: vi.fn(),
  getDocument: vi.fn(),
  listDirectory: vi.fn(),
  listDownloadFiles: vi.fn(),
  moveDownloadFile: vi.fn(),
}));

function doc(title: string, sha256: string | null = 'HASH', id = title): ServerDocumentEntry {
  return { id, title, size: 1024, last_modified: null, sha256 };
}

describe('readLocalDocumentStates', () => {
  beforeEach(() => {
    computeLocalSha256.mockReset();
  });

  it('does not call the backend when the directory has no documents', async () => {
    await expect(readLocalDocumentStates([], ['any'])).resolves.toEqual([]);
    expect(computeLocalSha256).not.toHaveBeenCalled();
  });

  it('hashes exactly the download paths the sync engine uses', async () => {
    computeLocalSha256.mockResolvedValue({});

    await readLocalDocumentStates([doc('read me.txt')], ['a/b', 'c']);

    // Sanitisation and joining must match `makeDownloadPath`, otherwise the
    // checker and the sync engine would disagree about which local file a
    // server document maps to.
    expect(computeLocalSha256).toHaveBeenCalledWith([
      makeDownloadPath(['a/b', 'c', 'read me.txt']),
    ]);
  });

  it('treats a matching hash as up to date', async () => {
    const [state] = await withLocalHashes([doc('a.txt', 'HASH')], { 'a.txt': 'HASH' });

    expect(state.isCurrent).toBe(true);
    expect(state.mismatched).toBe(false);
    expect(state.localHash).toBe('HASH');
  });

  it('flags a differing hash as outdated and mismatched', async () => {
    const [state] = await withLocalHashes([doc('a.txt', 'SERVER')], { 'a.txt': 'LOCAL' });

    expect(state.isCurrent).toBe(false);
    expect(state.mismatched).toBe(true);
  });

  it('treats a file missing from the download root as outdated, not mismatched', async () => {
    // `compute_local_sha256` omits files it cannot read, so an absent key means
    // "never downloaded".
    const [state] = await withLocalHashes([doc('a.txt', 'HASH')], {});

    expect(state.isCurrent).toBe(false);
    expect(state.mismatched).toBe(false);
    expect(state.localHash).toBeNull();
  });

  it('cannot call a document current when the server sends no hash', async () => {
    const [state] = await withLocalHashes([doc('a.txt', null)], { 'a.txt': 'LOCAL' });

    expect(state.isCurrent).toBe(false);
    expect(state.mismatched).toBe(false);
  });

  it('keeps each document paired with its own path', async () => {
    computeLocalSha256.mockResolvedValue({ 'x/one.txt': 'A', 'x/two.txt': 'B' });

    const states = await readLocalDocumentStates(
      [doc('one.txt', 'A', 'id-1'), doc('two.txt', 'OTHER', 'id-2')],
      ['x'],
    );

    expect(states.map((s) => [s.doc.id, s.path, s.isCurrent])).toEqual([
      ['id-1', 'x/one.txt', true],
      ['id-2', 'x/two.txt', false],
    ]);
  });
});

/** Run the comparison with a canned local-hash response. */
async function withLocalHashes(
  documents: ServerDocumentEntry[],
  localHashes: Record<string, string>,
) {
  computeLocalSha256.mockResolvedValue(localHashes);
  return readLocalDocumentStates(documents, []);
}
