<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    inputId: string;
    label: string;
    error?: boolean;
    disabled?: boolean;
    labelContent?: Snippet;
    children: Snippet;
  }
  let { inputId, label, error = false, disabled = false, labelContent, children }: Props = $props();
</script>

<div class="cfms-field" class:cfms-field--error={error} class:cfms-field--disabled={disabled}>
  <label class="cfms-field__label" for={inputId} title={label}>
    {#if labelContent}{@render labelContent()}{:else}{label}{/if}
  </label>
  <div class="cfms-field__content cfms-field-surface">{@render children()}</div>
  <!-- The decorative legend cuts a real notch without painting over translucent surfaces. -->
  <fieldset class="cfms-field__outline" aria-hidden="true">
    <legend><span>{#if labelContent}{@render labelContent()}{:else}{label}{/if}</span></legend>
  </fieldset>
</div>

<style>
  .cfms-field {
    --cfms-outline-color: var(--colorNeutralStroke1);
    position: relative;
    inline-size: 100%;
    min-inline-size: 0;
    padding-block-start: 8px;
    border-radius: var(--borderRadiusMedium);
  }
  .cfms-field__label, .cfms-field__outline legend {
    font: 400 12px/16px var(--fontFamilyBase);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cfms-field__label {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 12px;
    z-index: 1;
    max-inline-size: calc(100% - 24px);
    color: var(--colorNeutralForeground3);
    cursor: text;
    transition: color var(--durationFaster) var(--curveEasyEase);
  }
  .cfms-field__content {
    box-sizing: border-box;
    display: flex;
    min-inline-size: 0;
    min-block-size: var(--cfms-outlined-min-size, 32px);
    align-items: center;
    border: 1px solid transparent;
    border-radius: inherit;
  }
  .cfms-field:has(:global(fluent-text-input[control-size="small"])) { --cfms-outlined-min-size: 24px; }
  .cfms-field__outline {
    box-sizing: border-box;
    position: absolute;
    inset: 0;
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 1px solid var(--cfms-outline-color);
    border-block-end-color: var(--colorNeutralStrokeAccessible);
    border-radius: inherit;
    pointer-events: none;
    transition: border-color var(--durationFaster) var(--curveEasyEase);
  }
  .cfms-field .cfms-field__outline legend {
    margin-block: 0;
    max-inline-size: calc(100% - 16px);
    margin-inline-start: 8px;
    padding-inline: 4px;
  }
  .cfms-field__outline legend span { visibility: hidden; }
  .cfms-field:hover { --cfms-outline-color: var(--colorNeutralStroke1Hover); }
  .cfms-field:focus-within { --cfms-outline-color: var(--colorStrokeFocus2); }
  .cfms-field:focus-within .cfms-field__outline {
    border-color: var(--cfms-outline-color);
    border-block-end-width: 2px;
  }
  .cfms-field:focus-within .cfms-field__label { color: var(--colorBrandForeground1); }
  .cfms-field--error, .cfms-field--error:hover, .cfms-field--error:focus-within,
  .cfms-field:has(:global([aria-invalid="true"])) { --cfms-outline-color: var(--colorStatusDangerBorder1); }
  .cfms-field--error .cfms-field__outline,
  .cfms-field:has(:global([aria-invalid="true"])) .cfms-field__outline { border-color: var(--cfms-outline-color); }
  .cfms-field--error .cfms-field__label,
  .cfms-field:has(:global([aria-invalid="true"])) .cfms-field__label { color: var(--colorStatusDangerForeground1); }
  .cfms-field--disabled,
  .cfms-field:has(:global(:is(input:disabled, textarea:disabled, fluent-text-input[disabled]))) {
    --cfms-outline-color: var(--colorNeutralStrokeDisabled);
  }
  .cfms-field--disabled .cfms-field__label,
  .cfms-field:has(:global(:is(input:disabled, textarea:disabled, fluent-text-input[disabled]))) .cfms-field__label {
    color: var(--colorNeutralForegroundDisabled);
    cursor: default;
  }
  .cfms-field--disabled .cfms-field__outline,
  .cfms-field:has(:global(:is(input:disabled, textarea:disabled, fluent-text-input[disabled]))) .cfms-field__outline {
    border-color: var(--colorNeutralStrokeDisabled);
  }
  @media (pointer: coarse) {
    .cfms-field__content { min-block-size: 44px; }
    .cfms-field__content :global(:is(input, textarea)) { font-size: 16px; }
    .cfms-field__content :global(button) { min-inline-size: 44px; min-block-size: 44px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cfms-field__label, .cfms-field__outline { transition: none; }
  }
  @media (forced-colors: active) {
    .cfms-field { --cfms-outline-color: ButtonText; }
    .cfms-field__label { color: FieldText; }
    .cfms-field:focus-within { --cfms-outline-color: Highlight; }
    .cfms-field:focus-within .cfms-field__label { color: Highlight; }
    .cfms-field--disabled .cfms-field__outline { border-color: GrayText; }
    .cfms-field--disabled .cfms-field__label { color: GrayText; }
  }
</style>
