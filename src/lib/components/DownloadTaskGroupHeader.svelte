<script lang="ts">
  import FluentButton from '$lib/components/FluentButton.svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    canDeleteDownloadTaskGroupFiles, canRemoveDownloadTaskGroupRecords,
    type DownloadTaskGroup,
  } from '$lib/download-task-groups';
  import { formatByteRate } from '$lib/transfer-speed';
  import Icon from './Icon.svelte';
  import ProgressRing from './ProgressRing.svelte';

  type PendingAction = 'pause' | 'resume' | 'retry' | 'cancel' | 'delete' | 'remove' | null;

  interface Props {
    group: DownloadTaskGroup;
    expanded: boolean;
    onToggle: (groupId: string) => void;
    onPause: (groupId: string) => Promise<void>;
    onResume: (groupId: string) => Promise<void>;
    onRetry: (groupId: string) => Promise<void>;
    onCancel: (groupId: string) => Promise<void>;
    onDeleteFiles: (groupId: string) => Promise<void>;
    onRemoveRecords: (groupId: string) => Promise<void>;
    pendingAction?: PendingAction;
    bytesPerSecond?: number;
    onContextMenu?: (event: MouseEvent | KeyboardEvent, group: DownloadTaskGroup) => void;
  }

  let {
    group,
    expanded,
    onToggle,
    onPause,
    onResume,
    onRetry,
    onCancel,
    onDeleteFiles,
    onRemoveRecords,
    pendingAction = null,
    bytesPerSecond = 0,
    onContextMenu,
  }: Props = $props();

  const isDeleting = $derived(pendingAction === 'delete');
  const isRemoving = $derived(pendingAction === 'remove');
  const isBusy = $derived(Boolean(pendingAction));
  const percent = $derived(group.progressKnown ? Math.round(group.progress * 100) : null);
  const progressWidth = $derived(`${percent ?? 0}%`);
  const canPause = $derived(
    (group.preparing && !group.batchPaused) || group.tasks.some((task) =>
      task.status === 'pending'
        || task.status === 'scheduled'
        || (task.status === 'downloading' && task.supports_resume),
    ),
  );
  const canResume = $derived(group.batchPaused || group.paused > 0);
  const canRetry = $derived(group.tasks.some((task) => task.status === 'failed'));
  const canCancel = $derived(
    group.preparing || group.tasks.some((task) =>
      ['pending', 'scheduled', 'downloading', 'decrypting', 'verifying', 'paused'].includes(task.status),
    ),
  );
  const canDeleteFiles = $derived(canDeleteDownloadTaskGroupFiles(group));
  const canRemoveRecords = $derived(canRemoveDownloadTaskGroupRecords(group));
  const primaryAction = $derived(
    canRetry ? 'retry' : canResume ? 'resume' : canPause ? 'pause' : null,
  );
  const hasActions = $derived(
    canCancel
    || canDeleteFiles
    || canRemoveRecords
    || canPause
    || canResume
    || canRetry,
  );
  const isCancelled = $derived(
    !group.preparing
    && group.cancelled > 0
    && group.pending === 0
    && group.running === 0
    && group.paused === 0,
  );
  const isRateLimited = $derived(
    group.rateLimitWaiting || group.queueRateLimited > 0 || group.rateLimited > 0,
  );
  const unclassifiedQueueFailures = $derived(Math.max(0, group.failed - group.queueRateLimited));
  const otherScheduled = $derived(Math.max(0, group.scheduled - group.rateLimited));
  const waitingToStart = $derived(Math.max(0, group.pending - group.scheduled));
  const statusText = $derived(
    isDeleting
      ? $t('tasks.batchDeleting')
      : isRemoving
      ? $t('tasks.batchRemoving')
      : group.preparing
      ? [
        group.rateLimitWaiting
          ? $t('tasks.batchRateLimitWaiting')
          : group.queueRateLimited > 0
          ? $t('tasks.batchQueueRateLimitedCount', { values: { count: group.queueRateLimited } })
          : group.batchPaused
          ? $t('tasks.paused')
          : group.phase === 'queueing' ? $t('tasks.batchQueueing') : $t('tasks.batchPreparing'),
        group.queued > 0 ? $t('tasks.batchQueuedCount', { values: { count: group.queued } }) : null,
        unclassifiedQueueFailures > 0 ? $t('tasks.batchFailedCount', { values: { count: unclassifiedQueueFailures } }) : null,
        group.cancelled > 0 ? $t('tasks.batchCancelledCount', { values: { count: group.cancelled } }) : null,
      ].filter(Boolean).join(' · ')
      : [
        group.rateLimited > 0 ? $t('tasks.batchRateLimitedCount', { values: { count: group.rateLimited } }) : null,
        otherScheduled > 0 ? $t('tasks.batchRetryWaitingCount', { values: { count: otherScheduled } }) : null,
        waitingToStart > 0 ? $t('tasks.batchPendingCount', { values: { count: waitingToStart } }) : null,
        group.running > 0 ? $t('tasks.batchActiveCount', { values: { count: group.running } }) : null,
        group.paused > 0 ? $t('tasks.batchPausedCount', { values: { count: group.paused } }) : null,
        group.failed > 0 ? $t('tasks.batchFailedCount', { values: { count: group.failed } }) : null,
        group.cancelled > 0 ? $t('tasks.batchCancelledCount', { values: { count: group.cancelled } }) : null,
        group.deleted > 0 ? $t('tasks.batchDeletedCount', { values: { count: group.deleted } }) : null,
      ].filter(Boolean).join(' · '),
  );

  async function runAction(action: (groupId: string) => Promise<void>) {
    if (pendingAction) return;
    await action(group.id);
  }

  function handleContextMenu(event: MouseEvent | KeyboardEvent) {
    if (isBusy) {
      event.preventDefault();
      return;
    }
    onContextMenu?.(event, group);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="batch-card"
  class:batch-card-deleting={isDeleting}
  role="group"
  aria-label={group.name}
  aria-busy={isBusy}
  oncontextmenu={handleContextMenu}
  onkeydown={(event) => {
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      handleContextMenu(event);
    }
  }}
>
  <div class="batch-summary">
    <span class="batch-folder" class:batch-folder-cancelled={isCancelled}>
      {#if isDeleting}
        <ProgressRing class="batch-delete-ring" size={20} strokeWidth={2.6} label={$t('tasks.batchDeleting')} />
      {:else}
        <Icon name="folder" size="22px" />
      {/if}
    </span>
    <span class="batch-copy">
      <span class="batch-title" title={group.name}>{group.name}</span>
      <span class="batch-meta">
        {#if group.total > 0}
          {$t('tasks.batchProgress', { values: { completed: group.completed, total: group.total } })}
        {:else}
          {$t('tasks.batchTaskCount', { values: { count: group.total } })}
        {/if}
      </span>
    </span>
    <span class="batch-state" class:batch-state-warning={isRateLimited} aria-live="polite">
      {#if isRateLimited}<span class="cfms-icon-text__icon batch-state-icon" aria-hidden="true"><Icon name="warningAmber" size="15px" /></span>{/if}
      <span class="batch-state-copy">
        {statusText || (group.total > 0 && group.completed === group.total
          ? $t('tasks.completed')
          : $t('tasks.batchProgressPending'))}
      </span>
    </span>
    <span class="batch-progress-cell">
      <span class="batch-progress-meta">
        <span class="batch-speed">{bytesPerSecond > 0 ? formatByteRate(bytesPerSecond) : ''}</span>
        <span class="batch-percent">
          {percent === null ? $t('tasks.batchProgressPending') : `${percent}%`}
        </span>
      </span>
      <span
        class="batch-progress"
        class:batch-progress-indeterminate={!group.progressKnown}
        role="progressbar"
        aria-label={$t('tasks.progressFor', { values: { name: group.name } })}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={percent ?? undefined}
      ><span style={`width: ${progressWidth}`}></span></span>
    </span>
    <span class="batch-row-actions">
      {#if primaryAction === 'retry'}
        <FluentButton data-fluent-owner="lib-components-download-task-group-header"
          type="button"
          disabled={Boolean(pendingAction) || isDeleting}
          title={$t('tasks.retryAction')}
          aria-label={$t('tasks.retryAction')}
          onclick={() => runAction(onRetry)}
          appearance="subtle"
          class="batch-primary-action batch-action-primary"
        ><Icon name="restartAlt" size="16px" /><span class="batch-action-label">{$t('tasks.retryAction')}</span></FluentButton>
      {:else if primaryAction === 'resume'}
        <FluentButton data-fluent-owner="lib-components-download-task-group-header"
          type="button"
          disabled={Boolean(pendingAction) || isDeleting}
          title={$t('tasks.resume')}
          aria-label={$t('tasks.resume')}
          onclick={() => runAction(onResume)}
          appearance="subtle"
          class="batch-primary-action batch-action-primary"
        ><Icon name="resume" size="16px" /><span class="batch-action-label">{$t('tasks.resume')}</span></FluentButton>
      {:else if primaryAction === 'pause'}
        <FluentButton data-fluent-owner="lib-components-download-task-group-header"
          type="button"
          disabled={Boolean(pendingAction) || isDeleting}
          title={$t('tasks.pause')}
          aria-label={$t('tasks.pause')}
          onclick={() => runAction(onPause)}
          appearance="subtle"
          class="batch-primary-action batch-action-warning"
        ><Icon name="pause" size="16px" /><span class="batch-action-label">{$t('tasks.pause')}</span></FluentButton>
      {/if}
      {#if canPause && primaryAction !== 'pause'}
        <FluentButton data-fluent-owner="lib-components-download-task-group-header"
          type="button"
          disabled={Boolean(pendingAction) || isDeleting}
          title={$t('tasks.pause')}
          aria-label={$t('tasks.pause')}
          onclick={() => runAction(onPause)}
          appearance="subtle"
          class="batch-action batch-action-warning"
        ><Icon name="pause" size="16px" /><span class="batch-action-label">{$t('tasks.pause')}</span></FluentButton>
      {/if}
      {#if canResume && primaryAction !== 'resume'}
        <FluentButton data-fluent-owner="lib-components-download-task-group-header"
          type="button"
          disabled={Boolean(pendingAction) || isDeleting}
          title={$t('tasks.resume')}
          aria-label={$t('tasks.resume')}
          onclick={() => runAction(onResume)}
          appearance="subtle"
          class="batch-action batch-action-primary"
        ><Icon name="resume" size="16px" /><span class="batch-action-label">{$t('tasks.resume')}</span></FluentButton>
      {/if}
      {#if canRetry && primaryAction !== 'retry'}
        <FluentButton data-fluent-owner="lib-components-download-task-group-header"
          type="button"
          disabled={Boolean(pendingAction) || isDeleting}
          title={$t('tasks.retryAction')}
          aria-label={$t('tasks.retryAction')}
          onclick={() => runAction(onRetry)}
          appearance="subtle"
          class="batch-action batch-action-primary"
        ><Icon name="restartAlt" size="16px" /><span class="batch-action-label">{$t('tasks.retryAction')}</span></FluentButton>
      {/if}
      {#if canCancel}
        <FluentButton data-fluent-owner="lib-components-download-task-group-header"
          type="button"
          disabled={Boolean(pendingAction) || isDeleting}
          title={$t('tasks.cancel')}
          aria-label={$t('tasks.cancel')}
          onclick={() => runAction(onCancel)}
          appearance="subtle"
          tone="danger"
          class="batch-action batch-action-danger"
        ><Icon name="cancel" size="16px" /><span class="batch-action-label">{$t('tasks.cancel')}</span></FluentButton>
      {/if}
      {#if canDeleteFiles}
        <FluentButton data-fluent-owner="lib-components-download-task-group-header"
          type="button"
          disabled={Boolean(pendingAction) || isDeleting}
          title={isDeleting ? $t('tasks.batchDeleting') : $t('tasks.deleteBatchFiles')}
          aria-label={isDeleting ? $t('tasks.batchDeleting') : $t('tasks.deleteBatchFiles')}
          onclick={() => runAction(onDeleteFiles)}
          appearance="subtle"
          tone="danger"
          class="batch-action batch-action-danger"
        >
          {#if isDeleting}<ProgressRing class="batch-delete-ring" size={16} strokeWidth={2.4} label={$t('tasks.batchDeleting')} />{:else}<Icon name="delete" size="16px" />{/if}
          <span class="batch-action-label">{isDeleting ? $t('tasks.batchDeleting') : $t('tasks.deleteBatchFiles')}</span>
        </FluentButton>
      {/if}
      {#if canRemoveRecords}
        <FluentButton data-fluent-owner="lib-components-download-task-group-header"
          type="button"
          disabled={Boolean(pendingAction)}
          title={isRemoving ? $t('tasks.batchRemoving') : $t('tasks.removeBatchRecords')}
          aria-label={isRemoving ? $t('tasks.batchRemoving') : $t('tasks.removeBatchRecords')}
          onclick={() => runAction(onRemoveRecords)}
          appearance="subtle"
          class="batch-action"
        >
          {#if isRemoving}<ProgressRing size={16} strokeWidth={2.4} label={$t('tasks.batchRemoving')} />{:else}<Icon name="playlistRemove" size="16px" />{/if}
          <span class="batch-action-label">{isRemoving ? $t('tasks.batchRemoving') : $t('tasks.removeBatchRecords')}</span>
        </FluentButton>
      {/if}
      {#if hasActions}<span class="batch-action-divider" aria-hidden="true"></span>{/if}
      <FluentButton data-fluent-owner="lib-components-download-task-group-header"
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? $t('tasks.collapseBatch') : $t('tasks.expandBatch')}
        title={expanded ? $t('tasks.collapseBatch') : $t('tasks.expandBatch')}
        disabled={isBusy}
        onclick={() => onToggle(group.id)}
        appearance="subtle"
        class="batch-expand"
      >
        <span class:batch-chevron-expanded={expanded} class="batch-chevron"><Icon name="expandMore" size="18px" /></span>
      </FluentButton>
    </span>
  </div>
</div>

<style>
  .batch-card {
    container-name: download-batch;
    container-type: inline-size;
    min-width: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--explorer-border);
    background: transparent;
    transition: background-color 180ms var(--motion-easing-standard);
  }

  .batch-card:hover {
    background: var(--explorer-surface-hover);
  }

  .batch-card-deleting {
    background: color-mix(in srgb, var(--explorer-danger) 12%, var(--explorer-surface));
  }

  .batch-summary {
    display: grid;
    width: 100%;
    min-width: 0;
    min-height: 72px;
    grid-template:
      'folder copy progress actions' auto
      'folder state progress actions' auto /
      28px minmax(180px, 1fr) minmax(180px, 0.72fr) auto;
    align-items: center;
    gap: 0.35rem 0.75rem;
    padding: 0.55rem 0.7rem;
    font-family: var(--font-md3-sans);
  }

  .batch-folder {
    display: grid;
    grid-area: folder;
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    color: var(--explorer-folder);
    transition:
      background-color 180ms var(--motion-easing-standard),
      color 180ms var(--motion-easing-standard);
  }

  .batch-folder-cancelled {
    color: var(--explorer-text-muted);
  }

  .batch-copy {
    display: grid;
    grid-area: copy;
    min-width: 0;
    gap: 4px;
  }

  .batch-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--explorer-text);
    font-size: 14px;
    font-weight: 600;
  }

  .batch-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--explorer-text-muted);
    font-size: 12px;
  }

  .batch-state {
    display: flex;
    grid-area: state;
    min-width: 0;
    align-items: flex-start;
    gap: 4px;
    color: var(--explorer-text-muted);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .batch-state-warning {
    color: var(--explorer-warning);
  }

  .batch-state-icon {
    flex: none;
  }

  .batch-state-copy {
    min-width: 0;
  }

  .batch-progress-cell {
    display: grid;
    grid-area: progress;
    min-width: 0;
    gap: 4px;
  }

  .batch-percent {
    color: var(--explorer-accent);
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .batch-progress {
    display: block;
    height: 0.25rem;
    overflow: hidden;
    border-radius: 9999px;
    background: var(--explorer-surface-raised);
  }

  .batch-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--explorer-accent);
    transition: width 260ms var(--motion-easing-emphasized-decelerate);
  }

  .batch-progress-indeterminate span {
    width: 42% !important;
    animation: batch-progress-sweep 1.3s var(--motion-easing-emphasized-decelerate) infinite;
  }

  .batch-row-actions {
    display: flex;
    grid-area: actions;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }

  .batch-progress-meta {
    display: flex;
    min-width: 0;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .batch-speed {
    overflow: hidden;
    color: var(--explorer-text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.batch-primary-action[data-fluent-owner="lib-components-download-task-group-header"]),
  :global(.batch-action[data-fluent-owner="lib-components-download-task-group-header"]) {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 34px;
    border-radius: var(--borderRadiusMedium);
    padding: 0.25rem 0.55rem;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    transition:
      background-color 120ms var(--motion-easing-standard),
      filter 160ms var(--motion-easing-standard),
      opacity 160ms var(--motion-easing-standard),
      transform 120ms var(--motion-easing-standard);
  }

  .batch-action-divider {
    width: 1px;
    height: 20px;
    flex: none;
    margin: 0 0.15rem;
    background: var(--explorer-border);
  }

  :global(.batch-expand[data-fluent-owner="lib-components-download-task-group-header"]) {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: 999px;
    color: var(--explorer-text-muted);
    transition: color 120ms var(--motion-easing-standard), background-color 120ms var(--motion-easing-standard), transform 120ms var(--motion-easing-standard);
  }

  .batch-chevron { display: inline-flex; transition: transform 180ms var(--motion-easing-emphasized-decelerate); }
  .batch-chevron-expanded { transform: rotate(180deg); }

  :global(.batch-expand[data-fluent-owner="lib-components-download-task-group-header"]:hover:not(:is(:disabled, [disabled]))) {
    background: var(--explorer-surface-selected);
    color: var(--explorer-text);
  }

  :global(.batch-primary-action[data-fluent-owner="lib-components-download-task-group-header"]:hover:not(:is(:disabled, [disabled]))),
  :global(.batch-action[data-fluent-owner="lib-components-download-task-group-header"]:hover:not(:is(:disabled, [disabled]))) {
    background: var(--explorer-surface-selected);
    filter: none;
  }

  :global(.batch-primary-action[data-fluent-owner="lib-components-download-task-group-header"]:focus-visible),
  :global(.batch-action[data-fluent-owner="lib-components-download-task-group-header"]:focus-visible),
  :global(.batch-expand[data-fluent-owner="lib-components-download-task-group-header"]:focus-visible) {
    outline: none;
    outline-offset: -2px;
  }

  :global(.batch-primary-action[data-fluent-owner="lib-components-download-task-group-header"]:active:not(:is(:disabled, [disabled]))),
  :global(.batch-action[data-fluent-owner="lib-components-download-task-group-header"]:active:not(:is(:disabled, [disabled]))),
  :global(.batch-expand[data-fluent-owner="lib-components-download-task-group-header"]:active:not(:is(:disabled, [disabled]))) { transform: none; }

  :global(.batch-primary-action[data-fluent-owner="lib-components-download-task-group-header"]:is(:disabled, [disabled])),
  :global(.batch-action[data-fluent-owner="lib-components-download-task-group-header"]:is(:disabled, [disabled])),
  :global(.batch-expand[data-fluent-owner="lib-components-download-task-group-header"]:is(:disabled, [disabled])) {
    opacity: 0.5;
  }

  :global(.batch-delete-ring) {
    color: currentColor;
  }

  :global(.batch-action-warning[data-fluent-owner="lib-components-download-task-group-header"]) {
    color: var(--explorer-warning);
  }

  :global(.batch-action-primary[data-fluent-owner="lib-components-download-task-group-header"]) {
    color: var(--explorer-accent);
  }

  :global(.batch-action-danger[data-fluent-owner="lib-components-download-task-group-header"]) {
    color: var(--explorer-danger);
  }

  @keyframes batch-progress-sweep {
    from {
      transform: translateX(-110%);
    }
    to {
      transform: translateX(250%);
    }
  }

  @container download-batch (max-width: 64rem) {
    :global(.batch-primary-action[data-fluent-owner="lib-components-download-task-group-header"]),
    :global(.batch-action[data-fluent-owner="lib-components-download-task-group-header"]) {
      width: 36px;
      height: 36px;
      padding: 0;
    }

    .batch-action-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  @container download-batch (max-width: 46rem) {
    .batch-summary {
      grid-template:
        'folder copy copy' auto
        '. state state' auto
        '. progress progress' auto
        '. actions actions' auto /
        28px minmax(0, 1fr) auto;
      gap: 0.5rem 0.55rem;
      padding: 0.65rem;
    }

    .batch-row-actions {
      flex-wrap: wrap;
    }
  }

  @media (pointer: coarse) {
    :global(.batch-primary-action[data-fluent-owner="lib-components-download-task-group-header"]),
    :global(.batch-action[data-fluent-owner="lib-components-download-task-group-header"]) {
      min-width: 44px;
      min-height: 44px;
    }
    :global(.batch-expand[data-fluent-owner="lib-components-download-task-group-header"]) { width: 44px; height: 44px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .batch-progress-indeterminate span { animation: none; }
    .batch-card,
    .batch-folder,
    .batch-progress span,
    :global(.batch-primary-action[data-fluent-owner="lib-components-download-task-group-header"]),
    :global(.batch-action[data-fluent-owner="lib-components-download-task-group-header"]),
    :global(.batch-expand[data-fluent-owner="lib-components-download-task-group-header"]),
    .batch-chevron { transition: none; }
    :global(.batch-primary-action[data-fluent-owner="lib-components-download-task-group-header"]:active:not(:is(:disabled, [disabled]))),
    :global(.batch-action[data-fluent-owner="lib-components-download-task-group-header"]:active:not(:is(:disabled, [disabled]))),
    :global(.batch-expand[data-fluent-owner="lib-components-download-task-group-header"]:active:not(:is(:disabled, [disabled]))) { transform: none; }
  }

</style>
