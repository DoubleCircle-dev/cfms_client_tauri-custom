<script lang="ts">
  // Directory hierarchy, independent of the file manager's visit timeline.

  import Icon from './Icon.svelte';
  import { _ as t } from 'svelte-i18n';
  import { ROOT_DIRECTORY_ID } from '$lib/file-browser';
  import { focusRovingItem } from '$lib/keyboard';

  interface Props {
    segments: Array<{ label: string; path: string }>;
    onNavigate: (path: string) => void;
  }

  let { segments, onNavigate }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
  aria-label={$t('common.breadcrumb')}
  class="cfms-breadcrumb flex flex-nowrap items-center gap-1 whitespace-nowrap text-sm no-select"
  tabindex="-1"
  onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, {
    selector: '[data-breadcrumb-item]',
    orientation: 'horizontal',
  })}
>
  <!-- Root -->
  <button
    data-breadcrumb-item
    tabindex="0"
    class="inline-flex h-5 shrink-0 items-center justify-center leading-none transition-colors"
    title={$t('files.goToRoot')}
    aria-label={$t('files.goToRoot')}
    onclick={() => onNavigate(ROOT_DIRECTORY_ID)}
  >
    <Icon name="home" size="16px" class="shrink-0" />
  </button>

  {#each segments as seg, i}
    <span
      class="flex h-5 shrink-0 items-center justify-center leading-none text-md3-on-surface-variant select-none"
    >
      <Icon name="breadcrumbSep" size="14px" class="shrink-0" />
    </span>
    {#if i === segments.length - 1}
      <span
        class="inline-flex h-5 shrink-0 items-center whitespace-nowrap leading-5 text-md3-on-surface"
        aria-current="page"
      >
        {seg.label}
      </span>
    {:else}
      <button
        data-breadcrumb-item
        tabindex="-1"
        class="inline-flex h-5 shrink-0 items-center whitespace-nowrap leading-5 transition-colors"
        onclick={() => onNavigate(seg.path)}
      >
        {seg.label}
      </button>
    {/if}
  {/each}
</nav>

<style>
  .cfms-breadcrumb { color: var(--colorNeutralForeground1); font-weight: 400; }
  .cfms-breadcrumb [data-breadcrumb-item] { min-block-size: var(--breadcrumb-target-height, 32px); border-radius: var(--borderRadiusMedium); padding-inline: 4px; }
  .cfms-breadcrumb [data-breadcrumb-item]:hover { background: color-mix(in srgb, var(--colorNeutralForeground1) 8%, transparent); }
  @media (pointer: coarse) {
    .cfms-breadcrumb [data-breadcrumb-item] { min-inline-size: 44px; min-block-size: var(--breadcrumb-target-height, 44px); }
  }
</style>
