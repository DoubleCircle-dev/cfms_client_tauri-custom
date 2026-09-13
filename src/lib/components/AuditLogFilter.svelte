<script lang="ts">
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import { menuScale } from '$lib/motion/transitions';

  interface Props {
    availableActions: readonly string[];
    selectedActions: readonly string[];
    disabled?: boolean;
    onApply: (filters: string[]) => void | Promise<void>;
  }

  let {
    availableActions,
    selectedActions,
    disabled = false,
    onApply,
  }: Props = $props();

  let rootElement = $state<HTMLDivElement | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let queryInput = $state<HTMLInputElement | null>(null);
  let open = $state(false);
  let query = $state('');
  let draftActions = $state<string[]>([]);
  let panelPlacement = $state<'above' | 'below'>('below');
  let panelOffsetX = $state(-272);
  let panelWidth = $state(352);
  let panelMaxHeight = $state(544);

  const PANEL_GAP = 8;
  const VIEWPORT_PADDING = 16;
  const PANEL_MAX_WIDTH = 352;
  const PANEL_MAX_HEIGHT = 544;
  const PANEL_PREFERRED_MIN_HEIGHT = 360;

  const normalizedAvailableActions = $derived.by(() => normalizeActions([
    ...availableActions,
    ...selectedActions,
    ...draftActions,
  ]));
  const normalizedSelectedActions = $derived(normalizeActions(selectedActions));
  const trimmedQuery = $derived(query.trim());
  const filteredActions = $derived.by(() => {
    const normalizedQuery = trimmedQuery.toLocaleLowerCase();
    if (!normalizedQuery) return normalizedAvailableActions;
    return normalizedAvailableActions.filter((action) =>
      action.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
  const customActionAvailable = $derived(
    Boolean(trimmedQuery)
      && !normalizedAvailableActions.includes(trimmedQuery),
  );
  const draftChanged = $derived(
    JSON.stringify(normalizeActions(draftActions)) !== JSON.stringify(normalizedSelectedActions),
  );

  $effect(() => {
    if (!open || typeof window === 'undefined') return;

    const reposition = () => positionPanel();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && rootElement?.contains(event.target)) return;
      void closePanel();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    };
  });

  function normalizeActions(actions: readonly string[]): string[] {
    return [...new Set(actions.map((action) => action.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  }

  async function openPanel() {
    if (disabled) return;
    draftActions = [...normalizedSelectedActions];
    query = '';
    positionPanel();
    open = true;
    await tick();
    positionPanel();
    queryInput?.focus({ preventScroll: true });
  }

  async function closePanel(returnFocus = true) {
    if (!open) return;
    open = false;
    query = '';
    draftActions = [];
    if (!returnFocus) return;
    await tick();
    triggerElement?.focus({ preventScroll: true });
  }

  function toggleAction(action: string) {
    if (disabled) return;
    if (draftActions.includes(action)) {
      draftActions = draftActions.filter((candidate) => candidate !== action);
    } else {
      draftActions = normalizeActions([...draftActions, action]);
    }
  }

  function addQueryAction() {
    const action = trimmedQuery;
    if (!action || disabled) return;
    if (!draftActions.includes(action)) {
      draftActions = normalizeActions([...draftActions, action]);
    }
    query = '';
    void tick().then(() => queryInput?.focus({ preventScroll: true }));
  }

  async function applyFilters() {
    if (disabled) return;
    const filters = normalizeActions(draftActions);
    await closePanel();
    await onApply(filters);
  }

  function handlePanelKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void closePanel();
    }
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !trimmedQuery) return;
    event.preventDefault();
    addQueryAction();
  }

  function positionPanel() {
    if (typeof window === 'undefined' || !triggerElement) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const triggerRect = triggerElement.getBoundingClientRect();
    const availableWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING * 2);
    panelWidth = Math.min(PANEL_MAX_WIDTH, availableWidth);
    const naturalLeft = triggerRect.right - panelWidth;
    const clampedLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(naturalLeft, viewportWidth - panelWidth - VIEWPORT_PADDING),
    );
    panelOffsetX = clampedLeft - triggerRect.left;

    const spaceBelow = Math.max(
      0,
      viewportHeight - triggerRect.bottom - PANEL_GAP - VIEWPORT_PADDING,
    );
    const spaceAbove = Math.max(0, triggerRect.top - PANEL_GAP - VIEWPORT_PADDING);

    const openBelow = spaceBelow >= PANEL_PREFERRED_MIN_HEIGHT || spaceBelow >= spaceAbove;
    panelPlacement = openBelow ? 'below' : 'above';
    panelMaxHeight = Math.min(PANEL_MAX_HEIGHT, openBelow ? spaceBelow : spaceAbove);
  }
</script>

<div class="audit-filter" bind:this={rootElement}>
  <button
    bind:this={triggerElement}
    type="button"
    class="filter-trigger"
    class:filter-trigger--active={selectedActions.length > 0}
    aria-label={$t('manage.auditFilterButton', { values: { count: selectedActions.length } })}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls="audit-action-filter-panel"
    {disabled}
    onclick={() => open ? closePanel() : openPanel()}
  >
    <Icon name="filterList" size="18px" />
    <span>{$t('manage.auditFilter')}</span>
    {#if selectedActions.length > 0}
      <span class="filter-count" aria-hidden="true">{selectedActions.length}</span>
    {/if}
  </button>

  {#if open}
    <div
      id="audit-action-filter-panel"
      class="filter-panel"
      class:filter-panel--above={panelPlacement === 'above'}
      role="dialog"
      aria-modal="false"
      aria-labelledby="audit-action-filter-title"
      tabindex="-1"
      style={`left: ${panelOffsetX}px; width: ${panelWidth}px; max-height: ${panelMaxHeight}px;`}
      transition:menuScale={{ duration: 150, y: -4 }}
      onkeydown={handlePanelKeydown}
    >
      <header class="filter-panel__header">
        <div>
          <h3 id="audit-action-filter-title">{$t('manage.auditFilterTitle')}</h3>
          <p>{$t('manage.auditFilterHelp')}</p>
        </div>
        <button
          type="button"
          class="filter-close"
          aria-label={$t('common.close')}
          onclick={() => closePanel()}
        >
          <Icon name="close" size="17px" />
        </button>
      </header>

      <div class="filter-search">
        <Icon name="search" size="18px" />
        <input
          bind:this={queryInput}
          bind:value={query}
          type="text"
          data-focus-ring="delegated"
          autocomplete="off"
          aria-label={$t('manage.auditFilterSearch')}
          placeholder={$t('manage.auditFilterSearchPlaceholder')}
          onkeydown={handleInputKeydown}
        />
        {#if query}
          <button
            type="button"
            aria-label={$t('manage.auditFilterClearSearch')}
            onclick={() => {
              query = '';
              queryInput?.focus({ preventScroll: true });
            }}
          >
            <Icon name="close" size="15px" />
          </button>
        {/if}
      </div>

      <div class="filter-options" role="listbox" aria-multiselectable="true" aria-label={$t('manage.auditFilterOptions')}>
        {#if customActionAvailable}
          <button
            type="button"
            class="filter-option filter-option--custom"
            role="option"
            aria-selected="false"
            onclick={addQueryAction}
          >
            <span class="filter-option__icon"><Icon name="add" size="17px" /></span>
            <span class="filter-option__content">
              <span>{$t('manage.auditFilterAddCustom')}</span>
              <code>{trimmedQuery}</code>
            </span>
          </button>
        {/if}

        {#each filteredActions as action (action)}
          <button
            type="button"
            class="filter-option"
            class:filter-option--selected={draftActions.includes(action)}
            role="option"
            aria-selected={draftActions.includes(action)}
            onclick={() => toggleAction(action)}
          >
            <span class="filter-option__icon">
              <Icon name={draftActions.includes(action) ? 'checkBox' : 'checkBoxBlank'} size="18px" />
            </span>
            <code>{action}</code>
          </button>
        {:else}
          {#if !customActionAvailable}
            <div class="filter-empty">
              <Icon name={trimmedQuery ? 'search' : 'filterList'} size="22px" />
              <p>{trimmedQuery ? $t('manage.auditFilterNoMatches') : $t('manage.auditFilterNoSuggestions')}</p>
            </div>
          {/if}
        {/each}
      </div>

      <footer class="filter-panel__footer">
        <button
          type="button"
          class="filter-reset"
          disabled={draftActions.length === 0}
          onclick={() => {
            draftActions = [];
            query = '';
          }}
        >
          {$t('common.reset')}
        </button>
        <div class="filter-panel__actions">
          <span class="filter-selection-summary">
            {$t('manage.auditFilterSelected', { values: { count: draftActions.length } })}
          </span>
          <button type="button" class="filter-cancel" onclick={() => closePanel()}>
            {$t('common.cancel')}
          </button>
          <button type="button" class="filter-apply" disabled={!draftChanged} onclick={applyFilters}>
            {$t('manage.auditFilterApply')}
          </button>
        </div>
      </footer>
    </div>
  {/if}
</div>

<style>
  .audit-filter {
    position: relative;
    flex: none;
    font-family: var(--font-md3-sans);
  }

  .filter-trigger {
    display: inline-flex;
    min-height: 2rem;
    align-items: center;
    gap: 0.4rem;
    border-radius: 5px;
    padding: 0.3rem 0.55rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    font-weight: 600;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
  }

  .filter-trigger:hover:not(:disabled),
  .filter-trigger--active {
    color: var(--color-md3-primary-emphasis);
    background: color-mix(in srgb, var(--color-md3-primary-container) 48%, transparent);
  }

  .filter-trigger:active:not(:disabled) {
    transform: scale(0.97);
  }

  .filter-trigger:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .filter-count {
    display: inline-grid;
    min-width: 1.15rem;
    height: 1.15rem;
    place-items: center;
    border-radius: 9999px;
    padding: 0 0.28rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
    font-size: 0.65rem;
    line-height: 1;
  }

  .filter-panel {
    position: absolute;
    z-index: 50;
    top: calc(100% + 0.5rem);
    right: auto;
    bottom: auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: 12px;
    color: var(--color-md3-on-surface);
    background: color-mix(in srgb, var(--color-md3-surface-container) 94%, transparent);
    box-shadow: 0 18px 48px rgb(0 0 0 / 0.24);
    -webkit-backdrop-filter: blur(20px) saturate(0.95);
    backdrop-filter: blur(20px) saturate(0.95);
  }

  .filter-panel--above {
    top: auto;
    bottom: calc(100% + 0.5rem);
  }

  .filter-panel__header {
    display: flex;
    flex: none;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1rem 0.85rem;
  }

  .filter-panel__header h3 {
    font-size: 0.9rem;
    font-weight: 650;
    line-height: 1.25;
  }

  .filter-panel__header p {
    max-width: 32ch;
    margin-top: 0.25rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
    line-height: 1.45;
  }

  .filter-close {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    border-radius: 9999px;
    color: var(--color-md3-on-surface-variant);
    transition: background-color 120ms ease, color 120ms ease;
  }

  .filter-close:hover {
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
  }

  .filter-search {
    display: flex;
    flex: none;
    min-height: 2.625rem;
    align-items: center;
    gap: 0.5rem;
    margin: 0 1rem 0.75rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: 8px;
    padding: 0 0.7rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-field);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .filter-search:focus-within {
    border-color: var(--color-md3-primary);
    box-shadow: inset 0 0 0 1px var(--color-md3-primary);
  }

  .filter-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    color: var(--color-md3-on-surface);
    background: transparent;
    font-size: 0.8rem;
  }

  .filter-search input::placeholder {
    color: var(--color-md3-on-surface-variant);
  }

  .filter-search button {
    display: inline-grid;
    width: 1.75rem;
    height: 1.75rem;
    flex: none;
    place-items: center;
    border-radius: 9999px;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .filter-search button:hover {
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
  }

  .filter-options {
    min-height: 0;
    max-height: 20rem;
    flex: 1 1 auto;
    overflow-x: hidden;
    overflow-y: auto;
    border-block: 1px solid color-mix(in srgb, var(--color-md3-outline) 65%, transparent);
    overscroll-behavior: contain;
    padding: 0.35rem 0;
  }

  .filter-option {
    display: flex;
    width: 100%;
    min-height: 2.35rem;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 1rem;
    text-align: left;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .filter-option:hover,
  .filter-option--selected {
    background: color-mix(in srgb, var(--color-md3-primary-container) 32%, transparent);
  }

  .filter-option--selected {
    color: var(--color-md3-primary-emphasis);
  }

  .filter-option__icon {
    display: inline-grid;
    width: 1.2rem;
    flex: none;
    place-items: center;
    color: var(--color-md3-on-surface-variant);
  }

  .filter-option--selected .filter-option__icon,
  .filter-option--custom .filter-option__icon {
    color: var(--color-md3-primary-emphasis);
  }

  .filter-option code {
    min-width: 0;
    overflow-wrap: anywhere;
    color: inherit;
    font-family: var(--font-md3-mono);
    font-size: 0.76rem;
  }

  .filter-option__content {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.7rem;
  }

  .filter-option__content code {
    color: var(--color-md3-on-surface);
  }

  .filter-empty {
    display: grid;
    min-height: 7rem;
    place-items: center;
    align-content: center;
    gap: 0.5rem;
    padding: 1rem;
    color: var(--color-md3-on-surface-variant);
    text-align: center;
  }

  .filter-empty p {
    max-width: 30ch;
    font-size: 0.75rem;
    line-height: 1.45;
  }

  .filter-panel__footer {
    display: flex;
    flex: none;
    min-height: 3.4rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.65rem 0.8rem;
  }

  .filter-panel__actions {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .filter-selection-summary {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.68rem;
    white-space: nowrap;
  }

  .filter-reset,
  .filter-cancel,
  .filter-apply {
    min-height: 2rem;
    border-radius: 5px;
    padding: 0.35rem 0.65rem;
    font-size: 0.72rem;
    font-weight: 600;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
  }

  .filter-reset,
  .filter-cancel {
    color: var(--color-md3-on-surface-variant);
  }

  .filter-reset:hover:not(:disabled),
  .filter-cancel:hover {
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
  }

  .filter-apply {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .filter-apply:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .filter-reset:disabled,
  .filter-apply:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .filter-reset:active:not(:disabled),
  .filter-cancel:active,
  .filter-apply:active:not(:disabled) {
    transform: scale(0.97);
  }

  @media (max-width: 520px) {
    .filter-panel__footer,
    .filter-panel__actions {
      flex-wrap: wrap;
    }

    .filter-selection-summary {
      width: 100%;
      text-align: right;
    }
  }

  @media (pointer: coarse) {
    .filter-trigger,
    .filter-option,
    .filter-reset,
    .filter-cancel,
    .filter-apply {
      min-height: 2.75rem;
    }

    .filter-close,
    .filter-search button {
      width: 2.75rem;
      height: 2.75rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .filter-trigger,
    .filter-close,
    .filter-search,
    .filter-search button,
    .filter-option,
    .filter-reset,
    .filter-cancel,
    .filter-apply {
      transition: none;
    }

    .filter-trigger:active:not(:disabled),
    .filter-reset:active:not(:disabled),
    .filter-cancel:active,
    .filter-apply:active:not(:disabled) {
      transform: none;
    }
  }
</style>
