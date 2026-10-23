<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { publicKeyError } from '$lib/public-key-errors';
  import ModalFrame from './ModalFrame.svelte';
  import MdOutlinedField from './MdOutlinedField.svelte';
  import DialogActionButton from './DialogActionButton.svelte';
  import ProgressRing from './ProgressRing.svelte';
  let { onUnlock, onCancel }: { onUnlock: (password: string) => Promise<void>; onCancel: () => void } = $props();
  let password = $state('');
  let busy = $state(false);
  let error = $state('');
  let input = $state<HTMLInputElement>();
  onMount(() => input?.focus());
  onDestroy(() => { password = ''; });
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !password) return;
    busy = true; error = '';
    try { await onUnlock(password); }
    catch (e) { error = publicKeyError(e, $t); }
    finally { password = ''; busy = false; }
  }
</script>
<ModalFrame title={$t('publicKey.migrationTitle')} onClose={onCancel} dismissible={!busy} maxWidth="max-w-md">
  <form class="flex flex-col gap-5 p-5" onsubmit={submit}>
    <p class="text-sm text-md3-on-surface-variant">{$t('publicKey.migrationBody')}</p>
    <MdOutlinedField inputId="preference-migration-password" label={$t('publicKey.previousPassword')}>
      <input bind:this={input} id="preference-migration-password" data-focus-ring="delegated" type="password" bind:value={password} disabled={busy} autocomplete="off" class="w-full bg-transparent px-4 py-3 text-md3-on-surface outline-none" />
    </MdOutlinedField>
    {#if error}<p role="alert" class="text-sm text-md3-error">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <DialogActionButton onclick={onCancel} disabled={busy}>{$t('common.cancel')}</DialogActionButton>
      <DialogActionButton type="submit" variant="primary" disabled={busy || !password}>
        {#if busy}<ProgressRing size={16} tone="inherit" label={$t('common.verifying')} />{/if}
        {$t('publicKey.migrate')}
      </DialogActionButton>
    </div>
  </form>
</ModalFrame>
