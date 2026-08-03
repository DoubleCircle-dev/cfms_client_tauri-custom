<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { invoke } from '@tauri-apps/api/core';

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    if (!import.meta.env.DEV) {
      goto('/home/overview', { replaceState: true });
    }
  });

  async function openInNewWindow() {
    try {
      await invoke('open_dev_tools_window');
    } catch (e) {
      console.error('Failed to open dev tools window:', e);
    }
  }
</script>

{#if import.meta.env.DEV}
  <div class="dev-layout">
    <header class="dev-header">
      <span class="dev-badge">🛠 DEV TOOLS</span>
      <span class="dev-warning">仅在开发环境中可用</span>
      <button class="popout-btn" onclick={openInNewWindow} title="在独立窗口中打开">
        🔲 独立窗口
      </button>
    </header>
    <main class="dev-main">
      {@render children()}
    </main>
  </div>
{/if}

<style>
  .dev-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #1a1a2e;
    color: #e0e0e0;
  }
  .dev-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: #16213e;
    border-bottom: 1px solid #0f3460;
    flex-shrink: 0;
  }
  .dev-badge {
    font-weight: 700;
    font-size: 14px;
    color: #e94560;
  }
  .dev-warning {
    font-size: 12px;
    color: #ffc107;
    margin-left: auto;
  }
  .popout-btn {
    margin-left: 8px;
    padding: 4px 10px;
    border: 1px solid #0f3460;
    border-radius: 4px;
    background: transparent;
    color: #58a6ff;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .popout-btn:hover {
    border-color: #58a6ff;
    background: #16213e;
  }
  .dev-main {
    flex: 1;
    overflow: hidden;
  }
</style>
