<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    DEFAULT_FILE_AUTO_UPDATE_AUTO_DOWNLOAD,
    DEFAULT_FILE_AUTO_UPDATE_ENABLED,
    DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES,
    DEFAULT_SYNC_GIT_TRACKING_ENABLED,
    getFileAutoUpdateSettings,
    getSyncGitTrackingEnabled,
    normalizeFileAutoUpdateIntervalMinutes,
    setFileAutoUpdateSettings,
    setSyncGitTrackingEnabled,
  } from '$lib/api';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  let autoFileUpdateEnabled = $state(DEFAULT_FILE_AUTO_UPDATE_ENABLED);
  let autoFileUpdateIntervalMinutes = $state(DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES);
  let autoFileUpdateAutoDownload = $state(DEFAULT_FILE_AUTO_UPDATE_AUTO_DOWNLOAD);
  let syncGitTrackingEnabled = $state(DEFAULT_SYNC_GIT_TRACKING_ENABLED);
  let loading = $state(true);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
  });

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
      const autoUpdateSettings = await getFileAutoUpdateSettings();
      autoFileUpdateEnabled = autoUpdateSettings.enabled;
      autoFileUpdateIntervalMinutes = autoUpdateSettings.intervalMinutes;
      autoFileUpdateAutoDownload = autoUpdateSettings.autoDownload;
      syncGitTrackingEnabled = await getSyncGitTrackingEnabled();
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

  function applySyncGitTrackingEnabled(enabled: boolean) {
    if (loading) return;
    syncGitTrackingEnabled = enabled;
    error = null;
    void autoSave.run(async () => {
      await setSyncGitTrackingEnabled(enabled);
    });
  }

  function resetAll() {
    applyAutoFileUpdateEnabled(DEFAULT_FILE_AUTO_UPDATE_ENABLED);
    applyAutoFileUpdateIntervalMinutes(DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES);
    applyAutoFileUpdateAutoDownload(DEFAULT_FILE_AUTO_UPDATE_AUTO_DOWNLOAD);
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
          disabled={loading}
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
