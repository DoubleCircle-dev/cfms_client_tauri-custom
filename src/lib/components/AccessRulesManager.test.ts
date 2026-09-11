// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccessRulesManager from './AccessRulesManager.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = 'light';
});

describe('AccessRulesManager', () => {
  it('uses the shared CodeMirror JSON editor for source rules', async () => {
    const { container } = render(AccessRulesManager, {
      props: {
        rules: {
          read: [{ match: 'any', match_groups: [] }],
        },
        inheritParent: false,
        onSave: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'files.sourceCode' }));

    const editor = await screen.findByLabelText('files.accessRules');
    expect(editor.closest('.cm-editor')).not.toBeNull();
    expect(editor.getAttribute('data-focus-ring')).toBe('delegated');
    expect(editor.textContent).toContain('read');
    expect(container.querySelector('.access-rules-source-editor > textarea')).toBeNull();
  });
});
