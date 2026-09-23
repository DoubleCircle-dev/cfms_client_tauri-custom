<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import type { Capability, PermissionExplanation } from '$lib/permission-explainer';

  /**
   * Literal keys, so the unused-message checker keeps seeing them.
   */
  const CAPABILITY_LABELS: Record<Capability, string> = {
    view: 'files.permissionCapabilityView',
    download: 'files.permissionCapabilityDownload',
    modify: 'files.permissionCapabilityModify',
    delete: 'files.permissionCapabilityDelete',
  };

  const STATE_LABELS = {
    granted: 'files.permissionStateGranted',
    denied: 'files.permissionStateDenied',
    unverified: 'files.permissionStateUnverified',
  } as const;

  const STATE_ICONS = {
    granted: 'check',
    denied: 'close',
    unverified: 'help',
  } as const;

  let {
    title,
    description,
    subject = '',
    details = [],
    explanation = null,
    actionLabel = '',
    presentation = 'page',
    onAction,
  }: {
    title: string;
    description: string;
    subject?: string;
    details?: Array<{ label: string; value: string }>;
    /** Optional permission breakdown behind the refusal. */
    explanation?: PermissionExplanation | null;
    actionLabel?: string;
    presentation?: 'page' | 'dialog';
    onAction?: () => void;
  } = $props();

  let whyExpanded = $state(false);
</script>

<section
  class="access-denied-notice"
  class:access-denied-notice--dialog={presentation === 'dialog'}
  aria-label={title}
  aria-live="polite"
>
  <div class="access-denied-icon" aria-hidden="true">
    <Icon name="lock" size={presentation === 'dialog' ? '44px' : '54px'} />
    <span class="access-denied-badge">
      <Icon name="remove" size={presentation === 'dialog' ? '13px' : '15px'} />
    </span>
  </div>

  <div class="access-denied-copy">
    <h2>{title}</h2>
    <p>{description}</p>
  </div>

  {#if subject}
    <div class="access-denied-subject" title={subject}>
      <Icon name="filePresent" size="18px" />
      <span>{subject}</span>
    </div>
  {/if}

  {#if details.length > 0}
    <dl class="access-denied-details">
      {#each details as detail}
        <div class="access-denied-detail-row">
          <dt>{detail.label}</dt>
          <dd title={detail.value}>{detail.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if explanation}
    <section class="permission-panel" aria-label={$t('files.permissionPanelTitle')}>
      <h3 class="permission-panel-title">{$t('files.permissionStateTitle')}</h3>

      <ul class="permission-capabilities">
        {#each explanation.rows as row (row.capability)}
          <li class="permission-capability permission-capability--{row.state}">
            <span class="permission-capability-icon" aria-hidden="true">
              <Icon name={STATE_ICONS[row.state]} size="15px" />
            </span>
            <span class="permission-capability-label">
              {$t(CAPABILITY_LABELS[row.capability])}
              {#if row.accessType}
                <code class="permission-capability-type">{row.accessType}</code>
              {/if}
            </span>
            <span class="permission-capability-state">
              {$t(STATE_LABELS[row.state])}
            </span>
          </li>
        {/each}
      </ul>

      <div class="permission-source">
        <span class="permission-source-label">{$t('files.permissionSourceTitle')}</span>
        <span class="permission-source-value">
          {#if explanation.groups.length > 0}
            {$t('files.permissionSourceGroups')}: {explanation.groups.join(' · ')}
          {:else}
            {$t('files.permissionSourceOwn')}
          {/if}
        </span>
      </div>

      <p class="permission-source-note">
        {#if explanation.denialKind === 'object-rule'}
          {$t('files.permissionDeniedByObjectRule')}
        {:else if explanation.denialKind === 'account-permission'}
          {$t('files.permissionDeniedByAccount')}
        {:else}
          {$t('files.permissionSourceServerControlled')}
        {/if}
      </p>

      <button
        type="button"
        class="permission-why"
        aria-expanded={whyExpanded}
        onclick={() => (whyExpanded = !whyExpanded)}
      >
        <Icon name="help" size="16px" />
        <span>{$t('files.permissionWhy')}</span>
        <Icon name={whyExpanded ? 'expandLess' : 'expandMore'} size="16px" />
      </button>

      {#if whyExpanded}
        <div class="permission-why-body">
          {#if explanation.serverMissing.length > 0}
            <p class="permission-why-row">
              <span class="permission-why-key">{$t('files.permissionYouLack')}</span>
              <code>{explanation.serverMissing.join(', ')}</code>
            </p>
          {/if}

          {#each explanation.rows as row (row.capability)}
            {#if row.capability === explanation.refused}
              {#if row.accessType}
                <p class="permission-why-row">
                  <span class="permission-why-key">{$t('files.permissionRequires')}</span>
                  <code>{row.accessType}</code>
                </p>
              {/if}
              {#if row.granted.length > 0}
                <p class="permission-why-row">
                  <span class="permission-why-key">{$t('files.permissionYouHave')}</span>
                  <code>{row.granted.join(', ')}</code>
                </p>
              {/if}
              {#if row.missing.length > 0 && explanation.serverMissing.length === 0}
                <p class="permission-why-row">
                  <span class="permission-why-key">{$t('files.permissionYouLack')}</span>
                  <code>{row.missing.join(', ')}</code>
                </p>
              {/if}
              {#if row.permissions.length === 0 && explanation.serverMissing.length === 0 && !row.accessType}
                <p class="permission-why-note">{$t('files.permissionNoClientEvidence')}</p>
              {/if}
            {/if}
          {/each}

          {#if explanation.blockedByObjectRule}
            <p class="permission-why-note">{$t('files.permissionBlockedByObjectRule')}</p>
          {/if}

          {#if explanation.serverMessage}
            <p class="permission-why-row">
              <span class="permission-why-key">{$t('files.permissionServerSaid')}</span>
              <span class="permission-why-server">{explanation.serverMessage}</span>
            </p>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  {#if actionLabel && onAction}
    <button
      type="button"
      class="access-denied-action"
      onclick={onAction}
    >
      {#if presentation === 'page'}
        <Icon name="arrowBack" size="18px" />
      {/if}
      <span>{actionLabel}</span>
    </button>
  {/if}
</section>

<style>
  .access-denied-notice {
    display: flex;
    width: 100%;
    min-height: 100%;
    align-items: center;
    /* `safe` keeps the top of a too-tall notice reachable once the container
       scrolls, instead of centring the overflow out of view. */
    justify-content: center;
    justify-content: safe center;
    flex-direction: column;
    gap: 1.05rem;
    padding: 3rem 1.5rem;
    color: var(--explorer-text, var(--color-md3-on-surface));
    text-align: center;
    animation: access-denied-enter 320ms var(--motion-easing-emphasized-decelerate) both;
  }

  .access-denied-notice--dialog {
    min-height: 0;
    gap: 0.9rem;
    padding: 2rem 2rem 1.5rem;
    color: var(--color-md3-on-surface);
  }

  .access-denied-icon {
    position: relative;
    display: grid;
    width: 78px;
    height: 78px;
    place-items: center;
    color: color-mix(in srgb, var(--color-md3-on-surface-variant) 84%, var(--color-md3-on-surface));
  }

  .access-denied-notice--dialog .access-denied-icon {
    width: 66px;
    height: 66px;
  }

  .access-denied-badge {
    position: absolute;
    right: 1px;
    bottom: 9px;
    display: grid;
    width: 27px;
    height: 27px;
    place-items: center;
    border: 3px solid var(--explorer-background, var(--color-md3-surface-container));
    border-radius: 999px;
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
    box-shadow: 0 6px 15px color-mix(in srgb, var(--color-md3-primary) 34%, transparent);
  }

  .access-denied-notice--dialog .access-denied-badge {
    right: 1px;
    bottom: 8px;
    width: 23px;
    height: 23px;
    border-width: 3px;
    border-color: var(--color-md3-surface-container);
  }

  .access-denied-copy {
    display: grid;
    max-width: 34rem;
    gap: 0.55rem;
  }

  h2, p { margin: 0; }
  h2 { font-size: clamp(1.25rem, 2vw, 1.6rem); font-weight: 680; letter-spacing: -0.02em; }
  p { color: var(--explorer-text-muted, var(--color-md3-on-surface-variant)); font-size: 0.95rem; line-height: 1.65; }

  .access-denied-subject {
    display: flex;
    min-width: 0;
    max-width: min(100%, 28rem);
    align-items: center;
    gap: 0.6rem;
    padding: 0.2rem 0.1rem;
    color: var(--color-md3-on-surface);
    font-size: 0.9rem;
    font-weight: 600;
  }

  .access-denied-subject span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .access-denied-details {
    display: grid;
    width: min(100%, 28rem);
    gap: 0.55rem;
    margin: -0.15rem 0 0;
    border-top: 1px solid var(--color-md3-outline);
    padding: 0.9rem 0.1rem 0;
  }

  .access-denied-detail-row {
    display: grid;
    min-width: 0;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    align-items: baseline;
    gap: 0.85rem;
    font-size: 0.78rem;
    line-height: 1.45;
    text-align: left;
  }

  .access-denied-detail-row dt {
    color: var(--color-md3-on-surface-variant);
  }

  .access-denied-detail-row dd {
    min-width: 0;
    margin: 0;
    color: var(--color-md3-on-surface);
    overflow-wrap: anywhere;
  }

  .access-denied-action {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    border: 0;
    border-radius: 999px;
    padding: 0.55rem 1.15rem;
    color: var(--color-md3-primary-emphasis, var(--color-md3-primary));
    background: transparent;
    font-size: 0.88rem;
    font-weight: 650;
    transition:
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .access-denied-action:hover {
    background: color-mix(in srgb, var(--color-md3-primary) 10%, transparent);
  }

  .access-denied-action:active {
    background: color-mix(in srgb, var(--color-md3-primary) 16%, transparent);
    transform: scale(0.97);
  }

  .access-denied-notice--dialog .access-denied-action {
    min-width: 8rem;
    margin-top: 0.25rem;
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  .access-denied-notice--dialog .access-denied-action:hover {
    background: color-mix(in srgb, var(--color-md3-primary) 88%, white);
  }

  .access-denied-notice--dialog .access-denied-action:active {
    background: color-mix(in srgb, var(--color-md3-primary) 82%, black);
  }

  /* ---------------------------------------------------------------------
   * Permission panel — the evidence behind the refusal
   * --------------------------------------------------------------------- */

  .permission-panel {
    display: grid;
    width: min(100%, 30rem);
    gap: 0.6rem;
    border-top: 1px solid var(--color-md3-outline);
    padding: 1rem 0.1rem 0;
    text-align: left;
  }

  .permission-panel-title {
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .permission-capabilities {
    display: grid;
    gap: 0.15rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .permission-capability {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.6rem;
    border-radius: var(--explorer-radius-small, 5px);
    padding: 0.3rem 0.4rem;
    font-size: 0.82rem;
  }

  .permission-capability-icon {
    display: grid;
    place-items: center;
    color: var(--color-md3-on-surface-variant);
  }

  .permission-capability--granted .permission-capability-icon {
    color: var(--color-md3-success, var(--color-md3-primary));
  }

  .permission-capability--denied .permission-capability-icon {
    color: var(--color-md3-error, var(--color-md3-primary));
  }

  .permission-capability-label { color: var(--color-md3-on-surface); }

  .permission-capability-type {
    margin-left: 0.4rem;
    color: var(--color-md3-on-surface-variant);
    font-family: var(--font-mono, monospace);
    font-size: 0.7rem;
  }

  .permission-capability-state {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
  }

  .permission-source {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    align-items: baseline;
    gap: 0.85rem;
    font-size: 0.78rem;
  }

  .permission-source-label { color: var(--color-md3-on-surface-variant); }
  .permission-source-value { color: var(--color-md3-on-surface); overflow-wrap: anywhere; }

  .permission-source-note {
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .permission-why {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    align-self: start;
    border: 1px solid var(--color-md3-outline);
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    color: var(--color-md3-primary-emphasis, var(--color-md3-primary));
    background: transparent;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .permission-why:hover { background: color-mix(in srgb, var(--color-md3-primary) 10%, transparent); }

  .permission-why-body {
    display: grid;
    gap: 0.4rem;
    border-radius: var(--explorer-radius-medium, 8px);
    padding: 0.7rem 0.75rem;
    background: color-mix(in srgb, var(--color-md3-on-surface) 6%, transparent);
    font-size: 0.76rem;
    line-height: 1.55;
  }

  .permission-why-row {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    gap: 0.6rem;
    margin: 0;
  }

  .permission-why-key { color: var(--color-md3-on-surface-variant); }

  .permission-why-row code {
    color: var(--color-md3-on-surface);
    font-family: var(--font-mono, monospace);
    font-size: 0.74rem;
    overflow-wrap: anywhere;
  }

  .permission-why-server { color: var(--color-md3-on-surface); overflow-wrap: anywhere; }

  .permission-why-note { margin: 0; color: var(--color-md3-on-surface-variant); }

  @keyframes access-denied-enter {
    from { opacity: 0; transform: translateY(10px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

</style>
