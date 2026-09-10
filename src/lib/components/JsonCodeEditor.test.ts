// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JsonCodeEditor from './JsonCodeEditor.svelte';

afterEach(cleanup);

describe('JsonCodeEditor', () => {
  it('loads CodeMirror with the current JSON and a delegated focus ring', async () => {
    const onChange = vi.fn();
    const props = {
      value: '{"duration_seconds": 60}',
      diagnostics: [],
      disabled: false,
      ariaLabel: 'Payload JSON',
      loadingLabel: 'Loading JSON editor…',
      onChange,
    };
    const view = render(JsonCodeEditor, { props });

    const editor = await screen.findByLabelText('Payload JSON');
    expect(editor.getAttribute('data-focus-ring')).toBe('delegated');
    expect(editor.textContent).toContain('duration_seconds');

    await view.rerender({ ...props, value: '{"duration_seconds": 120}' });
    await waitFor(() => expect(editor.textContent).toContain('120'));
  });
});
