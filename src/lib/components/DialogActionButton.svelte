<script lang="ts">
  import type { Snippet, ComponentProps } from 'svelte';
  import FluentButton from './FluentButton.svelte';
  interface Props extends Omit<ComponentProps<typeof FluentButton>, 'appearance' | 'children'> {
    variant?: 'primary' | 'secondary' | 'danger' | 'tonal'; class?: string; children: Snippet;
  }
  let { variant = 'secondary', class: className = '', children, ...attributes }: Props = $props();
</script>
  <FluentButton {...attributes} appearance={variant === 'primary' || variant === 'danger' ? 'primary' : variant === 'tonal' ? 'outline' : 'subtle'}
    class="dialog-action-button dialog-action-button--{variant} {className}">
    {@render children()}
  </FluentButton>
<style>
  :global(.dialog-action-button--danger) {
    --colorBrandBackground: var(--colorStatusDangerBackground3);
    --colorBrandBackgroundHover: var(--colorStatusDangerBackground3Hover);
    --colorBrandBackgroundPressed: var(--colorStatusDangerBackground3Pressed);
    --colorNeutralForegroundOnBrand: var(--colorNeutralForegroundStaticInverted);
  }
  :global(.dialog-action-button--tonal) { --colorNeutralBackground1: var(--colorBrandBackground2); }
  :global(.dialog-action-button .md-progress-ring) { color: inherit; }
</style>
