<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  let { value, disabled = false, onchange }: { value: 'password' | 'publickey'; disabled?: boolean; onchange: (value: 'password' | 'publickey') => void } = $props();
  const optionsId = $props.id();
  let expanded = $state(false);
</script>

<div class="sign-in-options">
  <button
    type="button"
    class="options-toggle"
    aria-expanded={expanded}
    aria-controls={optionsId}
    {disabled}
    onclick={() => (expanded = !expanded)}
  >
    {$t('publicKey.signInOptions')}
    <span class="options-chevron" class:expanded><Icon name="expandMore" size="16px" /></span>
  </button>
  <div id={optionsId} class="options-row" hidden={!expanded} role="group" aria-label={$t('publicKey.signInOptions')}>
    <IconButton icon="password" label={$t('publicKey.passwordOption')} active={value === 'password'} {disabled} size={18} class="sign-in-method" onclick={() => onchange('password')} />
    <IconButton icon="passkey" label={$t('publicKey.keyOption')} active={value === 'publickey'} {disabled} size={18} class="sign-in-method" onclick={() => onchange('publickey')} />
  </div>
</div>

<style>
  .sign-in-options { min-width: 0; }
  .options-toggle { display: flex; align-items: center; justify-content: center; gap: 0.25rem; min-height: 32px; margin: 0 auto; padding: 0.25rem 0.5rem; border: 0; border-radius: 5px; background: transparent; color: var(--explorer-text-muted); font-size: 0.75rem; cursor: pointer; }
  .options-toggle:hover:not(:disabled) { color: var(--explorer-text); background: var(--explorer-surface-hover); }
  .options-toggle:disabled { opacity: 0.5; cursor: default; }
  .options-chevron { display: flex; transition: transform 140ms var(--motion-easing-standard); }
  .options-chevron.expanded { transform: rotate(180deg); }
  .options-row { display: flex; justify-content: center; gap: 0.5rem; padding-top: 0.5rem; }
  .options-row[hidden] { display: none; }
  @media (pointer: coarse) {
    .options-toggle { min-height: 44px; }
    .options-row :global(.sign-in-method) { inline-size: 44px; block-size: 44px; }
  }
  @media (prefers-reduced-motion: reduce) { .options-chevron { transition: none; } }
</style>
