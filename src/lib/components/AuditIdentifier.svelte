<script lang="ts">
  import { onDestroy } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { notificationStore } from '$lib/stores.svelte';

  let { value, kind = 'audit' }: { value: string | null | undefined; kind?: 'audit' | 'user' } = $props();
  let expanded = $state(false);
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressClick = false;
  const shortened = $derived(Boolean(value && value.length > 7));

  function clearLongPress() {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  onDestroy(clearLongPress);

  async function copy() {
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        try {
          textarea.select();
          if (!document.execCommand('copy')) throw new Error('Copy failed');
        } finally {
          textarea.remove();
        }
      }
      notificationStore.success($t(kind === 'audit' ? 'manage.auditIdCopied' : 'manage.userIdCopied'), 1600);
    } catch {
      notificationStore.error($t(kind === 'audit' ? 'manage.auditIdCopyFailed' : 'manage.userIdCopyFailed'));
    }
  }
</script>

{#if value}
  <button
    type="button"
    class="audit-identifier rounded-md px-1 py-0.5 text-left leading-relaxed transition-colors hover:bg-md3-primary-container/30 hover:text-md3-primary-emphasis"
    title={value}
    aria-label={kind === 'audit'
      ? $t(expanded ? 'manage.collapseAuditId' : 'manage.expandAuditId')
      : $t(expanded ? 'manage.collapseUserId' : 'manage.expandUserId')}
    aria-expanded={expanded}
    onclick={(event) => {
      if (suppressClick) {
        event.preventDefault();
        suppressClick = false;
      } else expanded = !expanded;
    }}
    oncontextmenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      clearLongPress();
      void copy();
    }}
    onpointerdown={(event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      clearLongPress();
      suppressClick = false;
      longPressTimer = setTimeout(() => {
        suppressClick = true;
        longPressTimer = null;
        void copy();
      }, 550);
    }}
    onpointerup={clearLongPress}
    onpointercancel={clearLongPress}
    onpointerleave={clearLongPress}
  >
    {expanded || !shortened ? value : `${value.slice(0, 7)}…`}
  </button>
{:else}
  <span class="text-md3-on-surface-variant">—</span>
{/if}

<style>
  .audit-identifier {
    max-width: 100%;
    overflow-wrap: anywhere;
    vertical-align: top;
    touch-action: manipulation;
    -webkit-touch-callout: none;
    user-select: none;
  }
</style>
