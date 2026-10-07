<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { getAccessRules, listDirectoryPage, setAccessRules } from '$lib/api';
  import { ACCESS_OPERATIONS, cloneAccessRules, validateAccessRules, type AccessRulesRecord } from '$lib/access-rules';
  import {
    BatchAccessRulesController, batchRulesTargetKey,
    type BatchRulesItemStatus, type BatchRulesProblem, type BatchRulesSnapshot, type BatchRulesTarget,
  } from '$lib/files/batch-access-rules';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import { floatingProgressStore } from '$lib/stores.svelte';
  import { dialogStore } from '$lib/dialogs.svelte';
  import AccessRulesManager from './AccessRulesManager.svelte';
  import DialogActionButton from './DialogActionButton.svelte';
  import Icon from './Icon.svelte';
  import MdCheckbox from './MdCheckbox.svelte';
  import MdSwitch from './MdSwitch.svelte';
  import ModalFrame from './ModalFrame.svelte';
  import ProgressRing from './ProgressRing.svelte';
  import VirtualList from './VirtualList.svelte';

  let { targets, canReadTemplate, checkGuard, onApplied, onClose }: {
    targets: BatchRulesTarget[];
    canReadTemplate: boolean;
    checkGuard: () => BatchRulesProblem | null;
    onApplied: () => Promise<void>;
    onClose: () => void;
  } = $props();

  const roots = untrack(() => targets.map((target) => ({ ...target })));
  const progressId = `files:batch-access-rules:${crypto.randomUUID()}`;
  let stage = $state<'edit' | 'review' | 'results'>('edit');
  let recursive = $state(false);
  let editorRules = $state<AccessRulesRecord>({});
  let editorInherit = $state(true);
  let draftRules = $state<AccessRulesRecord>({});
  let draftInherit = $state(true);
  let templateKey = $state(batchRulesTargetKey(roots[0]));
  let templateLoading = $state(false);
  let templateError = $state<string | null>(null);
  let templateSource = $state<string | null>(null);
  let allowIncomplete = $state(false);
  let filter = $state<'all' | BatchRulesItemStatus>('all');
  let refreshing = $state(false);
  let refreshError = $state<string | null>(null);
  let now = $state(Date.now());
  let snapshot = $state.raw<BatchRulesSnapshot>(undefined!);
  let disposed = false;
  let templateRequest = 0;
  let editRevision = 0;
  let refreshedSuccesses = 0;

  const controller = new BatchAccessRulesController(roots, {
    fetchPage: listDirectoryPage,
    setRules: setAccessRules,
    guard: () => checkGuard(),
    onChange: (next) => { snapshot = next; },
  });
  snapshot = controller.snapshot;

  const busy = $derived(['scanning', 'running', 'waiting'].includes(snapshot.phase));
  const guardIssue = $derived(checkGuard());
  const counts = $derived.by(() => {
    const result = { pending: 0, success: 0, failed: 0, unconfirmed: 0 };
    for (const item of snapshot.results) result[item.status] += 1;
    return result;
  });
  const processed = $derived(snapshot.runCompleted);
  const folders = $derived(snapshot.targets.filter((target) => target.objectType === 'directory').length);
  const documents = $derived(snapshot.targets.length - folders);
  const filteredResults = $derived(snapshot.results.filter((item) => filter === 'all' || item.status === filter));
  const emptyRules = $derived(ACCESS_OPERATIONS.every((operation) => !(draftRules[operation]?.length)));
  const waitSeconds = $derived(Math.max(0, Math.ceil(((snapshot.waitingUntil ?? snapshot.retryAt) - now) / 1_000)));

  $effect(() => {
    const problem = guardIssue;
    if (problem && busy && !snapshot.stopRequested) untrack(() => controller.stop(problem));
  });

  $effect(() => {
    if (busy) {
      const text = snapshot.phase === 'waiting'
        ? $t('files.batchRules.waiting', { values: { seconds: waitSeconds } })
        : snapshot.operation === 'scan'
          ? $t('files.batchRules.discovered', { values: { count: snapshot.targets.length } })
          : $t('files.batchRules.progress', { values: { processed, total: snapshot.runTotal } });
      const title = $t('files.batchRules.title');
      const current = snapshot.operation === 'scan' ? 0 : processed;
      const total = snapshot.operation === 'scan' ? 0 : snapshot.runTotal;
      untrack(() => floatingProgressStore.upsert(progressId, title, text, current, total));
    } else untrack(() => floatingProgressStore.remove(progressId));
  });

  onMount(() => {
    const timer = setInterval(() => { now = Date.now(); }, 1_000);
    return () => clearInterval(timer);
  });

  onDestroy(() => {
    disposed = true;
    templateRequest += 1;
    controller.dispose();
    floatingProgressStore.remove(progressId);
  });

  function problemText(problem: BatchRulesProblem, scanning = false): string {
    const label = $t(scanning && problem.kind === 'denied' ? 'files.batchRules.scanDenied' : `files.batchRules.problem.${problem.kind}`);
    return problem.error === undefined ? label : `${label}: ${formatUserFacingError(problem.error)}`;
  }

  function close() {
    if (!busy && !refreshing) onClose();
  }

  async function loadTemplate() {
    if (!canReadTemplate || templateLoading || guardIssue) return;
    const target = roots.find((item) => batchRulesTargetKey(item) === templateKey);
    if (!target) return;
    const request = ++templateRequest;
    const revision = editRevision;
    templateLoading = true;
    templateError = null;
    try {
      const current = await getAccessRules(target.objectType, target.objectId);
      if (disposed || !canReadTemplate || request !== templateRequest || revision !== editRevision || checkGuard()) return;
      if (typeof current?.inherit !== 'boolean') throw new Error($t('files.batchRules.problem.invalid_response'));
      validateAccessRules(current.rules);
      editorRules = cloneAccessRules(current.rules);
      editorInherit = current.inherit;
      templateSource = target.name;
    } catch (error) {
      if (!disposed && request === templateRequest) templateError = formatUserFacingError(error);
    } finally {
      if (!disposed && request === templateRequest) templateLoading = false;
    }
  }

  async function prepare(rules: AccessRulesRecord, inherit: boolean) {
    if (templateLoading || guardIssue || busy) return;
    draftRules = cloneAccessRules(rules);
    draftInherit = inherit;
    allowIncomplete = false;
    stage = 'review';
    await controller.discover(draftRules, draftInherit, recursive);
  }

  async function retryScan() {
    allowIncomplete = false;
    await controller.discover(draftRules, draftInherit, recursive);
  }

  async function run(action: () => Promise<void>) {
    if (busy || refreshing || guardIssue) return;
    stage = 'results';
    await action();
    if (disposed || counts.success <= refreshedSuccesses) return;
    refreshedSuccesses = counts.success;
    refreshing = true;
    refreshError = null;
    try {
      await onApplied();
    } catch (error) {
      if (!disposed) refreshError = `${$t('files.batchRules.refreshFailed')}: ${formatUserFacingError(error)}`;
    } finally {
      if (!disposed) refreshing = false;
    }
  }

  async function resubmitUnconfirmed() {
    if (busy || refreshing || guardIssue) return;
    const confirmed = await dialogStore.confirm({
      title: $t('files.batchRules.unconfirmedTitle'),
      message: $t('files.batchRules.unconfirmedConfirm'),
      confirmLabel: $t('files.batchRules.resubmitUnconfirmed'),
      cancelLabel: $t('common.cancel'),
    });
    if (confirmed && !disposed) await run(() => controller.resubmitUnconfirmed());
  }
</script>

<ModalFrame
  title={$t('files.batchRules.title')}
  maxWidth="max-w-6xl" resizable maximizable minWidth={680} minHeight={480}
  closeLabel={$t('common.close')} dismissible={!busy && !refreshing} closeOnBackdrop={false} onClose={close}
>
  <div class="batch-rules-layout">
    <div class="batch-rules-context">
      <p class="batch-rules-step">{$t(`files.batchRules.step.${stage}`)}</p>
      {#if guardIssue}<p class="batch-rules-warning" role="alert">{problemText(guardIssue)}</p>{/if}
      {#if stage === 'edit'}
        <p>{$t('files.batchRules.selection', { values: { count: roots.length } })}</p>
        <div class="batch-rules-options">
          {#if roots.some((target) => target.objectType === 'directory')}
            <label class="batch-rules-switch">
              <MdSwitch bind:checked={recursive} ariaLabel={$t('files.batchRules.recursive')} />
              <span>{$t('files.batchRules.recursive')}</span>
            </label>
          {/if}
          {#if canReadTemplate}
            <div class="batch-rules-template">
              <select bind:value={templateKey} aria-label={$t('files.batchRules.templateObject')} disabled={templateLoading}>
                {#each roots as target (batchRulesTargetKey(target))}
                  <option value={batchRulesTargetKey(target)}>{$t(`files.${target.objectType}`)} · {target.name}</option>
                {/each}
              </select>
              <DialogActionButton onclick={loadTemplate} disabled={templateLoading || !!guardIssue}>
                {#if templateLoading}<ProgressRing size={16} label={$t('common.loadingEllipsis')} />{/if}
                {$t('files.batchRules.loadTemplate')}
              </DialogActionButton>
            </div>
          {/if}
        </div>
        {#if templateSource}<p class="batch-rules-muted">{$t('files.batchRules.templateSource', { values: { name: templateSource } })}</p>{/if}
        {#if templateError}<p class="batch-rules-warning" role="alert">{templateError}</p>{/if}
      {:else}
        <p>{$t('files.batchRules.scope', { values: { documents, folders } })}</p>
        <p class="batch-rules-muted">
          {$t(recursive ? 'files.batchRules.recursiveEnabled' : 'files.batchRules.selectedOnly')}
          · {$t(draftInherit ? 'files.batchRules.inheritOn' : 'files.batchRules.inheritOff')}
        </p>
      {/if}
    </div>

    {#if !snapshot.started}
      <div class="batch-rules-editor" class:hidden={stage !== 'edit'}>
        <AccessRulesManager
          rules={editorRules} inheritParent={editorInherit} saving={stage !== 'edit'}
          submitLabel={$t('files.batchRules.reviewScope')} submitDisabled={templateLoading || !!guardIssue}
          onEdit={() => { editRevision += 1; }} onSave={prepare} onCancel={close}
        />
      </div>
    {/if}

    {#if stage !== 'edit'}
      <div class="batch-rules-summary" aria-live="polite">
        {#if busy}
          <div class="batch-rules-status">
            <ProgressRing size={20} label={$t('files.batchRules.title')} />
            <span>
              {snapshot.stopRequested ? $t('files.batchRules.stopping')
                : snapshot.phase === 'waiting' ? $t('files.batchRules.waiting', { values: { seconds: waitSeconds } })
                : snapshot.operation === 'scan' ? $t('files.batchRules.discovered', { values: { count: snapshot.targets.length } })
                : $t('files.batchRules.progress', { values: { processed, total: snapshot.runTotal } })}
            </span>
          </div>
        {:else if stage === 'review'}
          <p>{$t('files.batchRules.overwrite')}</p>
          {#if emptyRules}<p class="batch-rules-warning">{$t('files.batchRules.emptyRules')}</p>{/if}
        {:else}
          <p class="batch-rules-step">{$t(`files.batchRules.phase.${snapshot.phase}`)}</p>
        {/if}
        {#if snapshot.started}
          <p>{$t('files.batchRules.counts', { values: counts })}</p>
          <p class="batch-rules-muted">{$t('files.batchRules.noRollback')}</p>
          {#if busy && snapshot.operation === 'apply'}
            <progress max={snapshot.runTotal || 1} value={processed} aria-label={$t('files.batchRules.progress', { values: { processed, total: snapshot.runTotal } })}></progress>
          {/if}
        {/if}
        {#if snapshot.stopReason}<p class="batch-rules-warning">{problemText(snapshot.stopReason)}</p>{/if}
        {#if !busy && waitSeconds > 0}<p>{$t('files.batchRules.cooldown', { values: { seconds: waitSeconds } })}</p>{/if}
        {#if refreshError}<p class="batch-rules-warning" role="alert">{refreshError}</p>{/if}
        {#if refreshing}<p class="batch-rules-muted">{$t('files.batchRules.refreshing')}</p>{/if}
      </div>

      {#if snapshot.scanIssues.length > 0 || (!snapshot.scanComplete && !busy)}
        <div class="batch-rules-scan-warning">
          <p class="batch-rules-warning">{$t('files.batchRules.incompleteScope')}</p>
          {#if snapshot.scanIssues.length > 0}
            <VirtualList items={snapshot.scanIssues} keyOf={(issue) => batchRulesTargetKey(issue.target)} estimateSize={72} viewportClass="batch-rules-issues">
              {#snippet children(issue)}
                <div class="batch-rules-issue-row">
                  <strong>{issue.target.path ?? issue.target.name}</strong>
                  <p>{problemText(issue.problem, true)}</p>
                </div>
              {/snippet}
            </VirtualList>
          {/if}
          {#if stage === 'review' && snapshot.phase === 'ready'}
            <label class="batch-rules-switch">
              <MdCheckbox bind:checked={allowIncomplete} ariaLabel={$t('files.batchRules.allowIncomplete')} />
              <span>{$t('files.batchRules.allowIncomplete')}</span>
            </label>
          {/if}
        </div>
      {/if}

      {#if snapshot.started}
        <div class="batch-rules-filter">
          <label for={progressId + ':filter'}>{$t('files.batchRules.filter')}</label>
          <select id={progressId + ':filter'} bind:value={filter}>
            <option value="all">{$t('files.batchRules.allResults')}</option>
            {#each ['success', 'failed', 'unconfirmed', 'pending'] as status}
              <option value={status}>{$t(`files.batchRules.item.${status}`)}</option>
            {/each}
          </select>
        </div>
      {/if}

      {#if snapshot.results.length > 0}
        <VirtualList items={filteredResults} keyOf={(item) => batchRulesTargetKey(item.target)} estimateSize={84} resetKey={filter} viewportClass="batch-rules-results">
          {#snippet children(item)}
            <div class="batch-rules-result">
              <Icon name={item.target.objectType === 'directory' ? 'folder' : 'filePresent'} size="20px" />
              <div class="batch-rules-result-copy">
                <strong>{item.target.name}</strong>
                <p class="batch-rules-muted">{item.target.path ?? item.target.objectId}</p>
                {#if item.problem}<p class="batch-rules-warning">{problemText(item.problem)}</p>{/if}
              </div>
              {#if snapshot.started}
                <span class:batch-rules-success={item.status === 'success'}>
                  {$t(`files.batchRules.item.${busy && snapshot.activeKey === batchRulesTargetKey(item.target) ? 'working' : item.status}`)}
                  {#if item.problem?.status}<span class="batch-rules-muted"> · {item.problem.status}</span>{/if}
                </span>
              {/if}
            </div>
          {/snippet}
        </VirtualList>
        {#if filteredResults.length === 0}<p class="batch-rules-empty">{$t('files.batchRules.noResults')}</p>{/if}
      {/if}

      <div class="batch-rules-actions">
        {#if busy}
          <DialogActionButton onclick={() => controller.stop()} disabled={snapshot.stopRequested}>{$t('files.batchRules.stop')}</DialogActionButton>
        {:else if stage === 'review'}
          <DialogActionButton onclick={() => { stage = 'edit'; }} disabled={refreshing}>{$t('files.batchRules.backToEdit')}</DialogActionButton>
          {#if snapshot.scanIssues.length > 0}
            <DialogActionButton onclick={retryScan} disabled={!!guardIssue}>{$t('files.batchRules.retryScan')}</DialogActionButton>
          {/if}
          {#if snapshot.phase === 'ready'}
            <DialogActionButton variant="primary" onclick={() => run(() => controller.apply(allowIncomplete))} disabled={!!guardIssue || (snapshot.scanIssues.length > 0 && !allowIncomplete)}>
              {$t('files.batchRules.apply', { values: { count: snapshot.targets.length } })}
            </DialogActionButton>
          {:else}
            <DialogActionButton variant="primary" onclick={() => controller.resumeScan()} disabled={!!guardIssue}>{$t('files.batchRules.resumeScan')}</DialogActionButton>
          {/if}
        {:else}
          {#if counts.failed > 0}<DialogActionButton onclick={() => run(() => controller.retryFailed())} disabled={refreshing || !!guardIssue}>{$t('files.batchRules.retryFailed')}</DialogActionButton>{/if}
          {#if counts.pending > 0 || (snapshot.phase === 'paused' && counts.failed > 0)}
            <DialogActionButton variant="primary" onclick={() => run(() => controller.continuePending())} disabled={refreshing || !!guardIssue}>{$t('files.batchRules.continuePending')}</DialogActionButton>
          {/if}
          {#if counts.unconfirmed > 0}<DialogActionButton onclick={resubmitUnconfirmed} disabled={refreshing || !!guardIssue}>{$t('files.batchRules.resubmitUnconfirmed')}</DialogActionButton>{/if}
          <DialogActionButton onclick={close} disabled={refreshing}>{$t('common.close')}</DialogActionButton>
        {/if}
      </div>
    {/if}
  </div>
</ModalFrame>

<style>
  .batch-rules-layout { display: flex; min-height: 0; max-height: 78vh; flex-direction: column; color: var(--color-md3-on-surface); font-size: 0.875rem; }
  .batch-rules-context, .batch-rules-summary, .batch-rules-scan-warning { flex: none; padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--color-md3-outline); }
  .batch-rules-context p, .batch-rules-summary p { margin-block: 0.25rem; }
  .batch-rules-step { font-weight: 650; }
  .batch-rules-muted { color: var(--color-md3-on-surface-variant); font-size: 0.78rem; }
  .batch-rules-warning { color: var(--color-md3-error); overflow-wrap: anywhere; }
  .batch-rules-options, .batch-rules-template, .batch-rules-switch, .batch-rules-status, .batch-rules-filter { display: flex; align-items: center; gap: 0.65rem; }
  .batch-rules-options { flex-wrap: wrap; margin-top: 0.75rem; justify-content: space-between; }
  .batch-rules-template { min-width: 0; flex-wrap: wrap; }
  select { max-width: 100%; min-height: 2rem; min-width: 0; border: 1px solid var(--color-md3-outline); border-radius: 6px; padding: 0.3rem 0.5rem; background: var(--color-md3-surface-container-high); color: var(--color-md3-on-surface); }
  .batch-rules-template select { max-width: 18rem; }
  .batch-rules-editor { display: flex; min-height: 0; flex: 1; flex-direction: column; }
  .hidden { display: none; }
  .batch-rules-filter { flex: none; padding: 0.6rem 1.25rem; }
  .batch-rules-layout :global(.batch-rules-results) { flex: 1; min-height: 100px; max-height: 38vh; overflow: auto; }
  .batch-rules-layout :global(.batch-rules-issues) { max-height: 120px; overflow: auto; }
  .batch-rules-result { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--color-md3-outline); }
  .batch-rules-result-copy { min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .batch-rules-result p { margin-top: 0.2rem; }
  .batch-rules-result > span { flex: none; font-size: 0.78rem; }
  .batch-rules-success { color: var(--color-md3-success); }
  .batch-rules-issue-row { padding-block: 0.5rem; overflow-wrap: anywhere; }
  .batch-rules-actions { display: flex; flex: none; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid var(--color-md3-outline); padding: 0.85rem 1.25rem; }
  .batch-rules-empty { padding: 1rem 1.25rem; }
  progress { width: 100%; height: 0.3rem; accent-color: var(--color-md3-primary); margin-top: 0.65rem; }
  @media (max-width: 640px) {
    .batch-rules-layout { max-height: 82vh; }
    .batch-rules-context, .batch-rules-summary, .batch-rules-scan-warning { padding: 0.75rem; }
    .batch-rules-template { width: 100%; }
    .batch-rules-template select { flex: 1; }
    .batch-rules-result { padding-inline: 0.75rem; }
    .batch-rules-result > span { max-width: 5rem; }
  }
  @media (pointer: coarse) { select { min-height: 2.5rem; } }
</style>
