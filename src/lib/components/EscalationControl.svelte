<script lang="ts">
  import FluentButton from '$lib/components/FluentButton.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { authStore, serverStateStore } from '$lib/stores.svelte';
  import { escalationRemaining } from '$lib/authentication';
  import { ensureEscalation, escalationFlow } from '$lib/escalation.svelte';
  import AuthenticationDialog from './AuthenticationDialog.svelte';
  import Icon from './Icon.svelte';
  import ProgressRing from './ProgressRing.svelte';

  let now = $state(Date.now());
  const remaining = $derived(escalationRemaining(authStore.escalationExp, now));
  const active = $derived(remaining > 0);

  onMount(() => {
    const timer = window.setInterval(() => { now = Date.now(); }, 1000);
    return () => window.clearInterval(timer);
  });

  $effect(() => {
    if (!authStore.isLoggedIn || !serverStateStore.connected) escalationFlow.cancel();
  });
  onDestroy(() => escalationFlow.cancel());

  async function begin() {
    if (escalationFlow.busy) return;
    if ((authStore.escalationExp ?? 0) * 1000 > Date.now()) await escalationFlow.drop();
    else await ensureEscalation();
    now = Date.now();
  }
</script>

<FluentButton data-fluent-owner="lib-components-escalation-control"
  type="button"
  data-active={active}
  title={$t(active ? 'authentication.exitEscalation' : 'authentication.escalate')}
  aria-label={$t(active ? 'authentication.exitEscalation' : 'authentication.escalate')}
  aria-pressed={active}
  disabled={escalationFlow.busy || (!active && !serverStateStore.connected)}
  onclick={begin}
  appearance="subtle"
  iconOnly
  class="explorer-command-button escalation-button"
>
  {#if escalationFlow.busy}
    <ProgressRing size={18} label={$t('common.verifying')} />
  {:else}
    <Icon name="personKey" size="19px" />
  {/if}
</FluentButton>

{#if escalationFlow.methods && authStore.isLoggedIn}
  {#key escalationFlow.methods}
    {@const onClosed = escalationFlow.dialogCloseHandler()}
    <AuthenticationDialog methods={escalationFlow.methods} title={$t('authentication.escalationTitle')}
      {onClosed} onVerify={(method, data) => escalationFlow.verify(method, data)} onCancel={() => escalationFlow.cancel()} />
  {/key}
{/if}
