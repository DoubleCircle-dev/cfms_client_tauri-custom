<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorView as EditorViewType } from '@codemirror/view';
  import type { Compartment as CompartmentType, Extension } from '@codemirror/state';
  import type { Diagnostic } from '@codemirror/lint';

  export interface JsonEditorDiagnostic {
    path: string;
    message: string;
  }

  interface Props {
    value: string;
    diagnostics?: JsonEditorDiagnostic[];
    disabled?: boolean;
    ariaLabel: string;
    loadingLabel: string;
    onChange: (value: string) => void;
  }

  let {
    value,
    diagnostics = [],
    disabled = false,
    ariaLabel,
    loadingLabel,
    onChange,
  }: Props = $props();

  let host: HTMLDivElement;
  let editorView = $state<EditorViewType | null>(null);
  let editableCompartment: CompartmentType | null = null;
  let editableExtension: ((disabled: boolean) => Extension) | null = null;
  let forceLinting: ((view: EditorViewType) => void) | null = null;
  let loadFailed = $state(false);

  function decodePointerSegment(segment: string): string {
    return segment.replaceAll('~1', '/').replaceAll('~0', '~');
  }

  function diagnosticRange(text: string, path: string): { from: number; to: number } {
    const leaf = path.split('/').filter(Boolean).at(-1);
    if (!leaf) return { from: 0, to: Math.min(1, text.length) };
    const needle = JSON.stringify(decodePointerSegment(leaf));
    const from = text.indexOf(needle);
    return from < 0
      ? { from: 0, to: Math.min(1, text.length) }
      : { from, to: from + needle.length };
  }

  onMount(() => {
    let disposed = false;
    void Promise.all([
      import('codemirror'),
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/lang-json'),
      import('@codemirror/lint'),
    ]).then(([codeMirror, stateModule, viewModule, jsonModule, lintModule]) => {
      if (disposed) return;
      const { basicSetup } = codeMirror;
      const { EditorState, Compartment } = stateModule;
      const { EditorView } = viewModule;
      const { json, jsonParseLinter } = jsonModule;
      const { linter, lintGutter } = lintModule;
      const parseJson = jsonParseLinter();
      editableCompartment = new Compartment();
      editableExtension = (nextDisabled) => EditorView.editable.of(!nextDisabled);
      forceLinting = lintModule.forceLinting;

      const schemaLinter = linter((view) => {
        const syntaxDiagnostics = parseJson(view);
        if (syntaxDiagnostics.length > 0) return syntaxDiagnostics;
        const text = view.state.doc.toString();
        return diagnostics.map((diagnostic): Diagnostic => ({
          ...diagnosticRange(text, diagnostic.path),
          severity: 'error',
          message: diagnostic.message,
          source: 'JSON Schema',
        }));
      }, { delay: 180 });

      const state = EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          json(),
          lintGutter(),
          schemaLinter,
          editableCompartment.of(editableExtension(disabled)),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': ariaLabel,
            'aria-multiline': 'true',
            'data-focus-ring': 'delegated',
            spellcheck: 'false',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': {
              minHeight: '12rem',
              backgroundColor: 'var(--color-md3-field)',
              color: 'var(--color-md3-on-surface)',
              fontFamily: 'var(--font-md3-mono)',
              fontSize: '0.78rem',
            },
            '.cm-content': { minHeight: '12rem', padding: '0.65rem 0' },
            '.cm-gutters': {
              backgroundColor: 'var(--color-md3-surface-container-high)',
              color: 'var(--color-md3-on-surface-variant)',
              borderRight: '1px solid var(--color-md3-outline)',
            },
            '.cm-activeLine, .cm-activeLineGutter': {
              backgroundColor: 'var(--color-md3-surface-container-highest)',
            },
            '.cm-cursor': { borderLeftColor: 'var(--color-md3-primary)' },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
              backgroundColor: 'color-mix(in srgb, var(--color-md3-primary) 24%, transparent)',
            },
            '&.cm-focused': { outline: '2px solid var(--color-md3-primary)', outlineOffset: '1px' },
            '.cm-tooltip': {
              border: '1px solid var(--color-md3-outline)',
              backgroundColor: 'var(--color-md3-surface-container-high)',
              color: 'var(--color-md3-on-surface)',
            },
          }),
        ],
      });
      editorView = new EditorView({ state, parent: host });
    }).catch(() => {
      loadFailed = true;
    });

    return () => {
      disposed = true;
      editorView?.destroy();
      editorView = null;
    };
  });

  $effect(() => {
    const nextValue = value;
    if (!editorView || editorView.state.doc.toString() === nextValue) return;
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: nextValue },
    });
  });

  $effect(() => {
    const nextDisabled = disabled;
    if (!editorView || !editableCompartment || !editableExtension) return;
    editorView.dispatch({
      effects: editableCompartment.reconfigure(editableExtension(nextDisabled)),
    });
  });

  $effect(() => {
    diagnostics;
    if (editorView && forceLinting) forceLinting(editorView);
  });
</script>

<div class="code-editor" class:disabled>
  <div bind:this={host}></div>
  {#if !editorView && !loadFailed}
    <div class="editor-loading" aria-live="polite">{loadingLabel}</div>
  {:else if loadFailed}
    <textarea
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      spellcheck="false"
      oninput={(event) => onChange(event.currentTarget.value)}
    ></textarea>
  {/if}
</div>

<style>
  .code-editor { position: relative; overflow: hidden; border: 1px solid var(--color-md3-outline); border-radius: 8px; background: var(--color-md3-field); }
  .code-editor.disabled { opacity: 0.55; }
  .editor-loading { display: grid; min-height: 12rem; place-items: center; color: var(--color-md3-on-surface-variant); font: 0.75rem var(--font-md3-sans); }
  textarea { display: block; width: 100%; min-height: 12rem; box-sizing: border-box; resize: vertical; border: 0; padding: 0.7rem; outline: 0; background: transparent; color: var(--color-md3-on-surface); font: 0.78rem/1.5 var(--font-md3-mono); }
  :global(.code-editor .cm-editor) { min-height: 12rem; }
</style>
