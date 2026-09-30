<script lang="ts">
  import { onMount } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { _ as t } from 'svelte-i18n';
  import {
    deleteGithubToken,
    getGithubAuthStatus,
    saveGithubToken,
    type GithubAuthMode,
  } from '$lib/api';
  import { resetGithubAuthNotice } from '$lib/github-auth-notices';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  const tokenGuideUrl = 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token';
  const rateLimitsUrl = 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api';

  let mode = $state<GithubAuthMode>('none');
  let token = $state('');
  let loading = $state(true);
  let busy = $state(false);

  const canSave = $derived(!loading && !busy && mode !== 'unavailable' && token.trim().length > 0);
  const canRemove = $derived(!loading && !busy && (mode === 'configured' || mode === 'needs_attention'));
  const stateIcon = $derived(mode === 'configured' ? 'verified' : mode === 'needs_attention' ? 'warning' : mode === 'unavailable' ? 'help' : 'info');

  onMount(() => {
    void refreshStatus();
  });

  async function refreshStatus() {
    loading = true;
    try {
      mode = (await getGithubAuthStatus()).mode;
    } catch {
      mode = 'unavailable';
    } finally {
      loading = false;
    }
  }

  async function saveToken() {
    if (!canSave) return;
    busy = true;
    try {
      await saveGithubToken(token.trim());
      token = '';
      mode = 'configured';
      resetGithubAuthNotice();
      notificationStore.success($t('settings.githubApi.saved'));
    } catch {
      await refreshStatus();
      notificationStore.error($t('settings.githubApi.saveFailed'));
    } finally {
      busy = false;
    }
  }

  async function removeToken() {
    if (!canRemove) return;
    busy = true;
    try {
      await deleteGithubToken();
      token = '';
      mode = 'none';
      resetGithubAuthNotice();
      notificationStore.success($t('settings.githubApi.removed'));
    } catch {
      await refreshStatus();
      notificationStore.error($t('settings.githubApi.removeFailed'));
    } finally {
      busy = false;
    }
  }

  async function openDocumentation(url: string) {
    try {
      await openUrl(url);
    } catch {
      notificationStore.error($t('settings.githubApi.docsOpenFailed'));
    }
  }
</script>

<div class="workspace-page settings-page-shell github-api-page">
  <SettingsPageHeader
    title={$t('settings.githubApi.title')}
    description={$t('settings.githubApi.description')}
    icon="api"
  />

  <div class="settings-section-list">
    <section class="settings-section github-api-section" aria-labelledby="github-api-status-title">
      <div class="settings-section-heading">
        <h2 id="github-api-status-title">{$t('settings.githubApi.statusTitle')}</h2>
        <p>{$t('settings.githubApi.purpose')}</p>
      </div>

      <div class="credential-status credential-status--{mode}" role="status" aria-live="polite" aria-busy={loading}>
        <span class="credential-status__icon" aria-hidden="true"><Icon name={stateIcon} size="20px" /></span>
        <div class="credential-status__copy">
          <strong>{$t(`settings.githubApi.status.${loading ? 'checking' : mode}`)}</strong>
          <span>{$t(`settings.githubApi.statusHint.${loading ? 'checking' : mode}`)}</span>
        </div>
      </div>

      {#if mode === 'unavailable' && !loading}
        <button type="button" class="secondary-action" onclick={refreshStatus} disabled={busy}>
          <Icon name="refresh" size="18px" />
          {$t('settings.githubApi.retryStatus')}
        </button>
      {/if}
    </section>

    <section class="settings-section github-api-section" aria-labelledby="github-api-token-title">
      <div class="settings-section-heading">
        <h2 id="github-api-token-title">{$t('settings.githubApi.tokenTitle')}</h2>
        <p>{$t('settings.githubApi.tokenHint')}</p>
      </div>

      <form class="credential-form" onsubmit={(event) => { event.preventDefault(); void saveToken(); }}>
        <label for="github-api-token">{$t('settings.githubApi.tokenLabel')}</label>
        <input
          id="github-api-token"
          type="password"
          autocomplete="new-password"
          autocapitalize="none"
          spellcheck="false"
          placeholder={$t('settings.githubApi.tokenPlaceholder')}
          bind:value={token}
          disabled={loading || busy || mode === 'unavailable'}
        />
        <div class="credential-actions">
          <button type="submit" class="primary-action" disabled={!canSave}>
            <Icon name="check" size="18px" />
            {$t(mode === 'none' ? 'settings.githubApi.save' : 'settings.githubApi.replace')}
          </button>
          {#if mode === 'configured' || mode === 'needs_attention'}
            <button type="button" class="remove-action" onclick={removeToken} disabled={!canRemove}>
              <Icon name="delete" size="18px" />
              {$t('settings.githubApi.remove')}
            </button>
          {/if}
        </div>
      </form>
    </section>

    <div class="settings-section github-api-section">
      <div class="github-api-guidance">
        <p>{$t('settings.githubApi.rateLimitHint')}</p>
        <p>{$t('settings.githubApi.permissionsHint')}</p>
      </div>
      <div class="documentation-links">
        <a href={tokenGuideUrl} target="_blank" rel="noopener noreferrer" onclick={(event) => { event.preventDefault(); void openDocumentation(tokenGuideUrl); }}>
          {$t('settings.githubApi.createTokenLink')}
        </a>
        <a href={rateLimitsUrl} target="_blank" rel="noopener noreferrer" onclick={(event) => { event.preventDefault(); void openDocumentation(rateLimitsUrl); }}>
          {$t('settings.githubApi.rateLimitsLink')}
        </a>
      </div>
    </div>
  </div>
</div>

<style>
  .github-api-section {
    display: grid;
    gap: 1rem;
  }

  .credential-status {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    min-height: 3rem;
  }

  .credential-status__icon {
    display: grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    color: var(--color-md3-on-surface-variant);
  }

  .credential-status--configured .credential-status__icon { color: var(--color-md3-success); }
  .credential-status--needs_attention .credential-status__icon { color: var(--color-md3-warning); }

  .credential-status__copy {
    display: grid;
    gap: 0.2rem;
  }

  .credential-status__copy strong {
    color: var(--color-md3-on-surface);
    font: 650 0.875rem/1.4 var(--font-md3-sans);
  }

  .credential-status__copy span {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .credential-form {
    display: grid;
    justify-items: start;
    gap: 0.65rem;
  }

  .credential-form label {
    color: var(--color-md3-on-surface);
    font: 650 0.8125rem/1.35 var(--font-md3-sans);
  }

  .credential-form input {
    width: min(100%, 30rem);
    min-height: 2.75rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: 8px;
    padding: 0.65rem 0.85rem;
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
    font: 0.875rem/1.4 var(--font-md3-sans);
  }

  .credential-form input:disabled { opacity: 0.55; }
  .credential-actions,
  .documentation-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .primary-action,
  .secondary-action,
  .remove-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 2.5rem;
    border-radius: 6px;
    padding: 0.45rem 0.85rem;
    font: 650 0.8125rem/1.25 var(--font-md3-sans);
    transition: background-color var(--motion-duration-short4) var(--motion-easing-standard), transform var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .primary-action {
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  .secondary-action {
    justify-self: start;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .remove-action {
    color: var(--color-md3-error);
    background: transparent;
  }

  .primary-action:hover:not(:disabled),
  .secondary-action:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
  .remove-action:hover:not(:disabled) { background: color-mix(in srgb, var(--color-md3-error) 9%, transparent); }
  .credential-actions button:disabled { cursor: not-allowed; opacity: 0.55; }

  .github-api-guidance {
    display: grid;
    gap: 0.24rem;
  }

  .github-api-guidance p {
    max-width: 70ch;
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.74rem;
    line-height: 1.5;
  }

  .documentation-links { gap: 1.25rem; }

  .documentation-links a {
    display: inline-flex;
    align-items: center;
    min-height: 2.5rem;
    color: var(--color-md3-primary-emphasis);
    font: 500 0.8rem/1.4 var(--font-md3-sans);
    text-decoration: underline;
    text-underline-offset: 0.2rem;
  }

  .documentation-links a:hover { text-decoration-thickness: 2px; }
  .documentation-links a:focus-visible { outline-offset: 2px; }

  @media (max-width: 420px) {
    .credential-actions { width: 100%; }
    .credential-actions button { width: 100%; }
  }
</style>
