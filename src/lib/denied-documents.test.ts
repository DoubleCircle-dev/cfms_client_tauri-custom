import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ getDocumentInfo: vi.fn() }));
vi.mock('$lib/api/files', () => files);

import { deniedDocuments } from './denied-documents.svelte';

const KEY_PREFIX = 'cfms:denied-documents:v1';

function scopeFor(serverAddress: string, username: string) {
  return { serverAddress, username };
}

beforeEach(() => {
  // Point the store at a throwaway account, then empty it: switching scope only
  // clears the records when the key actually changes, so a repeated scope call
  // (which production relies on) would leave the previous test's records behind.
  deniedDocuments.useAccountScope(scopeFor('reset', 'reset'));
  deniedDocuments.clearAll();
  window.localStorage.clear();
  files.getDocumentInfo.mockReset();
});

describe('denied documents', () => {
  it('stores each account under its own key', () => {
    deniedDocuments.useAccountScope(scopeFor('wss://server.example:5104', 'alice'));
    deniedDocuments.mark({ docId: 'd1', path: 'a/b.txt' });

    expect(Object.keys(window.localStorage)).toEqual([
      `${KEY_PREFIX}:${encodeURIComponent('wss://server.example:5104')}:alice`,
    ]);
  });

  it('never shows one account the denials of another', () => {
    deniedDocuments.useAccountScope(scopeFor('wss://a', 'alice'));
    deniedDocuments.mark({ docId: 'd1', path: 'a/b.txt' });

    // Same server, different user — and the same document is not denied to them.
    deniedDocuments.useAccountScope(scopeFor('wss://a', 'bob'));
    expect(deniedDocuments.isDenied('d1')).toBe(false);

    deniedDocuments.useAccountScope(scopeFor('wss://a', 'alice'));
    expect(deniedDocuments.isDenied('d1')).toBe(true);
  });

  it('answers yes for a readable document and no only for a refusal', async () => {
    files.getDocumentInfo.mockResolvedValueOnce(null);
    await expect(deniedDocuments.probeDocumentAccess('open')).resolves.toBe(true);

    files.getDocumentInfo.mockRejectedValueOnce(new Error('Server returned 403: access denied'));
    await expect(deniedDocuments.probeDocumentAccess('closed')).resolves.toBe(false);
  });

  it('does not read a network failure as a refusal', async () => {
    // The document may be perfectly readable — the answer just never arrived.
    // Treating this as denied would hide a real update until the next check.
    files.getDocumentInfo.mockRejectedValueOnce(new Error('WebSocket closed unexpectedly'));
    await expect(deniedDocuments.probeDocumentAccess('unknown')).resolves.toBe(true);
  });

  it('does not read a throttled or overloaded server as a refusal', async () => {
    files.getDocumentInfo.mockRejectedValueOnce(new Error('Server returned 429: too many requests'));
    await expect(deniedDocuments.probeDocumentAccess('busy')).resolves.toBe(true);
  });

  it('probes the document itself, not its metadata rules', async () => {
    // Access rules live behind their own permission, so a user without it would
    // have every document look refused.
    files.getDocumentInfo.mockResolvedValue(null);

    await deniedDocuments.probeDocumentAccess('d1');

    expect(files.getDocumentInfo).toHaveBeenCalledWith('d1');
  });

  it('forgets a record when the document is fetchable again', () => {
    deniedDocuments.mark({ docId: 'd1', path: 'a/b.txt' });
    deniedDocuments.clear('d1');

    expect(deniedDocuments.isDenied('d1')).toBe(false);
    expect(deniedDocuments.count).toBe(0);
  });
});
