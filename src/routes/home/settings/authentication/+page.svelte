<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { authStore } from '$lib/stores.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';
  import AuthenticationManagement from '$lib/components/AuthenticationManagement.svelte';
</script>

<div class="workspace-page settings-page-shell">
  <SettingsPageHeader title={$t('authManagement.title')} icon="passkey" />
  {#if authStore.isLoggedIn}
    <AuthenticationManagement />
  {:else}
    <p>{$t('authManagement.signInRequired')}</p>
  {/if}
</div>
