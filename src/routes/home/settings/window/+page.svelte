<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    DEFAULT_CLOSE_BUTTON_BEHAVIOR,
    getCloseButtonBehavior,
    setCloseButtonBehavior,
    type CloseButtonBehavior,
  } from '$lib/api';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';
  import { focusRovingItem } from '$lib/keyboard';

  const behaviorOptions: Array<{
    value: CloseButtonBehavior;
    labelKey: string;
    descriptionKey: string;
  }> = [
    {
      value: 'ask',
      labelKey: 'settings.window.closeAsk',
      descriptionKey: 'settings.window.closeAskHint',
    },
    {
      value: 'minimize_to_tray',
      labelKey: 'settings.window.closeMinimize',
      descriptionKey: 'settings.window.closeMinimizeHint',
    },
    {
      value: 'quit',
      labelKey: 'settings.window.closeQuit',
      descriptionKey: 'settings.window.closeQuitHint',
    },
  ];

  let behavior = $state<CloseButtonBehavior>(DEFAULT_CLOSE_BUTTON_BEHAVIOR);
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
    try {
      behavior = await getCloseButtonBehavior();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function applyBehavior(nextBehavior: CloseButtonBehavior) {
    if (loading || nextBehavior === behavior) return;

    behavior = nextBehavior;
    error = null;
    void autoSave.run(async () => {
      await setCloseButtonBehavior(nextBehavior);
    });
  }

  function resetBehavior() {
    applyBehavior(DEFAULT_CLOSE_BUTTON_BEHAVIOR);
  }

  function handleOptionKeydown(event: KeyboardEvent, nextBehavior: CloseButtonBehavior) {
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
</script>

<div class="workspace-page settings-page-shell">
  <SettingsPageHeader
    title={$t('settings.window.title')}
    description={$t('settings.window.description')}
    icon="window"
    resetDisabled={loading}
    onReset={resetBehavior}
  />

  <div class="settings-section-list">
    <section class="settings-section space-y-4">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.window.closeTitle')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.window.closeHint')}
        </p>
      </div>

      <div
        class="space-y-2"
        role="radiogroup"
        tabindex="-1"
        aria-label={$t('settings.window.closeTitle')}
        onkeydown={handleBehaviorGroupKeydown}
      >
        {#each behaviorOptions as option}
          <div
            data-radio-item
            class="flex w-full items-start gap-3 px-3 py-2.5 rounded-lg text-left
                   text-sm text-md3-on-surface border transition-all outline-none
                   hover:bg-md3-primary-container/15
                   {behavior === option.value
                     ? 'border-md3-primary bg-md3-primary-container/15'
                     : 'border-md3-outline/50 bg-md3-surface-container-high/40'}
                   {loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}"
            style="font-family: var(--font-md3-sans);"
            role="radio"
            aria-checked={behavior === option.value}
            aria-disabled={loading}
            tabindex={loading ? -1 : behavior === option.value ? 0 : -1}
            onclick={() => applyBehavior(option.value)}
            onkeydown={(event) => handleOptionKeydown(event, option.value)}
          >
            <span
              class="mt-0.5 shrink-0 {behavior === option.value ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
              aria-hidden="true"
            >
              <Icon
                name={behavior === option.value ? 'radioChecked' : 'radioUnchecked'}
                filled={behavior === option.value}
                size="22px"
              />
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

    <section class="settings-section space-y-3">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.window.trayTitle')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.window.trayHint')}
        </p>
      </div>

      <div
        class="flex items-start gap-3 rounded-lg border border-md3-outline/70
               bg-md3-surface-container-high/40 px-3 py-3 text-sm text-md3-on-surface"
      >
        <span class="mt-0.5 shrink-0 text-md3-on-surface-variant">
          <Icon name="info" size="20px" />
        </span>
        <span class="min-w-0 flex-1 text-xs text-md3-on-surface-variant">
          {$t('settings.window.trayKeepAlive')}
        </span>
      </div>
    </section>
  </div>
</div>
