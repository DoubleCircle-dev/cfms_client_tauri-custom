import { beforeEach, describe, expect, it, vi } from 'vitest';

// The tracker only reaches out for the local comparison; everything else it
// needs is local state, so the sync engine is stubbed out.
vi.mock('$lib/sync-all.svelte', () => ({ readLocalDocumentStates: vi.fn() }));

import { fileUpdateTracker } from './file-update-tracker.svelte';

const HISTORY_KEY_PREFIX = 'cfms:file-check-history:v1';

function scopeFor(serverAddress: string, username: string) {
  return { serverAddress, username };
}

beforeEach(() => {
  // Point the tracker at a dummy account first: switching scope always clears
  // the in-memory log, which gives every test the same empty starting point.
  fileUpdateTracker.useAccountScope(scopeFor('reset', 'reset'));
  window.localStorage.clear();
});

describe('check history scoping', () => {
  it('stores each account under its own key', () => {
    fileUpdateTracker.useAccountScope(scopeFor('wss://server.example:5104', 'alice'));
    fileUpdateTracker.addCheckHistory(1, 0, 1);

    expect(Object.keys(window.localStorage)).toEqual([
      `${HISTORY_KEY_PREFIX}:${encodeURIComponent('wss://server.example:5104')}:alice`,
    ]);
  });

  it('never shows one account the history of another', () => {
    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'alice'));
    fileUpdateTracker.addCheckHistory(3, 1, 5);

    // Same server, different user.
    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'bob'));
    expect(fileUpdateTracker.checkHistory).toEqual([]);
    fileUpdateTracker.addCheckHistory(0, 2, 9);

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
    fileUpdateTracker.addCheckHistory(2, 0, 2);

    fileUpdateTracker.useAccountScope(scopeFor('wss://a', 'alice'));

    expect(fileUpdateTracker.checkHistory).toHaveLength(1);
  });

  it('does not write history to a shared key while logged out', () => {
    fileUpdateTracker.useAccountScope(null);
    fileUpdateTracker.addCheckHistory(1, 1, 1);

    expect(fileUpdateTracker.checkHistory).toHaveLength(1);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });
});
