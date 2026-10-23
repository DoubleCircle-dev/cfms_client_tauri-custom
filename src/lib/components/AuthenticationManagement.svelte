<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { getUserAuthentication, setUserAuthPolicies, registerUserAuthPublicKey, updateUserAuthPublicKey, deleteUserAuthPublicKey, serverErrorData, type AuthPolicyStep, type AuthPurpose, type UserAuthentication } from '$lib/api';
  import { AUTH_PURPOSES, changedAuthPolicies } from '$lib/auth-policy-editor';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import DialogActionButton from './DialogActionButton.svelte';
  import ProgressRing from './ProgressRing.svelte';

  let { userId }: { userId?: string } = $props();
  let inventory = $state<UserAuthentication | null>(null);
  let draft = $state<Record<AuthPurpose, AuthPolicyStep[][]>>({ login: [], mfa: [], escalation: [] });
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let conflict = $state(false);
  let publicKey = $state('');
  let label = $state('');
  let now = $state(Date.now());
  const elevated = $derived((authStore.escalationExp ?? 0) * 1000 > now);
  const changed = $derived(inventory ? changedAuthPolicies(inventory.policies, draft) : []);
  const writable = $derived(elevated && !busy && !loading);

  onMount(() => {
    void load();
    const timer = window.setInterval(() => { now = Date.now(); }, 1000);
    return () => window.clearInterval(timer);
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await getUserAuthentication(userId);
      inventory = result;
      draft = Object.fromEntries(AUTH_PURPOSES.map((purpose) => [purpose, structuredClone(result.policies[purpose].chains)])) as typeof draft;
      conflict = false;
    } catch (e) { error = formatUserFacingError(e); }
    finally { loading = false; }
  }

  async function reload() {
    if (changed.length && !(await dialogStore.confirm($t('authManagement.discardChanges')))) return;
    await load();
  }

  async function write(action: () => Promise<unknown>) {
    if (!writable) return;
    busy = true;
    error = '';
    try {
      await action();
      notificationStore.success($t('authManagement.saved'));
    } catch (e) {
      const reason = serverErrorData(e)?.reason;
      conflict = reason === 'revision_conflict';
      const reasons = ['revision_conflict', 'duplicate_public_key', 'login_unavailable', 'escalation_unavailable', 'escalation_required', 'invalid_public_key', 'unsupported_public_key', 'invalid_policy'];
      error = typeof reason === 'string' && reasons.includes(reason) ? $t(`authManagement.errors.${reason}`) : formatUserFacingError(e);
    } finally { busy = false; }
  }

  async function savePolicies() {
    if (!inventory || !changed.length) return;
    const replacements = structuredClone($state.snapshot(changed));
    await write(async () => {
      const result = await setUserAuthPolicies(replacements, userId);
      if (!inventory) return;
      for (const purpose of AUTH_PURPOSES) {
        const policy = result.policies[purpose];
        if (policy) inventory.policies[purpose] = policy;
      }
      conflict = false;
    });
  }

  function addAlternative(purpose: AuthPurpose) {
    const method = Object.keys(inventory?.methods ?? {}).find((name) => inventory?.methods[name].purposes.includes(purpose));
    if (method) draft[purpose].push([{ method, credential_ids: [] }]);
  }

  function setMethod(purpose: AuthPurpose, chainIndex: number, method: string) {
    draft[purpose][chainIndex] = [{ method, credential_ids: [] }];
  }

  function toggleCredential(step: AuthPolicyStep, id: string) {
    step.credential_ids = step.credential_ids.includes(id) ? step.credential_ids.filter((value) => value !== id) : [...step.credential_ids, id];
  }

  async function registerKey(event: SubmitEvent) {
    event.preventDefault();
    if (!publicKey.trim()) return;
    await write(async () => {
      const result = await registerUserAuthPublicKey(publicKey.trim(), label.trim() || null, userId);
      inventory?.credentials.push({ method: 'publickey', credential_id: result.credential_id, active: true, label: result.label, key_identity: result.fingerprint });
      publicKey = '';
      label = '';
    });
  }

  async function editKey(credential: UserAuthentication['credentials'][number]) {
    const next = await dialogStore.prompt({ message: $t('authManagement.keyLabel'), defaultValue: credential.label ?? '', maxLength: 255 });
    if (next === null) return;
    await write(async () => {
      const result = await updateUserAuthPublicKey(credential.credential_id, next.trim() || null, userId);
      credential.label = result.label;
    });
  }

  async function deleteKey(credential: UserAuthentication['credentials'][number]) {
    if (!(await dialogStore.confirm({ title: $t('authManagement.deleteKey'), message: $t('authManagement.deleteKeyConfirm'), danger: true }))) return;
    await write(async () => {
      await deleteUserAuthPublicKey(credential.credential_id, userId);
      if (inventory) inventory.credentials = inventory.credentials.filter((item) => item.credential_id !== credential.credential_id);
    });
  }
</script>

<div class="authentication-management">
  <div class="management-toolbar">
    <p>{$t('authManagement.description')}</p>
    <DialogActionButton disabled={busy || loading} onclick={reload}>{$t('common.refresh')}</DialogActionButton>
  </div>
  {#if error}<p role="alert" class="management-error">{error}</p>{/if}
  {#if loading}
    <ProgressRing label={$t('common.loading')} />
  {:else if inventory}
    <p class="account-id">{$t('manage.userId')}: <span>{inventory.user_id}</span></p>
    {#if !elevated}<p role="status" class="management-notice">{$t('authManagement.elevationRequired')}</p>{/if}
    <section aria-labelledby="authentication-credentials-title">
      <h2 id="authentication-credentials-title">{$t('authManagement.credentials')}</h2>
      {#if !inventory.credentials.length}<p>{$t('authManagement.noCredentials')}</p>{/if}
      <ul class="credential-list">
        {#each inventory.credentials as credential (credential.credential_id)}
          <li>
            <div class="credential-copy">
              <strong>{credential.label || credential.method}</strong>
              <span>{credential.method} · {$t(credential.active ? 'common.enabled' : 'common.disabled')}</span>
              <code>{credential.credential_id}</code>
              {#if credential.key_identity}<code>{credential.key_identity}</code>{/if}
            </div>
            {#if credential.method === 'publickey'}
              <div class="management-actions">
                <DialogActionButton disabled={!writable} onclick={() => editKey(credential)}>{$t('authManagement.editLabel')}</DialogActionButton>
                <DialogActionButton disabled={!writable} onclick={() => deleteKey(credential)}>{$t('common.delete')}</DialogActionButton>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      <form onsubmit={registerKey} class="key-form">
        <h3>{$t('authManagement.registerKey')}</h3>
        <p>{$t('authManagement.keyHelp')}</p>
        <label>{$t('authManagement.publicKey')}<textarea bind:value={publicKey} disabled={!writable} rows="3" spellcheck="false" placeholder="ssh-ed25519 AAAA…"></textarea></label>
        <label>{$t('authManagement.keyLabel')}<input bind:value={label} disabled={!writable} maxlength="255" /></label>
        <div class="management-actions"><DialogActionButton type="submit" variant="primary" disabled={!writable || !publicKey.trim()}>{$t('authManagement.registerKey')}</DialogActionButton></div>
      </form>
    </section>
    <section aria-labelledby="authentication-policies-title">
      <h2 id="authentication-policies-title">{$t('authManagement.policies')}</h2>
      <p>{$t('authManagement.policyHelp')}</p>
      <p class="mt-2">{$t('authManagement.clientMethods')}</p>
      {#each AUTH_PURPOSES as purpose}
        <fieldset class="purpose-editor" disabled={!writable}>
          <legend>{$t(`authManagement.purposes.${purpose}`)} <span>r{inventory.policies[purpose].revision}</span></legend>
          {#if !draft[purpose].length}<p>{$t(`authManagement.empty.${purpose}`)}</p>{/if}
          {#each draft[purpose] as chain, chainIndex}
            <div class="policy-chain">
              <div class="chain-toolbar">
                <label>{$t('authManagement.alternative', { values: { count: chainIndex + 1 } })}
                  <select value={chain[0]?.method ?? ''} onchange={(event) => setMethod(purpose, chainIndex, event.currentTarget.value)}>
                    {#if !inventory.methods[chain[0]?.method]}<option value={chain[0]?.method}>{chain[0]?.method}</option>{/if}
                    {#each Object.entries(inventory.methods) as [method, metadata]}
                      {#if metadata.purposes.includes(purpose)}<option value={method}>{method}</option>{/if}
                    {/each}
                  </select>
                </label>
                <DialogActionButton disabled={!writable} onclick={() => { draft[purpose].splice(chainIndex, 1); }}>{$t('common.delete')}</DialogActionButton>
              </div>
              {#each chain as step, stepIndex}
                <div class="policy-step">
                  <div class="step-toolbar"><strong>{$t('authManagement.step', { values: { count: stepIndex + 1 } })}</strong><DialogActionButton disabled={!writable || chain.length <= 1} onclick={() => { chain.splice(stepIndex, 1); }}>{$t('common.delete')}</DialogActionButton></div>
                  {#each inventory.credentials.filter((credential) => credential.method === step.method) as credential (credential.credential_id)}
                    <label class="credential-choice"><input type="checkbox" checked={step.credential_ids.includes(credential.credential_id)} onchange={() => toggleCredential(step, credential.credential_id)} /><span>{credential.label || credential.credential_id}{credential.active ? '' : ` · ${$t('common.disabled')}`}</span></label>
                  {/each}
                  {#each step.credential_ids.filter((id) => !inventory?.credentials.some((credential) => credential.credential_id === id)) as id}
                    <label class="credential-choice"><input type="checkbox" checked onchange={() => toggleCredential(step, id)} /><span>{$t('authManagement.missingCredential')}: {id}</span></label>
                  {/each}
                  {#if !step.credential_ids.length}<p class="management-notice">{$t('authManagement.selectCredential')}</p>{/if}
                </div>
              {/each}
              <DialogActionButton disabled={!writable || chain[0]?.method !== 'publickey'} onclick={() => { chain.push({ method: chain[0].method, credential_ids: [] }); }}>{$t('authManagement.addStep')}</DialogActionButton>
            </div>
          {/each}
          <DialogActionButton disabled={!writable} onclick={() => addAlternative(purpose)}>{$t('authManagement.addAlternative')}</DialogActionButton>
        </fieldset>
      {/each}
      <div class="management-actions"><DialogActionButton variant="primary" disabled={!writable || !changed.length || conflict || changed.some((policy) => policy.chains.some((chain) => chain.some((step) => !step.credential_ids.length)))} onclick={savePolicies}>{$t('authManagement.savePolicies')}</DialogActionButton></div>
    </section>
  {/if}
</div>

<style>
  .authentication-management { display: flex; min-width: 0; flex-direction: column; gap: 1rem; color: var(--explorer-text); }
  .management-toolbar, .management-actions, .chain-toolbar, .step-toolbar { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
  .management-toolbar p { flex: 1; min-width: 12rem; }
  .management-actions { justify-content: flex-end; }
  section { min-width: 0; border-top: 1px solid var(--explorer-border); padding-top: 1.25rem; }
  h2 { font-size: 1.1rem; font-weight: 650; margin-bottom: .75rem; }
  h3, legend { font-weight: 600; }
  p, .credential-copy span, legend span { color: var(--explorer-text-muted); font-size: .8125rem; line-height: 1.6; }
  .account-id span, code { overflow-wrap: anywhere; font-family: var(--font-md3-mono, monospace); }
  .credential-list { margin-top: .75rem; }
  .credential-list li { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .75rem; padding-block: .875rem; border-bottom: 1px solid var(--explorer-border); }
  .credential-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: .2rem; font-size: .875rem; }
  code { font-size: .75rem; color: var(--explorer-text-muted); }
  .key-form { display: flex; flex-direction: column; gap: .75rem; margin-block: 1.25rem .25rem; }
  label { display: flex; flex-direction: column; gap: .4rem; font-size: .8125rem; }
  input:not([type='checkbox']), textarea, select { min-width: 0; width: 100%; border: 1px solid var(--explorer-border-strong); border-radius: var(--explorer-radius-small); background: var(--explorer-surface-raised); color: var(--explorer-text); padding: .65rem; }
  textarea { resize: vertical; }
  .purpose-editor { min-width: 0; margin-block: 1.25rem; }
  legend { margin-bottom: .6rem; }
  .policy-chain { border: 1px solid var(--explorer-border); border-radius: var(--explorer-radius-medium); padding: 1rem; margin-block: .75rem; }
  .chain-toolbar label { flex: 1; min-width: 8rem; }
  .policy-step { border-top: 1px solid var(--explorer-border); padding-block: .75rem; margin-top: .75rem; }
  .step-toolbar { margin-bottom: .5rem; font-size: .8125rem; }
  .credential-choice { flex-direction: row; align-items: center; padding-block: .4rem; overflow-wrap: anywhere; }
  .credential-choice input { flex: none; accent-color: var(--explorer-accent); }
  .management-error { position: sticky; top: 0; z-index: 2; padding: .75rem; border: 1px solid var(--explorer-danger); border-radius: var(--explorer-radius-small); color: var(--explorer-danger); background: var(--explorer-surface); }
  .management-notice { color: var(--explorer-danger); }
  :disabled { opacity: .55; }
</style>
