<script lang="ts">
  import FluentButton from '$lib/components/FluentButton.svelte';
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import { navigateUp } from '$lib/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  interface Props {
    title: string;
    description?: string;
    icon?: IconName;
    resetDisabled?: boolean;
    resetLabel?: string;
    onReset?: () => void | Promise<void>;
  }

  let {
    title,
    description,
    icon,
    resetDisabled = false,
    resetLabel,
    onReset,
  }: Props = $props();
</script>

<div class="settings-page-header">
  <FluentButton data-fluent-owner="lib-components-settings-page-header"
    type="button"
    onclick={() => navigateUp(page.url.pathname)}
    appearance="subtle"
    class="settings-back-button"
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </FluentButton>

  <div class="settings-heading-row">
    <div class="settings-heading">
      {#if icon}
        <span class="settings-heading-icon" aria-hidden="true">
          <Icon name={icon} size="28px" />
        </span>
      {/if}
      <div class="settings-heading-copy">
        <h1>{title}</h1>
        {#if description}
          <p>{description}</p>
        {/if}
      </div>
    </div>

    {#if onReset}
      <FluentButton data-fluent-owner="lib-components-settings-page-header"
        type="button"
        onclick={onReset}
        disabled={resetDisabled}
        title={resetLabel ?? $t('common.reset')}
        aria-label={resetLabel ?? $t('common.reset')}
        appearance="subtle"
        class="settings-reset-button"
        iconOnly
      >
        <Icon name="resetSettings" size="20px" />
      </FluentButton>
    {/if}
  </div>
</div>

<style>
  .settings-page-header {
    display: grid;
    gap: 12px;
  }

  :global(.settings-back-button[data-fluent-owner="lib-components-settings-page-header"]) {
    display: inline-flex;
    min-height: 34px;
    width: fit-content;
    align-items: center;
    gap: 8px;
    border: 1px solid transparent;
    border-radius: var(--borderRadiusMedium);
    padding: 0.35rem 0.55rem 0.35rem 0.45rem;
    color: var(--color-md3-on-surface-variant);
    background: transparent;
    font: 600 12px/16px var(--font-md3-sans);
    transition:
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      color var(--motion-duration-short3) var(--motion-easing-standard),
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  :global(.settings-back-button[data-fluent-owner="lib-components-settings-page-header"]:hover) {
    color: var(--color-md3-on-surface);
    background: color-mix(in srgb, var(--color-md3-on-surface) 7%, transparent);
  }

  :global(.settings-back-button[data-fluent-owner="lib-components-settings-page-header"]:active) {
    transform: none;
  }

  .settings-heading-row,
  .settings-heading {
    display: flex;
    min-width: 0;
    align-items: flex-start;
  }

  .settings-heading-row {
    justify-content: space-between;
    gap: 16px;
  }

  .settings-heading {
    align-items: center;
    gap: 12px;
  }

  .settings-heading-icon {
    display: grid;
    width: 30px;
    height: 30px;
    flex: none;
    place-items: center;
    color: var(--color-md3-primary-emphasis);
  }

  .settings-heading-copy {
    min-width: 0;
  }

  .settings-heading-copy h1 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font: 700 28px/36px var(--font-md3-sans);
    letter-spacing: -0.018em;
    text-wrap: balance;
  }

  .settings-heading-copy p {
    max-width: 68ch;
    margin: 0.28rem 0 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    line-height: 1.5;
  }

  :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]) {
    display: inline-flex;
    inline-size: 40px;
    block-size: 40px;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--borderRadiusMedium);
    background: transparent;
    color: var(--color-md3-on-surface-variant);
    padding: 0;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]:hover:not(:is(:disabled, [disabled]))) {
    background: color-mix(in srgb, var(--color-md3-on-surface) 7%, transparent);
    color: var(--color-md3-on-surface);
    transform: translateY(-1px);
  }

  :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]:is(:disabled, [disabled])) {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @media (pointer: coarse) {
    :global(.settings-back-button[data-fluent-owner="lib-components-settings-page-header"]),
    :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]) {
      min-height: 44px;
    }

    :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]) {
      width: 44px;
      height: 44px;
    }
  }
</style>
