<script lang="ts">
  import { untrack, tick, onDestroy } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { JsonValue } from '$lib/api';
  import { supportedVerificationMethods } from '$lib/authentication';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import TwoFactorVerifyDialog from './TwoFactorVerifyDialog.svelte';
  import ModalFrame from './ModalFrame.svelte';
  import DialogActionButton from './DialogActionButton.svelte';
  import MdOutlinedField from './MdOutlinedField.svelte';
  import ProgressRing from './ProgressRing.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from '$lib/icons';
  import PublicKeyVerification from './PublicKeyVerification.svelte';
  import type { PublicKeyInteraction } from '$lib/api';

  let { methods, onVerify, onCancel, title, allowPublicKey = false }: {
    methods: string[];
    title: string;
    onVerify: (method: string, data: Record<string, JsonValue>, onInteraction?: (event: PublicKeyInteraction) => void) => Promise<boolean>;
    onCancel: () => void;
    allowPublicKey?: boolean;
  } = $props();
  const methodIcons: Record<string, IconName> = { password: 'password', totp: 'personPasskey', publickey: 'passkey' };
  const available = $derived(methods.filter((method) => supportedVerificationMethods.includes(method) || (allowPublicKey && method === 'publickey')));
  let selected = $state<string | null>(untrack(() => available.length === 1 ? available[0] : null));
  let password = $state('');
  let busy = $state(false);
  let error = $state('');
  let passwordInput = $state<HTMLInputElement>();
  onDestroy(() => { password = ''; });

  $effect(() => {
    if (selected === 'password') void tick().then(() => passwordInput?.focus());
    else password = '';
  });

  async function verifyPassword(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !password) return;
    busy = true;
    error = '';
    try {
      if (!(await onVerify('password', { password }))) error = $t('authentication.failed');
    } catch (e) {
      error = formatUserFacingError(e);
    } finally {
      busy = false;
      password = '';
    }
  }
</script>

{#if selected === 'totp'}
  <TwoFactorVerifyDialog
    {title}
    onVerify={(token) => onVerify('totp', { token })}
    {onCancel}
    onBack={available.length > 1 ? () => { selected = null; } : undefined}
  />
{:else}
  <ModalFrame {title} maxWidth="max-w-md" dismissible={!busy} onClose={onCancel} closeLabel={$t('common.close')}>
    {#if selected === 'publickey'}
      <PublicKeyVerification
        onVerify={(keyRef, passphrase, receive) => onVerify('publickey', { keyRef, passphrase }, receive)}
        {onCancel}
        onBack={available.length > 1 ? () => { selected = null; } : undefined}
      />
    {:else if selected === 'password'}
      <form class="flex flex-col gap-5 p-5" onsubmit={verifyPassword}>
        <p class="text-sm text-md3-on-surface-variant">{$t('authentication.passwordPrompt')}</p>
        <MdOutlinedField inputId="authentication-password" label={$t('login.password')}>
          <input bind:this={passwordInput} id="authentication-password" data-focus-ring="delegated" type="password" bind:value={password} autocomplete="current-password" disabled={busy} class="cfms-native-field w-full px-4 text-md3-on-surface" />
        </MdOutlinedField>
        {#if error}<p role="alert" class="text-sm text-md3-error">{error}</p>{/if}
        <div class="flex justify-end gap-2">
          {#if available.length > 1}
            <DialogActionButton disabled={busy} onclick={() => { selected = null; }}>{$t('common.back')}</DialogActionButton>
          {/if}
          <DialogActionButton disabled={busy} onclick={onCancel}>{$t('common.cancel')}</DialogActionButton>
          <DialogActionButton type="submit" variant="primary" disabled={busy || !password}>
            {#if busy}<ProgressRing size={16} tone="inherit" label={$t('common.verifying')} />{/if}
            {$t('dialog.twoFactor.verify')}
          </DialogActionButton>
        </div>
      </form>
    {:else}
      <div class="flex flex-col gap-4 p-5">
        <p class="text-sm text-md3-on-surface-variant">{$t(available.length ? 'authentication.chooseMethod' : 'authentication.unsupported', { values: { methods: methods.join(', ') || '—' } })}</p>
        <div class="flex flex-wrap gap-2">
          {#each available as method}
            <DialogActionButton onclick={() => { selected = method; }}>
              <Icon name={methodIcons[method] ?? 'more'} size="20px" />
              {$t(`authentication.${method}`)}
            </DialogActionButton>
          {/each}
        </div>
        <div class="flex justify-end"><DialogActionButton onclick={onCancel}>{$t('common.cancel')}</DialogActionButton></div>
      </div>
    {/if}
  </ModalFrame>
{/if}
