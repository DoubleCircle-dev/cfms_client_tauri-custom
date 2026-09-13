import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerDocumentEntry } from '$lib/api';
import { deniedDocuments } from './denied-documents.svelte';
import { EMPTY_SHA256, makeDownloadPath, readLocalDocumentStates, syncFiles } from './sync-all.svelte';

const files = vi.hoisted(() => ({
  checkDownloadsExist: vi.fn(),
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

const dialogs = vi.hoisted(() => ({
  choose: vi.fn(),
  confirm: vi.fn(async () => true),
  resolveConflicts: vi.fn(),
}));

vi.mock('$lib/api/files', () => files);
vi.mock('$lib/api/settings', () => settings);
vi.mock('$lib/dialogs.svelte', () => ({ dialogStore: dialogs }));
// The engine only needs a formatter. Initialising the real locale in a unit test
// is noise, and formatting throws while no locale is set.
vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (value: unknown) => void) {
      run((key: string) => key);
      return () => {};
    },
  },
}));

function doc(
  title: string,
  sha256: string | null = 'HASH',
  id = title,
  size: number | null = 1024,
): ServerDocumentEntry {
  return { id, title, size, last_modified: null, sha256 };
}

beforeEach(() => {
  for (const mock of Object.values(files)) mock.mockReset();
  settings.getSyncGitTrackingEnabled.mockReset();
  settings.getSyncGitTrackingEnabled.mockResolvedValue(false);

  files.computeLocalSha256.mockResolvedValue({});
  files.checkDownloadsExist.mockResolvedValue([]);
  files.getDocument.mockResolvedValue(null);
  files.moveDownloadFile.mockResolvedValue(true);
  files.createDownloadPlaceholder.mockResolvedValue(undefined);
  files.downloadGitInit.mockResolvedValue(undefined);
  files.downloadGitCommit.mockResolvedValue(null);

  // Default to "cancelled": a test that unexpectedly hits the prompt aborts
  // loudly instead of hanging on a modal nobody answers.
  dialogs.choose.mockResolvedValue(null);
  dialogs.resolveConflicts.mockResolvedValue(null);
  dialogs.confirm.mockResolvedValue(true);
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

  it('accepts a zero byte revision with no server hash as current', async () => {
    // Uploaders never hash empty files, so the server reports NULL for them.
    // There is only one empty byte string, so the local digest alone settles it.
    const [state] = await withLocalHashes(
      [doc('empty.txt', null, 'e', 0)],
      { 'empty.txt': EMPTY_SHA256 },
    );

    expect(state.isCurrent).toBe(true);
    expect(state.existsLocally).toBe(true);
  });

  it('still fetches a zero byte revision the download root does not have', async () => {
    const [state] = await withLocalHashes([doc('empty.txt', null, 'e', 0)], {});

    expect(state.isCurrent).toBe(false);
    expect(state.existsLocally).toBe(false);
  });

  it('does not accept a digest-less non-empty revision', async () => {
    const [state] = await withLocalHashes([doc('a.bin', null, 'a', 4096)], { 'a.bin': 'LOCAL' });

    expect(state.isCurrent).toBe(false);
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
    expect(files.getDocument).toHaveBeenCalledWith('d1', 'a/b.txt');
    expect(files.getDocument).toHaveBeenCalledWith('d2', 'c.md');
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

    expect(files.moveDownloadFile).toHaveBeenCalledWith('a.txt', expect.stringMatching(/^a\.txt\+\d{8}-\d{6}\.bak$/));
    // Renamed away, so the download writes a new file rather than overwriting.
    expect(files.getDocument).toHaveBeenCalledWith('d1', 'a.txt');
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

    expect(files.moveDownloadFile).toHaveBeenCalledWith('a.txt', expect.stringMatching(/^a\.txt\+\d{8}-\d{6}\.bak$/));
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
    expect(files.getDocument).toHaveBeenCalledWith('fresh', 'fresh.txt');
    expect(result.skipped).toBe(1);
    expect(result.queued).toBe(1);
  });

  it('mirrors an inaccessible document as a placeholder instead of dropping it', async () => {
    files.getDocument.mockRejectedValue('Server returned 403: access denied');

    await syncFiles({ queue: [{ docId: 'd1', path: 'secret.txt', sha256: 'S' }] });

    expect(files.createDownloadPlaceholder).toHaveBeenCalledWith('secret.txt');
  });

  it('records a denied document so the check stops offering it', async () => {
    deniedDocuments.clearAll();
    files.getDocument.mockRejectedValue('Server returned 403: access denied');

    const result = await syncFiles({ queue: [{ docId: 'd1', path: 'secret.txt', sha256: 'S' }] });

    expect(result.denied).toBe(1);
    // Nothing was written, so the run must not claim it changed anything.
    expect(result.changed).toBe(false);
    expect(deniedDocuments.isDenied('d1')).toBe(true);
  });

  it('keeps an existing placeholder instead of recreating it', async () => {
    deniedDocuments.clearAll();
    files.getDocument.mockRejectedValue('Server returned 403: access denied');
    files.checkDownloadsExist.mockResolvedValue(['secret.txt']);

    await syncFiles({ queue: [{ docId: 'd1', path: 'secret.txt', sha256: 'S' }] });

    expect(files.createDownloadPlaceholder).not.toHaveBeenCalled();
  });

  it('does nothing at all for an empty queue', async () => {
    // Recovery from a refusal is the check's job, not the sync's: the sync has
    // no way to know whether the permission changed, and guessing would turn an
    // every-run retry into a background download nobody asked for.
    deniedDocuments.clearAll();
    deniedDocuments.mark({ docId: 'd1', path: 'secret.txt' });

    const result = await syncFiles({ queue: [] });

    expect(files.getDocument).not.toHaveBeenCalled();
    expect(result.queued).toBe(0);
    expect(result.denied).toBe(0);
  });

  it('aborts the whole run when the conflict dialog is dismissed', async () => {
    // A cancelled confirm must not fall back to "skip": nothing is written at
    // all, so the caller can keep its queue and retry with another strategy.
    files.computeLocalSha256.mockResolvedValue({ 'old.txt': 'OLD' });
    dialogs.resolveConflicts.mockResolvedValue(null);

    const result = await syncFiles({
      queue: [
        { docId: 'old', path: 'old.txt', sha256: 'NEW' },
        { docId: 'fresh', path: 'fresh.txt', sha256: 'F' },
      ],
    });

    expect(dialogs.resolveConflicts).toHaveBeenCalledTimes(1);
    // Only the real conflict is offered; a missing file has nothing to decide.
    const options = dialogs.resolveConflicts.mock.calls[0][0] as {
      items: { id: string; label: string }[];
    };
    expect(options.items).toEqual([{ id: 'old', label: 'old.txt' }]);
    expect(files.getDocument).not.toHaveBeenCalled();
    expect(files.moveDownloadFile).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(true);
    expect(result.changed).toBe(false);
  });

  it('applies one strategy per file when the dialog returns several', async () => {
    files.computeLocalSha256.mockResolvedValue({ 'a.txt': 'OLD', 'b.txt': 'OLD' });
    dialogs.resolveConflicts.mockResolvedValue(new Map([
      ['d1', 'force_overwrite'],
      ['d2', 'skip'],
    ]));

    const result = await syncFiles({
      queue: [
        { docId: 'd1', path: 'a.txt', sha256: 'NEW' },
        { docId: 'd2', path: 'b.txt', sha256: 'NEW' },
      ],
    });

    // The file answered "overwrite" is replaced in place, with no backup.
    expect(files.moveDownloadFile).not.toHaveBeenCalled();
    expect(files.getDocument).toHaveBeenCalledTimes(1);
    expect(files.getDocument).toHaveBeenCalledWith('d1', 'a.txt');
    expect(result.cancelled).toBe(false);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(1);
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

    expect(files.getDocument).toHaveBeenCalledWith('a.txt', 'a.txt');
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

  it('keeps the backups it made instead of deleting them as strays', async () => {
    // Regression: the timestamped snapshot the engine writes is never on the
    // server, so the next full sync deleted the backup it had just created --
    // without asking, because git tracking skips the delete confirmation.
    serve([doc('a.txt', 'SAME')], { 'a.txt': 'SAME' });
    files.listDownloadFiles.mockResolvedValue([
      'a.txt',
      'a.txt+20260912-053811.bak',
      'a/b.txt+20260912-053811.bak',
      // Snapshots written before the `.bak` extension existed are still the
      // engine's own, so they must not be swept up either.
      'a.txt+20260912-053156',
    ]);

    const result = await syncFiles({ overwriteStrategy: 'force_overwrite' });

    expect(files.deleteDownloadFile).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
  });

  it('names the snapshot it keeps with a .bak extension', async () => {
    // The extension is what the download-root .gitignore excludes, so it also
    // decides whether the backup enters the version history.
    serve([doc('a.txt', 'NEW')], { 'a.txt': 'OLD' });

    await syncFiles({ overwriteStrategy: 'backup_rename' });

    expect(files.moveDownloadFile).toHaveBeenCalledWith(
      'a.txt',
      expect.stringMatching(/^a\.txt\+\d{8}-\d{6}\.bak$/),
    );
  });

  it('still deletes a local file the server no longer has', async () => {
    serve([doc('a.txt', 'SAME')], { 'a.txt': 'SAME' });
    files.listDownloadFiles.mockResolvedValue(['a.txt', 'gone.txt']);
    // The server never hashed `gone.txt`, so it is not in the local map either.
    files.computeLocalSha256.mockResolvedValue({ 'a.txt': 'SAME' });

    const result = await syncFiles({ overwriteStrategy: 'force_overwrite' });

    expect(files.deleteDownloadFile).toHaveBeenCalledWith('gone.txt');
    expect(result.deleted).toBe(1);
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
