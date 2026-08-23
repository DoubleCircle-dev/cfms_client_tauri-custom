<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    DEFAULT_FILE_AUTO_UPDATE_ENABLED,
    DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES,
    DEFAULT_ROOT_BACK_BUTTON_BEHAVIOR,
    getFileAutoUpdateSettings,
    getRootBackButtonBehavior,
    normalizeFileAutoUpdateIntervalMinutes,
    setFileAutoUpdateSettings,
    setRootBackButtonBehavior,
    type RootBackButtonBehavior,
  } from '$lib/api';
  import { appLockStore } from '$lib/app-lock.svelte';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';
  import { focusRovingItem } from '$lib/keyboard';

  const behaviorOptions: Array<{ value: RootBackButtonBehavior; labelKey: string; descriptionKey: string }> = [
    {
      value: 'background',
      labelKey: 'settings.behavior.rootBackBackground',
      descriptionKey: 'settings.behavior.rootBackBackgroundHint',
    },
    {
      value: 'exit',
      labelKey: 'settings.behavior.rootBackExit',
      descriptionKey: 'settings.behavior.rootBackExitHint',
    },
  ];

  let behavior = $state<RootBackButtonBehavior>('exit');
  let autoFileUpdateEnabled = $state(DEFAULT_FILE_AUTO_UPDATE_ENABLED);
  let autoFileUpdateIntervalMinutes = $state(DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES);
  let loading = $state(true);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
  });

  const canUseBackgroundBehavior = $derived(appLockStore.canUseRootBackBackground);
  const backgroundBehaviorUnavailable = $derived(!canUseBackgroundBehavior);

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
      if (authStore.username) {
        await appLockStore.init(`${serverStateStore.remoteAddress ?? 'local'}:${authStore.username}`);
      }

      const savedBehavior = await getRootBackButtonBehavior();
      behavior = savedBehavior === 'background' && !appLockStore.canUseRootBackBackground
        ? 'exit'
        : savedBehavior;
      if (savedBehavior !== behavior) {
        await setRootBackButtonBehavior(behavior);
      }

      const autoUpdateSettings = await getFileAutoUpdateSettings();
      autoFileUpdateEnabled = autoUpdateSettings.enabled;
      autoFileUpdateIntervalMinutes = autoUpdateSettings.intervalMinutes;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  $effect(() => {
    if (behavior === 'background' && !canUseBackgroundBehavior) {
      applyBehavior('exit');
    }
  });

  function applyBehavior(nextBehavior: RootBackButtonBehavior) {
    if (loading || nextBehavior === behavior) return;
    if (nextBehavior === 'background' && !canUseBackgroundBehavior) {
      return;
    }

    behavior = nextBehavior;
    error = null;
    void autoSave.run(async () => {
      await setRootBackButtonBehavior(nextBehavior);
    });
  }

  function resetBehavior() {
    applyBehavior(DEFAULT_ROOT_BACK_BUTTON_BEHAVIOR);
    applyAutoFileUpdateEnabled(DEFAULT_FILE_AUTO_UPDATE_ENABLED);
    applyAutoFileUpdateIntervalMinutes(DEFAULT_FILE_AUTO_UPDATE_INTERVAL_MINUTES);
  }

  function applyAutoFileUpdateEnabled(enabled: boolean) {
    if (loading) return;
    autoFileUpdateEnabled = enabled;
    error = null;
    const interval = normalizeFileAutoUpdateIntervalMinutes(autoFileUpdateIntervalMinutes);
    void autoSave.run(async () => {
      await setFileAutoUpdateSettings({
        enabled,
        intervalMinutes: interval,
      });
    });
  }

  function applyAutoFileUpdateIntervalMinutes(rawValue: number) {
    if (loading) return;
    const interval = normalizeFileAutoUpdateIntervalMinutes(rawValue);
    autoFileUpdateIntervalMinutes = interval;
    error = null;
    void autoSave.run(async () => {
      await setFileAutoUpdateSettings({
        enabled: autoFileUpdateEnabled,
        intervalMinutes: interval,
      });
    });
  }

  function handleOptionKeydown(event: KeyboardEvent, nextBehavior: RootBackButtonBehavior) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    applyBehavior(nextBehavior);
  }

  function handleBehaviorGroupKeydown(event: KeyboardEvent) {
    const next = focusRovingItem(event, event.currentTarget as HTMLElement, {
      selector: '[data-radio-item]',
      orientation: 'both',
    });
    next?.click();
  }

  function isOptionUnavailable(value: RootBackButtonBehavior) {
    return value === 'background' && backgroundBehaviorUnavailable;
  }
</script>

{#if authStore.isLoggedIn}
<div class="workspace-page settings-page-shell">
  <SettingsPageHeader
    title={$t('settings.behavior.title')}
    description={$t('settings.behavior.description')}
    icon="touchApp"
    resetDisabled={loading}
    onReset={resetBehavior}
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
    </section>

    <section class="settings-section space-y-4">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.behavior.rootBackTitle')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.behavior.rootBackHint')}
        </p>
      </div>

      {#if backgroundBehaviorUnavailable}
        <div
          class="flex flex-wrap items-center gap-3 rounded-lg border border-md3-outline/70
                 bg-md3-surface-container-high/55 px-3 py-3 text-sm text-md3-on-surface"
        >
          <span class="shrink-0 text-md3-primary-emphasis">
            <Icon name="warningAmber" size="20px" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium">{$t('settings.behavior.rootBackRequirementTitle')}</span>
            <span class="block text-xs text-md3-on-surface-variant mt-0.5">
              {$t('settings.behavior.rootBackRequirementHint')}
            </span>
          </span>
          <a
            class="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold
                   text-md3-primary transition-colors hover:bg-md3-primary-container/30"
            href="/home/settings/app-lock"
          >
            <Icon name="lockPerson" size="16px" />
            {$t('settings.behavior.openAppLock')}
          </a>
        </div>
      {/if}

      <div class="space-y-2" role="radiogroup" tabindex="-1" aria-label={$t('settings.behavior.rootBackTitle')} onkeydown={handleBehaviorGroupKeydown}>
        {#each behaviorOptions as option}
          {@const optionUnavailable = isOptionUnavailable(option.value)}
          <div
            data-radio-item
            class="flex w-full items-start gap-3 px-3 py-2.5 rounded-lg text-left
                   text-sm text-md3-on-surface border transition-all outline-none
                   hover:bg-md3-primary-container/15
                   {behavior === option.value
                     ? 'border-md3-primary bg-md3-primary-container/15'
                     : 'border-md3-outline/50 bg-md3-surface-container-high/40'}
                   {loading || optionUnavailable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}"
            style="font-family: var(--font-md3-sans);"
            role="radio"
            aria-checked={behavior === option.value}
            aria-disabled={loading || optionUnavailable}
            tabindex={loading || optionUnavailable ? -1 : behavior === option.value ? 0 : -1}
            onclick={() => applyBehavior(option.value)}
            onkeydown={(event) => handleOptionKeydown(event, option.value)}
          >
            <span class="mt-0.5 shrink-0 {behavior === option.value ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}" aria-hidden="true">
              <Icon name={behavior === option.value ? 'radioChecked' : 'radioUnchecked'} size="22px" />
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
    </section>
  </div>
</div>
{/if}
