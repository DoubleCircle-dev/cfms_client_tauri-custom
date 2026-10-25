<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { authStore } from '$lib/stores.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';
  import AuthenticationManagement from '$lib/components/AuthenticationManagement.svelte';
</script>

<div class="workspace-page settings-page-shell">
  {#if authStore.isLoggedIn}
    <AuthenticationManagement>
      {#snippet header(onRefresh, refreshDisabled)}
        <SettingsPageHeader
          title={$t('authManagement.title')}
          description={$t('authManagement.description')}
          icon="passkey"
          {onRefresh}
          {refreshDisabled}
        />
      {/snippet}
    </AuthenticationManagement>
  {:else}
    <SettingsPageHeader title={$t('authManagement.title')} description={$t('authManagement.description')} icon="passkey" />
    <p>{$t('authManagement.signInRequired')}</p>
  {/if}
</div>
