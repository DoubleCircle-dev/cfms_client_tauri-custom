<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { listDirectory } from '$lib/api';
  import type { SyncOverwriteStrategy } from '$lib/api/settings';
  import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import { serverStateStore } from '$lib/features/connection/connection-state.svelte.ts';
  import { notificationStore } from '$lib/shared/notifications/notifications.svelte.ts';
  import { fileUpdateTracker, type CheckHistoryEntry, type CheckHistoryItemKind, type PendingUpdateItem } from '$lib/file-update-tracker.svelte';
  import { buildCheckHistoryRows } from '$lib/file-check-history-rows';
  import { serializeCheckHistoryCsv } from '$lib/file-check-history-export';
  import { makeDownloadPath, syncAllCoordinator, syncFiles } from '$lib/sync-all.svelte';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';

  let { accountName }: { accountName: string } = $props();

  const checkHistory = $derived([...fileUpdateTracker.checkHistory].reverse());
  const lastCheckResult = $derived(checkHistory.find((entry) => entry.eventType === 'check') ?? null);
  const pendingUpdates = $derived(fileUpdateTracker.pendingUpdates);
  const pendingDeletions = $derived(fileUpdateTracker.pendingDeletions);
  const historyRows = $derived(buildCheckHistoryRows(checkHistory));

  let expandedHistory = $state<Set<number>>(new Set());
  let checkBusy = $state(false);
  let queueBusy = $state(false);

  function toggleHistoryRow(time: number) {
    const next = new Set(expandedHistory);
    if (!next.delete(time)) next.add(time);
    expandedHistory = next;
  }

  function formatCheckTime(timestamp: number) {
    return new Date(timestamp).toLocaleString();
  }

  function historyKindLabel(kind: CheckHistoryItemKind) {
    switch (kind) {
      case 'added': return $t('files.checkKindAdded');
      case 'modified': return $t('files.checkKindModified');
      case 'denied': return $t('files.checkKindDenied');
      case 'permission_changed': return $t('files.checkKindPermissionChanged');
      case 'access_revoked': return $t('files.checkKindAccessRevoked');
      case 'access_restored': return $t('files.checkKindAccessRestored');
      default: return $t('files.checkKindUnverifiable');
    }
  }

  function historyAccessTransitionSummary(entry: CheckHistoryEntry) {
    return $t('files.checkHistoryAccessTransitions', {
      values: { revoked: entry.revoked, restored: entry.restored },
    });
  }

  async function clearCheckHistory() {
    const confirmed = await dialogStore.confirm({
      title: $t('files.checkHistoryClearTitle'),
      message: $t('files.checkHistoryClearConfirm'),
      confirmLabel: $t('files.checkHistoryClearConfirmButton'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      await fileUpdateTracker.clearCheckHistory();
      expandedHistory = new Set();
      notificationStore.success($t('files.checkHistoryCleared'));
    } catch (error) {
      notificationStore.error(formatUserFacingError(error));
    }
  }

  function exportCheckHistory() {
    if (fileUpdateTracker.checkHistory.length === 0) return;
    try {
      const csv = serializeCheckHistoryCsv(
        fileUpdateTracker.checkHistory,
        serverStateStore.remoteAddress ?? '',
        accountName,
        {
          headers: [
            $t('files.checkHistoryCsvTime'),
            $t('files.checkHistoryCsvEvent'),
            $t('files.checkHistoryCsvServer'),
            $t('files.checkHistoryCsvAccount'),
            $t('files.checkHistoryCsvChanged'),
            $t('files.checkHistoryCsvDenied'),
            $t('files.checkHistoryCsvRevoked'),
            $t('files.checkHistoryCsvRestored'),
            $t('files.checkHistoryCsvDirectories'),
            $t('files.checkHistoryCsvDocuments'),
            $t('files.checkHistoryCsvItemKind'),
            $t('files.checkHistoryCsvItemTitle'),
            $t('files.checkHistoryCsvPath'),
            $t('files.checkHistoryCsvHidden'),
          ],
          checkEvent: $t('files.checkHistoryCsvCheckEvent'),
          accessRulesEvent: $t('files.checkHistoryCsvAccessRulesEvent'),
          itemKind: historyKindLabel,
        },
      );
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cfms-file-history-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notificationStore.success($t('files.checkHistoryExported'));
    } catch (error) {
      notificationStore.error(formatUserFacingError(error));
    }
  }

  function quietRange(entries: CheckHistoryEntry[]) {
    const newest = entries[0];
    const oldest = entries[entries.length - 1];
    return newest === oldest
      ? formatCheckTime(newest.time)
      : `${formatCheckTime(oldest.time)} — ${formatCheckTime(newest.time)}`;
  }

  async function triggerCheck() {
    if (checkBusy) return;
    checkBusy = true;
    try {
      await detectAndQueueServerChanges();
      fileUpdateTracker.resetPollingCountdown();
    } catch (error) {
      notificationStore.error(formatUserFacingError(error), 4000);
    } finally {
      checkBusy = false;
    }
  }

  async function detectAndQueueServerChanges() {
    const changed = new Map<string, PendingUpdateItem>();
    const result = await fileUpdateTracker.recursiveCheck(
      (id) => listDirectory(id),
      null,
      20,
      200,
      ({ pathParts, outdated }) => {
        for (const document of outdated) {
          changed.set(document.id, {
            id: document.id,
            title: document.title,
            path: [...pathParts, document.title].join('/'),
            downloadPath: makeDownloadPath([...pathParts, document.title]),
            sha256: document.sha256,
          });
        }
      },
    );
    fileUpdateTracker.replacePendingSyncPlan([...changed.values()], result.deletions);

    const parts: string[] = [];
    if (result.outdated > 0) {
      parts.push($t('files.checkHistoryUpdates', { values: { count: result.outdated } }));
    }
    if (result.denied > 0) {
      parts.push($t('files.checkHistoryDenied', { values: { count: result.denied } }));
    }
    if (result.deletions.length > 0) {
      parts.push($t('files.serverChangesDeletedFiles', { values: { count: result.deletions.length } }));
    }
    if (parts.length > 0) {
      notificationStore.info($t('files.serverChangesDetected', { values: { changes: parts.join(', ') } }), 5000);
    } else {
      notificationStore.success($t('files.noChangesDetected'), 2500);
    }
    return result.outdated;
  }

  async function confirmQueuedUpdates(strategy?: SyncOverwriteStrategy) {
    if (queueBusy || (pendingUpdates.length === 0 && pendingDeletions.length === 0)) return;
    if (syncAllCoordinator.busy) {
      notificationStore.info($t('files.autoDownloadBusy'), 4000);
      return;
    }

    queueBusy = true;
    try {
      if (pendingDeletions.length > 0 && strategy === undefined) {
        const confirmed = await dialogStore.confirm({
          title: $t('files.syncDeleteTitle'),
          message: $t('files.syncDeleteMessage', { values: { count: pendingDeletions.length } }),
          confirmLabel: $t('common.delete'),
          cancelLabel: $t('common.cancel'),
          danger: true,
        });
        if (!confirmed) return;
      }

      const result = await syncFiles({
        queue: pendingUpdates.map((item) => ({
          docId: item.id,
          path: item.downloadPath,
          sha256: item.sha256,
        })),
        stagedDeletions: pendingDeletions,
        confirmDeletes: false,
        overwriteStrategy: strategy,
        onStatus: (message, level) =>
          level === 'warning'
            ? notificationStore.warning(message, 5000)
            : notificationStore.success(message, 5000),
      });
      if (result.cancelled || result.failed) return;

      fileUpdateTracker.clearPendingUpdates();
      if (!result.changed && strategy !== undefined) {
        notificationStore.info($t('files.noChangesDetected'), 3000);
      }
    } catch (error) {
      notificationStore.error(formatUserFacingError(error), 4000);
    } finally {
      queueBusy = false;
    }
  }
</script>

<section class="check-history-section" aria-labelledby="check-history-title">
  <div class="check-history-header">
    <div class="check-history-heading">
      <Icon name="history" size="18px" />
      <h2 id="check-history-title">{$t('files.checkHistoryTitle')}</h2>
      {#if lastCheckResult}
        <span class="check-history-badge" class:has-changes={lastCheckResult.changed > 0}>
          {lastCheckResult.changed > 0
            ? `🔔 ${$t('files.checkHistoryBadgeChanges', { values: { count: lastCheckResult.changed } })}`
            : `✅ ${$t('files.checkHistoryBadgeNone')}`}
        </span>
      {/if}
    </div>
    <div class="check-history-actions">
      <button type="button" class="check-history-action" onclick={triggerCheck} disabled={checkBusy}>
        <Icon name="refresh" size="16px" />
        {$t('files.checkFileUpdates')}
      </button>
      <button
        type="button"
        class="check-history-action"
        onclick={() => confirmQueuedUpdates()}
        disabled={queueBusy || (pendingUpdates.length === 0 && pendingDeletions.length === 0)}
      >
        <Icon name="download" size="16px" />
        {$t('files.confirmQueuedUpdates')} ({pendingUpdates.length + pendingDeletions.length})
      </button>
      <button type="button" class="check-history-action" onclick={exportCheckHistory} disabled={checkHistory.length === 0}>
        <Icon name="download" size="16px" />
        {$t('files.checkHistoryExport')}
      </button>
      <button type="button" class="check-history-action danger" onclick={clearCheckHistory} disabled={checkHistory.length === 0}>
        <Icon name="delete" size="16px" />
        {$t('files.checkHistoryClear')}
      </button>
    </div>
  </div>

  {#if checkHistory.length === 0}
    <p class="check-history-empty">{$t('files.checkHistoryEmpty')}</p>
  {:else}
    <div class="check-history-list">
      {#each historyRows.slice(0, fileUpdateTracker.checkHistoryLimit) as row, index (`${row.kind}:${index}`)}
        {@const entry = row.kind === 'quiet' ? row.entries[0] : row.entry}
        {@const expandable = entry.items.length > 0}
        {@const expanded = expandedHistory.has(entry.time)}
        <div class="check-history-row" class:has-detail={expandable}>
          <button
            type="button"
            class="check-history-main"
            disabled={!expandable}
            aria-expanded={expandable ? expanded : undefined}
            onclick={() => toggleHistoryRow(entry.time)}
          >
            <span class="check-history-icon">
              {row.kind === 'quiet' ? '✅' : entry.eventType === 'access_rules' ? '🔐' : '🔔'}
            </span>
            <span class="check-history-time">
              {row.kind === 'quiet' ? quietRange(row.entries) : formatCheckTime(entry.time)}
            </span>
            <span class="check-history-info">
              <span class="check-history-summary">
                {row.kind === 'quiet'
                  ? entry.denied > 0
                    ? $t('files.checkHistoryDenied', {
                        values: { count: row.entries.reduce((count, item) => count + item.denied, 0) },
                      })
                    : $t(row.entries.length > 1 ? 'files.checkHistoryMerged' : 'files.checkHistoryNoChanges', {
                        values: { count: row.entries.length },
                      })
                  : entry.eventType === 'access_rules'
                    ? $t('files.checkHistoryAccessRules', { values: { count: entry.items.length + entry.hidden } })
                    : entry.revoked > 0 || entry.restored > 0
                      ? historyAccessTransitionSummary(entry)
                      : $t('files.checkHistoryUpdates', { values: { count: entry.changed } })}
              </span>
              {#if row.kind !== 'quiet' && entry.eventType === 'check'}
                <span class="check-history-meta">
                  {$t('files.checkHistoryScope', { values: { dirs: entry.dirs, docs: entry.docs } })}
                  {#if entry.denied > 0}
                    · {$t('files.checkHistoryDenied', { values: { count: entry.denied } })}
                  {/if}
                  {#if entry.scopePath}
                    · {$t('files.checkHistoryScopePath', { values: { path: entry.scopePath } })}
                  {/if}
                </span>
              {/if}
            </span>
            {#if expandable}
              <span class="check-history-chevron" class:open={expanded} aria-hidden="true">
                <Icon name="expandMore" size="18px" />
              </span>
            {/if}
          </button>
          {#if expandable}
            <div class="check-history-files" class:open={expanded}>
              <span class="check-history-files-title">{$t('files.checkHistoryFilesTitle')}</span>
              {#each entry.items as item (item.id)}
                <span class="check-history-file">
                  <span class="check-history-file-kind" data-kind={item.kind}>{historyKindLabel(item.kind)}</span>
                  <span class="check-history-file-path" title={item.path}>{item.path}</span>
                </span>
              {/each}
              {#if entry.hidden > 0}
                <span class="check-history-file-more">+{entry.hidden}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .check-history-section {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid color-mix(in srgb, var(--color-md3-outline) 55%, transparent);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-low) 86%, transparent);
  }

  .check-history-header,
  .check-history-heading,
  .check-history-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .check-history-header {
    justify-content: space-between;
  }

  .check-history-heading h2 {
    margin: 0;
  }

  .check-history-badge,
  .check-history-action {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2rem;
    border-radius: 999px;
    padding: 0.25rem 0.65rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
  }

  .check-history-badge {
    background: var(--color-md3-surface-container-high);
  }

  .check-history-badge.has-changes {
    color: var(--color-md3-primary);
  }

  .check-history-action {
    border: 1px solid var(--color-md3-outline-variant);
    background: transparent;
  }

  .check-history-action:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .check-history-action.danger {
    color: var(--color-md3-error);
  }

  .check-history-empty {
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.85rem;
  }

  .check-history-list {
    display: grid;
    gap: 0.35rem;
  }

  .check-history-row {
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-md3-outline) 35%, transparent);
    border-radius: 0.75rem;
  }

  .check-history-main {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.65rem;
    padding: 0.65rem;
    color: var(--color-md3-on-surface);
    text-align: left;
  }

  .check-history-main:disabled {
    cursor: default;
  }

  .check-history-icon,
  .check-history-time,
  .check-history-chevron {
    flex: none;
  }

  .check-history-time,
  .check-history-meta {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
  }

  .check-history-info {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }

  .check-history-summary {
    overflow-wrap: anywhere;
    font-size: 0.82rem;
  }

  .check-history-chevron {
    transition: transform 160ms ease;
  }

  .check-history-chevron.open {
    transform: rotate(180deg);
  }

  .check-history-files {
    display: none;
    gap: 0.35rem;
    padding: 0 0.75rem 0.75rem 2.4rem;
  }

  .check-history-files.open {
    display: grid;
  }

  .check-history-files-title {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
    font-weight: 600;
  }

  .check-history-file {
    display: flex;
    gap: 0.5rem;
    min-width: 0;
    font-size: 0.75rem;
  }

  .check-history-file-kind {
    flex: none;
    color: var(--color-md3-on-surface-variant);
  }

  .check-history-file-path {
    overflow-wrap: anywhere;
    color: var(--color-md3-on-surface);
  }

  .check-history-file-more {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
  }
</style>
