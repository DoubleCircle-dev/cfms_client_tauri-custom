<script lang="ts">
  import '@fluentui/web-components/switch.js';
  import type { Switch } from '@fluentui/web-components';
  import { disabledAttribute } from '$lib/fluent/control';
  interface Props {
    checked?: boolean; disabled?: boolean; ariaLabel?: string; class?: string;
    onChange?: (checked: boolean) => void;
  }
  let { checked = $bindable(false), disabled = false, ariaLabel = '', class: className = '', onChange }: Props = $props();
  const controlId = $props.id();
  let element: Switch | undefined = $state();
  $effect(() => { if (element) element.checked = checked; });
</script>
<label class="cfms-choice-target" for={controlId}><fluent-switch bind:this={element} id={controlId} role="switch" use:disabledAttribute={disabled} aria-label={ariaLabel}
  aria-checked={checked} aria-disabled={disabled || undefined} data-focus-ring="fluent"
  class="cfms-switch {className}"
  onchange={() => { if (element && !disabled) { checked = element.checked; onChange?.(checked); } }}
></fluent-switch></label>
<style>
  .cfms-switch { vertical-align: middle; flex-shrink: 0; }
  .cfms-choice-target { display: inline-flex; align-items: center; justify-content: center; min-inline-size: 28px; min-block-size: 28px; position: relative; }
  @media (pointer: coarse) { .cfms-choice-target { min-block-size: 44px; min-inline-size: 44px; } }
</style>
