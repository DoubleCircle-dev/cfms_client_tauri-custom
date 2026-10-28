<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';

  import Icon from '$lib/components/Icon.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import TaskActionButton from '$lib/components/TaskActionButton.svelte';
  import { notificationStore, type NotificationType } from '$lib/stores.svelte';

  type HistoryFilter = 'all' | NotificationType;

  const FILTERS: HistoryFilter[] = ['all', 'info', 'success', 'warning', 'error'];

  let filter = $state<HistoryFilter>('all');
  let expandedIds = $state<Set<number>>(new Set());

  const visibleEntries = $derived(
    filter === 'all'
      ? notificationStore.history
      : notificationStore.history.filter((entry) => entry.type === filter),
  );

  function filterLabel(value: HistoryFilter): string {
    if (value === 'all') return $t('notifications.filterAll');
    if (value === 'success') return $t('notifications.filterSuccess');
    if (value === 'warning') return $t('notifications.filterWarning');
    if (value === 'error') return $t('notifications.filterError');
    return $t('notifications.filterInfo');
  }

  function countFor(value: HistoryFilter): number {
    if (value === 'all') return notificationStore.history.length;
    return notificationStore.history.filter((entry) => entry.type === value).length;
  }

  function iconFor(type: NotificationType): 'checkCircle' | 'errorFilled' | 'warningAmber' | 'info' {
    if (type === 'success') return 'checkCircle';
    if (type === 'error') return 'errorFilled';
    if (type === 'warning') return 'warningAmber';
    return 'info';
  }

  /** Same day → time only; older rows carry the date so the day stays readable. */
  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const time = date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    if (date.toDateString() === now.toDateString()) return time;
    const day = date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
    return `${day} ${time}`;
  }

  function toggleExpanded(id: number) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  function clearHistory() {
    notificationStore.clearHistory();
    expandedIds = new Set();
  }
</script>

<div class="workspace-page notifications-page">
  <header class="notifications-header">
    <PageHeading
      title={$t('notifications.title')}
      description={$t('notifications.description')}
    />
    <div class="notifications-header-actions">
      <TaskActionButton
        presentation="labelled"
        icon="arrowBack"
        label={$t('notifications.backToTasks')}
        onclick={() => goto('/home/tasks')}
      />
      <TaskActionButton
        presentation="labelled"
        icon="delete"
        label={$t('notifications.clear')}
        onclick={clearHistory}
        disabled={notificationStore.history.length === 0}
      />
    </div>
  </header>

  <div class="notifications-filters" role="group" aria-label={$t('notifications.title')}>
    {#each FILTERS as value (value)}
      <button
        type="button"
        class="notifications-filter"
        class:notifications-filter--active={filter === value}
        aria-pressed={filter === value}
        onclick={() => (filter = value)}
      >
        <span>{filterLabel(value)}</span>
        <span class="notifications-filter-count">{countFor(value)}</span>
      </button>
    {/each}
  </div>

  {#if visibleEntries.length === 0}
    <div class="notifications-empty">
      <Icon name="history" size="40px" />
      <p>
        {notificationStore.history.length === 0
          ? $t('notifications.empty')
          : $t('notifications.emptyFiltered')}
      </p>
    </div>
  {:else}
    <ul class="notifications-list">
      {#each visibleEntries as entry (entry.id)}
        <li class="notifications-item notifications-item--{entry.type}">
          <span class="notifications-item-icon" aria-hidden="true">
            <Icon name={iconFor(entry.type)} size="18px" />
          </span>
          <div class="notifications-item-body">
            <p class="notifications-item-text">{entry.text}</p>
            {#if entry.items.length > 1}
              <button
                type="button"
                class="notifications-item-toggle"
                aria-expanded={expandedIds.has(entry.id)}
                onclick={() => toggleExpanded(entry.id)}
              >
                {$t('notifications.groupedItems', { values: { count: entry.items.length } })}
              </button>
              {#if expandedIds.has(entry.id)}
                <ul class="notifications-item-details">
                  {#each entry.items as item, index (`${entry.id}:${index}`)}
                    <li>
                      <span class="notifications-item-detail-time">{formatTime(item.createdAt)}</span>
                      <span>{item.text}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          </div>
          <time class="notifications-item-time" datetime={new Date(entry.createdAt).toISOString()}>
            {formatTime(entry.createdAt)}
          </time>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .notifications-page {
    display: flex;
    height: 100%;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
    padding: 24px clamp(1rem, 2vw, 1.5rem);
  }

  .notifications-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .notifications-header-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }

  .notifications-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .notifications-filter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusCircular);
    padding: 4px 12px;
    color: var(--colorNeutralForeground2);
    background: var(--colorNeutralBackground1);
    font: 400 13px/18px var(--fontFamilyBase);
    cursor: pointer;
  }

  .notifications-filter:hover {
    border-color: var(--colorBrandStroke);
    color: var(--colorBrandForeground1);
  }

  .notifications-filter--active {
    border-color: var(--colorBrandStroke);
    color: var(--colorBrandForeground1);
    background: color-mix(in srgb, var(--colorBrandBackground2) 60%, transparent);
  }

  .notifications-filter-count {
    color: var(--colorNeutralForeground3);
    font-variant-numeric: tabular-nums;
  }

  .notifications-list {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    margin: 0;
    padding: 0 4px 4px 0;
    list-style: none;
  }

  .notifications-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    border: 1px solid var(--colorNeutralStroke2);
    border-left: 3px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusMedium);
    padding: 10px 12px;
    background: var(--colorNeutralBackground1);
  }

  .notifications-item--success {
    border-left-color: var(--colorStatusSuccessForeground1);
  }

  .notifications-item--warning {
    border-left-color: var(--colorStatusWarningForeground1);
  }

  .notifications-item--error {
    border-left-color: var(--colorStatusDangerForeground1);
  }

  .notifications-item--info {
    border-left-color: var(--colorBrandStroke);
  }

  .notifications-item-icon {
    display: grid;
    flex: none;
    place-items: center;
    padding-top: 1px;
    color: var(--colorNeutralForeground2);
  }

  .notifications-item--success .notifications-item-icon {
    color: var(--colorStatusSuccessForeground1);
  }

  .notifications-item--warning .notifications-item-icon {
    color: var(--colorStatusWarningForeground1);
  }

  .notifications-item--error .notifications-item-icon {
    color: var(--colorStatusDangerForeground1);
  }

  .notifications-item--info .notifications-item-icon {
    color: var(--colorBrandForeground1);
  }

  .notifications-item-body {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 4px;
  }

  .notifications-item-text {
    margin: 0;
    color: var(--colorNeutralForeground1);
    font: 400 13px/19px var(--fontFamilyBase);
    overflow-wrap: anywhere;
  }

  .notifications-item-toggle {
    align-self: flex-start;
    border: 0;
    padding: 0;
    color: var(--colorBrandForeground1);
    background: transparent;
    font: 400 12px/16px var(--fontFamilyBase);
    cursor: pointer;
  }

  .notifications-item-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 2px 0 0;
    padding: 0;
    color: var(--colorNeutralForeground2);
    font: 400 12px/17px var(--fontFamilyBase);
    list-style: none;
  }

  .notifications-item-details li {
    display: flex;
    gap: 8px;
    overflow-wrap: anywhere;
  }

  .notifications-item-detail-time {
    flex: none;
    color: var(--colorNeutralForeground3);
    font-variant-numeric: tabular-nums;
  }

  .notifications-item-time {
    flex: none;
    color: var(--colorNeutralForeground3);
    font: 400 12px/19px var(--fontFamilyBase);
    font-variant-numeric: tabular-nums;
  }

  .notifications-empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--colorNeutralForeground3);
    font: 400 13px/19px var(--fontFamilyBase);
  }

  @media (max-width: 640px) {
    .notifications-page {
      padding: 16px;
    }

    .notifications-header {
      flex-direction: column;
      gap: 10px;
    }
  }
</style>
