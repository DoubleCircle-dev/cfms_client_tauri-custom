<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { protocolVersion } from '$lib/api';
  import { loadAppVersion } from '$lib/app-info';
  import { releaseHighlightsState } from '$lib/release-highlights/state.svelte';
  import { authStore } from '$lib/stores.svelte';
  import AppUpdateChecker from '$lib/components/AppUpdateChecker.svelte';
  import ChangelogPanel from '$lib/components/ChangelogPanel.svelte';

  let protoVer = $state<number | null>(null);
  let appVersion = $state<string | null>(null);
  let protoVerLoaded = $state(false);
  let appVersionLoaded = $state(false);

  onMount(async () => {
    void releaseHighlightsState.initialize();
    const [versionResult, protocolResult] = await Promise.allSettled([
      loadAppVersion(),
      protocolVersion(),
    ]);

    appVersion = versionResult.status === 'fulfilled' ? versionResult.value : null;
    protoVer = protocolResult.status === 'fulfilled' ? protocolResult.value : null;
    appVersionLoaded = true;
    protoVerLoaded = true;
  });

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
