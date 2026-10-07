import type { CheckHistoryEntry, CheckHistoryItemKind } from './file-update-tracker.svelte';

export interface CheckHistoryCsvLabels {
  headers: string[];
  checkEvent: string;
  accessRulesEvent: string;
  itemKind: (kind: CheckHistoryItemKind) => string;
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Serialize full check-history entries as spreadsheet-safe UTF-8 CSV rows. */
export function serializeCheckHistoryCsv(
  entries: readonly CheckHistoryEntry[],
  serverAddress: string,
  username: string,
  labels: CheckHistoryCsvLabels,
): string {
  const rows: (string | number)[][] = [labels.headers];
  for (const entry of entries) {
    const event = entry.eventType === 'access_rules' ? labels.accessRulesEvent : labels.checkEvent;
    const items = entry.items.length > 0 ? entry.items : [null];
    items.forEach((item, index) => {
      const firstRow = index === 0;
      rows.push([
        new Date(entry.time).toISOString(),
        event,
        serverAddress,
        username,
        firstRow ? entry.changed : '',
        firstRow ? entry.denied : '',
        firstRow ? entry.revoked : '',
        firstRow ? entry.restored : '',
        firstRow ? entry.dirs : '',
        firstRow ? entry.docs : '',
        item ? labels.itemKind(item.kind) : '',
        item?.title ?? '',
        item?.path ?? '',
        firstRow ? entry.hidden : '',
      ]);
    });
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
