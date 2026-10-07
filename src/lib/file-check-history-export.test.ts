import { describe, expect, it } from 'vitest';
import { serializeCheckHistoryCsv } from './file-check-history-export';
import type { CheckHistoryEntry } from './file-update-tracker.svelte';

const labels = {
  headers: [
    'Time', 'Event', 'Server', 'Account', 'Changed', 'Denied', 'Revoked',
    'Restored', 'Directories', 'Documents', 'Item kind', 'Item title', 'Path',
    'Hidden items',
  ],
  checkEvent: 'Check',
  accessRulesEvent: 'Access rules',
  itemKind: (kind: string) => kind,
};

function entry(overrides: Partial<CheckHistoryEntry> = {}): CheckHistoryEntry {
  return {
    time: Date.parse('2026-10-08T00:00:00.000Z'),
    eventType: 'check',
    changed: 0,
    dirs: 1,
    docs: 1,
    items: [],
    hidden: 0,
    denied: 0,
    revoked: 0,
    restored: 0,
    ...overrides,
  };
}

describe('serializeCheckHistoryCsv', () => {
  it('writes every history item with its event and account scope', () => {
    const csv = serializeCheckHistoryCsv(
      [
        entry({
          revoked: 1,
          denied: 1,
          items: [{
            id: 'd1',
            title: 'Report',
            path: 'Docs/Report.csv',
            kind: 'access_revoked',
          }],
        }),
        entry({
          eventType: 'access_rules',
          items: [{
            id: 'f1',
            title: 'Docs',
            path: 'Docs',
            kind: 'permission_changed',
          }],
        }),
      ],
      'https://server.example',
      'alice',
      labels,
    );

    expect(csv).toContain('"Check","https://server.example","alice"');
    expect(csv).toContain('"access_revoked","Report","Docs/Report.csv"');
    expect(csv).toContain('"Access rules"');
    expect(csv).toContain('"permission_changed","Docs","Docs"');
  });

  it('quotes delimiters, line breaks, quotes, and guards spreadsheet formulas', () => {
    const csv = serializeCheckHistoryCsv(
      [entry({
        items: [{
          id: 'd1',
          title: 'formula',
          path: '=HYPERLINK("https://example.invalid")',
          kind: 'denied',
        }],
      })],
      'https://server.example',
      'alice',
      labels,
    );

    expect(csv).toContain(`"'=HYPERLINK(""https://example.invalid"")"`);
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
