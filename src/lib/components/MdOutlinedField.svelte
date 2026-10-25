<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { inputId: string; label: string; error?: boolean; children: Snippet; }
  let { inputId, label, error = false, children }: Props = $props();
</script>
<div class="cfms-field" class:cfms-field--error={error}>
  <label class="cfms-field__label" for={inputId}>{label}</label>
  <div class="cfms-field__content cfms-field-surface">{@render children()}</div>
</div>
<style>
  .cfms-field { min-width: 0; }
  .cfms-field__label { display: block; margin-block-end: 8px; color: var(--colorNeutralForeground1); font: 400 14px/20pxpx var(--fontFamilyBase); }
  .cfms-field__content {
    display: flex; min-block-size: 32px; align-items: center; overflow: hidden;
    border: 1px solid var(--colorNeutralStroke1); border-block-end-color: var(--colorNeutralStrokeAccessible);
    border-radius: var(--borderRadiusMedium); background: var(--colorNeutralBackground1);
    transition: border-color var(--durationFaster) var(--curveEasyEase);
  }
  .cfms-field__content:focus-within { border-block-end-color: var(--colorStrokeFocus2); box-shadow: inset 0 -1px var(--colorStrokeFocus2); }
  .cfms-field--error .cfms-field__content { border-color: var(--colorStatusDangerBorder1); }
  .cfms-field--error .cfms-field__content:focus-within { box-shadow: inset 0 -1px var(--colorStatusDangerBorder1); }
  @media (pointer: coarse) {
    .cfms-field__content { min-block-size: 44px; }
    .cfms-field__content :global(input) { font-size: 16px; }
    .cfms-field__content :global(button) { min-inline-size: 44px; min-block-size: 44px; }
  }
  @media (forced-colors: active) { .cfms-field__content:focus-within { outline: 2px solid Highlight; outline-offset: -2px; } }
</style>
