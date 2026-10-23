<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import Icon from './Icon.svelte';
  let { value, disabled = false, onchange }: { value: 'password' | 'publickey'; disabled?: boolean; onchange: (value: 'password' | 'publickey') => void } = $props();
</script>

<fieldset class="sign-in-options" {disabled}>
  <legend>{$t('publicKey.signInOptions')}</legend>
  <div class="options-row">
    {#each ['password', 'publickey'] as method}
      <label class:selected={value === method}>
        <input type="radio" data-focus-ring="delegated" name="sign-in-method" value={method} checked={value === method} onchange={() => onchange(method as 'password' | 'publickey')} />
        <Icon name={method === 'password' ? 'password' : 'passkey'} size="21px" />
        <span>{$t(method === 'password' ? 'publicKey.passwordOption' : 'publicKey.keyOption')}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .sign-in-options { border: 0; padding: 0; margin: 0; min-width: 0; }
  legend { width: 100%; margin-bottom: 0.75rem; text-align: center; color: var(--explorer-text-muted); font-size: 0.75rem; }
  .options-row { display: flex; justify-content: center; gap: 0.75rem; }
  label { position: relative; display: flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 44px; min-width: 104px; padding: 0.5rem 0.875rem; border: 1px solid var(--explorer-border); border-radius: 8px; background: transparent; color: var(--explorer-text-muted); font-size: 0.8125rem; cursor: pointer; transition: background 140ms ease, color 140ms ease, border-color 140ms ease; }
  label:hover { color: var(--explorer-text); background: var(--explorer-surface-hover); }
  label.selected { border-color: var(--explorer-accent); color: var(--explorer-accent); background: color-mix(in srgb, var(--explorer-accent) 9%, transparent); }
  input { position: absolute; width: 100%; height: 100%; inset: 0; margin: 0; opacity: 0; cursor: inherit; }
  label:focus-within { outline: 2px solid var(--explorer-accent); outline-offset: 3px; }
  .sign-in-options:disabled label { opacity: 0.5; cursor: default; }
  @media (prefers-reduced-motion: reduce) { label { transition: none; } }
</style>
