// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeclarativePage } from '$lib/api/extensions';

vi.mock('$lib/api/extensions', () => ({
  readExtensionPage: vi.fn(),
}));
vi.mock('$lib/extension-workflows', () => ({
  runExtensionWorkflow: vi.fn(),
}));

import { readExtensionPage } from '$lib/api/extensions';
import ExtensionPageRenderer from './ExtensionPageRenderer.svelte';

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('style[data-extension-style-scope]').forEach((style) => style.remove());
});

describe('ExtensionPageRenderer', () => {
  it('adds scoped plugin styles and removes them when the page unmounts', async () => {
    const page: DeclarativePage = {
      schema_version: 1,
      title: 'Styled tools',
      class_name: 'plugin-page',
      blocks: [
        { type: 'text', text: 'Ready', class_name: 'plugin-status' },
        {
          type: 'form',
          id: 'tool',
          fields: [{ id: 'input', label: 'Input', type: 'text', class_name: 'plugin-input' }],
        },
      ],
      styles: [
        {
          selector: '.plugin-status',
          declarations: { color: 'var(--colorBrandForeground1)' },
        },
        {
          selector: '.plugin-input .extension-control',
          declarations: { width: '100%' },
        },
      ],
    };
    vi.mocked(readExtensionPage).mockResolvedValue(page);
    const { container, unmount } = render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.tools', pageId: 'overview' },
    });

    await screen.findByText('Ready');
    await waitFor(() => {
      expect(document.head.querySelector('style[data-extension-style-scope]')).toBeTruthy();
    });

    const root = container.querySelector<HTMLElement>('.extension-page');
    const scope = root?.dataset.extensionStyleScope;
    expect(root?.classList.contains('plugin-page')).toBe(true);
    expect(root?.querySelector('.plugin-status')).toBeTruthy();
    expect(screen.getByLabelText('Input').closest('.plugin-input')).toBeTruthy();
    expect(document.head.querySelector('style')?.textContent)
      .toContain(`[data-extension-style-scope="${scope}"] .plugin-status{color:var(--colorBrandForeground1)}`);

    unmount();
    expect(document.head.querySelector('style[data-extension-style-scope]')).toBeNull();
  });

  it('shows an error instead of injecting invalid styles', async () => {
    vi.mocked(readExtensionPage).mockResolvedValue({
      schema_version: 1,
      title: 'Invalid styles',
      blocks: [{ type: 'text', text: 'Content', class_name: 'plugin-content' }],
      styles: [{ selector: 'body', declarations: { color: 'red' } }],
    });

    render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.tools', pageId: 'overview' },
    });
    await screen.findByRole('alert');
    expect(document.head.querySelector('style[data-extension-style-scope]')).toBeNull();
  });
});