// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeclarativePage } from '$lib/api/extensions';

vi.mock('$lib/api/extensions', () => ({
  readExtensionPage: vi.fn(),
}));
vi.mock('$lib/extension-workflows', () => ({
  runExtensionWorkflow: vi.fn(),
}));

import { readExtensionPage } from '$lib/api/extensions';
import { runExtensionWorkflow } from '$lib/extension-workflows';
import ExtensionPageRenderer from './ExtensionPageRenderer.svelte';

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('style[data-extension-style-scope]').forEach((style) => style.remove());
});

describe('extension page styles', () => {
  it('renders scoped tabs, multiline fields, action results, and page CSS', async () => {
    const page: DeclarativePage = {
      schema_version: 1,
      title: 'Styled tools',
      blocks: [
        {
          type: 'tabs',
          id: 'tools',
          label: 'Tools',
          tabs: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }],
          default_tab: 'first',
          class_name: 'plugin-tool-tabs',
        },
        {
          type: 'form',
          id: 'tool',
          class_name: 'plugin-tool-form',
          tab: { group: 'tools', id: 'first' },
          fields: [{
            id: 'input',
            label: 'Input',
            type: 'textarea',
            class_name: 'plugin-tool-input',
          }],
        },
        {
          type: 'actions',
          tab: { group: 'tools', id: 'first' },
          actions: [
            { id: 'run', label: 'Run', workflow: 'run', result_id: 'output' },
            { id: 'clear', label: 'Clear', kind: 'clear', form_id: 'tool', field_ids: ['input'], result_id: 'output' },
          ],
        },
        {
          type: 'result',
          id: 'output',
          label: 'Output',
          copy_label: 'Copy result',
          tab: { group: 'tools', id: 'first' },
        },
      ],
      styles: [{
        selector: '.plugin-tool-form .extension-control',
        declarations: { width: '100%' },
      }],
    };
    vi.mocked(readExtensionPage).mockResolvedValue(page);
    vi.mocked(runExtensionWorkflow).mockResolvedValue({ ok: true, output: 'result text' });
    const { container } = render(ExtensionPageRenderer, {
      props: { extensionId: 'org.example.tools', pageId: 'overview' },
    });

    await screen.findByLabelText('Input');
    await waitFor(() => {
      expect(document.head.querySelector('style[data-extension-style-scope]')).toBeTruthy();
    });

    const root = container.querySelector<HTMLElement>('.extension-page');
    expect(root?.classList.contains('plugin-tool-form')).toBe(false);
    expect(root?.querySelector('.plugin-tool-form .plugin-tool-input')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'First' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected')).toBe('false');
    const scope = root?.dataset.extensionStyleScope;
    const styleText = document.head.querySelector('style[data-extension-style-scope]')?.textContent;
    expect(styleText).toContain(`[data-extension-style-scope="${scope}"] .plugin-tool-form .extension-control`);
    expect(styleText).not.toContain('body');

    const input = screen.getByLabelText('Input') as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: 'hello' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect((screen.getByLabelText('Output') as HTMLTextAreaElement).value).toBe('result text'));
    await fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
    expect(screen.queryByLabelText('Input')).toBeNull();
    await fireEvent.click(screen.getByRole('tab', { name: 'First' }));
    expect((screen.getByLabelText('Input') as HTMLTextAreaElement).value).toBe('hello');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByLabelText('Input') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText('Output') as HTMLTextAreaElement).value).toBe('');
  });
});
