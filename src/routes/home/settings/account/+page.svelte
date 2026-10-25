<script lang="ts">
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { renameUser } from '$lib/api';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import AvatarPreview from '$lib/components/AvatarPreview.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  const NICKNAME_MAX_LENGTH = 255;
  let editingNickname = $state(false);
  let nicknameInput = $state('');
  let nicknameInputElement = $state<HTMLInputElement | null>(null);
  let nicknameBusy = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  const cleanNickname = $derived(nicknameInput.trim() || null);
  const nicknameCharacterCount = $derived(Array.from(nicknameInput.trim()).length);
  const nicknameTooLong = $derived(nicknameCharacterCount > NICKNAME_MAX_LENGTH);
  const nicknameChanged = $derived.by(() => {
    const username = authStore.username;
    if (!username) return false;
    return (cleanNickname ?? username) !== (authStore.displayName ?? username);
  });
  const canSaveNickname = $derived(
    authStore.isLoggedIn
      && Boolean(authStore.username)
      && nicknameChanged
      && !nicknameTooLong
      && !nicknameBusy,
  );
  $effect(() => {
    if (!status) return;
    notificationStore.success(status, 5000);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  async function beginNicknameEdit() {
    if (!authStore.isLoggedIn || !authStore.username || nicknameBusy) return;
    nicknameInput = authStore.displayName ?? authStore.username;
    editingNickname = true;
    await tick();
    nicknameInputElement?.focus();
    nicknameInputElement?.select();
  }

  function cancelNicknameEdit() {
    if (nicknameBusy) return;
    nicknameInput = '';
    editingNickname = false;
  }

  function handleNicknameKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancelNicknameEdit();
  }

  async function saveNickname() {
    const username = authStore.username;
    if (!canSaveNickname || !username) return;

    nicknameBusy = true;
    try {
      const success = await renameUser(authStore.userId!, cleanNickname);
      if (!success) throw new Error($t('settings.account.nicknameUpdateFailed'));

      if (authStore.isLoggedIn && authStore.username === username) {
        authStore.nickname = cleanNickname ?? username;
      }
      nicknameInput = '';
      editingNickname = false;
      status = $t('settings.account.nicknameUpdated');
    } catch (err) {
      error = formatUserFacingError(err);
    } finally {
      nicknameBusy = false;
    }
  }

</script>

<div class="workspace-page settings-page-shell account-settings-page">
  <SettingsPageHeader
    title={$t('settings.account.title')}
    description={$t('settings.account.description')}
    icon="accountCircle"
  />

  <div class="account-sections">
  <section
    class="identity-panel account-section"
    aria-label={$t('settings.account.nicknameLabel')}
  >
    <div class="identity-summary">
      <div class="identity-avatar">
        <AvatarPreview
          username={authStore.username ?? $t('common.unknownUser')}
          size={52}
          avatarPath={authStore.avatarPath}
        />
      </div>

      <div class="identity-copy">
        <h2>{authStore.displayName ?? authStore.username ?? $t('common.unknown')}</h2>
        {#if authStore.username && authStore.displayName !== authStore.username}
          <p class="identity-username">@{authStore.username}</p>
        {/if}
        {#if authStore.groups.length > 0}
          <p class="identity-groups">
            <Icon name="groups" size="15px" />
            <span>{authStore.groups.join(', ')}</span>
          </p>
        {/if}
      </div>

      {#if !editingNickname}
        <button
          type="button"
          class="action-button action-button--secondary identity-edit-button"
          title={$t('settings.account.editNickname')}
          aria-label={$t('settings.account.editNickname')}
          disabled={!authStore.isLoggedIn || !authStore.username}
          onclick={() => void beginNicknameEdit()}
        >
          <Icon name="edit" size="18px" />
          <span>{$t('settings.account.editNickname')}</span>
        </button>
      {/if}
    </div>

    {#if editingNickname}
      <form
        class="nickname-editor"
        aria-label={$t('settings.account.editNickname')}
        onsubmit={(event) => {
          event.preventDefault();
          void saveNickname();
        }}
      >
        <label
          for="account-nickname-input"
          class="nickname-editor__label"
        >
          {$t('settings.account.nicknameLabel')}
        </label>

        <div class="nickname-editor__field">
          <div class="field-with-count">
            <input
              id="account-nickname-input"
              bind:this={nicknameInputElement}
              bind:value={nicknameInput}
              class="text-field text-field--counted"
              class:text-field--error={nicknameTooLong}
              type="text"
              name="nickname"
              autocomplete="off"
              aria-describedby="nickname-help nickname-count"
              aria-invalid={nicknameTooLong}
              disabled={nicknameBusy}
              onkeydown={handleNicknameKeydown}
            />
            <span
              id="nickname-count"
              class="field-count"
              class:field-count--error={nicknameTooLong}
            >
              {nicknameCharacterCount}/{NICKNAME_MAX_LENGTH}
            </span>
          </div>
          <span
            id="nickname-help"
            class="field-help"
            class:field-help--error={nicknameTooLong}
          >
            {$t(nicknameTooLong
              ? 'settings.account.nicknameTooLong'
              : 'settings.account.nicknameHint', {
                values: { max: NICKNAME_MAX_LENGTH },
              })}
          </span>
        </div>

        <div class="nickname-editor__actions">
          <button
            type="button"
            class="action-button action-button--secondary"
            title={$t('common.cancel')}
            aria-label={$t('common.cancel')}
            disabled={nicknameBusy}
            onclick={cancelNicknameEdit}
          >
            <Icon name="close" size="18px" />
            <span>{$t('common.cancel')}</span>
          </button>
          <button
            type="submit"
            class="action-button action-button--primary"
            title={$t(nicknameBusy ? 'common.saving' : 'common.save')}
            aria-label={$t(nicknameBusy ? 'common.saving' : 'common.save')}
            disabled={!canSaveNickname}
          >
            {#if nicknameBusy}
              <ProgressRing size={17} strokeWidth={2.2} label={$t('common.saving')} tone="inherit" />
            {:else}
              <Icon name="check" size="18px" />
            {/if}
            <span>{$t(nicknameBusy ? 'common.saving' : 'common.save')}</span>
          </button>
        </div>
      </form>
    {/if}
  </section>

  <section class="account-section authentication-link">
    <div><h2>{$t('authManagement.title')}</h2><p>{$t('authManagement.description')}</p></div>
    <button type="button" class="action-button action-button--secondary" onclick={() => goto('/home/settings/authentication')}><Icon name="passkey" size="18px" />{$t('authManagement.title')}</button>
  </section>
  </div>
</div>

<style>
  .account-settings-page {
    gap: 1rem;
  }

  .account-sections {
    border-top: 1px solid var(--color-md3-outline);
  }

  .account-section + .account-section {
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
  }

  .identity-panel {
    min-width: 0;
  }

  .identity-summary {
    display: grid;
    min-width: 0;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.9rem 0;
  }

  .identity-avatar {
    display: grid;
    border-radius: 9999px;
  }

  .identity-copy {
    min-width: 0;
  }

  .identity-copy h2,
  .identity-copy p {
    margin: 0;
  }

  .identity-copy h2 {
    overflow: hidden;
    color: var(--color-md3-on-surface);
    font: 700 1.08rem/1.28 var(--font-md3-sans);
    letter-spacing: -0.012em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity-username,
  .identity-groups {
    overflow: hidden;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.74rem;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity-username {
    margin-top: 0.2rem !important;
  }

  .identity-groups {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.35rem !important;
  }

  .identity-groups span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nickname-editor {
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.85rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
    padding: 0.9rem 0 1rem;
  }

  .nickname-editor__label {
    min-height: 42px;
    display: flex;
    align-items: center;
    color: var(--color-md3-on-surface);
    font: 650 0.8rem/1.3 var(--font-md3-sans);
  }

  .nickname-editor__field {
    min-width: 0;
  }

  .field-with-count {
    position: relative;
  }

  .text-field {
    width: 100%;
    min-height: 42px;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    padding: 0.58rem 0.75rem;
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
    font: 400 0.84rem/1.35 var(--font-md3-sans);
    transition:
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      box-shadow var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .text-field--counted {
    padding-inline-end: 4.5rem;
  }

  .text-field--error {
    border-color: var(--color-md3-error);
  }

  .text-field:disabled {
    cursor: not-allowed;
    opacity: 0.58;
  }

  .field-count {
    position: absolute;
    top: 50%;
    right: 0.75rem;
    color: var(--color-md3-on-surface-variant);
    font: 0.68rem/1 var(--font-md3-mono);
    font-variant-numeric: tabular-nums;
    transform: translateY(-50%);
  }

  .field-count--error,
  .field-help--error {
    color: var(--color-md3-error);
  }

  .field-help {
    display: block;
    margin-top: 0.35rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.68rem;
    line-height: 1.45;
  }

  .nickname-editor__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .nickname-editor__actions {
    min-height: 42px;
    align-items: center;
  }

  .action-button {
    display: inline-flex;
    min-height: 34px;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.42rem;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 5px);
    padding: 0.42rem 0.72rem;
    font: 650 0.76rem/1 var(--font-md3-sans);
    transition:
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      color var(--motion-duration-short3) var(--motion-easing-standard),
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .action-button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .action-button:active:not(:disabled) {
    transform: scale(0.97);
  }

  .action-button:disabled {
    cursor: not-allowed;
    opacity: 0.44;
  }

  .action-button--primary {
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  .action-button--primary:hover:not(:disabled) {
    background: var(--color-md3-primary-emphasis);
  }

  .action-button--secondary {
    border-color: var(--color-md3-outline);
    color: var(--color-md3-on-surface);
    background: transparent;
  }

  .action-button--secondary:hover:not(:disabled) {
    background: var(--color-md3-surface-container-high);
  }

  .authentication-link { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1.25rem 0; }
  .authentication-link h2 { margin: 0; font-size: .9375rem; font-weight: 600; }
  .authentication-link p { font-size: .8125rem; color: var(--color-md3-on-surface-variant); margin: .35rem 0 0; }
  @media (max-width: 640px) { .nickname-editor { grid-template-columns: 1fr; } .identity-summary { grid-template-columns: auto minmax(0, 1fr); } .identity-edit-button { grid-column: 2; justify-self: start; } .authentication-link { flex-wrap: wrap; } }
  @media (pointer: coarse) { .action-button { min-height: 44px; } }
  @media (prefers-reduced-motion: reduce) { .action-button, .text-field { transition: none; } }
</style>
