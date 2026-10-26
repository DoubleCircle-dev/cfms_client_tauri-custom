<script lang="ts">
  import { _ as t } from 'svelte-i18n';

  import FluentButton from '$lib/components/FluentButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { focusRovingItem } from '$lib/keyboard';
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

  function handleTabKeydown(event: KeyboardEvent) {
    const next = focusRovingItem(event, event.currentTarget as HTMLElement, {
      selector: '[data-tab-item]',
      orientation: 'horizontal',
    });
    next?.click();
  }

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

<div class="tools-page workspace-page">
  <header class="cfms-heading-copy">
    <h1>{$t('tools.title')}</h1>
    <p>{$t('tools.description')}</p>
  </header>

  <div class="tools-tabs" role="tablist" tabindex="-1" aria-label={$t('tools.title')} onkeydown={handleTabKeydown}>
    <button
      type="button"
      role="tab"
      data-tab-item
      aria-selected={activeTab === MATRIX_TOOL_ID}
      tabindex={activeTab === MATRIX_TOOL_ID ? 0 : -1}
      class="tools-tab"
      class:tools-tab--active={activeTab === MATRIX_TOOL_ID}
      onclick={() => (activeTab = MATRIX_TOOL_ID)}
    >
      <Icon name="gridOn" size="16px" />
      <span>{$t('tools.matrix.title')}</span>
    </button>
    {#each TOOLS as tool (tool.id)}
      <button
        type="button"
        role="tab"
        data-tab-item
        aria-selected={activeTab === tool.id}
        tabindex={activeTab === tool.id ? 0 : -1}
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
        <label class="tools-field">
          <span class="tools-field-label">{$t('tools.matrix.ip')}</span>
          <input class="cfms-native-field" bind:value={matrix.ip} placeholder="192.168.1.100" spellcheck="false" />
        </label>
        <label class="tools-field">
          <span class="tools-field-label">{$t('tools.matrix.port')}</span>
          <input class="cfms-native-field" bind:value={matrix.port} inputmode="numeric" spellcheck="false" />
        </label>
        <label class="tools-field">
          <span class="tools-field-label">{$t('tools.matrix.revision')}</span>
          <input class="cfms-native-field" bind:value={matrix.revision} inputmode="numeric" spellcheck="false" />
        </label>
        <label class="tools-field">
          <span class="tools-field-label">{$t('tools.matrix.decoyKey')}</span>
          <input class="cfms-native-field" bind:value={matrix.decoyKey} spellcheck="false" />
        </label>
      </div>

      <div class="tools-actions">
        <FluentButton appearance="primary" onclick={matrixGenerate}>
          {$t('tools.matrix.generate')}
        </FluentButton>
        <FluentButton appearance="outline" onclick={matrixDecodeAction}>
          {$t('tools.matrix.decode')}
        </FluentButton>
        <FluentButton appearance="outline" onclick={matrixTransposeAction}>
          {$t('tools.matrix.transpose')}
        </FluentButton>
        <FluentButton appearance="subtle" onclick={matrixClear}>
          {$t('tools.matrix.clear')}
        </FluentButton>
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
            <label class="tools-field">
              <span class="tools-field-label">{$t(spec.labelKey)}</span>
              {#if spec.options}
                <select class="cfms-native-field" bind:value={panel.keys[index]}>
                  {#each spec.options as option}
                    <option value={option}>{option}</option>
                  {/each}
                </select>
              {:else}
                <input class="cfms-native-field" bind:value={panel.keys[index]} spellcheck="false" />
              {/if}
            </label>
          {/each}
        </div>
      {/if}

      <label class="tools-field-label tools-io-label" for={`tool-input-${activeTool.id}`}>
        {$t('tools.labels.input')}
      </label>
      <textarea
        id={`tool-input-${activeTool.id}`}
        class="cfms-native-field tools-textarea"
        bind:value={panel.input}
        rows="6"
        spellcheck="false"
      ></textarea>

      <div class="tools-actions">
        {#if activeTool.decode}
          <FluentButton appearance="primary" onclick={() => runTool(activeTool, activeTool.encode)}>
            {$t('tools.actions.encode')}
          </FluentButton>
          <FluentButton appearance="outline" onclick={() => runTool(activeTool, activeTool.decode!)}>
            {$t('tools.actions.decode')}
          </FluentButton>
        {:else}
          <FluentButton appearance="primary" onclick={() => runTool(activeTool, activeTool.encode)}>
            {$t('tools.actions.compute')}
          </FluentButton>
        {/if}
        <FluentButton appearance="subtle" onclick={() => copyOutput(activeTool.id)}>
          {$t('tools.actions.copy')}
        </FluentButton>
        <FluentButton appearance="subtle" onclick={() => clearPanel(activeTool.id)}>
          {$t('tools.actions.clear')}
        </FluentButton>
      </div>

      <label class="tools-field-label tools-io-label" for={`tool-output-${activeTool.id}`}>
        {$t('tools.labels.output')}
      </label>
      <textarea
        id={`tool-output-${activeTool.id}`}
        class="cfms-native-field tools-textarea tools-textarea--readonly"
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
    display: grid;
    width: min(100%, 48rem);
    align-content: start;
    gap: 20px;
    margin-inline: auto;
    padding: 24px;
  }

  .cfms-heading-copy h1 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font: 600 28px/36px var(--font-md3-sans);
    letter-spacing: -0.018em;
  }

  .cfms-heading-copy p {
    max-width: 68ch;
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font: 400 14px/20px var(--font-md3-sans);
  }

  /* Segmented control matching the manage page: quiet track, brand-soft pill. */
  .tools-tabs {
    display: flex;
    width: fit-content;
    max-width: 100%;
    gap: 2px;
    border-radius: var(--borderRadiusXLarge);
    padding: 4px;
    background: var(--colorNeutralBackground3);
    overflow-x: auto;
  }

  .tools-tab {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: calc(var(--borderRadiusXLarge) - 4px);
    padding: 6px 14px;
    color: var(--colorNeutralForeground3);
    background: transparent;
    font: 500 12px/16px var(--fontFamilyBase);
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--durationFaster) var(--curveEasyEase), color var(--durationFaster) var(--curveEasyEase);
  }

  .tools-tab:hover {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .tools-tab--active {
    color: var(--colorBrandForeground2);
    background: var(--colorBrandBackground2);
    font-weight: 600;
  }

  .tools-tab--active:hover {
    color: var(--colorBrandForeground2);
    background: var(--colorBrandBackground2);
  }

  .tools-card {
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusLarge);
    padding: 16px;
    background: transparent;
  }

  .tools-hint {
    max-width: 70ch;
    margin: 0 0 12px;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .matrix-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }

  .tools-field {
    display: grid;
    min-width: 0;
    gap: 4px;
  }

  .tools-field-label {
    color: var(--colorNeutralForeground3);
    font: 600 12px/16px var(--fontFamilyBase);
  }

  .tools-field .cfms-native-field {
    width: 100%;
  }

  .tool-keys {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }

  .tools-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
  }

  /* Matrix cells keep their compact square geometry; field focus is owned by
     the global native-field indicator, so no local :focus rules live here. */
  .matrix-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
    max-width: 420px;
    margin: 8px auto 0;
  }

  .matrix-cell {
    width: 100%;
    aspect-ratio: 1;
    border: 1px solid var(--colorNeutralStroke1);
    border-block-end-color: var(--colorNeutralStrokeAccessible);
    border-radius: var(--borderRadiusMedium);
    color: var(--colorNeutralForeground1);
    background: var(--cfms-field-background);
    font: 400 14px/20px var(--fontFamilyMonospace);
    text-align: center;
  }

  .tools-io-label {
    display: block;
    margin-bottom: 4px;
  }

  .tools-textarea {
    width: 100%;
    font-family: var(--fontFamilyMonospace);
    font-size: 13px;
    line-height: 1.55;
  }

  .tools-textarea--readonly {
    color: var(--colorNeutralForeground3);
  }

  .tools-error {
    margin: 8px 0 0;
    border-radius: var(--borderRadiusMedium);
    padding: 8px 12px;
    color: var(--colorStatusDangerForeground1);
    background: var(--colorStatusDangerBackground1);
    font: 400 12px/18px var(--fontFamilyBase);
  }

  .matrix-result {
    margin: 8px 0 0;
    border-radius: var(--borderRadiusMedium);
    padding: 8px 12px;
    color: var(--colorStatusSuccessForeground1);
    background: var(--colorStatusSuccessBackground1);
    font: 400 12px/18px var(--fontFamilyMonospace);
    white-space: pre-wrap;
  }

  .matrix-result--invalid {
    color: var(--colorStatusDangerForeground1);
    background: var(--colorStatusDangerBackground1);
  }

  @media (max-width: 640px) {
    .tools-page {
      padding: 16px;
    }
  }
</style>
