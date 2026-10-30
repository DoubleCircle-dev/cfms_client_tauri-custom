<script lang="ts">
  import MdOutlinedField from '$lib/components/MdOutlinedField.svelte';
  import FluentButton from '$lib/components/FluentButton.svelte';
  import { onMount } from 'svelte';
  import {
    readExtensionPage,
    type DeclarativeAction,
    type DeclarativeBlock,
    type DeclarativePage,
  } from '$lib/api/extensions';
  import { runExtensionWorkflow } from '$lib/extension-workflows';
  import { createExtensionStylesheet } from '$lib/extensions/styles';
  import { notificationStore } from '$lib/stores.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let { extensionId, pageId }: { extensionId: string; pageId: string } = $props();
  const formId = $props.id();
  const styleScope = `extension-${formId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  let page = $state<DeclarativePage | null>(null);
  let pageStylesheet = $state('');
  let selectedTabs = $state<Record<string, string>>({});
  let results = $state<Record<string, string>>({});
  let resultErrors = $state<Record<string, string>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);
  let runningAction = $state<string | null>(null);
  let formValues = $state<Record<string, Record<string, unknown>>>({});
  let tabGroup = $derived(
    page?.blocks.find((block): block is Extract<DeclarativeBlock, { type: 'tabs' }> => block.type === 'tabs'),
  );
  let activeTab = $derived(
    tabGroup
      ? selectedTabs[tabGroup.id] ?? tabGroup.default_tab ?? tabGroup.tabs[0]?.id ?? ''
      : '',
  );

  onMount(load);

  $effect(() => {
    if (!pageStylesheet) return;
    const styleElement = document.createElement('style');
    styleElement.dataset.extensionStyleScope = styleScope;
    styleElement.textContent = pageStylesheet;
    document.head.append(styleElement);
    return () => styleElement.remove();
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const nextPage = await readExtensionPage(extensionId, pageId);
      if (nextPage.schema_version !== 1 || !Array.isArray(nextPage.blocks)) {
        throw new Error('Unsupported extension page schema');
      }
      pageStylesheet = createExtensionStylesheet(nextPage, styleScope);
      page = nextPage;
      selectedTabs = Object.fromEntries(
        nextPage.blocks
          .filter((block): block is Extract<DeclarativeBlock, { type: 'tabs' }> => block.type === 'tabs')
          .map((block) => [block.id, block.default_tab ?? block.tabs[0]?.id ?? '']),
      );
      results = {};
      resultErrors = {};
      const values: Record<string, Record<string, unknown>> = {};
      for (const block of nextPage.blocks) {
        if (block.type !== 'form') continue;
        values[block.id] = Object.fromEntries(block.fields.map((field) => [field.id, field.default ?? (field.type === 'toggle' ? false : '')]));
      }
      formValues = values;
    } catch (cause) {
      page = null;
      pageStylesheet = '';
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function updateField(formId: string, fieldId: string, value: unknown) {
    formValues = {
      ...formValues,
      [formId]: { ...(formValues[formId] ?? {}), [fieldId]: value },
    };
  }

  function isBlockVisible(block: DeclarativeBlock): boolean {
    return !block.tab || selectedTabs[block.tab.group] === block.tab.id;
  }

  function tabButtonId(groupId: string, tabId: string): string {
    const safeGroup = groupId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const safeTab = tabId.replace(/[^a-zA-Z0-9_-]/g, '-');
    return `${formId}-tab-${safeGroup}-${safeTab}`;
  }

  function handleTabKeydown(event: KeyboardEvent, group: Extract<DeclarativeBlock, { type: 'tabs' }>) {
    const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const currentIndex = buttons.indexOf(event.target as HTMLButtonElement);
    if (currentIndex < 0 || buttons.length === 0) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = buttons.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectedTabs = { ...selectedTabs, [group.id]: group.tabs[nextIndex].id };
    buttons[nextIndex].focus();
  }

  function applyWorkflowValues(value: unknown) {
    if (!page || !isRecord(value)) return;
    for (const block of page.blocks) {
      if (block.type !== 'form') continue;
      const updates = value[block.id];
      if (!isRecord(updates)) continue;
      for (const field of block.fields) {
        if (!Object.hasOwn(updates, field.id)) continue;
        const nextValue = updates[field.id];
        const valid = field.type === 'toggle'
          ? typeof nextValue === 'boolean'
          : field.type === 'number'
            ? (typeof nextValue === 'string'
              && (nextValue === '' || Number.isFinite(Number(nextValue))))
              || (typeof nextValue === 'number' && Number.isFinite(nextValue))
            : field.type === 'select'
              ? typeof nextValue === 'string' && (field.options ?? []).includes(nextValue)
              : field.type === 'digit'
                ? typeof nextValue === 'string' && /^\d?$/.test(nextValue)
                : typeof nextValue === 'string';
        if (valid) updateField(block.id, field.id, nextValue);
      }
    }
  }

  function clearAction(action: Extract<DeclarativeAction, { kind: 'clear' }>) {
    const form = page?.blocks.find(
      (block): block is Extract<DeclarativeBlock, { type: 'form' }> =>
        block.type === 'form' && block.id === action.form_id,
    );
    if (!form) {
      notificationStore.error(`Form ${action.form_id} is not available`);
      return;
    }
    const values = { ...(formValues[form.id] ?? {}) };
    for (const fieldId of action.field_ids) {
      const field = form.fields.find((candidate) => candidate.id === fieldId);
      if (field) values[fieldId] = field.type === 'toggle' ? false : '';
    }
    formValues = { ...formValues, [form.id]: values };
    if (action.result_id) {
      const nextResults = { ...results };
      const nextErrors = { ...resultErrors };
      delete nextResults[action.result_id];
      delete nextErrors[action.result_id];
      results = nextResults;
      resultErrors = nextErrors;
    }
  }

  async function copyResult(resultId: string) {
    const text = results[resultId];
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (cause) {
      notificationStore.error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function runAction(action: DeclarativeAction) {
    if (action.kind === 'clear') {
      clearAction(action);
      return;
    }
    if (runningAction) return;
    runningAction = action.id;
    try {
      const result = await runExtensionWorkflow(extensionId, action.workflow, {
        input: { formValues, actionId: action.id },
      });
      if (action.result_id && typeof result === 'object' && result !== null && !Array.isArray(result)) {
        const output = result as Record<string, unknown>;
        if (output.ok === true) {
          resultErrors = { ...resultErrors, [action.result_id]: '' };
          if (typeof output.output === 'string') {
            results = { ...results, [action.result_id]: output.output };
          } else {
            const nextResults = { ...results };
            delete nextResults[action.result_id];
            results = nextResults;
          }
          applyWorkflowValues(output.form_values);
        } else if (typeof output.error === 'string') {
          resultErrors = { ...resultErrors, [action.result_id]: output.error };
        }
      }
    } catch (cause) {
      notificationStore.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      runningAction = null;
    }
  }

  function inputValue(
    field: Extract<DeclarativeBlock, { type: 'form' }>['fields'][number],
    event: Event,
  ): unknown {
    const input = event.currentTarget as HTMLInputElement;
    if (field.type !== 'number') return input.value;
    return input.value === '' ? '' : input.valueAsNumber;
  }

  function cellValue(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    if (value === null || value === undefined) return '—';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  function blockClass(block: DeclarativeBlock, base: string): string {
    return ['extension-block', `extension-block--${block.type}`, base, block.class_name]
      .filter(Boolean)
      .join(' ');
  }

  function fieldClass(className?: string): string {
    return ['extension-form-field', className].filter(Boolean).join(' ');
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
</script>

{#if loading}
  <div class="extension-state"><ProgressRing size={28} label="Loading extension" /></div>
{:else if error}
  <div class="extension-state extension-error" role="alert">
    <strong>Unable to open extension</strong><p>{error}</p>
    <FluentButton data-fluent-owner="lib-components-extension-page-renderer"
      type="button"
      onclick={load}
      appearance="subtle"
    >Try again</FluentButton>
  </div>
{:else if page}
  <article class="extension-page" data-extension-style-scope={styleScope}>
    <header><h1>{page.title}</h1>{#if page.description}<p>{page.description}</p>{/if}</header>
    {#if tabGroup}
      <div class="extension-tab-list" role="tablist" aria-label={tabGroup.label}
        tabindex="-1"
        onkeydown={(event) => handleTabKeydown(event, tabGroup!)}>
        {#each tabGroup.tabs as tab}
          <button
            id={tabButtonId(tabGroup.id, tab.id)}
            type="button"
            class="extension-tab"
            class:extension-tab--active={activeTab === tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`${formId}-tab-panel`}
            tabindex={activeTab === tab.id ? 0 : -1}
            onclick={() => (selectedTabs = { ...selectedTabs, [tabGroup!.id]: tab.id })}
          >{tab.label}</button>
        {/each}
      </div>
    {/if}
    <div
      class="extension-grid"
      id={`${formId}-tab-panel`}
      role={tabGroup ? 'tabpanel' : undefined}
      aria-labelledby={tabGroup ? tabButtonId(tabGroup.id, activeTab) : undefined}
      tabindex="-1"
    >
      {#each page.blocks as block, index (`${block.type}:${index}`)}
        {#if block.type !== 'tabs' && isBlockVisible(block)}
        {#if block.type === 'text'}
          <p class={blockClass(block, block.style === 'heading' ? 'extension-heading' : block.style === 'caption' ? 'extension-caption' : '')}>{block.text}</p>
        {:else if block.type === 'status_card'}
          <section class={blockClass(block, `extension-card status-card tone-${block.tone ?? 'default'}`)}>
            <span>{block.title}</span><strong>{block.value}</strong>{#if block.description}<small>{block.description}</small>{/if}
          </section>
        {:else if block.type === 'alert'}
          <section class={blockClass(block, `extension-alert tone-${block.tone ?? 'info'}`)} role="status">
            {#if block.title}<strong>{block.title}</strong>{/if}<p>{block.message}</p>
          </section>
        {:else if block.type === 'progress'}
          <section class={blockClass(block, 'extension-card cfms-content-surface')}><span>{block.label}</span><progress aria-label={block.label} value={block.value} max={block.max ?? 100}></progress></section>
        {:else if block.type === 'list'}
          <section class={blockClass(block, 'extension-card cfms-content-surface extension-wide')}>
            {#if block.title}<h2>{block.title}</h2>{/if}
            {#if block.items.length === 0}<p class="muted">No items</p>{/if}
            <ul>{#each block.items as item}<li><span><strong>{item.title}</strong>{#if item.description}<small>{item.description}</small>{/if}</span>{#if item.value}<b>{item.value}</b>{/if}</li>{/each}</ul>
          </section>
        {:else if block.type === 'table'}
          <section class={blockClass(block, 'extension-card cfms-content-surface extension-wide table-wrap')}>
            {#if block.title}<h2>{block.title}</h2>{/if}
            <table><thead><tr>{#each block.columns as column}<th>{column.label}</th>{/each}</tr></thead>
              <tbody>{#each block.rows as row}<tr>{#each block.columns as column}<td>{cellValue(row, column.key)}</td>{/each}</tr>{/each}</tbody>
            </table>
          </section>
        {:else if block.type === 'empty_state'}
          <section class={blockClass(block, 'extension-card cfms-content-surface extension-wide empty')}><strong>{block.title}</strong>{#if block.description}<p>{block.description}</p>{/if}</section>
        {:else if block.type === 'form'}
          <section class={blockClass(block, 'extension-card cfms-content-surface extension-wide form-card')}>
            {#each block.fields as field}
              {#if field.type === 'toggle'}
                <label class={fieldClass(field.class_name)}><span>{field.label}</span>
                  <input class="extension-control" type="checkbox" checked={Boolean(formValues[block.id]?.[field.id])} onchange={(event) => updateField(block.id, field.id, event.currentTarget.checked)} />
                </label>
              {:else if field.type === 'select'}
                <label class={fieldClass(field.class_name)}><span>{field.label}</span>
                  <select class="cfms-native-field extension-control" value={String(formValues[block.id]?.[field.id] ?? '')} onchange={(event) => updateField(block.id, field.id, event.currentTarget.value)}>
                    {#each field.options ?? [] as option}<option value={option}>{option}</option>{/each}
                  </select>
                </label>
              {:else if field.type === 'digit'}
                <label class={fieldClass(field.class_name)}>
                  <input class="cfms-native-field extension-control" type="text" inputmode="numeric" maxlength="1" aria-label={field.label} value={String(formValues[block.id]?.[field.id] ?? '')} oninput={(event) => updateField(block.id, field.id, event.currentTarget.value)} />
                </label>
              {:else if field.type === 'textarea'}
                <div class={fieldClass(field.class_name)}>
                  <MdOutlinedField inputId={`${formId}-${block.id}-${field.id}`} label={field.label}>
                    <textarea class="cfms-native-field extension-control" id={`${formId}-${block.id}-${field.id}`} data-focus-ring="delegated" rows="6" spellcheck="false" value={String(formValues[block.id]?.[field.id] ?? '')} oninput={(event) => updateField(block.id, field.id, event.currentTarget.value)}></textarea>
                  </MdOutlinedField>
                </div>
              {:else}
                <div class={fieldClass(field.class_name)}>
                  <MdOutlinedField inputId={`${formId}-${block.id}-${field.id}`} label={field.label}>
                    <input class="extension-control" id={`${formId}-${block.id}-${field.id}`} data-focus-ring="delegated" type={field.type} value={String(formValues[block.id]?.[field.id] ?? '')} oninput={(event) => updateField(block.id, field.id, inputValue(field, event))} />
                  </MdOutlinedField>
                </div>
              {/if}
            {/each}
          </section>
        {:else if block.type === 'actions'}
          <div class={blockClass(block, 'extension-actions extension-wide')}>
            {#each block.actions as action}
              <FluentButton data-fluent-owner="lib-components-extension-page-renderer"
                type="button"
                disabled={runningAction !== null}
                onclick={() => runAction(action)}
                appearance="subtle"
                class={['extension-button', action.class_name, action.tone === 'primary' ? 'primary' : '', action.tone === 'danger' ? 'danger' : ''].filter(Boolean).join(' ')}
              >{runningAction === action.id ? 'Working…' : action.label}</FluentButton>
            {/each}
          </div>
        {:else if block.type === 'result'}
          <section class={blockClass(block, 'extension-card cfms-content-surface extension-wide plugin-result')}>
            <div class="result-heading">
              <label for={`${formId}-${block.id}`}>{block.label}</label>
              <FluentButton data-fluent-owner="lib-components-extension-page-renderer"
                type="button"
                disabled={!results[block.id]}
                onclick={() => copyResult(block.id)}
                appearance="subtle"
              >{block.copy_label}</FluentButton>
            </div>
            <textarea id={`${formId}-${block.id}`} class="cfms-native-field extension-control" readonly rows="6" aria-label={block.label} value={results[block.id] ?? ''}></textarea>
            {#if resultErrors[block.id]}<p class="extension-error-message" role="alert">{resultErrors[block.id]}</p>{/if}
          </section>
        {/if}
        {/if}
      {/each}
    </div>
  </article>
{/if}

<style>
  .extension-page { max-width: 1080px; margin: 0 auto; padding: 1.5rem; color: var(--explorer-text); }
  header { margin-bottom: 1.25rem; } h1 { font-size: 28px; font-weight: 700; } header p, .muted, small { color: var(--explorer-text-muted); }
  .extension-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .extension-card, .extension-alert { display: grid; gap: 8px; border: 1px solid var(--explorer-border); border-radius: var(--explorer-radius-medium); padding: 1rem; background: var(--explorer-surface-raised); }
  .status-card > strong { font-size: 28px; } .extension-wide { grid-column: 1 / -1; }
  .extension-alert { grid-column: 1 / -1; border-left-width: 4px; } .tone-success { border-left-color: var(--explorer-success); } .tone-warning { border-left-color: var(--explorer-warning); } .tone-danger { border-left-color: var(--explorer-danger); }
  .extension-heading { grid-column: 1 / -1; font-size: 16px; font-weight: 600; } .extension-caption { color: var(--explorer-text-muted); font-size: 12px; }
  ul { display: grid; gap: 4px; } li { display: flex; justify-content: space-between; gap: 16px; padding: .6rem 0; border-bottom: 1px solid var(--explorer-border); } li span { display: grid; }
  .table-wrap { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid var(--explorer-border); padding: .65rem; text-align: left; font-size: 12px; }
  .empty { place-items: center; min-height: 140px; text-align: center; } .form-card label { display: grid; gap: 4px; }
  .extension-tab-list { display: flex; max-width: 100%; gap: 2px; overflow-x: auto; }
  .extension-tab { flex: 0 0 auto; }
  .result-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .extension-error-message { margin: 0; color: var(--explorer-danger); }
  progress { width: 100%; accent-color: var(--explorer-accent); } .extension-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  :global(.cfms-button[data-fluent-owner="lib-components-extension-page-renderer"]) { border: 1px solid var(--explorer-border); border-radius: var(--borderRadiusMedium); padding: .55rem .9rem; background: var(--explorer-surface-raised); } :global(.cfms-button[data-fluent-owner="lib-components-extension-page-renderer"].primary[data-fluent-owner="lib-components-extension-page-renderer"]) { color: var(--colorNeutralForegroundOnBrand); background: var(--colorBrandBackground); } :global(.cfms-button[data-fluent-owner="lib-components-extension-page-renderer"].danger[data-fluent-owner="lib-components-extension-page-renderer"]) { color: var(--explorer-danger); }
  :global(.cfms-button[data-fluent-owner="lib-components-extension-page-renderer"].primary[data-fluent-owner="lib-components-extension-page-renderer"]:hover:not(:is(:disabled, [disabled]))) { background: var(--colorBrandBackgroundHover); }
  :global(.cfms-button[data-fluent-owner="lib-components-extension-page-renderer"].primary[data-fluent-owner="lib-components-extension-page-renderer"]:active:not(:is(:disabled, [disabled]))) { background: var(--colorBrandBackgroundPressed); }
  .extension-state { display: grid; min-height: 260px; place-items: center; padding: 2rem; text-align: center; } .extension-error { align-content: center; gap: 8px; }
  @media (max-width: 700px) { .extension-page { padding: 1rem; } .extension-grid { grid-template-columns: 1fr; } .extension-wide { grid-column: auto; } }
</style>
