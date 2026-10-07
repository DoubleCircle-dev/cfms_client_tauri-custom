// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BatchAccessRulesDialog from './BatchAccessRulesDialog.svelte';
import { getAccessRules, listDirectoryPage, setAccessRules } from '$lib/api';
import { dialogStore } from '$lib/dialogs.svelte';
import { floatingProgressStore } from '$lib/stores.svelte';
import '$lib/i18n';

vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  getAccessRules: vi.fn(), listDirectoryPage: vi.fn(), setAccessRules: vi.fn(),
  getLocale: vi.fn(), setLocale: vi.fn(),
}));
vi.mock('$lib/dialogs.svelte', () => ({ dialogStore: { confirm: vi.fn() } }));
vi.mock('$lib/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('$lib/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => {
    const animation = { cancel: vi.fn(), currentTime: 0, effect: {}, finished: Promise.resolve(),
      onfinish: null as (() => void) | null, playState: 'finished' };
    queueMicrotask(() => animation.onfinish?.());
    return animation;
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const targets = [
  { objectType: 'directory' as const, objectId: 'folder', name: 'Documents' },
  { objectType: 'document' as const, objectId: 'document', name: 'Report.txt' },
];
function setup(canReadTemplate = true) {
  const onApplied = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const props = { targets, canReadTemplate, checkGuard: (): import('$lib/files/batch-access-rules').BatchRulesProblem | null => null, onApplied, onClose };
  const view = render(BatchAccessRulesDialog, props);
  return { ...view, onApplied, onClose, props };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(floatingProgressStore, 'remove');
  locale.set('en');
  document.documentElement.dataset.reduceMotion = 'true';
  vi.mocked(getAccessRules).mockResolvedValue({ rules: {}, inherit: false });
  vi.mocked(setAccessRules).mockResolvedValue(true);
  vi.mocked(listDirectoryPage).mockResolvedValue({ folders: [], documents: [], parent_id: null, has_more: false, next_cursor: null, page_size: 128 });
});
afterEach(() => {
  cleanup();
  floatingProgressStore.clear();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.reduceMotion;
});

async function review() {
  await fireEvent.click(screen.getByRole('button', { name: 'Next: review scope' }));
  await screen.findByRole('button', { name: 'Apply to 2 objects' });
}

describe('BatchAccessRulesDialog', () => {
  it('starts blank with inheritance on and recursion off without fetching templates', async () => {
    setup(false);
    expect(screen.getByRole('switch', { name: 'Inherit rules from parent object' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Include directory descendants recursively' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Load as template' })).toBeNull();
    await review();
    expect(screen.getByText(/rules are empty/)).toBeTruthy();
    expect(getAccessRules).not.toHaveBeenCalled();
    expect(listDirectoryPage).not.toHaveBeenCalled();
    expect(setAccessRules).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 objects' }));
    await screen.findByText('This run has finished');
    expect(setAccessRules).toHaveBeenCalledTimes(2);
    expect(vi.mocked(setAccessRules).mock.calls[0][3]).toBe(true);
  });

  it('loads a chosen object as a template and applies its inheritance choice', async () => {
    setup();
    await fireEvent.change(screen.getByRole('combobox', { name: 'Rule template source' }), { target: { value: 'document:document' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Load as template' }));
    await screen.findByText('Template from: Report.txt');
    expect(getAccessRules).toHaveBeenCalledWith('document', 'document');
    expect(screen.getByRole('switch', { name: 'Inherit rules from parent object' }).getAttribute('aria-checked')).toBe('false');
  });

  it('keeps the draft after a template fetch failure and does not block blank editing', async () => {
    vi.mocked(getAccessRules).mockRejectedValueOnce('Server returned 403: denied');
    setup();
    await fireEvent.click(screen.getByRole('switch', { name: 'Inherit rules from parent object' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Load as template' }));
    await screen.findByText('Server returned 403: denied');
    expect(screen.getByRole('switch', { name: 'Inherit rules from parent object' }).getAttribute('aria-checked')).toBe('false');
    await review();
  });

  it('ignores template replies arriving after the user edits the draft', async () => {
    const pending = deferred<{ rules: unknown; inherit: boolean }>();
    vi.mocked(getAccessRules).mockReturnValueOnce(pending.promise);
    setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Load as template' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Inherit rules from parent object' }));
    pending.resolve({ rules: { read: [{ match: 'any', match_groups: [] }] }, inherit: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next: review scope' }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('switch', { name: 'Inherit rules from parent object' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/Template from:/)).toBeNull();
  });

  it('preserves source edits when returning from scope confirmation', async () => {
    setup(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Source Code' }));
    const content = await screen.findByLabelText('Access rules');
    const editor = EditorView.findFromDOM(content)!;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '{"read":[{"match":"all","match_groups":[]}]}' } });
    await review();
    expect(screen.queryByText(/rules are empty/)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }));
    expect(editor.state.doc.toString()).toContain('"match":"all"');
  });

  it('blocks invalid JSON before any scope scan or write', async () => {
    setup(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Source Code' }));
    const content = await screen.findByLabelText('Access rules');
    const editor = EditorView.findFromDOM(content)!;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '[]' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Next: review scope' }));
    await screen.findByText(/Invalid access rules JSON/);
    expect(listDirectoryPage).not.toHaveBeenCalled();
    expect(setAccessRules).not.toHaveBeenCalled();
  });

  it('requires explicit incomplete-scope acknowledgement after a recursive scan failure', async () => {
    vi.mocked(listDirectoryPage).mockRejectedValueOnce('Server returned 403: denied');
    setup(false);
    await fireEvent.click(screen.getByRole('switch', { name: 'Include directory descendants recursively' }));
    await review();
    expect(screen.getByRole('button', { name: 'Apply to 2 objects' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Scan scope again' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('checkbox', { name: /scope is incomplete/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 objects' }));
    await screen.findByText('This run has finished');
    expect(screen.getByText(/number of undiscovered objects is unknown/)).toBeTruthy();
    expect(setAccessRules).toHaveBeenCalledTimes(2);
  });

  it('filters results and retries failures without resubmitting successes', async () => {
    vi.mocked(setAccessRules).mockRejectedValueOnce('Server returned 403: denied');
    const { onApplied } = setup(false);
    await review();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 objects' }));
    await screen.findByText('This run has finished');
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    await fireEvent.change(screen.getByRole('combobox', { name: 'Show results' }), { target: { value: 'failed' } });
    expect(screen.getByText('Documents')).toBeTruthy();
    expect(screen.queryByText('Report.txt')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry failed objects' }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(2));
    expect(vi.mocked(setAccessRules).mock.calls.map(([, id]) => id)).toEqual(['folder', 'document', 'folder']);
    expect(screen.getByText('No results match this filter.')).toBeTruthy();
  });

  it('requires confirmation before resubmitting an uncertain result and keeps refresh errors separate', async () => {
    vi.mocked(setAccessRules).mockRejectedValueOnce(new Error('Connection failed: no response'));
    vi.mocked(dialogStore.confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onApplied } = setup(false);
    onApplied.mockRejectedValue(new Error('refresh unavailable'));
    await review();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 objects' }));
    await screen.findByText('Batch stopped');
    await fireEvent.click(screen.getByRole('button', { name: 'Resubmit unconfirmed objects' }));
    expect(setAccessRules).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Resubmit unconfirmed objects' }));
    await screen.findByText(/Directory refresh failed; recorded update results remain valid/);
    expect(setAccessRules).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Succeeded 1/)).toBeTruthy();
  });

  it('locks dismissal until an in-flight write settles, then preserves its success and removes progress', async () => {
    const pending = deferred<boolean>();
    vi.mocked(setAccessRules).mockReturnValueOnce(pending.promise);
    const { onClose, onApplied } = setup(false);
    await review();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 objects' }));
    await waitFor(() => expect(setAccessRules).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Stop further processing' }));
    pending.resolve(true);
    await screen.findByText('Batch stopped');
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(setAccessRules).toHaveBeenCalledTimes(1);
    expect(floatingProgressStore.remove).toHaveBeenCalled();
    await fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops after permission changes while retaining the actual in-flight result and blocking continuation', async () => {
    const pending = deferred<boolean>();
    vi.mocked(setAccessRules).mockReturnValueOnce(pending.promise);
    const view = setup(false);
    await review();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 objects' }));
    await waitFor(() => expect(setAccessRules).toHaveBeenCalledTimes(1));
    await view.rerender({ ...view.props, checkGuard: () => ({ kind: 'permission' }) });
    await screen.findByText('Stopping; waiting for the current request…');
    pending.resolve(true);
    await screen.findByText('Batch stopped');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue unfinished objects' }).hasAttribute('disabled')).toBe(true));
    expect(setAccessRules).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Succeeded 1/)).toBeTruthy();
  });
});
