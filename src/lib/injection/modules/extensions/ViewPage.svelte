<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import ExtensionPageRenderer from '$lib/injection/modules/extensions/ExtensionPageRenderer.svelte';
  import { isCustomFeatureEnabled } from '$lib/injection/registry';

  const extensionId = $derived(page.url.searchParams.get('extension') ?? '');
  const pageId = $derived(page.url.searchParams.get('page') ?? '');

  onMount(() => {
    // Preserve the renderer for later extension development without allowing
    // a manually entered URL to instantiate extension-provided UI today.
    if (!isCustomFeatureEnabled('extensions')) void goto('/home/overview', { replaceState: true });
  });
</script>

{#if isCustomFeatureEnabled('extensions')}
  {#if extensionId && pageId}
    <ExtensionPageRenderer {extensionId} {pageId} />
  {:else}
    <div class="invalid"><h1>Extension page unavailable</h1><p>The extension or page identifier is missing.</p></div>
  {/if}
{/if}

<style>.invalid { display: grid; min-height: 260px; place-items: center; align-content: center; gap: 8px; padding: 2rem; text-align: center; color: var(--explorer-text); }.invalid p { color: var(--explorer-text-muted); }</style>
