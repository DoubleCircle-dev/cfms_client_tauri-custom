<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    getProtocolVersionSettings,
    protocolVersion,
    setProtocolVersionOverride,
    type ProtocolVersionSettings,
  } from '$lib/api';
  import { loadAppVersion } from '$lib/app-info';
  import { releaseHighlightsState } from '$lib/release-highlights/state.svelte';
  import { authStore } from '$lib/stores.svelte';
  import AppUpdateChecker from '$lib/components/AppUpdateChecker.svelte';
  import ChangelogPanel from '$lib/components/ChangelogPanel.svelte';

  let protoVer = $state<number | null>(null);
  let appVersion = $state<string | null>(null);
  let protoVerLoaded = $state(false);
  let appVersionLoaded = $state(false);

  let protocolSettings = $state<ProtocolVersionSettings | null>(null);
  let protocolSelection = $state('');
  let protocolSaving = $state(false);
  let protocolError = $state<string | null>(null);

  const protocolRelaxed = $derived(protocolSettings?.overrideVersion != null);

  onMount(async () => {
    void releaseHighlightsState.initialize();
    void loadProtocolSettings();

    const [versionResult, protocolResult] = await Promise.allSettled([
      loadAppVersion(),
      protocolVersion(),
    ]);

    appVersion = versionResult.status === 'fulfilled' ? versionResult.value : null;
    protoVer = protocolResult.status === 'fulfilled' ? protocolResult.value : null;
    appVersionLoaded = true;
    protoVerLoaded = true;
  });

  function applyProtocolSettings(settings: ProtocolVersionSettings) {
    protocolSettings = settings;
    protocolSelection = String(settings.overrideVersion ?? settings.clientVersion);
  }

  async function loadProtocolSettings() {
    try {
      applyProtocolSettings(await getProtocolVersionSettings());
    } catch {
      protocolError = $t('about.protocolCompatibilityLoadFailed');
    }
  }

  async function saveProtocolSelection(selection: string) {
    const settings = protocolSettings;
    if (!settings || protocolSaving) return;

    const version = Number(selection);
    const next = version === settings.clientVersion ? null : version;
    if (next === settings.overrideVersion) return;

    protocolSelection = selection;
    protocolSaving = true;
    protocolError = null;
    try {
      applyProtocolSettings(await setProtocolVersionOverride(next));
    } catch (err) {
      // Snap the picker back to whatever is actually persisted.
      applyProtocolSettings(settings);
      protocolError = $t('about.protocolCompatibilitySaveFailed', {
        values: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      protocolSaving = false;
    }
  }

  async function replayReleaseHighlights() {
    await releaseHighlightsState.initialize();
    releaseHighlightsState.openManually(authStore.permissions);
  }
</script>

<div class="workspace-page about-page">
  <header class="product-heading">
    <h2>CFMS Client</h2>
    <p>{$t('about.productName')}</p>
  </header>

  <AppUpdateChecker
    currentVersion={appVersionLoaded ? appVersion : null}
    currentVersionLoaded={appVersionLoaded}
    protocolVersion={protoVerLoaded ? protoVer : null}
    protocolVersionLoaded={protoVerLoaded}
    onOpenFeatureTour={releaseHighlightsState.hasAvailableHighlights(authStore.permissions)
      ? replayReleaseHighlights
      : undefined}
  />

  {#if protocolSettings}
    <section class="protocol-compatibility" aria-labelledby="protocol-compatibility-heading">
      <div class="protocol-compatibility__text">
        <h3 id="protocol-compatibility-heading">{$t('about.protocolCompatibility')}</h3>
        <p>
          {$t('about.protocolCompatibilityHint', {
            values: { version: protocolSettings.clientVersion },
          })}
        </p>
      </div>

      <label class="protocol-compatibility__field">
        <span class="protocol-compatibility__label">
          {$t('about.protocolCompatibilityAccepted')}
        </span>
        <select
          value={protocolSelection}
          disabled={protocolSaving}
          aria-describedby="protocol-compatibility-status"
          onchange={(event) => saveProtocolSelection(event.currentTarget.value)}
        >
          {#each protocolSettings.selectableVersions as version (version)}
            <option value={String(version)}>
              {version === protocolSettings.clientVersion
                ? $t('about.protocolCompatibilityDefault', { values: { version } })
                : $t('about.protocolCompatibilityMinimum', { values: { version } })}
            </option>
          {/each}
        </select>
      </label>

      <p
        id="protocol-compatibility-status"
        class="protocol-compatibility__status"
        class:protocol-compatibility__status--relaxed={protocolRelaxed}
        role={protocolError ? 'alert' : undefined}
      >
        {protocolError ??
          (protocolRelaxed
            ? $t('about.protocolCompatibilityRelaxed', {
                values: {
                  min: protocolSettings.minAcceptedVersion,
                  max: protocolSettings.clientVersion,
                },
              })
            : $t('about.protocolCompatibilityStrict', {
                values: { version: protocolSettings.clientVersion },
              }))}
      </p>
    </section>
  {/if}

  <ChangelogPanel />

  <footer class="product-legal" aria-label={$t('about.legalInformation')}>
    <dl>
      <div>
        <dt>{$t('about.license')}</dt>
        <dd>Apache License 2.0</dd>
      </div>
      <div>
        <dt>{$t('about.copyright')}</dt>
        <dd>© 2025–2026 Creeper Team</dd>
      </div>
    </dl>
  </footer>
</div>

<style>
  .about-page {
    display: grid;
    width: min(100%, 45rem);
    gap: 1.5rem;
    margin-inline: auto;
    padding: 1.5rem 1.25rem 3rem;
  }

  .product-heading {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.35rem 0.8rem;
    min-width: 0;
    padding-block: 0.2rem 0.05rem;
  }

  .product-heading h2,
  .product-heading p {
    margin: 0;
  }

  .product-heading h2 {
    color: var(--color-md3-on-surface);
    font: 700 1.25rem/1.2 var(--font-md3-sans);
    letter-spacing: -0.01em;
    text-wrap: balance;
  }

  .product-heading p {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .product-legal {
    padding-top: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 55%, transparent);
  }

  .product-legal dl {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem 1.25rem;
    margin: 0;
  }

  .product-legal dl > div {
    display: inline-flex;
    align-items: baseline;
    gap: 0.45rem;
    min-width: 0;
  }

  .product-legal dt {
    color: var(--color-md3-on-surface-variant);
    font-family: var(--font-md3-sans);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .product-legal dd {
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .protocol-compatibility {
    display: grid;
    gap: 0.85rem;
    padding: 1rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--color-md3-outline) 55%, transparent);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 70%, transparent);
  }

  .protocol-compatibility__text h3 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font: 600 0.95rem/1.3 var(--font-md3-sans);
  }

  .protocol-compatibility__text p {
    margin: 0.3rem 0 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.8125rem;
    line-height: 1.55;
  }

  .protocol-compatibility__field {
    display: grid;
    gap: 0.4rem;
    min-width: 0;
  }

  .protocol-compatibility__label {
    color: var(--color-md3-on-surface-variant);
    font-family: var(--font-md3-sans);
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .protocol-compatibility__field select {
    width: 100%;
    min-width: 0;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: 0.75rem;
    background: var(--color-md3-surface-container-high);
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-size: 0.875rem;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .protocol-compatibility__field select:focus-visible {
    outline: none;
    border-color: var(--color-md3-primary);
    box-shadow: inset 0 0 0 1px var(--color-md3-primary);
  }

  .protocol-compatibility__field select:disabled {
    cursor: progress;
    opacity: 0.65;
  }

  .protocol-compatibility__status {
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .protocol-compatibility__status--relaxed {
    color: var(--color-md3-error);
  }

  @media (max-width: 640px) {
    .about-page {
      padding-top: 1rem;
    }
  }

  @media (max-width: 420px) {
    .about-page {
      padding-inline: 1rem;
    }

    .product-heading {
      display: grid;
      gap: 0.25rem;
    }
  }
</style>
