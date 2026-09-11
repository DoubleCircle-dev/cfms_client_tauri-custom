<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { JsonValue } from '$lib/api';
  import {
    issueMatchesPath,
    jsonPointer,
    parsePayloadSource,
    preparePayloadSchema,
    validatePayloadAgainstSchema,
    valueCanRender,
    type PayloadValidationIssue,
    type VisualSchemaNode,
  } from '$lib/schedule-schema';
  import Icon from './Icon.svelte';
  import JsonCodeEditor, { type JsonEditorDiagnostic } from './JsonCodeEditor.svelte';

  interface Props {
    schema: Record<string, JsonValue>;
    value: Record<string, JsonValue>;
    valid?: boolean;
    disabled?: boolean;
    onChange: (value: Record<string, JsonValue>) => void;
  }

  let {
    schema,
    value = $bindable(),
    valid = $bindable(false),
    disabled = false,
    onChange,
  }: Props = $props();

  const prepared = $derived(preparePayloadSchema(schema));
  let mode = $state<'form' | 'source'>('form');
  let sourceText = $state(JSON.stringify(value, null, 2));
  let sourceError = $state<string | null>(null);
  let modeInitialized = false;
  let formTab: HTMLButtonElement;
  let sourceTab: HTMLButtonElement;

  const validation = $derived(validatePayloadAgainstSchema(schema, value));
  const formAvailable = $derived(
    prepared.renderable
      && prepared.root !== null
      && sourceError === null
      && valueCanRender(prepared.root, value),
  );
  const editorDiagnostics = $derived<JsonEditorDiagnostic[]>(
    validation.issues.map((issue) => ({
      path: issue.instancePath,
      message: `${$t('schedules.payloadContractError')} ${issue.keyword}`,
    })),
  );

  $effect(() => {
    valid = sourceError === null && (!validation.available || validation.valid);
  });

  $effect(() => {
    if (modeInitialized) return;
    mode = prepared.renderable ? 'form' : 'source';
    modeInitialized = true;
  });

  function cloneValue<T extends JsonValue>(input: T): T {
    return JSON.parse(JSON.stringify(input)) as T;
  }

  function ownValue(container: Record<string, JsonValue>, key: string): JsonValue | undefined {
    return Object.hasOwn(container, key) ? container[key] : undefined;
  }

  function valueAt(path: Array<string | number>): JsonValue | undefined {
    let current: JsonValue = value;
    for (const part of path) {
      if (typeof part === 'number') {
        if (!Array.isArray(current) || part >= current.length) return undefined;
        current = current[part];
      } else {
        if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
        const next = ownValue(current, part);
        if (next === undefined) return undefined;
        current = next;
      }
    }
    return current;
  }

  function writeOwn(container: Record<string, JsonValue>, key: string, next: JsonValue) {
    Object.defineProperty(container, key, {
      value: next,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  function updateDraft(mutator: (draft: Record<string, JsonValue>) => void) {
    const next = cloneValue(value);
    mutator(next);
    value = next;
    sourceText = JSON.stringify(next, null, 2);
    sourceError = null;
    onChange(next);
  }

  function parentAt(
    root: Record<string, JsonValue>,
    path: Array<string | number>,
  ): { parent: Record<string, JsonValue> | JsonValue[]; key: string | number } | null {
    if (path.length === 0) return null;
    let current: Record<string, JsonValue> | JsonValue[] = root;
    for (let index = 0; index < path.length - 1; index += 1) {
      const part = path[index];
      const nextPart = path[index + 1];
      if (typeof part === 'number') {
        if (!Array.isArray(current)) return null;
        if (current[part] === undefined || current[part] === null) {
          current[part] = typeof nextPart === 'number' ? [] : {};
        }
        const next: JsonValue = current[part];
        if (typeof next !== 'object' || next === null) return null;
        current = next;
      } else {
        if (Array.isArray(current)) return null;
        let next = ownValue(current, part);
        if (next === undefined || next === null) {
          next = typeof nextPart === 'number' ? [] : {};
          writeOwn(current, part, next);
        }
        if (typeof next !== 'object' || next === null) return null;
        current = next;
      }
    }
    return { parent: current, key: path.at(-1)! };
  }

  function setValue(path: Array<string | number>, nextValue: JsonValue) {
    updateDraft((draft) => {
      const target = parentAt(draft, path);
      if (!target) return;
      if (typeof target.key === 'number') {
        if (Array.isArray(target.parent)) target.parent[target.key] = nextValue;
      } else if (!Array.isArray(target.parent)) {
        writeOwn(target.parent, target.key, nextValue);
      }
    });
  }

  function removeValue(path: Array<string | number>) {
    updateDraft((draft) => {
      const target = parentAt(draft, path);
      if (!target) return;
      if (typeof target.key === 'number') {
        if (Array.isArray(target.parent)) target.parent.splice(target.key, 1);
      } else if (!Array.isArray(target.parent)) {
        delete target.parent[target.key];
      }
    });
  }

  function starterValue(node: VisualSchemaNode): JsonValue {
    if (node.defaultValue !== undefined) return cloneValue(node.defaultValue);
    if (node.constValue !== undefined) return cloneValue(node.constValue);
    if (node.enumValues?.length) return cloneValue(node.enumValues[0]);
    if (node.kind === 'object') {
      const result: Record<string, JsonValue> = {};
      for (const property of node.properties ?? []) {
        if (property.node.defaultValue !== undefined || property.node.constValue !== undefined) {
          writeOwn(result, property.key, starterValue(property.node));
        }
      }
      return result;
    }
    if (node.kind === 'array') return [];
    if (node.kind === 'boolean') return false;
    if (node.kind === 'integer' || node.kind === 'number') return 0;
    return '';
  }

  function addArrayItem(path: Array<string | number>, node: VisualSchemaNode) {
    const current = valueAt(path);
    const items = Array.isArray(current) ? [...current] : [];
    items.push(starterValue(node));
    setValue(path, items);
  }

  function moveArrayItem(path: Array<string | number>, index: number, offset: number) {
    const current = valueAt(path);
    if (!Array.isArray(current)) return;
    const target = index + offset;
    if (target < 0 || target >= current.length) return;
    const items = [...current];
    [items[index], items[target]] = [items[target], items[index]];
    setValue(path, items);
  }

  function issuesAt(path: Array<string | number>, includeChildren = false): PayloadValidationIssue[] {
    const pointer = jsonPointer(path);
    return validation.issues.filter((issue) => includeChildren
      ? issueMatchesPath(issue.instancePath, pointer)
      : issue.instancePath === pointer);
  }

  function constraintSummary(node: VisualSchemaNode): string {
    const constraints: string[] = [];
    if (node.minLength !== undefined) constraints.push($t('schedules.payloadMinLength', { values: { count: node.minLength } }));
    if (node.maxLength !== undefined) constraints.push($t('schedules.payloadMaxLength', { values: { count: node.maxLength } }));
    if (node.minimum !== undefined) constraints.push(`≥ ${node.minimum}`);
    if (node.exclusiveMinimum !== undefined) constraints.push(`> ${node.exclusiveMinimum}`);
    if (node.maximum !== undefined) constraints.push(`≤ ${node.maximum}`);
    if (node.exclusiveMaximum !== undefined) constraints.push(`< ${node.exclusiveMaximum}`);
    if (node.multipleOf !== undefined) constraints.push($t('schedules.payloadMultipleOf', { values: { value: node.multipleOf } }));
    if (node.minItems !== undefined) constraints.push($t('schedules.payloadMinItems', { values: { count: node.minItems } }));
    if (node.maxItems !== undefined) constraints.push($t('schedules.payloadMaxItems', { values: { count: node.maxItems } }));
    return constraints.join(' · ');
  }

  function changeSource(nextSource: string) {
    sourceText = nextSource;
    try {
      const parsed = parsePayloadSource(nextSource);
      sourceError = null;
      value = parsed;
      onChange(parsed);
    } catch (error) {
      sourceError = error instanceof SyntaxError
        ? $t('schedules.payloadJsonError')
        : $t('schedules.payloadObjectError');
    }
  }

  function formatSource() {
    try {
      const parsed = parsePayloadSource(sourceText);
      sourceText = JSON.stringify(parsed, null, 2);
      sourceError = null;
      value = parsed;
      onChange(parsed);
    } catch {
      sourceError ??= $t('schedules.payloadJsonError');
    }
  }

  function selectMode(nextMode: 'form' | 'source') {
    if (nextMode === 'form' && !formAvailable) return;
    mode = nextMode;
  }

  function navigateTabs(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (mode === 'form') {
      selectMode('source');
      sourceTab.focus();
    } else if (formAvailable) {
      selectMode('form');
      formTab.focus();
    }
  }

  function displayLabel(node: VisualSchemaNode, fallback: string): string {
    return node.title?.trim() || fallback;
  }

  function inputMinimum(node: VisualSchemaNode): number | undefined {
    if (node.minimum !== undefined) return node.minimum;
    return node.kind === 'integer' && node.exclusiveMinimum !== undefined
      ? node.exclusiveMinimum + 1
      : undefined;
  }

  function inputMaximum(node: VisualSchemaNode): number | undefined {
    if (node.maximum !== undefined) return node.maximum;
    return node.kind === 'integer' && node.exclusiveMaximum !== undefined
      ? node.exclusiveMaximum - 1
      : undefined;
  }
</script>

<div class="payload-editor">
  <div class="mode-bar">
    <div class="mode-tabs" role="tablist" aria-label={$t('schedules.payloadEditorMode')}>
      <button
        bind:this={formTab}
        type="button"
        role="tab"
        aria-selected={mode === 'form'}
        aria-controls="schedule-payload-form"
        disabled={!formAvailable || disabled}
        onkeydown={navigateTabs}
        onclick={() => selectMode('form')}
      >
        <Icon name="edit" size="16px" />{$t('schedules.payloadFormMode')}
      </button>
      <button
        bind:this={sourceTab}
        type="button"
        role="tab"
        aria-selected={mode === 'source'}
        aria-controls="schedule-payload-source"
        disabled={disabled}
        onkeydown={navigateTabs}
        onclick={() => selectMode('source')}
      >
        <Icon name="code" size="16px" />{$t('schedules.payloadSourceMode')}
      </button>
    </div>
    <span class:valid={valid} class:error={!valid} class="validation-state" aria-live="polite">
      <Icon name={valid ? 'checkCircle' : 'errorFilled'} size="15px" />
      {valid ? $t('schedules.payloadValid') : $t('schedules.payloadInvalid')}
    </span>
  </div>

  {#if !prepared.renderable}
    <div class="editor-notice" role="status">
      <Icon name="code" size="18px" />
      <span>{$t('schedules.payloadSourceFallback', { values: { keyword: prepared.unsupportedKeyword ?? 'schema' } })}</span>
    </div>
  {:else if prepared.root && !valueCanRender(prepared.root, value)}
    <div class="editor-notice" role="status">
      <Icon name="warningAmber" size="18px" />
      <span>{$t('schedules.payloadFormTypeMismatch')}</span>
    </div>
  {/if}

  {#if mode === 'form' && prepared.root}
    <div id="schedule-payload-form" role="tabpanel" class="schema-form">
      {#if (prepared.root.properties?.length ?? 0) === 0}
        <div class="empty-payload">
          <Icon name="checkCircle" size="20px" />
          <span>{$t('schedules.payloadEmptyContract')}</span>
        </div>
      {:else}
        {#each prepared.root.properties ?? [] as property (property.key)}
          {@render field(property.node, [property.key], property.key, property.required)}
        {/each}
      {/if}
      {#if prepared.root.additionalProperties}
        <p class="additional-properties-note">{$t('schedules.payloadAdditionalProperties')}</p>
      {/if}
    </div>
  {:else}
    <div id="schedule-payload-source" role="tabpanel" class="source-panel">
      <div class="source-toolbar">
        <span>{$t('schedules.payloadSourceHelp')}</span>
        <button type="button" disabled={disabled || sourceError !== null} onclick={formatSource}>
          <Icon name="formatListBulleted" size="16px" />{$t('schedules.formatJson')}
        </button>
      </div>
      <JsonCodeEditor
        value={sourceText}
        diagnostics={sourceError ? [] : editorDiagnostics}
        {disabled}
        ariaLabel={$t('schedules.payload')}
        loadingLabel={$t('schedules.payloadEditorLoading')}
        onChange={changeSource}
      />
      {#if sourceError}
        <p class="source-error" role="alert">{sourceError}</p>
      {:else if validation.available && validation.issues.length > 0}
        <ul class="source-errors" aria-label={$t('schedules.payloadErrors')}>
          {#each validation.issues.slice(0, 6) as issue}
            <li><code>{issue.instancePath || '/'}</code> {$t('schedules.payloadContractError')} <code>{issue.keyword}</code></li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

{#snippet field(node: VisualSchemaNode, path: Array<string | number>, fallbackLabel: string, required: boolean)}
  {@const current = valueAt(path)}
  {@const pointer = jsonPointer(path)}
  {@const fieldIssues = issuesAt(path)}
  {@const summary = constraintSummary(node)}
  <div class="schema-field" class:field-error={fieldIssues.length > 0}>
    <div class="field-heading">
      <div>
        {#if node.kind === 'object' || node.kind === 'array'}
          <span class="field-title">
            <span>{displayLabel(node, fallbackLabel)}</span>
            {#if required}<span class="required-mark" aria-label={$t('schedules.payloadRequired')}>*</span>{/if}
          </span>
        {:else}
          <label for={`payload-field-${pointer}`}>
            <span>{displayLabel(node, fallbackLabel)}</span>
            {#if required}<span class="required-mark" aria-label={$t('schedules.payloadRequired')}>*</span>{/if}
          </label>
        {/if}
        {#if node.title && node.title !== fallbackLabel}<code>{fallbackLabel}</code>{/if}
      </div>
      {#if !required && current === undefined}
        <button type="button" class="field-action" disabled={disabled} onclick={() => setValue(path, starterValue(node))}>
          <Icon name="add" size="15px" />{$t('schedules.payloadAddField')}
        </button>
      {:else}
        <div class="field-actions">
          {#if node.nullable}
            <button
              type="button"
              class="field-action"
              disabled={disabled}
              onclick={() => setValue(path, current === null ? starterValue(node) : null)}
            >
              {current === null ? $t('schedules.payloadUseValue') : $t('schedules.payloadSetNull')}
            </button>
          {/if}
          {#if !required}
            <button type="button" class="field-action" disabled={disabled} onclick={() => removeValue(path)}>
              {$t('schedules.payloadRemoveField')}
            </button>
          {/if}
        </div>
      {/if}
    </div>

    {#if node.description}<p class="schema-description">{node.description}</p>{/if}
    {#if summary}<p class="constraint-summary">{summary}</p>{/if}

    {#if current !== undefined && current !== null}
      {#if node.constValue !== undefined}
        <output class="constant-value"><code>{JSON.stringify(node.constValue)}</code></output>
      {:else if node.enumValues}
        <select
          id={`payload-field-${pointer}`}
          value={JSON.stringify(current)}
          disabled={disabled}
          aria-invalid={fieldIssues.length > 0}
          aria-describedby={fieldIssues.length > 0 ? `payload-errors-${pointer}` : undefined}
          onchange={(event) => setValue(path, JSON.parse(event.currentTarget.value) as JsonValue)}
        >
          {#each node.enumValues as option}
            <option value={JSON.stringify(option)}>{option === null ? $t('schedules.payloadNull') : String(option)}</option>
          {/each}
        </select>
      {:else if node.kind === 'string'}
        {#if (node.maxLength ?? 0) > 240}
          <textarea
            id={`payload-field-${pointer}`}
            value={String(current)}
            maxlength={node.maxLength}
            minlength={node.minLength}
            disabled={disabled}
            aria-invalid={fieldIssues.length > 0}
            aria-describedby={fieldIssues.length > 0 ? `payload-errors-${pointer}` : undefined}
            oninput={(event) => setValue(path, event.currentTarget.value)}
          ></textarea>
        {:else}
          <input
            id={`payload-field-${pointer}`}
            type={node.format === 'email' ? 'email' : node.format === 'uri' ? 'url' : 'text'}
            value={String(current)}
            maxlength={node.maxLength}
            minlength={node.minLength}
            disabled={disabled}
            aria-invalid={fieldIssues.length > 0}
            aria-describedby={fieldIssues.length > 0 ? `payload-errors-${pointer}` : undefined}
            oninput={(event) => setValue(path, event.currentTarget.value)}
          />
        {/if}
      {:else if node.kind === 'integer' || node.kind === 'number'}
        <input
          id={`payload-field-${pointer}`}
          type="number"
          value={String(current)}
          min={inputMinimum(node)}
          max={inputMaximum(node)}
          step={node.kind === 'integer' ? Math.max(1, node.multipleOf ?? 1) : node.multipleOf ?? 'any'}
          disabled={disabled}
          aria-invalid={fieldIssues.length > 0}
          aria-describedby={fieldIssues.length > 0 ? `payload-errors-${pointer}` : undefined}
          oninput={(event) => {
            if (event.currentTarget.value === '') removeValue(path);
            else if (Number.isFinite(event.currentTarget.valueAsNumber)) setValue(path, event.currentTarget.valueAsNumber);
          }}
        />
      {:else if node.kind === 'boolean'}
        <select
          id={`payload-field-${pointer}`}
          value={String(current)}
          disabled={disabled}
          aria-invalid={fieldIssues.length > 0}
          aria-describedby={fieldIssues.length > 0 ? `payload-errors-${pointer}` : undefined}
          onchange={(event) => setValue(path, event.currentTarget.value === 'true')}
        >
          <option value="true">{$t('common.yes')}</option>
          <option value="false">{$t('common.no')}</option>
        </select>
      {:else if node.kind === 'object'}
        <fieldset class="nested-object">
          <legend>{displayLabel(node, fallbackLabel)}</legend>
          {#each node.properties ?? [] as property (property.key)}
            {@render field(property.node, [...path, property.key], property.key, property.required)}
          {/each}
          {#if node.additionalProperties}
            <p class="additional-properties-note">{$t('schedules.payloadAdditionalProperties')}</p>
          {/if}
        </fieldset>
      {:else if node.kind === 'array' && node.items}
        <div class="array-editor">
          {#each Array.isArray(current) ? current : [] as _item, index (index)}
            <div class="array-item">
              <div class="array-item-bar">
                <strong>{$t('schedules.payloadItem', { values: { index: index + 1 } })}</strong>
                <div>
                  <button type="button" aria-label={$t('schedules.payloadMoveUp')} disabled={disabled || index === 0} onclick={() => moveArrayItem(path, index, -1)}><Icon name="arrowUpward" size="16px" /></button>
                  <button type="button" aria-label={$t('schedules.payloadMoveDown')} disabled={disabled || index === (current as JsonValue[]).length - 1} onclick={() => moveArrayItem(path, index, 1)}><Icon name="arrowDownward" size="16px" /></button>
                  <button type="button" aria-label={$t('schedules.payloadRemoveItem')} disabled={disabled} onclick={() => removeValue([...path, index])}><Icon name="delete" size="16px" /></button>
                </div>
              </div>
              {@render field(node.items, [...path, index], $t('schedules.payloadItemValue'), true)}
            </div>
          {/each}
          <button
            type="button"
            class="add-item"
            disabled={disabled || (node.maxItems !== undefined && Array.isArray(current) && current.length >= node.maxItems)}
            onclick={() => addArrayItem(path, node.items!)}
          ><Icon name="add" size="16px" />{$t('schedules.payloadAddItem')}</button>
        </div>
      {/if}
    {:else if current === null}
      <div class="null-value"><code>null</code><span>{$t('schedules.payloadNullHelp')}</span></div>
    {:else if required}
      {#if node.enumValues}
        <select
          id={`payload-field-${pointer}`}
          value=""
          disabled={disabled}
          aria-invalid="true"
          aria-describedby={fieldIssues.length > 0 ? `payload-errors-${pointer}` : undefined}
          onchange={(event) => event.currentTarget.value && setValue(path, JSON.parse(event.currentTarget.value) as JsonValue)}
        >
          <option value="">{$t('schedules.payloadChooseValue')}</option>
          {#each node.enumValues as option}
            <option value={JSON.stringify(option)}>{option === null ? $t('schedules.payloadNull') : String(option)}</option>
          {/each}
        </select>
      {:else if node.kind === 'boolean'}
        <select id={`payload-field-${pointer}`} value="" disabled={disabled} aria-invalid="true" aria-describedby={fieldIssues.length > 0 ? `payload-errors-${pointer}` : undefined} onchange={(event) => event.currentTarget.value && setValue(path, event.currentTarget.value === 'true')}>
          <option value="">{$t('schedules.payloadChooseValue')}</option>
          <option value="true">{$t('common.yes')}</option>
          <option value="false">{$t('common.no')}</option>
        </select>
      {:else if node.kind === 'object'}
        <button type="button" class="initialize-field" disabled={disabled} onclick={() => setValue(path, starterValue(node))}>{$t('schedules.payloadInitializeObject')}</button>
      {:else if node.kind === 'array'}
        <button type="button" class="initialize-field" disabled={disabled} onclick={() => setValue(path, [])}>{$t('schedules.payloadInitializeArray')}</button>
      {:else}
        <input
          id={`payload-field-${pointer}`}
          type={node.kind === 'integer' || node.kind === 'number' ? 'number' : 'text'}
          value=""
          min={node.kind === 'integer' || node.kind === 'number' ? inputMinimum(node) : undefined}
          max={node.kind === 'integer' || node.kind === 'number' ? inputMaximum(node) : undefined}
          step={node.kind === 'integer' ? Math.max(1, node.multipleOf ?? 1) : node.kind === 'number' ? node.multipleOf ?? 'any' : undefined}
          disabled={disabled}
          aria-invalid="true"
          aria-describedby={fieldIssues.length > 0 ? `payload-errors-${pointer}` : undefined}
          oninput={(event) => {
            if (!event.currentTarget.value) return;
            setValue(path, node.kind === 'integer' || node.kind === 'number' ? event.currentTarget.valueAsNumber : event.currentTarget.value);
          }}
        />
      {/if}
    {/if}

    {#if fieldIssues.length > 0}
      <ul class="field-errors" id={`payload-errors-${pointer}`}>
        {#each fieldIssues as issue}
          <li>{$t('schedules.payloadContractError')} <code>{issue.keyword}</code></li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

<style>
  .payload-editor { display: grid; gap: 0.65rem; }
  .mode-bar, .mode-tabs, .validation-state, .field-heading, .field-heading > div, .field-actions, .source-toolbar, .source-toolbar button, .editor-notice, .array-item-bar, .array-item-bar > div, .add-item, .null-value { display: flex; align-items: center; }
  .mode-bar { justify-content: space-between; gap: 0.75rem; }
  .mode-tabs { gap: 0.2rem; border-bottom: 1px solid var(--color-md3-outline); }
  .mode-tabs button { display: inline-flex; min-height: 36px; align-items: center; gap: 0.35rem; border: 0; border-bottom: 2px solid transparent; padding: 0.35rem 0.55rem; background: transparent; color: var(--color-md3-on-surface-variant); font: 650 0.74rem var(--font-md3-sans); cursor: pointer; }
  .mode-tabs button[aria-selected="true"] { border-bottom-color: var(--color-md3-primary); color: var(--color-md3-primary-emphasis); }
  .mode-tabs button:disabled { cursor: not-allowed; opacity: 0.45; }
  .validation-state { flex: none; gap: 0.3rem; font: 650 0.68rem var(--font-md3-sans); }
  .validation-state.valid { color: var(--color-md3-success); }
  .validation-state.error { color: var(--color-md3-error); }
  .editor-notice { align-items: flex-start; gap: 0.45rem; border-radius: 8px; padding: 0.55rem 0.65rem; background: var(--color-md3-surface-container-high); color: var(--color-md3-on-surface-variant); font: 0.72rem/1.45 var(--font-md3-sans); }
  .schema-form { display: grid; gap: 0.8rem; }
  .schema-field { display: grid; gap: 0.38rem; min-width: 0; }
  .schema-field.field-error > .field-heading label, .schema-field.field-error > .field-heading .field-title { color: var(--color-md3-error); }
  .field-heading { min-height: 26px; justify-content: space-between; gap: 0.55rem; }
  .field-heading > div { min-width: 0; gap: 0.42rem; flex-wrap: wrap; }
  .field-heading label, .field-title { color: var(--color-md3-on-surface); font: 650 0.75rem var(--font-md3-sans); }
  .field-heading code { color: var(--color-md3-on-surface-variant); font: 0.68rem var(--font-md3-mono); }
  .required-mark { margin-left: 0.18rem; color: var(--color-md3-error); }
  .field-actions { gap: 0.2rem; }
  .field-action, .initialize-field, .source-toolbar button, .add-item, .array-item-bar button { border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--color-md3-primary-emphasis); font: 650 0.69rem var(--font-md3-sans); cursor: pointer; }
  .field-action { display: inline-flex; min-height: 28px; align-items: center; gap: 0.25rem; padding: 0.2rem 0.35rem; }
  .field-action:hover:not(:disabled), .source-toolbar button:hover:not(:disabled), .add-item:hover:not(:disabled), .array-item-bar button:hover:not(:disabled) { background: var(--color-md3-surface-container-highest); }
  button:disabled { cursor: not-allowed; opacity: 0.48; }
  input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--color-md3-outline); border-radius: 8px; background: var(--color-md3-field); color: var(--color-md3-on-surface); font: 0.82rem/1.4 var(--font-md3-sans); }
  input, select { min-height: 40px; padding: 0 0.65rem; }
  textarea { min-height: 6.5rem; resize: vertical; padding: 0.65rem; }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--color-md3-primary); outline-offset: 1px; }
  input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"] { border-color: var(--color-md3-error); }
  .schema-description, .constraint-summary, .additional-properties-note { margin: 0; color: var(--color-md3-on-surface-variant); font: 0.7rem/1.45 var(--font-md3-sans); }
  .constraint-summary { font-family: var(--font-md3-mono); }
  .nested-object { display: grid; gap: 0.75rem; min-width: 0; margin: 0; border: 1px solid var(--color-md3-outline); border-radius: 8px; padding: 0.75rem; }
  .nested-object legend { padding: 0 0.3rem; color: var(--color-md3-on-surface-variant); font: 650 0.68rem var(--font-md3-sans); }
  .constant-value, .null-value, .empty-payload { border-radius: 8px; padding: 0.65rem; background: var(--color-md3-surface-container-high); }
  .constant-value { color: var(--color-md3-on-surface); }
  .null-value { gap: 0.55rem; color: var(--color-md3-on-surface-variant); font: 0.72rem var(--font-md3-sans); }
  .null-value code, .constant-value code { font-family: var(--font-md3-mono); }
  .array-editor { display: grid; gap: 0.55rem; }
  .array-item { display: grid; gap: 0.55rem; border-top: 1px solid var(--color-md3-outline); padding-top: 0.55rem; }
  .array-item-bar { justify-content: space-between; gap: 0.5rem; color: var(--color-md3-on-surface-variant); font: 650 0.69rem var(--font-md3-sans); }
  .array-item-bar > div { gap: 0.1rem; }
  .array-item-bar button { display: grid; width: 30px; height: 30px; place-items: center; padding: 0; border-radius: 999px; }
  .add-item, .initialize-field { min-height: 36px; justify-content: center; gap: 0.35rem; border-color: var(--color-md3-outline); padding: 0.35rem 0.6rem; }
  .source-panel { display: grid; gap: 0.55rem; }
  .source-toolbar { min-height: 32px; justify-content: space-between; gap: 0.75rem; color: var(--color-md3-on-surface-variant); font: 0.7rem/1.4 var(--font-md3-sans); }
  .source-toolbar button { min-height: 30px; flex: none; gap: 0.3rem; padding: 0.25rem 0.45rem; }
  .source-error, .source-errors, .field-errors { margin: 0; color: var(--color-md3-error); font: 0.7rem/1.45 var(--font-md3-sans); }
  .source-errors, .field-errors { padding-left: 1.1rem; }
  .source-errors code, .field-errors code { font-family: var(--font-md3-mono); }
  .empty-payload { display: flex; align-items: center; gap: 0.5rem; color: var(--color-md3-on-surface-variant); font: 0.74rem var(--font-md3-sans); }
  @media (pointer: coarse) {
    .mode-tabs button, .field-action, .source-toolbar button, .add-item, .initialize-field { min-height: 44px; }
    .array-item-bar button { width: 44px; height: 44px; }
  }
</style>
