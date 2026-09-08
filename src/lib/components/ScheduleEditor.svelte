<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type {
    JsonValue,
    Schedule,
    ScheduleCreateInput,
    ScheduledTaskType,
    ScheduleTriggerType,
    ScheduleUpdateInput,
  } from '$lib/api';
  import {
    browserTimeZone,
    buildScheduleTrigger,
    isoToZonedDateTimeInput,
    parsePayloadObject,
    ScheduleValidationError,
    toZonedDateTimeInput,
  } from '$lib/schedule-form';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import Icon from './Icon.svelte';
  import MdSwitch from './MdSwitch.svelte';

  interface Props {
    taskTypes: ScheduledTaskType[];
    schedule?: Schedule | null;
    busy?: boolean;
    onSave: (input: ScheduleCreateInput | ScheduleUpdateInput) => void | Promise<void>;
    onCancel: () => void;
  }

  let {
    taskTypes,
    schedule = null,
    busy = false,
    onSave,
    onCancel,
  }: Props = $props();

  let taskName = $state('');
  let payloadText = $state('{}');
  let triggerType = $state<ScheduleTriggerType>('date');
  let timezone = $state('UTC');
  let cronExpression = $state('0 8 * * 1');
  let runAt = $state('');
  let intervalSeconds = $state('3600');
  let intervalStartAt = $state('');
  let enabled = $state(true);
  let validationError = $state<string | null>(null);
  let loadedKey = '';

  const selectedTaskType = $derived(taskTypes.find((item) => item.name === taskName) ?? null);
  const editingUnavailableTask = $derived(Boolean(schedule && !selectedTaskType));
  const formTitle = $derived(schedule ? $t('schedules.editTitle') : $t('schedules.createTitle'));

  $effect(() => {
    const key = schedule ? `${schedule.id}:${schedule.revision}` : 'create';
    if (key === loadedKey) return;
    loadedKey = key;
    validationError = null;
    if (!schedule) {
      const defaultTimezone = browserTimeZone();
      const defaultStart = toZonedDateTimeInput(new Date(Date.now() + 5 * 60_000), defaultTimezone);
      taskName = taskTypes[0]?.name ?? '';
      payloadText = '{}';
      triggerType = 'date';
      timezone = defaultTimezone;
      cronExpression = '0 8 * * 1';
      runAt = defaultStart;
      intervalSeconds = '3600';
      intervalStartAt = defaultStart;
      enabled = true;
      return;
    }

    taskName = schedule.task_name;
    payloadText = JSON.stringify(schedule.payload, null, 2);
    triggerType = schedule.trigger.type;
    timezone = schedule.trigger.timezone;
    cronExpression = typeof schedule.trigger.data.expression === 'string'
      ? schedule.trigger.data.expression
      : '0 8 * * 1';
    runAt = isoToZonedDateTimeInput(schedule.trigger.data.run_at, schedule.trigger.timezone);
    intervalSeconds = String(schedule.trigger.data.seconds ?? 3600);
    intervalStartAt = isoToZonedDateTimeInput(schedule.trigger.data.start_at, schedule.trigger.timezone);
    enabled = schedule.enabled;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    validationError = null;
    try {
      if (!taskName) throw new Error($t('schedules.taskRequired'));
      const payload = parsePayloadObject(payloadText);
      const trigger = buildScheduleTrigger({
        type: triggerType,
        timezone,
        cronExpression,
        runAt,
        intervalSeconds,
        intervalStartAt,
      });
      if (schedule) {
        await onSave({
          id: schedule.id,
          revision: schedule.revision,
          taskName,
          payload,
          trigger,
          enabled,
        });
      } else {
        await onSave({ taskName, payload, trigger, enabled });
      }
    } catch (error) {
      validationError = error instanceof ScheduleValidationError
        ? $t(`schedules.validation.${error.code}`)
        : formatUserFacingError(error);
    }
  }
</script>

<section class="schedule-editor" aria-labelledby="schedule-editor-title">
  <header>
    <div>
      <p class="editor-kicker">{$t('schedules.definition')}</p>
      <h2 id="schedule-editor-title">{formTitle}</h2>
    </div>
    <button type="button" class="icon-button" aria-label={$t('common.close')} onclick={onCancel}>
      <Icon name="close" size="19px" />
    </button>
  </header>

  {#if editingUnavailableTask}
    <div class="editor-warning" role="alert">
      <Icon name="warningAmber" size="19px" />
      <span>{$t('schedules.taskUnavailableEdit')}</span>
    </div>
  {/if}

  <form onsubmit={submit}>
    <label class="field-label" for="schedule-task">{$t('schedules.taskType')}</label>
    <select id="schedule-task" bind:value={taskName} disabled={busy || editingUnavailableTask}>
      {#if editingUnavailableTask}
        <option value={taskName}>{taskName}</option>
      {/if}
      {#each taskTypes as task (task.name)}
        <option value={task.name}>{task.name}</option>
      {/each}
    </select>

    {#if selectedTaskType}
      <div class="task-contract">
        <span>{$t('schedules.contractVersion', { values: { version: selectedTaskType.contract_version } })}</span>
        <span>{$t('schedules.maxAttempts', { values: { count: selectedTaskType.max_attempts } })}</span>
        <span>{selectedTaskType.required_permission}</span>
      </div>
    {/if}

    <div class="trigger-grid">
      <div>
        <label class="field-label" for="schedule-trigger">{$t('schedules.triggerType')}</label>
        <select id="schedule-trigger" bind:value={triggerType} disabled={busy}>
          <option value="date">{$t('schedules.trigger.date')}</option>
          <option value="cron">{$t('schedules.trigger.cron')}</option>
          <option value="interval">{$t('schedules.trigger.interval')}</option>
        </select>
      </div>
      <div>
        <label class="field-label" for="schedule-timezone">{$t('schedules.timezone')}</label>
        <input id="schedule-timezone" bind:value={timezone} disabled={busy} autocomplete="off" />
      </div>
    </div>

    {#if triggerType === 'cron'}
      <label class="field-label" for="schedule-cron">{$t('schedules.cronExpression')}</label>
      <input id="schedule-cron" bind:value={cronExpression} disabled={busy} placeholder="0 8 * * 1" />
      <p class="field-help">{$t('schedules.cronHelp')}</p>
    {:else if triggerType === 'date'}
      <label class="field-label" for="schedule-run-at">{$t('schedules.runAt')}</label>
      <input id="schedule-run-at" type="datetime-local" bind:value={runAt} disabled={busy} />
    {:else}
      <div class="trigger-grid">
        <div>
          <label class="field-label" for="schedule-interval">{$t('schedules.intervalSeconds')}</label>
          <input id="schedule-interval" type="number" min="1" step="1" bind:value={intervalSeconds} disabled={busy} />
        </div>
        <div>
          <label class="field-label" for="schedule-start-at">{$t('schedules.startAt')}</label>
          <input id="schedule-start-at" type="datetime-local" bind:value={intervalStartAt} disabled={busy} />
        </div>
      </div>
    {/if}

    <div class="payload-heading">
      <div>
        <label class="field-label" for="schedule-payload">{$t('schedules.payload')}</label>
        <p id="schedule-payload-help">{$t('schedules.payloadHelp')}</p>
      </div>
      {#if selectedTaskType}
        <details>
          <summary>{$t('schedules.viewSchema')}</summary>
          <pre>{JSON.stringify(selectedTaskType.payload_schema, null, 2)}</pre>
        </details>
      {/if}
    </div>
    <textarea
      id="schedule-payload"
      bind:value={payloadText}
      disabled={busy}
      rows="9"
      spellcheck="false"
      aria-describedby="schedule-payload-help"
    ></textarea>

    <div class="enabled-row">
      <div>
        <strong>{$t('schedules.enabled')}</strong>
        <span>{$t('schedules.enabledHelp')}</span>
      </div>
      <MdSwitch bind:checked={enabled} disabled={busy} ariaLabel={$t('schedules.enabled')} />
    </div>

    {#if validationError}
      <p class="validation-error" role="alert">{validationError}</p>
    {/if}

    <footer>
      <button type="button" class="secondary-button" disabled={busy} onclick={onCancel}>
        {$t('common.cancel')}
      </button>
      <button type="submit" class="primary-button" disabled={busy || editingUnavailableTask || !taskName}>
        {#if busy}<span class="button-spinner" aria-hidden="true"></span>{/if}
        {schedule ? $t('common.save') : $t('schedules.createAction')}
      </button>
    </footer>
  </form>
</section>

<style>
  .schedule-editor { min-height: 100%; background: var(--color-md3-surface-container); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--color-md3-outline); padding: 1rem 1.1rem 0.9rem; }
  h2, p { margin: 0; }
  h2 { margin-top: 0.15rem; color: var(--color-md3-on-surface); font-family: var(--font-md3-sans); font-size: 1rem; line-height: 1.25; }
  .editor-kicker { color: var(--color-md3-on-surface-variant); font-family: var(--font-md3-sans); font-size: 0.7rem; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; }
  .icon-button { display: grid; width: 40px; height: 40px; flex: none; place-items: center; border: 0; border-radius: 999px; padding: 0; background: transparent; color: var(--color-md3-on-surface-variant); cursor: pointer; }
  .icon-button:hover { background: var(--color-md3-surface-container-highest); color: var(--color-md3-on-surface); }
  form { display: grid; gap: 0.75rem; padding: 1rem 1.1rem 1.25rem; }
  .field-label { color: var(--color-md3-on-surface); font-family: var(--font-md3-sans); font-size: 0.75rem; font-weight: 650; }
  input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--color-md3-outline); border-radius: 8px; background: var(--color-md3-field); color: var(--color-md3-on-surface); font: 0.84rem/1.4 var(--font-md3-sans); }
  input, select { min-height: 42px; padding: 0 0.7rem; }
  textarea { min-height: 9rem; resize: vertical; padding: 0.7rem; font-family: var(--font-md3-mono); font-size: 0.78rem; }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--color-md3-primary); outline-offset: 1px; }
  input:disabled, select:disabled, textarea:disabled { cursor: not-allowed; opacity: 0.55; }
  .trigger-grid { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: 0.75rem; }
  .trigger-grid > div { display: grid; gap: 0.4rem; }
  .task-contract { display: flex; flex-wrap: wrap; gap: 0.35rem; color: var(--color-md3-on-surface-variant); font: 0.7rem var(--font-md3-sans); }
  .task-contract span { border-radius: 999px; padding: 0.25rem 0.45rem; background: var(--color-md3-surface-container-high); }
  .field-help, .payload-heading p { color: var(--color-md3-on-surface-variant); font: 0.75rem/1.45 var(--font-md3-sans); }
  .payload-heading { display: flex; align-items: end; justify-content: space-between; gap: 0.75rem; margin-top: 0.25rem; }
  .payload-heading > div { display: grid; gap: 0.2rem; }
  details { position: relative; color: var(--color-md3-on-surface-variant); font: 0.75rem var(--font-md3-sans); }
  summary { cursor: pointer; color: var(--color-md3-primary-emphasis); }
  details pre { position: absolute; right: 0; z-index: 5; width: min(430px, 75vw); max-height: 260px; overflow: auto; border: 1px solid var(--color-md3-outline); border-radius: 8px; padding: 0.7rem; background: var(--color-md3-surface-container-high); box-shadow: 0 12px 32px rgb(0 0 0 / 0.24); color: var(--color-md3-on-surface); font: 0.72rem/1.5 var(--font-md3-mono); white-space: pre-wrap; }
  .enabled-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-top: 1px solid var(--color-md3-outline); padding-top: 0.8rem; }
  .enabled-row > div { display: grid; gap: 0.15rem; }
  .enabled-row strong, .enabled-row span { font-family: var(--font-md3-sans); }
  .enabled-row strong { font-size: 0.8rem; }
  .enabled-row span { color: var(--color-md3-on-surface-variant); font-size: 0.72rem; }
  .editor-warning, .validation-error { color: var(--color-md3-on-error-container); background: var(--color-md3-error-container); }
  .editor-warning { display: flex; align-items: flex-start; gap: 0.5rem; margin: 0.8rem 1.1rem 0; border-radius: 8px; padding: 0.65rem 0.75rem; font: 0.78rem/1.45 var(--font-md3-sans); }
  .validation-error { border-radius: 8px; padding: 0.6rem 0.7rem; font: 0.78rem/1.45 var(--font-md3-sans); }
  footer { display: flex; justify-content: flex-end; gap: 0.55rem; padding-top: 0.25rem; }
  footer button { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; gap: 0.45rem; border-radius: 5px; padding: 0.35rem 0.85rem; font: 650 0.76rem var(--font-md3-sans); cursor: pointer; }
  footer button:disabled { cursor: not-allowed; opacity: 0.5; }
  .secondary-button { border: 1px solid var(--color-md3-outline); background: transparent; color: var(--color-md3-on-surface); }
  .primary-button { border: 1px solid var(--color-md3-primary); background: var(--color-md3-primary); color: var(--color-md3-on-primary); }
  .button-spinner { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 999px; animation: editor-spin 700ms linear infinite; }
  @keyframes editor-spin { to { transform: rotate(360deg); } }
  @media (max-width: 520px) { .trigger-grid { grid-template-columns: 1fr; } }
  @media (pointer: coarse) { .icon-button, footer button { min-width: 44px; min-height: 44px; } }
  @media (prefers-reduced-motion: reduce) { .button-spinner { animation-duration: 1.4s; } }
</style>
