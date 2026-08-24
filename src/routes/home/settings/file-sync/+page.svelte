<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    DEFAULT_FILE_AUTO_DETECT_ON_STARTUP,
    DEFAULT_FILE_AUTO_UPDATE_AUTO_DOWNLOAD,
    DEFAULT_FILE_AUTO_UPDATE_ENABLED,
    DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES,
    DEFAULT_SYNC_GIT_TRACKING_ENABLED,
    DEFAULT_SYNC_OVERWRITE_STRATEGY,
    downloadGitInit,
    getFileAutoDetectOnStartup,
    getFileAutoUpdateSettings,
    getSyncGitTrackingEnabled,
    getSyncOverwriteStrategy,
    normalizeFileAutoUpdateIntervalMinutes,
    setFileAutoDetectOnStartup,
    setFileAutoUpdateSettings,
    setSyncGitTrackingEnabled,
    setSyncOverwriteStrategy,
    type SyncOverwriteStrategy,
  } from '$lib/api';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  let autoFileDetectOnStartup = $state(DEFAULT_FILE_AUTO_DETECT_ON_STARTUP);
  let autoFileUpdateEnabled = $state(DEFAULT_FILE_AUTO_UPDATE_ENABLED);
  let autoFileUpdateIntervalMinutes = $state(DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES);
  let autoFileUpdateAutoDownload = $state(DEFAULT_FILE_AUTO_UPDATE_AUTO_DOWNLOAD);
  let syncGitTrackingEnabled = $state(DEFAULT_SYNC_GIT_TRACKING_ENABLED);
  let syncOverwriteStrategy = $state<SyncOverwriteStrategy>(DEFAULT_SYNC_OVERWRITE_STRATEGY);
  let gitInitBusy = $state(false);
  let loading = $state(true);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
  });

  const overwriteStrategyOptions: Array<{ value: SyncOverwriteStrategy; labelKey: string; descriptionKey: string }> = [
    {
      value: 'force_overwrite',
      labelKey: 'settings.fileSync.overwriteForce',
      descriptionKey: 'settings.fileSync.overwriteForceHint',
    },
    {
      value: 'backup_rename',
      labelKey: 'settings.fileSync.overwriteBackup',
      descriptionKey: 'settings.fileSync.overwriteBackupHint',
    },
    {
      value: 'skip',
      labelKey: 'settings.fileSync.overwriteSkip',
      descriptionKey: 'settings.fileSync.overwriteSkipHint',
    },
  ];

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    if (!authStore.isLoggedIn) {
      await goto('/home/settings', { replaceState: true });
      return;
    }

    try {
      autoFileDetectOnStartup = await getFileAutoDetectOnStartup();
      const autoUpdateSettings = await getFileAutoUpdateSettings();
      autoFileUpdateEnabled = autoUpdateSettings.enabled;
      autoFileUpdateIntervalMinutes = autoUpdateSettings.intervalMinutes;
      autoFileUpdateAutoDownload = autoUpdateSettings.autoDownload;
      syncGitTrackingEnabled = await getSyncGitTrackingEnabled();
      syncOverwriteStrategy = await getSyncOverwriteStrategy();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function currentAutoFileUpdateSettings() {
    return {
      enabled: autoFileUpdateEnabled,
      intervalMinutes: normalizeFileAutoUpdateIntervalMinutes(autoFileUpdateIntervalMinutes),
      autoDownload: autoFileUpdateAutoDownload,
    };
  }

  function applyAutoFileDetectOnStartup(enabled: boolean) {
    if (loading) return;
    autoFileDetectOnStartup = enabled;
    error = null;
    void autoSave.run(async () => {
      await setFileAutoDetectOnStartup(enabled);
    });
  }

  function applyAutoFileUpdateEnabled(enabled: boolean) {
    if (loading) return;
    autoFileUpdateEnabled = enabled;
    error = null;
    const next = currentAutoFileUpdateSettings();
    void autoSave.run(async () => {
      await setFileAutoUpdateSettings(next);
    });
  }

  function applyAutoFileUpdateIntervalMinutes(rawValue: number) {
    if (loading) return;
    autoFileUpdateIntervalMinutes = normalizeFileAutoUpdateIntervalMinutes(rawValue);
    error = null;
    const next = currentAutoFileUpdateSettings();
    void autoSave.run(async () => {
      await setFileAutoUpdateSettings(next);
    });
  }

  function applyAutoFileUpdateAutoDownload(autoDownload: boolean) {
    if (loading) return;
    autoFileUpdateAutoDownload = autoDownload;
    error = null;
    const next = currentAutoFileUpdateSettings();
    void autoSave.run(async () => {
      await setFileAutoUpdateSettings(next);
    });
  }

  function applySyncOverwriteStrategy(strategy: SyncOverwriteStrategy) {
    if (loading || strategy === syncOverwriteStrategy) return;
    syncOverwriteStrategy = strategy;
    error = null;
    void autoSave.run(async () => {
      await setSyncOverwriteStrategy(strategy);
    });
  }

  /** Enable git tracking: initialize the repo if missing; revert with a warning on failure. */
  function applySyncGitTrackingEnabled(enabled: boolean) {
    if (loading || gitInitBusy) return;
    if (!enabled) {
      syncGitTrackingEnabled = false;
      error = null;
      void autoSave.run(async () => {
        await setSyncGitTrackingEnabled(false);
      });
      return;
    }
    gitInitBusy = true;
    error = null;
    void autoSave.run(async () => {
      try {
        await downloadGitInit();
        await setSyncGitTrackingEnabled(true);
        syncGitTrackingEnabled = true;
      } catch (err) {
        syncGitTrackingEnabled = false;
        notificationStore.warning(
          $t('settings.fileSync.gitInitFailed', { values: { error: String(err) } }),
          6000,
        );
      } finally {
        gitInitBusy = false;
      }
    });
  }

  function resetAll() {
    applyAutoFileDetectOnStartup(DEFAULT_FILE_AUTO_DETECT_ON_STARTUP);
    applyAutoFileUpdateEnabled(DEFAULT_FILE_AUTO_UPDATE_ENABLED);
    applyAutoFileUpdateIntervalMinutes(DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES);
    applyAutoFileUpdateAutoDownload(DEFAULT_FILE_AUTO_UPDATE_AUTO_DOWNLOAD);
    applySyncOverwriteStrategy(DEFAULT_SYNC_OVERWRITE_STRATEGY);
    applySyncGitTrackingEnabled(DEFAULT_SYNC_GIT_TRACKING_ENABLED);
  }
</script>

{#if authStore.isLoggedIn}
<div class="workspace-page settings-page-shell">
  <SettingsPageHeader
    title={$t('settings.fileSync.title')}
    description={$t('settings.fileSync.description')}
    icon="update"
    resetDisabled={loading}
    onReset={resetAll}
  />

  <div class="settings-section-list">
    <section class="settings-section space-y-4">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.behavior.fileAutoUpdateTitle')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.behavior.fileAutoUpdateHint')}
        </p>
      </div>

      <div class="settings-row text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.behavior.fileAutoUpdateEnabled')}
        <MdSwitch
          checked={autoFileUpdateEnabled}
          disabled={loading}
          ariaLabel={$t('settings.behavior.fileAutoUpdateEnabled')}
          onChange={applyAutoFileUpdateEnabled}
        />
      </div>

      <div class="ml-4 space-y-4 border-l-2 border-md3-outline/40 pl-4">
        <div class="settings-row text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.behavior.fileAutoDetectOnStartup')}
          <MdSwitch
            checked={autoFileDetectOnStartup}
            disabled={loading || !autoFileUpdateEnabled}
            ariaLabel={$t('settings.behavior.fileAutoDetectOnStartup')}
            onChange={applyAutoFileDetectOnStartup}
          />
        </div>
        <p class="-mt-2 text-xs text-md3-on-surface-variant">
          {$t('settings.behavior.fileAutoDetectOnStartupHint')}
        </p>

        <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.behavior.fileAutoUpdateInterval')}
          <input
            class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high px-3 py-2 text-md3-on-surface disabled:opacity-60"
            type="number"
            min="5"
            max="1440"
            step="1"
            value={autoFileUpdateIntervalMinutes}
            oninput={(event) => applyAutoFileUpdateIntervalMinutes(Number(event.currentTarget.value))}
            disabled={loading || !autoFileUpdateEnabled}
          />
          <p class="text-xs text-md3-on-surface-variant">
            {$t('settings.behavior.fileAutoUpdateIntervalHint')}
          </p>
        </label>

        <div class="settings-row text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.behavior.fileAutoUpdateAutoDownload')}
          <MdSwitch
            checked={autoFileUpdateAutoDownload}
            disabled={loading || !autoFileUpdateEnabled}
            ariaLabel={$t('settings.behavior.fileAutoUpdateAutoDownload')}
            onChange={applyAutoFileUpdateAutoDownload}
          />
        </div>
        <p class="-mt-2 text-xs text-md3-on-surface-variant">
          {$t('settings.behavior.fileAutoUpdateAutoDownloadHint')}
        </p>

        {#if autoFileUpdateEnabled && autoFileUpdateAutoDownload}
          {@const strategyDisabled = loading || syncGitTrackingEnabled}
          <div
            class="ml-4 space-y-2 border-l-2 border-md3-outline/40 pl-4"
            role="radiogroup"
            aria-label={$t('settings.fileSync.overwriteStrategyTitle')}
          >
          <p class="text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('settings.fileSync.overwriteStrategyTitle')}
          </p>
          {#if syncGitTrackingEnabled}
            <p class="flex items-center gap-1.5 text-xs text-md3-on-surface-variant">
              <Icon name="info" size="14px" />
              {$t('settings.fileSync.overwriteStrategyGitDisabled')}
            </p>
          {/if}
          {#each overwriteStrategyOptions as option}
            <div
              class="flex w-full items-start gap-3 px-3 py-2.5 rounded-lg text-left
                     text-sm text-md3-on-surface border transition-all outline-none
                     hover:bg-md3-primary-container/15
                     {syncOverwriteStrategy === option.value
                       ? 'border-md3-primary bg-md3-primary-container/15'
                       : 'border-md3-outline/50 bg-md3-surface-container-high/40'}
                     {strategyDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}"
              style="font-family: var(--font-md3-sans);"
              role="radio"
              aria-checked={syncOverwriteStrategy === option.value}
              aria-disabled={strategyDisabled}
              tabindex={strategyDisabled ? -1 : syncOverwriteStrategy === option.value ? 0 : -1}
              onclick={() => {
                if (strategyDisabled) return;
                applySyncOverwriteStrategy(option.value);
              }}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (strategyDisabled) return;
                  applySyncOverwriteStrategy(option.value);
                }
              }}
            >
              <span class="mt-0.5 shrink-0 {syncOverwriteStrategy === option.value ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}" aria-hidden="true">
                <Icon name={syncOverwriteStrategy === option.value ? 'radioChecked' : 'radioUnchecked'} size="22px" />
              </span>
              <span class="min-w-0">
                <span class="block font-medium">{$t(option.labelKey)}</span>
                <span class="block text-xs text-md3-on-surface-variant mt-1">
                  {$t(option.descriptionKey)}
                </span>
              </span>
            </div>
          {/each}
        </div>
        {/if}
      </div>
    </section>

    <section class="settings-section space-y-4">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.fileSync.gitSectionTitle')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.fileSync.gitSectionHint')}
        </p>
      </div>

      <div class="settings-row text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.behavior.syncGitTracking')}
        <MdSwitch
          checked={syncGitTrackingEnabled}
          disabled={loading || gitInitBusy}
          ariaLabel={$t('settings.behavior.syncGitTracking')}
          onChange={applySyncGitTrackingEnabled}
        />
      </div>
      <p class="-mt-2 text-xs text-md3-on-surface-variant">
        {$t('settings.behavior.syncGitTrackingHint')}
      </p>
    </section>
  </div>
</div>
{/if}
