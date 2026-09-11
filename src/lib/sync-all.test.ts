import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerDocumentEntry } from '$lib/api';
import { makeDownloadPath, readLocalDocumentStates, syncFiles } from './sync-all.svelte';

const files = vi.hoisted(() => ({
  computeLocalSha256: vi.fn(),
  createDownloadPlaceholder: vi.fn(),
  deleteDownloadFile: vi.fn(),
  downloadGitCommit: vi.fn(),
  downloadGitInit: vi.fn(),
  getDocument: vi.fn(),
  listDirectory: vi.fn(),
  listDownloadFiles: vi.fn(),
  moveDownloadFile: vi.fn(),
}));

const settings = vi.hoisted(() => ({
  getSyncGitTrackingEnabled: vi.fn(async () => false),
}));

vi.mock('$lib/api/files', () => files);
vi.mock('$lib/api/settings', () => settings);

function doc(title: string, sha256: string | null = 'HASH', id = title): ServerDocumentEntry {
  return { id, title, size: 1024, last_modified: null, sha256 };
}

beforeEach(() => {
  for (const mock of Object.values(files)) mock.mockReset();
  settings.getSyncGitTrackingEnabled.mockReset();
  settings.getSyncGitTrackingEnabled.mockResolvedValue(false);

  files.computeLocalSha256.mockResolvedValue({});
  files.getDocument.mockResolvedValue(null);
  files.moveDownloadFile.mockResolvedValue(true);
  files.createDownloadPlaceholder.mockResolvedValue(undefined);
  files.downloadGitInit.mockResolvedValue(undefined);
  files.downloadGitCommit.mockResolvedValue(null);
});

describe('readLocalDocumentStates', () => {
  it('does not call the backend when the directory has no documents', async () => {
    await expect(readLocalDocumentStates([], ['any'])).resolves.toEqual([]);
    expect(files.computeLocalSha256).not.toHaveBeenCalled();
  });

  it('hashes exactly the download paths the sync engine uses', async () => {
    await readLocalDocumentStates([doc('read me.txt')], ['a/b', 'c']);

    // Sanitisation and joining must match `makeDownloadPath`, otherwise the
    // checker and the sync engine would disagree about which local file a
    // server document maps to.
    expect(files.computeLocalSha256).toHaveBeenCalledWith([
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
    files.computeLocalSha256.mockResolvedValue({ 'x/one.txt': 'A', 'x/two.txt': 'B' });

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

describe('syncFiles (cached queue)', () => {
  it('does nothing for an empty queue', async () => {
    const result = await syncFiles({ queue: [] });

    expect(files.computeLocalSha256).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
  });

  it('fetches exactly the queued documents, into their recorded download paths', async () => {
    const result = await syncFiles({
      queue: [
        { docId: 'd1', path: 'a/b.txt', sha256: 'S1' },
        { docId: 'd2', path: 'c.md', sha256: 'S2' },
      ],
    });

    expect(files.getDocument).toHaveBeenCalledTimes(2);
    expect(files.getDocument).toHaveBeenCalledWith('d1', 'a/b.txt', undefined, false);
    expect(files.getDocument).toHaveBeenCalledWith('d2', 'c.md', undefined, false);
    expect(result.queued).toBe(2);
    expect(result.changed).toBe(true);
  });

  it('never re-walks the server tree or the download root', async () => {
    // The whole point of the cached queue: confirming an update must not repeat
    // the scan the check already performed.
    await syncFiles({ queue: [{ docId: 'd1', path: 'a.txt', sha256: 'S' }] });

    expect(files.listDirectory).not.toHaveBeenCalled();
    expect(files.listDownloadFiles).not.toHaveBeenCalled();
  });

  it('skips documents that became current since the check ran', async () => {
    files.computeLocalSha256.mockResolvedValue({ 'a.txt': 'SAME' });

    const result = await syncFiles({ queue: [{ docId: 'd1', path: 'a.txt', sha256: 'SAME' }] });

    expect(files.getDocument).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.changed).toBe(false);
  });

  it('backs up an outdated local copy before replacing it', async () => {
    files.computeLocalSha256.mockResolvedValue({ 'a.txt': 'OLD' });

    await syncFiles({
      queue: [{ docId: 'd1', path: 'a.txt', sha256: 'NEW' }],
      overwriteStrategy: 'backup_rename',
    });

    expect(files.moveDownloadFile).toHaveBeenCalledWith('a.txt', expect.stringMatching(/^a\.txt\+/));
    // Renamed away, so the download writes a new file rather than overwriting.
    expect(files.getDocument).toHaveBeenCalledWith('d1', 'a.txt', undefined, false);
  });

  it('honours the configured strategy while git tracking is on', async () => {
    // Git tracking records the result in a commit; it must not override the
    // strategy the user picked.
    settings.getSyncGitTrackingEnabled.mockResolvedValue(true);
    files.computeLocalSha256.mockResolvedValue({ 'a.txt': 'OLD' });

    await syncFiles({
      queue: [{ docId: 'd1', path: 'a.txt', sha256: 'NEW' }],
      overwriteStrategy: 'backup_rename',
    });

    expect(files.moveDownloadFile).toHaveBeenCalledWith('a.txt', expect.stringMatching(/^a\.txt\+/));
  });

  it('leaves conflicting files alone under the skip strategy but still fetches new ones', async () => {
    files.computeLocalSha256.mockResolvedValue({ 'old.txt': 'OLD' });

    const result = await syncFiles({
      queue: [
        { docId: 'old', path: 'old.txt', sha256: 'NEW' },
        { docId: 'fresh', path: 'fresh.txt', sha256: 'F' },
      ],
      overwriteStrategy: 'skip',
    });

    expect(files.getDocument).toHaveBeenCalledTimes(1);
    expect(files.getDocument).toHaveBeenCalledWith('fresh', 'fresh.txt', undefined, false);
    expect(result.skipped).toBe(1);
    expect(result.queued).toBe(1);
  });

  it('mirrors an inaccessible document as a placeholder instead of dropping it', async () => {
    files.getDocument.mockRejectedValue('Server returned 403: access denied');

    await syncFiles({ queue: [{ docId: 'd1', path: 'secret.txt', sha256: 'S' }] });

    expect(files.createDownloadPlaceholder).toHaveBeenCalledWith('secret.txt');
  });

  it('commits a git snapshot only when something actually changed', async () => {
    settings.getSyncGitTrackingEnabled.mockResolvedValue(true);

    await syncFiles({ queue: [{ docId: 'd1', path: 'a.txt', sha256: 'S' }] });
    expect(files.downloadGitCommit).toHaveBeenCalledTimes(1);

    files.downloadGitCommit.mockClear();
    // Already current → nothing fetched → no commit.
    files.computeLocalSha256.mockResolvedValue({ 'b.txt': 'S' });
    await syncFiles({ queue: [{ docId: 'd2', path: 'b.txt', sha256: 'S' }] });
    expect(files.downloadGitCommit).not.toHaveBeenCalled();
  });
});

describe('syncFiles (full server walk)', () => {
  /** Serve one directory holding `documents` and a download root holding `local`. */
  function serve(documents: ServerDocumentEntry[], local: Record<string, string>) {
    files.listDirectory.mockResolvedValue({ folders: [], documents });
    files.computeLocalSha256.mockResolvedValue(local);
    files.listDownloadFiles.mockResolvedValue(Object.keys(local));
  }

  it('fetches a document the server cannot prove is current, even when a local copy exists', async () => {
    // Regression: the cached-queue path re-fetched documents the server sends no
    // hash for, while the full walk treated them as up to date and reported
    // "all files are up to date" without downloading anything.
    serve([doc('a.txt', null)], { 'a.txt': 'LOCAL' });

    const result = await syncFiles({ overwriteStrategy: 'force_overwrite' });

    expect(files.getDocument).toHaveBeenCalledWith('a.txt', 'a.txt', undefined, true);
    expect(result.updated).toBe(1);
    expect(result.changed).toBe(true);
  });

  it('leaves a document the server proves is current alone', async () => {
    serve([doc('a.txt', 'SAME')], { 'a.txt': 'SAME' });

    const result = await syncFiles({ overwriteStrategy: 'force_overwrite' });

    expect(files.getDocument).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.changed).toBe(false);
  });
});

/** Run the comparison with a canned local-hash response. */
async function withLocalHashes(
  documents: ServerDocumentEntry[],
  localHashes: Record<string, string>,
) {
  files.computeLocalSha256.mockResolvedValue(localHashes);
  return readLocalDocumentStates(documents, []);
}
