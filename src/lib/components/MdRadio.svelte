<script lang="ts">
  import '@fluentui/web-components/radio.js';
  import type { Radio } from '@fluentui/web-components';
  import { disabledAttribute } from '$lib/fluent/control';
  interface Props {
    checked?: boolean; disabled?: boolean; ariaLabel?: string; class?: string; onSelect?: () => void;
  }
  let { checked = false, disabled = false, ariaLabel = '', class: className = '', onSelect }: Props = $props();
  const controlId = $props.id();
  let element: Radio | undefined = $state();
  $effect(() => { if (element) element.checked = checked; });
</script>
<label class="cfms-choice-target" for={controlId}><fluent-radio bind:this={element} id={controlId} role="radio" use:disabledAttribute={disabled} aria-label={ariaLabel}
  aria-checked={checked} aria-disabled={disabled || undefined} data-focus-ring="fluent"
  class="cfms-radio {className}" tabindex="0"
  onchange={() => { if (element?.checked && !disabled) onSelect?.(); }}
></fluent-radio></label>
<style>
  .cfms-radio { vertical-align: middle; flex-shrink: 0; }
  .cfms-choice-target { display: inline-flex; align-items: center; justify-content: center; min-inline-size: 28px; min-block-size: 28px; position: relative; }
  @media (pointer: coarse) { .cfms-choice-target { min-block-size: 44px; min-inline-size: 44px; } }
</style>
