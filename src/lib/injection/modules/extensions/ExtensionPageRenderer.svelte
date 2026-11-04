<script lang="ts">
  import FluentButton from '$lib/components/FluentButton.svelte';
  import { onMount } from 'svelte';
  import {
    readExtensionPage,
    type DeclarativeAction,
    type DeclarativeBlock,
    type DeclarativePage,
  } from '$lib/injection/modules/extensions/api';
  import { createExtensionStylesheet } from '$lib/injection/modules/extensions/styles';
  import { runExtensionWorkflow } from '$lib/injection/modules/extensions/workflows';
  import { notificationStore } from '$lib/stores.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let { extensionId, pageId }: { extensionId: string; pageId: string } = $props();
  const formId = $props.id();
  const styleScopeId = `extension-${formId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  let page = $state<DeclarativePage | null>(null);
  let pageStylesheet = $state('');
  let loading = $state(true);
  let error = $state<string | null>(null);
  let runningAction = $state<string | null>(null);
  let formValues = $state<Record<string, Record<string, unknown>>>({});
  let selectedTabs = $state<Record<string, string>>({});
  let results = $state<Record<string, string>>({});
  let resultErrors = $state<Record<string, string>>({});
  let tabGroup = $derived(
    page?.blocks.find((block): block is Extract<DeclarativeBlock, { type: 'tabs' }> => block.type === 'tabs'),
  );
  let activeTab = $derived(
    tabGroup
      ? selectedTabs[tabGroup.id] ?? tabGroup.default_tab ?? tabGroup.tabs[0]?.id ?? ''
      : '',
  );

  onMount(load);

  async function load() {
    loading = true;
    error = null;
    page = null;
    pageStylesheet = '';
    try {
      const loadedPage = await readExtensionPage(extensionId, pageId);
      if (loadedPage.schema_version !== 1 || !Array.isArray(loadedPage.blocks)) {
        throw new Error('Unsupported extension page schema');
      }
      const stylesheet = createExtensionStylesheet(loadedPage, styleScopeId);
      selectedTabs = Object.fromEntries(
        loadedPage.blocks
          .filter((block): block is Extract<DeclarativeBlock, { type: 'tabs' }> => block.type === 'tabs')
          .map((block) => [block.id, block.default_tab ?? block.tabs[0]?.id ?? '']),
      );
      results = {};
      resultErrors = {};
      const values: Record<string, Record<string, unknown>> = {};
      for (const block of loadedPage.blocks) {
        if (block.type !== 'form') continue;
        values[block.id] = Object.fromEntries(block.fields.map((field) => [field.id, field.default ?? (field.type === 'toggle' ? false : '')]));
      }
      formValues = values;
      pageStylesheet = stylesheet;
      page = loadedPage;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const css = pageStylesheet;
    if (!css) return;
    const styleElement = document.createElement('style');
    styleElement.dataset.extensionStyleScope = styleScopeId;
    styleElement.textContent = css;
    document.head.append(styleElement);
    return () => styleElement.remove();
  });

  function updateField(formId: string, fieldId: string, value: unknown) {
    formValues = {
      ...formValues,
      [formId]: { ...(formValues[formId] ?? {}), [fieldId]: value },
    };
  }

  function isBlockVisible(block: DeclarativeBlock): boolean {
    return !('tab' in block) || !block.tab || selectedTabs[block.tab.group] === block.tab.id;
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
    if (action.kind === 'copy') {
      await copyResult(action.result_id);
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

  function blockClass(block: Exclude<DeclarativeBlock, { type: 'css' }>, base: string): string {
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
  <article
    class={`extension-page ${page.class_name ?? ''}`}
    data-extension-style-scope={styleScopeId}
  >
    <header class="extension-page-header">
      <h1 class="extension-page-title">{page.title}</h1>
      {#if page.description}<p class="extension-page-description">{page.description}</p>{/if}
    </header>
    {#if tabGroup}
      <div class="extension-tab-list" role="tablist" aria-label={tabGroup.label}
        tabindex="-1"
        onkeydown={(event) => handleTabKeydown(event, tabGroup!)}
      >
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
        {#if block.type !== 'tabs' && block.type !== 'css' && isBlockVisible(block)}
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
            <section class={blockClass(block, 'extension-card')}><span>{block.label}</span><progress aria-label={block.label} value={block.value} max={block.max ?? 100}></progress></section>
          {:else if block.type === 'list'}
            <section class={blockClass(block, 'extension-card extension-wide')}>
              {#if block.title}<h2>{block.title}</h2>{/if}
              {#if block.items.length === 0}<p class="extension-muted">No items</p>{/if}
              <ul>{#each block.items as item}<li><span><strong>{item.title}</strong>{#if item.description}<small>{item.description}</small>{/if}</span>{#if item.value}<b>{item.value}</b>{/if}</li>{/each}</ul>
            </section>
          {:else if block.type === 'table'}
            <section class={blockClass(block, 'extension-card extension-wide table-wrap')}>
              {#if block.title}<h2>{block.title}</h2>{/if}
              <table><thead><tr>{#each block.columns as column}<th>{column.label}</th>{/each}</tr></thead>
                <tbody>{#each block.rows as row}<tr>{#each block.columns as column}<td>{cellValue(row, column.key)}</td>{/each}</tr>{/each}</tbody>
              </table>
            </section>
          {:else if block.type === 'empty_state'}
            <section class={blockClass(block, 'extension-card extension-wide empty')}><strong>{block.title}</strong>{#if block.description}<p>{block.description}</p>{/if}</section>
          {:else if block.type === 'form'}
            <section class={blockClass(block, 'extension-card extension-wide form-card')}>
              {#each block.fields as field}
                {#if field.type === 'toggle'}
                  <label class={fieldClass(field.class_name)}><span class="extension-form-label">{field.label}</span>
                    <input class="extension-control" type="checkbox" checked={Boolean(formValues[block.id]?.[field.id])} onchange={(event) => updateField(block.id, field.id, event.currentTarget.checked)} />
                  </label>
                {:else if field.type === 'select'}
                  <label class={fieldClass(field.class_name)}><span class="extension-form-label">{field.label}</span>
                    <select class="cfms-native-field extension-control" value={String(formValues[block.id]?.[field.id] ?? '')} onchange={(event) => updateField(block.id, field.id, event.currentTarget.value)}>
                      {#each field.options ?? [] as option}<option value={option}>{option}</option>{/each}
                    </select>
                  </label>
                {:else if field.type === 'digit'}
                  <label class={fieldClass(field.class_name)}>
                    <input class="cfms-native-field extension-control" type="text" inputmode="numeric" maxlength="1" id={`${formId}-${block.id}-${field.id}`} aria-label={field.label} value={String(formValues[block.id]?.[field.id] ?? '')} oninput={(event) => updateField(block.id, field.id, event.currentTarget.value)} />
                  </label>
                {:else if field.type === 'textarea'}
                  <label class={fieldClass(field.class_name)}>
                    <span class="extension-form-label">{field.label}</span>
                    <textarea class="cfms-native-field extension-control" id={`${formId}-${block.id}-${field.id}`} rows="6" spellcheck="false" value={String(formValues[block.id]?.[field.id] ?? '')} oninput={(event) => updateField(block.id, field.id, event.currentTarget.value)}></textarea>
                  </label>
                {:else}
                  <label class={fieldClass(field.class_name)}>
                    <span class="extension-form-label">{field.label}</span>
                    <input class="cfms-native-field extension-control" id={`${formId}-${block.id}-${field.id}`} type={field.type} value={String(formValues[block.id]?.[field.id] ?? '')} oninput={(event) => updateField(block.id, field.id, inputValue(field, event))} />
                  </label>
                {/if}
              {/each}
            </section>
          {:else if block.type === 'actions'}
            <div class={blockClass(block, 'extension-actions extension-wide')}>
              {#each block.actions as action}
                <FluentButton data-fluent-owner="lib-components-extension-page-renderer"
                  type="button"
                  disabled={runningAction !== null || (action.kind === 'copy' && !results[action.result_id])}
                  onclick={() => runAction(action)}
                  appearance="subtle"
                  class={['extension-button', action.class_name, action.tone === 'primary' ? 'primary' : '', action.tone === 'danger' ? 'danger' : ''].filter(Boolean).join(' ')}
                >{runningAction === action.id ? 'Working…' : action.label}</FluentButton>
              {/each}
            </div>
          {:else if block.type === 'result'}
            {#if block.variant === 'banner'}
              {#if resultErrors[block.id]}
                <p class={`extension-block extension-block--result extension-result-banner extension-result-banner--danger ${block.class_name ?? ''}`} role="alert">{resultErrors[block.id]}</p>
              {:else if results[block.id]}
                <p class={`extension-block extension-block--result extension-result-banner extension-result-banner--success ${block.class_name ?? ''}`}>{results[block.id]}</p>
              {/if}
            {:else}
              <section class={blockClass(block, 'extension-card extension-wide plugin-result')}>
                <div class="extension-result-heading">
                  <label for={`${formId}-${block.id}`}>{block.label}</label>
                  {#if block.copy_label}
                    <FluentButton data-fluent-owner="lib-components-extension-page-renderer"
                      type="button"
                      disabled={!results[block.id]}
                      onclick={() => copyResult(block.id)}
                      appearance="subtle"
                    >{block.copy_label}</FluentButton>
                  {/if}
                </div>
                <textarea id={`${formId}-${block.id}`} class="cfms-native-field extension-control" readonly rows="6" aria-label={block.label} value={results[block.id] ?? ''}></textarea>
                {#if resultErrors[block.id]}<p class="extension-error-message" role="alert">{resultErrors[block.id]}</p>{/if}
              </section>
            {/if}
          {/if}
        {/if}
      {/each}
    </div>
  </article>
{/if}

<style>
  .extension-state { display: grid; min-height: 260px; place-items: center; padding: 2rem; text-align: center; }
  .extension-error { align-content: center; gap: 8px; }
</style>
