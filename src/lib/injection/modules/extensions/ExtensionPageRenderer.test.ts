// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeclarativePage } from '$lib/injection/modules/extensions/api';

vi.mock('$lib/injection/modules/extensions/api', () => ({
  readExtensionPage: vi.fn(),
}));
vi.mock('$lib/injection/modules/extensions/workflows', () => ({
  runExtensionWorkflow: vi.fn(),
}));
vi.mock('$lib/stores.svelte', () => ({
  notificationStore: { error: vi.fn() },
}));

import { readExtensionPage } from '$lib/injection/modules/extensions/api';
import { runExtensionWorkflow } from '$lib/injection/modules/extensions/workflows';
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
    expect(root?.querySelector('.extension-page-header .extension-page-title')?.textContent)
      .toBe('Styled tools');
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

  it('renders CSS blocks invisibly and applies their scoped rules', async () => {
    vi.mocked(readExtensionPage).mockResolvedValue({
      schema_version: 1,
      title: 'CSS blocks',
      blocks: [
        { type: 'text', text: 'Visible content', class_name: 'plugin-content' },
        { type: 'css', css: '.plugin-content { color: red; }' },
      ],
    });

    const { container } = render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.tools', pageId: 'overview' },
    });

    await screen.findByText('Visible content');
    await waitFor(() => {
      expect(document.head.querySelector('style[data-extension-style-scope]')?.textContent)
        .toContain('.plugin-content{color:red}');
    });
    expect(container.querySelectorAll('.extension-grid > *')).toHaveLength(1);
  });

  it('replaces declared table rows from successful workflow results', async () => {
    vi.mocked(readExtensionPage).mockResolvedValue({
      schema_version: 1,
      title: 'Schedules',
      blocks: [
        {
          type: 'table',
          id: 'task-table',
          columns: [{ key: 'name', label: 'Name' }],
          rows: [{ name: 'Initial row' }],
        },
        {
          type: 'actions',
          actions: [{ id: 'refresh', label: 'Refresh', workflow: 'list-tasks', result_id: 'output' }],
        },
      ],
    });
    vi.mocked(runExtensionWorkflow).mockResolvedValue({
      ok: true,
      table_values: { 'task-table': [{ name: 'New task' }] },
    });

    render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.scheduler', pageId: 'overview' },
    });
    await screen.findByText('Initial row');
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('New task')).toBeTruthy();
    expect(screen.queryByText('Initial row')).toBeNull();
  });

  it('rejects table row payloads over the row limit without replacing existing rows', async () => {
    vi.mocked(readExtensionPage).mockResolvedValue({
      schema_version: 1,
      title: 'Schedules',
      blocks: [
        {
          type: 'table',
          id: 'task-table',
          columns: [{ key: 'name', label: 'Name' }],
          rows: [{ name: 'Initial row' }],
        },
        {
          type: 'actions',
          actions: [{ id: 'refresh', label: 'Refresh', workflow: 'list-tasks', result_id: 'output' }],
        },
      ],
    });
    vi.mocked(runExtensionWorkflow).mockResolvedValue({
      ok: true,
      table_values: { 'task-table': Array.from({ length: 65 }, (_, index) => ({ name: `Task ${index}` })) },
    });

    render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.scheduler', pageId: 'overview' },
    });
    await screen.findByText('Initial row');
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('Initial row')).toBeTruthy();
    expect(screen.queryByText('Task 0')).toBeNull();
  });
});