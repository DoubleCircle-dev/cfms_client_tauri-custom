<script lang="ts">
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import Icon from '$lib/components/Icon.svelte';
  import { menuScale } from '$lib/motion/transitions';
  import type {
    ContextMenuActionItem,
    ContextMenuItem,
  } from '$lib/components/context-menu';
  import {
    filterContextMenuItems,
    isContextMenuDivider,
  } from '$lib/components/context-menu';
  import { focusRovingItem } from '$lib/keyboard';
  import { portal } from '$lib/actions/portal';

  interface Props {
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
    userPermissions?: readonly string[];
    sourceElement?: HTMLElement | null;
  }

  let { open, x, y, items, onClose, userPermissions = [], sourceElement = null }: Props = $props();

  let menuEl = $state<HTMLDivElement | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);
  let originX = $state<'left' | 'right'>('left');
  let originY = $state<'top' | 'bottom'>('top');
  let focusReturnTarget: HTMLElement | null = null;

  const visibleItems = $derived(filterContextMenuItems(items, userPermissions));

  $effect(() => {
    if (!open) return;

    focusReturnTarget = sourceElement
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const nextX = x;
    const nextY = y;
    visibleItems.length;
    menuX = nextX;
    menuY = nextY;

    void tick().then(() => {
      if (!menuEl || !open) return;

      const width = menuEl.offsetWidth;
      const height = menuEl.offsetHeight;
      const padding = 8;
      const adjustedX = Math.max(padding, Math.min(nextX, window.innerWidth - width - padding));
      const adjustedY = Math.max(padding, Math.min(nextY, window.innerHeight - height - padding));

      menuX = adjustedX;
      menuY = adjustedY;
      originX = nextX > adjustedX + width / 2 ? 'right' : 'left';
      originY = nextY > adjustedY + height / 2 ? 'bottom' : 'top';
      const firstItem = menuEl.querySelector<HTMLElement>('[data-menu-item]:not(:disabled)');
      if (firstItem) {
        firstItem.tabIndex = 0;
        firstItem.focus({ preventScroll: true });
      } else {
        menuEl.focus({ preventScroll: true });
      }
    });

    return () => {
      if (focusReturnTarget?.isConnected) focusReturnTarget.focus({ preventScroll: true });
      focusReturnTarget = null;
    };
  });

  async function handleItemSelect(item: ContextMenuActionItem) {
    if (item.disabled) return;
    onClose();
    await item.onSelect();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      onClose();
      return;
    }
    if (menuEl && focusRovingItem(event, menuEl, {
      selector: '[data-menu-item]',
      orientation: 'vertical',
    })) return;

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && menuEl) {
      const query = event.key.toLocaleLowerCase();
      const items = Array.from(menuEl.querySelectorAll<HTMLButtonElement>('[data-menu-item]:not(:disabled)'));
      const current = document.activeElement instanceof HTMLButtonElement ? items.indexOf(document.activeElement) : -1;
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(query));
      if (match) {
        event.preventDefault();
        for (const item of items) item.tabIndex = item === match ? 0 : -1;
        match.focus({ preventScroll: true });
      }
    }
  }
</script>

{#if open && visibleItems.length > 0}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    use:portal
    class="fixed inset-0 z-40"
    role="presentation"
    transition:fade={{ duration: 90 }}
    onclick={onClose}
    oncontextmenu={(event) => {
      event.preventDefault();
      onClose();
    }}
  ></div>
  <div
    bind:this={menuEl}
    use:portal
    class="context-menu-surface cfms-acrylic-surface cfms-menu-surface fixed z-50"
    style="left: {menuX}px; top: {menuY}px; transform-origin: {originX} {originY};"
    transition:menuScale={{ duration: 140 }}
    role="menu"
    tabindex="-1"
    onkeydown={handleKeydown}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#each visibleItems as item, index (`${isContextMenuDivider(item) ? 'divider' : item.id}:${index}`)}
      {#if isContextMenuDivider(item)}
        <div class="context-menu-separator" role="separator"></div>
      {:else}
        <button
          data-menu-item
          class="context-menu-item"
          class:danger={item.danger}
          role="menuitem"
          tabindex="-1"
          onclick={() => handleItemSelect(item)}
          disabled={item.disabled}
        >
          <Icon name={item.icon} size="20px" filled={item.iconFilled} duotone={!item.iconFilled && !item.danger && !item.disabled} />
          <span class="context-menu-label">{item.label}</span>
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .context-menu-surface {
    width: max-content;
    min-width: min(190px, calc(100vw - 16px));
    max-width: min(320px, calc(100vw - 16px));
    padding: 4px;
    max-height: calc(100dvh - 16px);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    font: 400 14px/20px var(--fontFamilyBase);
  }
  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-block-size: 32px;
    padding: 6px 8px;
    border-radius: var(--borderRadiusMedium);
    color: var(--colorNeutralForeground1);
    text-align: start;
    cursor: default;
    transition: background-color var(--durationFaster) var(--curveEasyEase);
  }
  .context-menu-item:hover:not(:disabled), .context-menu-item:focus-visible { background: var(--colorSubtleBackgroundHover); }
  .context-menu-item:active:not(:disabled) { background: var(--colorSubtleBackgroundPressed); }
  .context-menu-item.danger { color: var(--colorStatusDangerForeground1); }
  .context-menu-item:disabled { color: var(--colorNeutralForegroundDisabled); cursor: not-allowed; }
  .context-menu-label { min-width: 0; overflow-wrap: anywhere; }
  .context-menu-separator { margin-block: 4px; border-top: 1px solid var(--colorNeutralStroke2); }
  @media (pointer: coarse) { .context-menu-item { min-block-size: 44px; } }
  @media (forced-colors: active) {
    .context-menu-item.danger { color: CanvasText; }
    .context-menu-item:disabled { color: GrayText; }
    .context-menu-item:is(:hover, :focus-visible, :active):not(:disabled) { color: HighlightText; background: Highlight; }
    .context-menu-separator { border-color: CanvasText; }
  }
</style>
