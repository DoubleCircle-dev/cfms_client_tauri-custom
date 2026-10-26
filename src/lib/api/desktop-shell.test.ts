import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CLOSE_BUTTON_BEHAVIOR,
  dismissCloseRequest,
  getCloseButtonBehavior,
  normalizeCloseButtonBehavior,
  resolveCloseRequest,
  setCloseButtonBehavior,
  syncDesktopShellLabels,
} from './desktop-shell';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => invokeMock.mockReset());

describe('close-button behaviour', () => {
  it('asks on a fresh profile instead of guessing', () => {
    expect(DEFAULT_CLOSE_BUTTON_BEHAVIOR).toBe('ask');
    expect(normalizeCloseButtonBehavior(undefined)).toBe('ask');
    expect(normalizeCloseButtonBehavior(null)).toBe('ask');
    expect(normalizeCloseButtonBehavior('close')).toBe('ask');
  });

  it('accepts the two concrete answers', () => {
    expect(normalizeCloseButtonBehavior('minimize_to_tray')).toBe('minimize_to_tray');
    expect(normalizeCloseButtonBehavior('quit')).toBe('quit');
  });

  it('reads the stored behaviour', async () => {
    invokeMock.mockResolvedValue('minimize_to_tray');

    await expect(getCloseButtonBehavior()).resolves.toBe('minimize_to_tray');
    expect(invokeMock).toHaveBeenCalledWith('get_close_behavior');
  });

  it('normalizes an unexpected stored value', async () => {
    invokeMock.mockResolvedValue('close');

    await expect(getCloseButtonBehavior()).resolves.toBe('ask');
  });

  it('normalizes before persisting', async () => {
    invokeMock.mockResolvedValue(undefined);

    await setCloseButtonBehavior('nonsense' as never);

    expect(invokeMock).toHaveBeenCalledWith('set_close_behavior', { behavior: 'ask' });
  });

  it('forwards the prompt answer and the remember flag', async () => {
    invokeMock.mockResolvedValue(undefined);

    await resolveCloseRequest('quit', true);

    expect(invokeMock).toHaveBeenCalledWith('resolve_close_request', {
      action: 'quit',
      remember: true,
    });
  });

  it('forwards the minimized answer without remembering', async () => {
    invokeMock.mockResolvedValue(undefined);

    await resolveCloseRequest('minimize_to_tray', false);

    expect(invokeMock).toHaveBeenCalledWith('resolve_close_request', {
      action: 'minimize_to_tray',
      remember: false,
    });
  });

  it('tells the shell when the prompt was dismissed', async () => {
    invokeMock.mockResolvedValue(undefined);

    await dismissCloseRequest();

    expect(invokeMock).toHaveBeenCalledWith('resolve_close_request', {
      action: 'ask',
      remember: false,
    });
  });

  it('pushes tray labels in the shape the shell expects', async () => {
    invokeMock.mockResolvedValue(undefined);

    await syncDesktopShellLabels({
      show: 'Show main window',
      hide: 'Hide to tray',
      quit: 'Quit CFMS Client',
      tooltip: 'CFMS Client',
    });

    expect(invokeMock).toHaveBeenCalledWith('sync_desktop_shell_labels', {
      labels: {
        show: 'Show main window',
        hide: 'Hide to tray',
        quit: 'Quit CFMS Client',
        tooltip: 'CFMS Client',
      },
    });
  });
});
