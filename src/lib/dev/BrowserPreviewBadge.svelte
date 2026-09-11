<script lang="ts">
  // Rendered by the root layout only while the dev-only browser preview bridge
  // is active, so previewed data is never mistaken for a real server session.
  import { browserPreviewMode } from '$lib/tauri-runtime';

  const mode = browserPreviewMode();
  const live = mode === 'live';
</script>

{#if mode}
  <div
    class="preview-badge"
    class:preview-badge--live={live}
    role="status"
    title={live
      ? '浏览器预览：命令经 CDP 转发到正在运行的真实客户端，数据来自真实后端'
      : '浏览器预览：IPC 与账户会话均为模拟数据，未连接任何服务器'}
  >
    <span class="preview-badge__dot" aria-hidden="true"></span>
    <span>{live ? '预览模式 · 真实后端' : '预览模式 · 模拟数据'}</span>
  </div>
{/if}

<style>
  .preview-badge {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 30;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, #e94560 55%, transparent);
    background: color-mix(in srgb, #16213e 92%, transparent);
    color: #ffd8df;
    font-size: 11px;
    line-height: 1.5;
    letter-spacing: 0.02em;
    pointer-events: none;
    backdrop-filter: blur(6px);
  }

  .preview-badge__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #e94560;
    box-shadow: 0 0 6px #e94560;
  }

  /* Live mode is a real session, so it reads as informational rather than alarming. */
  .preview-badge--live {
    border-color: color-mix(in srgb, #3fb950 55%, transparent);
    color: #d7f5de;
  }

  .preview-badge--live .preview-badge__dot {
    background: #3fb950;
    box-shadow: 0 0 6px #3fb950;
    animation: preview-pulse 2.4s ease-in-out infinite;
  }

  @keyframes preview-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  @media (prefers-reduced-motion: reduce) {
    .preview-badge--live .preview-badge__dot {
      animation: none;
    }
  }
</style>
