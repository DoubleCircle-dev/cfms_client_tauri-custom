<script lang="ts">
  import { _ as t } from 'svelte-i18n';

  import Icon from '$lib/components/Icon.svelte';
  import { ToolError } from '$lib/tools/errors';
  import { matrixDecode, matrixEncode, matrixTranspose } from '$lib/tools/matrix';
  import { TOOLS, MATRIX_TOOL_ID, type ToolDefinition, type ToolFunction } from '$lib/tools/registry';

  interface ToolPanelState {
    input: string;
    output: string;
    keys: string[];
    error: string | null;
  }

  interface MatrixPanelState {
    ip: string;
    port: string;
    revision: string;
    decoyKey: string;
    cells: string[][];
    result: string | null;
    resultOk: boolean;
    error: string | null;
  }

  const initialPanels: Record<string, ToolPanelState> = {};
  for (const tool of TOOLS) {
    initialPanels[tool.id] = {
      input: '',
      output: '',
      keys: tool.keySpecs.map((spec) => spec.defaultValue),
      error: null,
    };
  }

  let activeTab = $state(MATRIX_TOOL_ID);
  let panels = $state(initialPanels);
  let matrix = $state<MatrixPanelState>({
    ip: '',
    port: '7573',
    revision: '1',
    decoyKey: '726791',
    cells: Array.from({ length: 7 }, () => Array(7).fill('')),
    result: null,
    resultOk: true,
    error: null,
  });

  const activeTool = $derived(TOOLS.find((tool) => tool.id === activeTab));

  function formatToolError(error: unknown): string {
    if (error instanceof ToolError) {
      return $t(`tools.errors.${error.key}`, { values: error.params });
    }
    return error instanceof Error ? error.message : String(error);
  }

  function runTool(tool: ToolDefinition, fn: ToolFunction) {
    const panel = panels[tool.id];
    try {
      panel.output = fn(panel.input, panel.keys);
      panel.error = null;
    } catch (error) {
      panel.error = formatToolError(error);
    }
  }

  async function copyOutput(toolId: string) {
    const text = panels[toolId].output;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be unavailable in embedded webviews; ignore.
    }
  }

  function clearPanel(toolId: string) {
    const panel = panels[toolId];
    panel.input = '';
    panel.output = '';
    panel.error = null;
  }

  function readMatrix(): number[][] {
    return matrix.cells.map((row) =>
      row.map((value) => {
        const cell = value.trim();
        if (!/^\d$/.test(cell)) throw new ToolError('matrix.digits');
        return parseInt(cell, 10);
      }),
    );
  }

  function writeMatrix(values: number[][]) {
    matrix.cells = values.map((row) => row.map((value) => String(value)));
  }

  function matrixGenerate() {
    matrix.error = null;
    try {
      const ip = matrix.ip.trim();
      const portText = matrix.port.trim();
      const revisionText = matrix.revision.trim() || '1';
      const decoyKey = matrix.decoyKey.trim() || '726791';
      if (!/^[+-]?\d+$/.test(portText)) throw new ToolError('ciphers.integer');
      if (!/^[+-]?\d+$/.test(revisionText)) throw new ToolError('ciphers.integer');
      const port = parseInt(portText, 10);
      const revision = parseInt(revisionText, 10);
      writeMatrix(matrixEncode(ip, port, revision, decoyKey));
      matrix.result = $t('tools.matrix.generated');
      matrix.resultOk = true;
    } catch (error) {
      matrix.error = formatToolError(error);
    }
  }

  function matrixDecodeAction() {
    matrix.error = null;
    try {
      const info = matrixDecode(readMatrix());
      const rbf = info.rbfClass === null ? $t('tools.matrix.uncertain') : String(info.rbfClass);
      matrix.result =
        `${$t('tools.matrix.endpoint')} ${info.endpoint}\n`
        + `${$t('tools.matrix.checksum')} ${info.checksum}`
        + `  |  ${$t('tools.matrix.rbf')}${rbf}`
        + ` (${$t('tools.matrix.distance')} ${info.rbfDistance})\n`
        + (info.valid ? $t('tools.matrix.valid') : $t('tools.matrix.invalid'));
      matrix.resultOk = info.valid;
    } catch (error) {
      matrix.error = formatToolError(error);
    }
  }

  function matrixTransposeAction() {
    matrix.error = null;
    try {
      writeMatrix(matrixTranspose(readMatrix()));
      matrix.result = null;
    } catch (error) {
      matrix.error = formatToolError(error);
    }
  }

  function matrixClear() {
    matrix.cells = Array.from({ length: 7 }, () => Array(7).fill(''));
    matrix.result = null;
    matrix.error = null;
  }
</script>

<svelte:head><title>{$t('tools.title')}</title></svelte:head>

<div class="tools-page">
  <header class="tools-header">
    <h1>{$t('tools.title')}</h1>
    <p>{$t('tools.matrix.hint')}</p>
  </header>

  <div class="tools-tabs" role="tablist" aria-label={$t('tools.title')}>
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === MATRIX_TOOL_ID}
      class="tools-tab"
      class:tools-tab--active={activeTab === MATRIX_TOOL_ID}
      onclick={() => (activeTab = MATRIX_TOOL_ID)}
    >
      <Icon name="gridOn" size="17px" />
      <span>{$t('tools.matrix.title')}</span>
    </button>
    {#each TOOLS as tool (tool.id)}
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === tool.id}
        class="tools-tab"
        class:tools-tab--active={activeTab === tool.id}
        onclick={() => (activeTab = tool.id)}
      >
        <span>{$t(tool.tabLabelKey)}</span>
      </button>
    {/each}
  </div>

  {#if activeTab === MATRIX_TOOL_ID}
    <section class="tools-card matrix-panel" aria-label={$t('tools.matrix.title')}>
      <p class="tools-hint">{$t('tools.matrix.hint')}</p>

      <div class="matrix-fields">
        <label class="matrix-field">
          <span>{$t('tools.matrix.ip')}</span>
          <input bind:value={matrix.ip} placeholder="192.168.1.100" spellcheck="false" />
        </label>
        <label class="matrix-field">
          <span>{$t('tools.matrix.port')}</span>
          <input bind:value={matrix.port} inputmode="numeric" spellcheck="false" />
        </label>
        <label class="matrix-field">
          <span>{$t('tools.matrix.revision')}</span>
          <input bind:value={matrix.revision} inputmode="numeric" spellcheck="false" />
        </label>
        <label class="matrix-field">
          <span>{$t('tools.matrix.decoyKey')}</span>
          <input bind:value={matrix.decoyKey} spellcheck="false" />
        </label>
      </div>

      <div class="tools-actions">
        <button type="button" class="tools-button tools-button--primary" onclick={matrixGenerate}>
          {$t('tools.matrix.generate')}
        </button>
        <button type="button" class="tools-button" onclick={matrixDecodeAction}>
          {$t('tools.matrix.decode')}
        </button>
        <button type="button" class="tools-button" onclick={matrixTransposeAction}>
          {$t('tools.matrix.transpose')}
        </button>
        <button type="button" class="tools-button" onclick={matrixClear}>
          {$t('tools.matrix.clear')}
        </button>
      </div>

      <div class="matrix-grid" role="group" aria-label={$t('tools.matrix.title')}>
        {#each matrix.cells as row, r}
          {#each row as cell, c}
            <input
              class="matrix-cell"
              bind:value={matrix.cells[r][c]}
              maxlength="1"
              inputmode="numeric"
              aria-label={$t('tools.matrix.cell', { values: { row: r + 1, col: c + 1 } })}
              spellcheck="false"
            />
          {/each}
        {/each}
      </div>

      {#if matrix.error}
        <p class="tools-error" role="alert">{matrix.error}</p>
      {/if}
      {#if matrix.result}
        <p class="matrix-result" class:matrix-result--invalid={!matrix.resultOk}>
          {matrix.result}
        </p>
      {/if}
    </section>
  {:else if activeTool}
    {@const panel = panels[activeTool.id]}
    <section class="tools-card tool-panel" aria-label={$t(activeTool.tabLabelKey)}>
      <p class="tools-hint">{$t(activeTool.hintKey)}</p>

      {#if activeTool.keySpecs.length > 0}
        <div class="tool-keys">
          {#each activeTool.keySpecs as spec, index}
            <label class="tool-key">
              <span>{$t(spec.labelKey)}</span>
              {#if spec.options}
                <select bind:value={panel.keys[index]}>
                  {#each spec.options as option}
                    <option value={option}>{option}</option>
                  {/each}
                </select>
              {:else}
                <input bind:value={panel.keys[index]} spellcheck="false" />
              {/if}
            </label>
          {/each}
        </div>
      {/if}

      <label class="tool-textarea-label" for={`tool-input-${activeTool.id}`}>
        {$t('tools.labels.input')}
      </label>
      <textarea
        id={`tool-input-${activeTool.id}`}
        class="tool-textarea"
        bind:value={panel.input}
        rows="6"
        spellcheck="false"
      ></textarea>

      <div class="tools-actions">
        {#if activeTool.decode}
          <button
            type="button"
            class="tools-button tools-button--primary"
            onclick={() => runTool(activeTool, activeTool.encode)}
          >
            {$t('tools.actions.encode')}
          </button>
          <button
            type="button"
            class="tools-button"
            onclick={() => runTool(activeTool, activeTool.decode!)}
          >
            {$t('tools.actions.decode')}
          </button>
        {:else}
          <button
            type="button"
            class="tools-button tools-button--primary"
            onclick={() => runTool(activeTool, activeTool.encode)}
          >
            {$t('tools.actions.compute')}
          </button>
        {/if}
        <button type="button" class="tools-button" onclick={() => copyOutput(activeTool.id)}>
          {$t('tools.actions.copy')}
        </button>
        <button type="button" class="tools-button" onclick={() => clearPanel(activeTool.id)}>
          {$t('tools.actions.clear')}
        </button>
      </div>

      <label class="tool-textarea-label" for={`tool-output-${activeTool.id}`}>
        {$t('tools.labels.output')}
      </label>
      <textarea
        id={`tool-output-${activeTool.id}`}
        class="tool-textarea"
        bind:value={panel.output}
        rows="6"
        readonly
        spellcheck="false"
      ></textarea>

      {#if panel.error}
        <p class="tools-error" role="alert">{panel.error}</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .tools-page {
    width: min(880px, calc(100% - 2rem));
    margin: 0 auto;
    padding: 2rem 0 3rem;
    display: grid;
    gap: 1.1rem;
  }

  .tools-header {
    display: grid;
    gap: 0.35rem;
  }

  .tools-header h1 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-size: clamp(1.5rem, 3.4vw, 2rem);
    font-weight: 800;
    letter-spacing: 0;
  }

  .tools-header p {
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.9rem;
  }

  .tools-tabs {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    padding: 0.25rem 0.15rem 0.35rem;
    scrollbar-width: thin;
  }

  .tools-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex: 0 0 auto;
    border: 1px solid var(--color-md3-outline-variant);
    border-radius: 999px;
    padding: 0.42rem 0.85rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container);
    font-family: var(--font-md3-sans);
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      transform 120ms ease;
  }

  .tools-tab:hover {
    border-color: var(--color-md3-primary);
    color: var(--color-md3-on-surface);
    transform: translateY(-1px);
  }

  .tools-tab--active {
    border-color: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  .tools-tab:focus-visible {
    outline: 2px solid var(--color-md3-primary-emphasis);
    outline-offset: 2px;
  }

  .tools-card {
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--radius-md3-form);
    padding: 1.15rem 1.25rem;
    background: var(--color-md3-surface-container);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  }

  .tools-hint {
    margin: 0 0 0.85rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.83rem;
    line-height: 1.55;
  }

  .matrix-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.7rem;
    margin-bottom: 0.85rem;
  }

  .matrix-field,
  .tool-key {
    display: grid;
    gap: 0.3rem;
  }

  .matrix-field span,
  .tool-key span {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
    font-weight: 600;
  }

  .matrix-field input,
  .tool-key input,
  .tool-key select {
    min-width: 0;
    border: 1px solid var(--color-md3-outline-variant);
    border-radius: 10px;
    padding: 0.48rem 0.6rem;
    color: var(--color-md3-on-surface);
    background: var(--color-md3-field);
    font-family: var(--font-md3-sans);
    font-size: 0.83rem;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .matrix-field input:focus,
  .tool-key input:focus,
  .tool-key select:focus,
  .tool-textarea:focus {
    border-color: var(--color-md3-primary);
    box-shadow: inset 0 0 0 1px var(--color-md3-primary);
    outline: none;
  }

  .tool-keys {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.7rem;
    margin-bottom: 0.85rem;
  }

  .tools-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.85rem 0;
  }

  .tools-button {
    border: 1px solid var(--color-md3-outline-variant);
    border-radius: 999px;
    padding: 0.5rem 1.1rem;
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
    font-family: var(--font-md3-sans);
    font-size: 0.8rem;
    font-weight: 650;
    cursor: pointer;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      transform 120ms ease;
  }

  .tools-button:hover {
    border-color: var(--color-md3-primary);
    transform: translateY(-1px);
  }

  .tools-button--primary {
    border-color: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  .tools-button:focus-visible {
    outline: 2px solid var(--color-md3-primary-emphasis);
    outline-offset: 2px;
  }

  .matrix-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0.35rem;
    max-width: 420px;
    margin: 0.4rem auto 0.2rem;
  }

  .matrix-cell {
    width: 100%;
    aspect-ratio: 1;
    border: 1px solid var(--color-md3-outline-variant);
    border-radius: 10px;
    color: var(--color-md3-on-surface);
    background: var(--color-md3-field);
    font-family: var(--font-md3-mono);
    font-size: 1rem;
    text-align: center;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .matrix-cell:focus {
    border-color: var(--color-md3-primary);
    box-shadow: inset 0 0 0 1px var(--color-md3-primary);
    outline: none;
  }

  .tool-textarea-label {
    display: block;
    margin-bottom: 0.35rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    font-weight: 650;
  }

  .tool-textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--color-md3-outline-variant);
    border-radius: 10px;
    padding: 0.6rem 0.7rem;
    color: var(--color-md3-on-surface);
    background: var(--color-md3-field);
    font-family: var(--font-md3-mono);
    font-size: 0.82rem;
    line-height: 1.55;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .tool-textarea[readonly] {
    color: var(--color-md3-on-surface-variant);
  }

  .tools-error {
    margin: 0.5rem 0 0;
    border-radius: 10px;
    padding: 0.55rem 0.7rem;
    color: var(--color-md3-on-error-container);
    background: var(--color-md3-error-container);
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .matrix-result {
    margin: 0.65rem 0 0;
    border: 1px solid var(--color-md3-outline-variant);
    border-radius: 10px;
    padding: 0.6rem 0.75rem;
    color: var(--color-md3-success);
    background: var(--color-md3-success-container);
    font-family: var(--font-md3-mono);
    font-size: 0.8rem;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .matrix-result--invalid {
    color: var(--color-md3-on-error-container);
    background: var(--color-md3-error-container);
  }
</style>
