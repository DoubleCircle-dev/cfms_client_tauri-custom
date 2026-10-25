<script lang="ts">
  import FluentButton from '$lib/components/FluentButton.svelte';
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { dropEscalation, getUserAuthentication, requestEscalation, type JsonValue } from '$lib/api';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import { escalationMethods, escalationRemaining } from '$lib/authentication';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import AuthenticationDialog from './AuthenticationDialog.svelte';
  import Icon from './Icon.svelte';
  import ProgressRing from './ProgressRing.svelte';

  let busy = $state(false);
  let methods = $state<string[] | null>(null);
  let now = $state(Date.now());
  const remaining = $derived(escalationRemaining(authStore.escalationExp, now));
  const active = $derived(remaining > 0);

  onMount(() => {
    const timer = window.setInterval(() => { now = Date.now(); }, 1000);
    return () => window.clearInterval(timer);
  });

  async function begin() {
    if (busy) return;
    busy = true;
    try {
      if (active) {
        authStore.apply(await dropEscalation());
        now = Date.now();
        return;
      }
      const authentication = await getUserAuthentication();
      if (!authStore.isLoggedIn) return;
      if (authentication.policies.escalation.chains.length === 0) {
        authStore.apply(await requestEscalation());
        now = Date.now();
      } else {
        const available = escalationMethods(authentication);
        if (!available.length) throw new Error($t('authentication.unavailable'));
        methods = available;
      }
    } catch (e) {
      notificationStore.error(formatUserFacingError(e));
    } finally {
      busy = false;
    }
  }

  async function verify(method: string, data: Record<string, JsonValue>) {
    authStore.apply(await requestEscalation(method, data));
    now = Date.now();
    methods = null;
    return true;
  }
</script>

<FluentButton data-fluent-owner="lib-components-escalation-control"
  type="button"
  data-active={active}
  title={$t(active ? 'authentication.exitEscalation' : 'authentication.escalate')}
  aria-label={$t(active ? 'authentication.exitEscalation' : 'authentication.escalate')}
  aria-pressed={active}
  disabled={busy || (!active && !serverStateStore.connected)}
  onclick={begin}
  appearance="subtle"
  iconOnly
  class="explorer-command-button escalation-button"
>
  {#if busy}
    <ProgressRing size={18} label={$t('common.verifying')} />
  {:else}
    <Icon name="adminPanelSettings" size="19px" />
  {/if}
</FluentButton>

{#if methods && authStore.isLoggedIn}
  <AuthenticationDialog {methods} title={$t('authentication.escalationTitle')} onVerify={verify} onCancel={() => { methods = null; }} />
{/if}
