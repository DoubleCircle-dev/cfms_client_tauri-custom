import type { CheckHistoryEntry } from './file-update-tracker.svelte';

export type CheckHistoryRow =
  | { kind: 'entry'; entry: CheckHistoryEntry }
  | { kind: 'quiet'; entries: CheckHistoryEntry[] };

function quietCheck(entry: CheckHistoryEntry): boolean {
  return entry.eventType === 'check'
    && entry.changed === 0
    && entry.denied === 0
    && entry.revoked === 0
    && entry.restored === 0
    && entry.items.length === 0;
}

function repeatedDenialKey(entry: CheckHistoryEntry): string | null {
  if (
    entry.eventType !== 'check'
    || entry.changed !== 0
    || entry.denied === 0
    || entry.revoked !== 0
    || entry.restored !== 0
    || entry.hidden !== 0
    || entry.items.length !== entry.denied
    || entry.items.some((item) => item.kind !== 'denied')
  ) {
    return null;
  }

  return JSON.stringify(
    entry.items
      .map((item) => JSON.stringify([item.id, item.title, item.path]))
      .sort(),
  );
}

/** Fold adjacent no-change checks and repeated identical permission denials. */
export function buildCheckHistoryRows(entries: readonly CheckHistoryEntry[]): CheckHistoryRow[] {
  const rows: CheckHistoryRow[] = [];

  for (let index = 0; index < entries.length;) {
    const entry = entries[index];
    const denialKey = repeatedDenialKey(entry);

    if (denialKey !== null) {
      const group = [entry];
      while (index + group.length < entries.length
        && repeatedDenialKey(entries[index + group.length]) === denialKey) {
        group.push(entries[index + group.length]);
      }
      rows.push(group.length > 1
        ? { kind: 'quiet', entries: group }
        : { kind: 'entry', entry });
      index += group.length;
      continue;
    }

    if (quietCheck(entry)) {
      const group = [entry];
      while (index + group.length < entries.length && quietCheck(entries[index + group.length])) {
        group.push(entries[index + group.length]);
      }
      rows.push({ kind: 'quiet', entries: group });
      index += group.length;
      continue;
    }

    rows.push({ kind: 'entry', entry });
    index++;
  }

  return rows;
}
