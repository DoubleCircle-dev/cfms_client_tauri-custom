<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import { renderMarkdown } from '$lib/markdown';

  export interface PreviewModel {
    title: string;
    subtitle?: string;
    kind: 'image' | 'audio' | 'text';
    /** asset:// URL for image/audio content. */
    src?: string | null;
    /** Decoded text content for text files. */
    text?: string | null;
    /** Render the text as sanitized markdown. */
    markdown?: boolean;
    /** The raw text was truncated by the backend. */
    truncated?: boolean;
    /** Detected character encoding of the text. */
    encoding?: string;
    loading?: boolean;
    error?: string | null;
  }

  let {
    open,
    model = null,
    emptyTitle,
    emptyLabel,
    closeLabel,
    truncatedLabel,
    encodingLabel,
    onClose,
  }: {
    open: boolean;
    model?: PreviewModel | null;
    emptyTitle: string;
    emptyLabel: string;
    closeLabel: string;
    truncatedLabel: string;
    encodingLabel: string;
    onClose: () => void;
  } = $props();
</script>

{#if open}
  <aside
    class="explorer-preview-pane"
    aria-label={model?.title ?? emptyTitle}
    data-keyboard-region="preview"
    tabindex="-1"
  >
    <header class="explorer-preview-header">
      <div class="explorer-preview-heading">
        <span class="explorer-preview-icon"><Icon name="preview" size="22px" /></span>
        <div class="min-w-0">
          <h2>{model?.title ?? emptyTitle}</h2>
          {#if model?.subtitle}<p>{model.subtitle}</p>{/if}
        </div>
      </div>
      <button
        class="explorer-command-button explorer-preview-close"
        aria-label={closeLabel}
        title={closeLabel}
        onclick={onClose}
      >
        <Icon name="close" size="17px" />
      </button>
    </header>

    <div class="explorer-preview-body">
      {#if model?.loading}
        <div class="explorer-preview-empty">
          <ProgressRing size={20} strokeWidth={2.5} label={emptyLabel} />
        </div>
      {:else if model?.error}
        <p class="explorer-preview-error">{model.error}</p>
      {:else if model?.kind === 'image' && model.src}
        <div class="explorer-preview-image-wrap">
          <img src={model.src} alt={model.title} />
        </div>
      {:else if model?.kind === 'audio' && model.src}
        <div class="explorer-preview-audio">
          <audio controls src={model.src}></audio>
        </div>
      {:else if model?.kind === 'text'}
        {#if model.markdown}
          <div class="explorer-preview-markdown">{@html renderMarkdown(model.text)}</div>
        {:else}
          <pre class="explorer-preview-text">{model.text}</pre>
        {/if}
        {#if model.truncated}
          <p class="explorer-preview-truncated">{truncatedLabel}</p>
        {/if}
        {#if model.encoding}
          <p class="explorer-preview-meta">{encodingLabel}：{model.encoding}</p>
        {/if}
      {:else}
        <p class="explorer-preview-empty">{emptyLabel}</p>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .explorer-preview-pane {
    position: relative;
    display: flex;
    width: 420px;
    max-width: min(480px, 45vw);
    height: 100%;
    min-height: 0;
    flex: 0 0 auto;
    flex-direction: column;
    border-left: 1px solid var(--explorer-border);
    background: var(--explorer-surface-raised);
  }

  .explorer-preview-header {
    display: flex;
    min-height: 54px;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-bottom: 1px solid var(--explorer-border);
    padding: 0.55rem 0.65rem 0.55rem 0.8rem;
  }

  .explorer-preview-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.65rem;
  }

  .explorer-preview-icon {
    display: inline-flex;
    width: 22px;
    height: 22px;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--explorer-icon);
  }

  .explorer-preview-heading h2 {
    margin: 0;
    overflow: hidden;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .explorer-preview-heading p {
    margin: 0;
    overflow: hidden;
    font-size: 0.75rem;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--explorer-muted);
  }

  .explorer-preview-close {
    flex: none;
  }

  .explorer-preview-body {
    min-height: 0;
    flex: 1 1 auto;
    overflow: auto;
    padding: 0.9rem;
  }

  .explorer-preview-empty {
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    font-size: 0.85rem;
    text-align: center;
    color: var(--explorer-muted);
  }

  .explorer-preview-error {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--explorer-danger, #d64545);
  }

  .explorer-preview-image-wrap {
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
  }

  .explorer-preview-image-wrap img {
    display: block;
    max-width: 100%;
    max-height: 62vh;
    object-fit: contain;
    border-radius: 6px;
  }

  .explorer-preview-audio {
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
  }

  .explorer-preview-audio audio {
    width: 100%;
  }

  .explorer-preview-text {
    margin: 0;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
    font-size: 0.82rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--explorer-text);
  }

  .explorer-preview-markdown {
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--explorer-text);
  }

  .explorer-preview-markdown :global(pre) {
    overflow: auto;
    padding: 0.6rem;
    border-radius: 6px;
    background: var(--explorer-surface-sunken, rgba(0, 0, 0, 0.06));
  }

  .explorer-preview-markdown :global(img) {
    max-width: 100%;
  }

  .explorer-preview-markdown :global(a) {
    color: var(--explorer-accent);
  }

  .explorer-preview-truncated,
  .explorer-preview-meta {
    margin: 0.7rem 0 0;
    font-size: 0.75rem;
    color: var(--explorer-muted);
  }
</style>
