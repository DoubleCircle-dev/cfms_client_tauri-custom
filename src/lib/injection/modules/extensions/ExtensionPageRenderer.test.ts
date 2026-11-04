// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { addMessages, init } from 'svelte-i18n';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

beforeAll(() => {
  addMessages('en', { common: { add: 'Add', delete: 'Delete' } });
  init({ fallbackLocale: 'en', initialLocale: 'en' });
});

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('style[data-extension-style-scope]').forEach((style) => style.remove());
});

describe('ExtensionPageRenderer', () => {
  it('loads the selected extension page when its route parameters change', async () => {
    vi.mocked(readExtensionPage)
      .mockResolvedValueOnce({
        schema_version: 1,
        title: 'First extension',
        blocks: [{ type: 'text', text: 'First page' }],
      })
      .mockResolvedValueOnce({
        schema_version: 1,
        title: 'Second extension',
        blocks: [{ type: 'text', text: 'Second page' }],
      });

    const { rerender } = render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.first', pageId: 'home' },
    });

    await screen.findByText('First page');
    await rerender({ extensionId: 'org.example.second', pageId: 'settings' });

    await screen.findByText('Second page');
    expect(readExtensionPage).toHaveBeenNthCalledWith(1, 'org.example.first', 'home');
    expect(readExtensionPage).toHaveBeenNthCalledWith(2, 'org.example.second', 'settings');
  });

  it('maps declared action tones to Fluent button appearances', async () => {
    vi.mocked(readExtensionPage).mockResolvedValue({
      schema_version: 1,
      title: 'Actions',
      blocks: [{
        type: 'actions',
        actions: [
          { id: 'primary', label: 'Save', workflow: 'save', tone: 'primary' },
          { id: 'secondary', label: 'Cancel', workflow: 'cancel', tone: 'secondary' },
          { id: 'danger', label: 'Delete', workflow: 'delete', tone: 'danger' },
        ],
      }],
    });

    const { container } = render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.actions', pageId: 'home' },
    });

    await screen.findByRole('button', { name: 'Save' });
    const primary = container.querySelector('fluent-button.primary');
    const secondary = container.querySelector('fluent-button:not(.primary):not(.danger)');
    const danger = container.querySelector('fluent-button.danger');
    expect(primary && Reflect.get(primary, 'appearance')).toBe('primary');
    expect(primary?.getAttribute('data-tone')).toBe('primary');
    expect(secondary && Reflect.get(secondary, 'appearance')).toBe('subtle');
    expect(danger && Reflect.get(danger, 'appearance')).toBe('outline');
    expect(danger?.getAttribute('data-tone')).toBe('danger');
  });

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

  it('lets users edit, add, and delete typed table rows and sends table values to workflows', async () => {
    vi.mocked(readExtensionPage).mockResolvedValue({
      schema_version: 1,
      title: 'Editable table',
      blocks: [
        {
          type: 'table',
          id: 'records',
          title: 'Records',
          editable: true,
          columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'mode', label: 'Mode', type: 'select', options: ['fast', 'slow'] },
            { key: 'count', label: 'Count', type: 'number' },
            { key: 'enabled', label: 'Enabled', type: 'checkbox' },
          ],
          rows: [
            { name: 'Alpha', mode: 'slow', count: 1, enabled: false },
            { name: 'Remove', mode: 'fast', count: 2, enabled: true },
          ],
        },
        { type: 'actions', actions: [{ id: 'submit', label: 'Submit', workflow: 'submit' }] },
      ],
    });
    vi.mocked(runExtensionWorkflow).mockResolvedValue({ ok: true });

    const { container } = render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.editor', pageId: 'overview' },
    });
    await screen.findByRole('textbox', { name: 'Name 1' });

    await fireEvent.click(container.querySelector('.table-toolbar fluent-button')!);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);

    await fireEvent.input(screen.getByRole('textbox', { name: 'Name 1' }), {
      target: { value: 'Beta' },
    });
    await fireEvent.input(screen.getByRole('spinbutton', { name: 'Count 1' }), {
      target: { value: '5' },
    });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Mode 3' }), {
      target: { value: 'slow' },
    });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Enabled 3' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete 2' }));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);

    await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(runExtensionWorkflow).toHaveBeenCalledWith('org.example.editor', 'submit', {
      input: {
        formValues: {},
        tableValues: {
          records: [
            { name: 'Beta', mode: 'slow', count: 5, enabled: false },
            { name: '', mode: 'slow', count: '', enabled: true },
          ],
        },
        tableDeletions: { records: [] },
        actionId: 'submit',
      },
    });
  });

  it('keeps horizontal scrolling enabled by default and supports tables that fit the container', async () => {
    vi.mocked(readExtensionPage).mockResolvedValue({
      schema_version: 1,
      title: 'Responsive tables',
      blocks: [
        {
          type: 'table',
          columns: [{ key: 'name', label: 'Name' }],
          rows: [{ name: 'Scrollable by default' }],
        },
        {
          type: 'table',
          horizontal_scroll: false,
          columns: [{ key: 'name', label: 'Name' }],
          rows: [{ name: 'Fits the container' }],
        },
      ],
    });

    const { container } = render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.tables', pageId: 'overview' },
    });
    await screen.findByText('Fits the container');

    const tables = container.querySelectorAll('.table-wrap');
    expect(tables).toHaveLength(2);
    expect(tables[0].classList.contains('table-wrap--no-horizontal-scroll')).toBe(false);
    expect(tables[1].classList.contains('table-wrap--no-horizontal-scroll')).toBe(true);
  });

  it('restores a cell when an edit would exceed the table data limit', async () => {
    const initialValue = 'x'.repeat(65_500);
    vi.mocked(readExtensionPage).mockResolvedValue({
      schema_version: 1,
      title: 'Bounded table',
      blocks: [{
        type: 'table',
        id: 'bounded',
        editable: true,
        columns: [{ key: 'name', label: 'Name', type: 'text' }],
        rows: [{ name: initialValue }],
      }],
    });

    render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.bounded', pageId: 'overview' },
    });
    const input = await screen.findByRole('textbox', { name: 'Name 1' });
    await fireEvent.input(input, { target: { value: `${initialValue}${'y'.repeat(40)}` } });

    expect((input as HTMLInputElement).value).toBe(initialValue);
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