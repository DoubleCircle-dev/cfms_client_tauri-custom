<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { invoke } from '@tauri-apps/api/core';

  onMount(() => {
    if (!import.meta.env.DEV) {
      goto('/home/overview', { replaceState: true });
    }
  });

  let opening = $state(false);

  async function openVulnTest() {
    opening = true;
    try {
      await invoke('open_dev_tools_window');
    } catch (e) {
      console.error('Failed to open dev tools window:', e);
    } finally {
      opening = false;
    }
  }
</script>

<svelte:head>
  <title>Dev Tools — CFMS</title>
</svelte:head>

{#if import.meta.env.DEV}
  <div class="landing">
    <div class="hero">
      <h1>🛠 CFMS Dev Tools</h1>
      <p>开发环境专用工具集</p>
    </div>

    <div class="tools-grid">
      <button class="tool-card" onclick={openVulnTest} disabled={opening}>
        <span class="tool-icon">🛡</span>
        <span class="tool-name">服务器漏洞测试</span>
        <span class="tool-desc">发送原始 WebSocket 请求，测试未认证访问、信息泄露等安全漏洞</span>
        <span class="tool-action">{opening ? '启动中...' : '🔲 在独立窗口中打开'}</span>
      </button>

      <a href="/dev/server-vuln-test" class="tool-card">
        <span class="tool-icon">📋</span>
        <span class="tool-name">漏洞测试（内嵌）</span>
        <span class="tool-desc">在当前窗口中打开测试工具</span>
        <span class="tool-action">→ 打开</span>
      </a>
    </div>
  </div>
{/if}

<style>
  .landing {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px;
    height: 100%;
    overflow-y: auto;
  }
  .hero {
    text-align: center;
    margin-bottom: 32px;
  }
  .hero h1 {
    font-size: 22px;
    font-weight: 700;
    color: #c9d1d9;
  }
  .hero p {
    font-size: 13px;
    color: #8b949e;
    margin-top: 4px;
  }
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    width: 100%;
    max-width: 640px;
  }
  .tool-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px;
    border: 1px solid #21262d;
    border-radius: 8px;
    background: #161b22;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    font-family: inherit;
    font-size: inherit;
  }
  .tool-card:hover:not(:disabled) {
    border-color: #58a6ff;
    background: #1a2035;
  }
  .tool-card:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .tool-icon { font-size: 24px; }
  .tool-name { font-weight: 600; font-size: 14px; }
  .tool-desc { font-size: 12px; color: #8b949e; }
  .tool-action { font-size: 11px; color: #58a6ff; margin-top: 4px; }
</style>
