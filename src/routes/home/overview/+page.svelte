<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    getDirectoryInfo,
    getDocument,
    getFileAutoUpdateSettings,
    getSyncOverwriteStrategy,
    loadUserPreference,
    listDirectory,
    type SyncOverwriteStrategy,
  } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import HomeRecordPanel from '$lib/components/HomeRecordPanel.svelte';
  import {
    clearFavoriteRecords,
    clearRecentVisits,
    loadFavoriteRecords,
    loadRecentVisits,
    rememberVisit,
    removeRecentVisit,
    setFavoriteRecord,
    shouldRecordRecentVisits,
    type FilePreferenceScope,
    type FileRecord,
    type RecentFileRecord,
  } from '$lib/file-preferences';
  import {
    authStore,
    eventLog,
    fileShortcutValidationStore,
    notificationStore,
    serverStateStore,
  } from '$lib/stores.svelte';
  import { fileUpdateTracker, type CheckHistoryEntry, type PendingUpdateItem } from '$lib/file-update-tracker.svelte';
  import { syncAllFiles as runSyncAll } from '$lib/sync-all.svelte';
  import { formatUserFacingError } from '$lib/user-facing-errors';

  let recent = $state<RecentFileRecord[]>([]);
  let favorites = $state<FileRecord[]>([]);
  let loadingRecent = $state(true);
  let loadingFavorites = $state(true);
  let openingId = $state<string | null>(null);
  let recordRecentVisits = $state(true);
  let autoFileUpdateEnabled = $state(true);
  let autoFileUpdateIntervalMinutes = $state(60);
  let autoFileUpdateAutoDownload = $state(false);
  let syncOverwriteStrategy = $state<SyncOverwriteStrategy>('backup_rename');
  let queueBusy = $state(false);

  onMount(async () => {
    const scope = currentFilePreferenceScope();
    try {
      const preferences = await loadUserPreference();
      recordRecentVisits = shouldRecordRecentVisits(preferences);
      recent = await loadRecentVisits(scope);
      favorites = await loadFavoriteRecords(scope);
      const autoSettings = await getFileAutoUpdateSettings();
      autoFileUpdateEnabled = autoSettings.enabled;
      autoFileUpdateIntervalMinutes = autoSettings.intervalMinutes;
      autoFileUpdateAutoDownload = autoSettings.autoDownload;
      syncOverwriteStrategy = await getSyncOverwriteStrategy();
    } catch {
      recent = [];
      favorites = [];
      recordRecentVisits = true;
      autoFileUpdateEnabled = true;
      autoFileUpdateIntervalMinutes = 60;
      autoFileUpdateAutoDownload = false;
    } finally {
      loadingRecent = false;
      loadingFavorites = false;
    }

    // Trigger initial full scan once per login session
    if (!fileUpdateTracker.initialScanDone && !sessionStorage.getItem('cfms:initial-scan-done')) {
      fileUpdateTracker.initialScanDone = true;
      sessionStorage.setItem('cfms:initial-scan-done', '1');
      console.log('%c[cfms:check] Initial full scan after login…', 'color:#4fc3f7');
      try {
        const result = await fileUpdateTracker.recursiveCheck(
          (id) => listDirectory(id),
          null,
        );
        if (result.changed > 0) {
          notificationStore.info(
            $t('files.serverChangesDetected', {
              values: { changes: `${result.changed} director${result.changed === 1 ? 'y' : 'ies'} changed` },
            }),
            5000,
          );
        }
      } catch (err) {
        console.warn('[cfms:check] Initial scan failed:', err);
      }
    }

    // Start/stop persistent polling (survives page navigation) using user settings.
    if (autoFileUpdateEnabled) {
      fileUpdateTracker.startPolling(async () => {
        try {
          const changes = await detectAndQueueServerChanges();
          if (changes > 0 && autoFileUpdateAutoDownload) {
            // Automatic download: apply the configured strategy silently.
            await confirmQueuedUpdates(syncOverwriteStrategy);
          }
        } catch (err) {
          console.warn('[cfms:check] Poll failed:', err);
        }
      }, autoFileUpdateIntervalMinutes * 60 * 1000);
    } else {
      fileUpdateTracker.stopPolling();
    }
  });

  async function openRecord(record: FileRecord) {
    openingId = `${record.type}:${record.id}`;
    try {
      const scope = currentFilePreferenceScope();

      if (record.type === 'directory') {
        await getDirectoryInfo(record.id);
        recent = await rememberVisit(scope, record);
        const params = new URLSearchParams({
          folder: record.id,
          name: record.name,
        });
        await goto(`/home/files?${params.toString()}`);
      } else {
        const result = await getDocument(record.id, record.name);
        recent = await rememberVisit(scope, record);
        if (result.already_exists) {
          notificationStore.info($t('home.downloadAlreadyExists', { values: { name: record.name } }));
        } else {
          notificationStore.success($t('home.downloadQueued', { values: { name: record.name } }));
        }
      }
    } catch (err) {
      if (isUnavailableError(err)) {
        fileShortcutValidationStore.markUnavailable(record.type, record.id);
        eventLog.push('warning', `Shortcut is no longer accessible: ${record.type}:${record.id}`);
      } else {
        notificationStore.error(formatUserFacingError(err));
      }
    } finally {
      openingId = null;
    }
  }

  async function removeRecent(record: FileRecord) {
    recent = await removeRecentVisit(currentFilePreferenceScope(), record);
  }

  async function removeFavorite(record: FileRecord) {
    await setFavoriteRecord(currentFilePreferenceScope(), record, false);
    favorites = favorites.filter((item) => item.type !== record.type || item.id !== record.id);
  }

  async function clearRecent() {
    recent = await clearRecentVisits(currentFilePreferenceScope());
  }

  async function clearFavorites() {
    await clearFavoriteRecords(currentFilePreferenceScope());
    favorites = [];
  }

  function isShortcutUnavailable(record: FileRecord) {
    return fileShortcutValidationStore.isUnavailable(record.type, record.id);
  }

  function isUnavailableError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return /Server returned\s+(403|404|410)\b/i.test(message)
      || /not found|no longer exists|does not exist|access denied/i.test(message);
  }

  function formatVisitTime(timestamp: number) {
    return new Date(timestamp).toLocaleString();
  }

  function currentFilePreferenceScope(): FilePreferenceScope {
    return {
      serverAddress: serverStateStore.remoteAddress,
      username: authStore.username,
    };
  }

  const checkHistory = $derived([...fileUpdateTracker.checkHistory].reverse());
  const lastCheckResult = $derived(checkHistory[0] ?? null);
  const pendingUpdates = $derived(fileUpdateTracker.pendingUpdates);

  function formatCheckTime(ts: number) {
    return new Date(ts).toLocaleString();
  }

  let checkBusy = $state(false);

  // Poll countdown (mirrors files page)
  let pollCountdown = $state('');
  $effect(() => {
    const update = () => {
      const next = fileUpdateTracker.nextCheckTime;
      if (!next || !fileUpdateTracker.isPolling) { pollCountdown = ''; return; }
      const remaining = Math.max(0, next - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      pollCountdown = `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  });

  async function triggerCheck() {
    if (checkBusy) return;
    checkBusy = true;
    try {
      await detectAndQueueServerChanges();
      fileUpdateTracker.resetPollingCountdown();
    } catch (err) {
      notificationStore.error(String(err), 4000);
    } finally {
      checkBusy = false;
    }
  }

  async function detectAndQueueServerChanges() {
    const changedMap = new Map<string, PendingUpdateItem>();
    const result = await fileUpdateTracker.recursiveCheck(
      (id) => listDirectory(id),
      null,
      20,
      200,
      ({ pathParts, documents, diff }) => {
        if (diff.newDocuments.length === 0 && diff.modifiedDocuments.length === 0) return;
        const changedIds = new Set([...diff.newDocuments, ...diff.modifiedDocuments]);
        for (const doc of documents) {
          if (!changedIds.has(doc.id)) continue;
          changedMap.set(doc.id, {
            id: doc.id,
            title: doc.title,
            path: [...pathParts, doc.title].join('/'),
            sha256: doc.sha256,
          });
        }
      },
    );
    if (changedMap.size > 0) {
      fileUpdateTracker.enqueuePendingUpdates([...changedMap.values()]);
    }
    if (result.changed > 0) {
      notificationStore.info(
        $t('files.serverChangesDetected', {
          values: { changes: `${result.changed} director${result.changed === 1 ? 'y' : 'ies'} changed` },
        }),
        5000,
      );
    } else {
      notificationStore.success($t('files.noChangesDetected'), 2500);
    }
    return result.changed;
  }

  /** Confirm queued updates. A preset strategy (automatic downloads) applies
   *  silently; omitting it (manual confirm) prompts for each differing file. */
  async function confirmQueuedUpdates(strategy?: SyncOverwriteStrategy) {
    if (queueBusy || pendingUpdates.length === 0) return;
    queueBusy = true;
    try {
      await runSyncAll({
        overwriteLocal: false,
        confirmDeletes: true,
        overwriteStrategy: strategy,
        onStatus: (msg) => notificationStore.info(msg, 5000),
      });
      fileUpdateTracker.clearPendingUpdates();
    } catch (err) {
      notificationStore.error(String(err), 4000);
    } finally {
      queueBusy = false;
    }
  }

  onMount(() => {
    fileUpdateTracker.registerDevtoolHook(
      (id) => listDirectory(id),
      () => null,
    );
  });

  onDestroy(() => {
    delete (window as any).__cfms_check_updates__;
  });
</script>

<div class="workspace-page blueprint-home mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-5">
  <section class="blueprint-hero overflow-hidden">
    <div class="relative z-10 grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6">
      <div class="blueprint-hero-copy min-w-0">
        <h1 class="text-[clamp(1.75rem,7vw,3.25rem)] font-semibold leading-tight text-md3-on-surface">
          {$t('home.workspace')}
        </h1>
        <p class="mt-3 max-w-xl text-sm text-md3-on-surface-variant sm:text-base">
          {$t('home.welcomeBack')}
          {#if authStore.nickname ?? authStore.username}
            , {authStore.nickname ?? authStore.username}
          {/if}
        </p>
      </div>

      <div class="grid min-w-[12rem] content-end gap-1 text-sm">
        <div class="blueprint-status-chip">
          <Icon name={serverStateStore.connected ? 'checkCircle' : 'errorFilled'} size="18px" />
          <span>{serverStateStore.connected ? $t('common.connected') : $t('common.disconnected')}</span>
        </div>
        <div class="blueprint-status-chip blueprint-status-chip-muted">
          <Icon name="history" size="18px" />
          <span>{recent.length} {$t('home.recent')}</span>
        </div>
        <div class="blueprint-status-chip blueprint-status-chip-muted">
          <Icon name="star" size="18px" />
          <span>{favorites.length} {$t('home.favorites')}</span>
        </div>
        <button
          type="button"
          class="blueprint-check-btn"
          disabled={checkBusy}
          onclick={triggerCheck}
          title={$t('files.checkFileUpdates')}
        >
          {#if checkBusy}
            <span class="check-btn-spinner"></span>
          {:else}
            <Icon name="refresh" size="16px" />
          {/if}
          <span>{$t('files.checkFileUpdates')}</span>
        </button>
        <button
          type="button"
          class="blueprint-check-btn"
          disabled={queueBusy || pendingUpdates.length === 0}
          onclick={() => confirmQueuedUpdates()}
          title={$t('files.confirmQueuedUpdates')}
        >
          {#if queueBusy}
            <span class="check-btn-spinner"></span>
          {:else}
            <Icon name="download" size="16px" />
          {/if}
          <span>{$t('files.confirmQueuedUpdates')} ({pendingUpdates.length})</span>
        </button>
      </div>
    </div>
  </section>

  <div class="grid gap-4 lg:grid-cols-2">
    <HomeRecordPanel
      title={$t('home.recent')}
      icon="history"
      records={recent}
      loading={loadingRecent}
      emptyLabel={recordRecentVisits ? $t('home.noRecent') : $t('home.recentRecordingDisabled')}
      loadingLabel={$t('common.loadingEllipsis')}
      clearLabel={$t('home.clearRecent')}
      removeLabel={$t('home.removeShortcut')}
      unavailableLabel={$t('home.unavailable')}
      {openingId}
      meta={(item) => item.visitedAt ? formatVisitTime(item.visitedAt) : ''}
      isUnavailable={isShortcutUnavailable}
      onOpen={openRecord}
      onRemove={removeRecent}
      onClear={clearRecent}
    />

    <HomeRecordPanel
      title={$t('home.favorites')}
      icon="star"
      iconClass="text-md3-warning"
      records={favorites}
      loading={loadingFavorites}
      emptyLabel={$t('home.noFavorites')}
      loadingLabel={$t('common.loadingEllipsis')}
      clearLabel={$t('home.clearFavorites')}
      removeLabel={$t('home.removeShortcut')}
      showOpenIndicator={false}
      unavailableLabel={$t('home.unavailable')}
      {openingId}
      meta={(item) => item.type === 'directory' ? $t('files.directory') : $t('files.document')}
      isUnavailable={isShortcutUnavailable}
      onOpen={openRecord}
      onRemove={removeFavorite}
      onClear={clearFavorites}
    />
  </div>

  {#if checkHistory.length > 0}
    <section class="check-history-section">
      <div class="check-history-header">
        <Icon name="history" size="18px" />
        <h2 class="text-sm font-medium text-md3-on-surface">文件更新检查记录</h2>
        {#if pollCountdown}
          <span class="check-countdown">下次: {pollCountdown}</span>
        {/if}
        {#if lastCheckResult}
          <span class="check-history-badge" class:has-changes={lastCheckResult.changed > 0}>
            {lastCheckResult.changed > 0 ? `🔔 ${lastCheckResult.changed} 处变化` : '✅ 无变化'}
          </span>
        {/if}
      </div>
      <div class="check-history-list">
        {#each checkHistory.slice(0, 20) as entry (entry.time)}
          <div class="check-history-row">
            <span class="check-history-icon">{entry.changed > 0 ? '🔔' : '✅'}</span>
            <span class="check-history-time">{formatCheckTime(entry.time)}</span>
            <span class="check-history-summary">{entry.summary}</span>
            <span class="check-history-meta">{entry.dirs} 子目录, {entry.docs} 文档</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .blueprint-home {
    isolation: isolate;
    position: relative;
  }

  .blueprint-home h1 {
    font-size: clamp(1.45rem, 4vw, 2.2rem);
    letter-spacing: -0.025em;
  }

  .blueprint-hero-copy {
    font-family: var(--font-md3-sans);
  }

  .blueprint-hero {
    position: relative;
  }

  .blueprint-status-chip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.2rem;
    padding: 0.42rem 0.75rem;
    color: var(--color-md3-on-surface);
  }

  .blueprint-status-chip-muted {
    color: var(--color-md3-on-surface-variant);
  }

  .blueprint-check-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.35rem;
    padding: 0.45rem 0.85rem;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-small);
    background: var(--explorer-surface);
    color: var(--explorer-accent);
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 120ms ease, box-shadow 120ms ease;
  }

  .blueprint-check-btn:hover {
    background: var(--explorer-surface-hover);
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  .blueprint-check-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .check-btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--explorer-border);
    border-top-color: var(--explorer-accent);
    border-radius: 50%;
    animation: check-spin 0.6s linear infinite;
  }

  @keyframes check-spin {
    to { transform: rotate(360deg); }
  }

  .check-history-section {
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-small);
    padding: 1rem;
    background: var(--explorer-surface);
  }

  .check-history-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--explorer-border);
  }

  .check-history-badge {
    margin-left: auto;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: var(--explorer-surface-hover);
    color: var(--explorer-text-muted);
  }

  .check-history-badge.has-changes {
    background: color-mix(in srgb, var(--color-md3-warning, #f09d00) 18%, transparent);
    color: var(--color-md3-warning, #f09d00);
  }

  .check-countdown {
    margin-left: auto;
    margin-right: 0.5rem;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    color: var(--explorer-accent);
    font-weight: 500;
  }

  .check-history-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 320px;
    overflow-y: auto;
  }

  .check-history-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.4rem;
    border-radius: 4px;
    font-size: 0.78rem;
    color: var(--explorer-text-muted);
  }

  .check-history-row:hover {
    background: var(--explorer-surface-hover);
  }

  .check-history-icon {
    flex: none;
    width: 1.2rem;
    text-align: center;
  }

  .check-history-time {
    flex: none;
    min-width: 8rem;
    color: var(--explorer-text);
  }

  .check-history-summary {
    flex: 1;
  }

  .check-history-meta {
    flex: none;
    font-size: 0.7rem;
    opacity: 0.7;
  }
</style>
