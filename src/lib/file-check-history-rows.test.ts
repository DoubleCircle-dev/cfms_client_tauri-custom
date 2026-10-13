import { describe, expect, it } from 'vitest';
import type { CheckHistoryEntry } from './file-update-tracker.svelte';
import { buildCheckHistoryRows } from './file-check-history-rows';

function checkEntry(overrides: Partial<CheckHistoryEntry> = {}): CheckHistoryEntry {
  return {
    time: 1,
    eventType: 'check',
    changed: 0,
    dirs: 2,
    docs: 4,
    items: [],
    hidden: 0,
    denied: 0,
    revoked: 0,
    restored: 0,
    ...overrides,
  };
}

describe('buildCheckHistoryRows', () => {
  it('folds consecutive checks with the same denied items into a no-change row', () => {
    const denial = { id: 'document:d1', title: 'secret.txt', path: 'private/secret.txt', kind: 'denied' as const };

    expect(buildCheckHistoryRows([
      checkEntry({ time: 3, denied: 1, items: [denial] }),
      checkEntry({ time: 2, denied: 1, items: [denial] }),
    ])).toEqual([
      {
        kind: 'quiet',
        entries: [
          checkEntry({ time: 3, denied: 1, items: [denial] }),
          checkEntry({ time: 2, denied: 1, items: [denial] }),
        ],
      },
    ]);
  });

  it('keeps distinct denied items as separate history entries', () => {
    const first = { id: 'document:d1', title: 'one.txt', path: 'one.txt', kind: 'denied' as const };
    const second = { id: 'document:d2', title: 'two.txt', path: 'two.txt', kind: 'denied' as const };

    expect(buildCheckHistoryRows([
      checkEntry({ denied: 1, items: [first] }),
      checkEntry({ denied: 1, items: [second] }),
    ])).toEqual([
      { kind: 'entry', entry: checkEntry({ denied: 1, items: [first] }) },
      { kind: 'entry', entry: checkEntry({ denied: 1, items: [second] }) },
    ]);
  });

  it('does not fold permission transitions or checks with real updates', () => {
    const denial = { id: 'document:d1', title: 'secret.txt', path: 'secret.txt', kind: 'denied' as const };

    expect(buildCheckHistoryRows([
      checkEntry({ denied: 1, items: [denial] }),
      checkEntry({ denied: 1, revoked: 1, items: [{ ...denial, kind: 'access_revoked' }] }),
      checkEntry({ denied: 1, changed: 1, items: [denial] }),
    ])).toEqual([
      { kind: 'entry', entry: checkEntry({ denied: 1, items: [denial] }) },
      { kind: 'entry', entry: checkEntry({ denied: 1, revoked: 1, items: [{ ...denial, kind: 'access_revoked' }] }) },
      { kind: 'entry', entry: checkEntry({ denied: 1, changed: 1, items: [denial] }) },
    ]);
  });

  it('continues to fold ordinary no-change checks', () => {
    expect(buildCheckHistoryRows([checkEntry({ time: 2 }), checkEntry({ time: 1 })])).toEqual([
      { kind: 'quiet', entries: [checkEntry({ time: 2 }), checkEntry({ time: 1 })] },
    ]);
  });
});
