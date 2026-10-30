import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: mocks.isPermissionGranted,
  requestPermission: mocks.requestPermission,
  sendNotification: mocks.sendNotification,
}));

vi.mock('./tauri-runtime', () => ({ isTauriRuntime: () => true }));

vi.mock('svelte-i18n', async () => {
  const { readable } = await import('svelte/store');
  const formatter = (key: string, options?: { values?: Record<string, string | number> }) => {
    const values = options?.values ?? {};
    return key.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? ''));
  };
  return { _: readable(formatter) };
});

import {
  ensureNotificationPermission,
  notifyDownloadCompleted,
  resetSystemNotifications,
} from './system-notifications';

function setBackground(background: boolean) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(
    background ? 'hidden' : 'visible',
  );
  vi.spyOn(document, 'hasFocus').mockReturnValue(!background);
}

async function flushTimers() {
  await vi.advanceTimersByTimeAsync(2000);
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.isPermissionGranted.mockReset().mockResolvedValue(true);
  mocks.requestPermission.mockReset().mockResolvedValue('granted');
  mocks.sendNotification.mockReset();
  resetSystemNotifications();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetSystemNotifications();
});

describe('system notifications', () => {
  it('notifies a background completion with the file name', async () => {
    setBackground(true);
    notifyDownloadCompleted('/home/user/机密文件.pdf');
    await flushTimers();

    expect(mocks.sendNotification).toHaveBeenCalledWith({
      title: 'downloads.notifyCompleteTitle',
      body: '机密文件.pdf',
    });
  });

  it('coalesces a burst of completions into one notification', async () => {
    setBackground(true);
    notifyDownloadCompleted('/a/one.txt');
    notifyDownloadCompleted('/a/two.txt');
    notifyDownloadCompleted('/a/three.txt');
    await flushTimers();

    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotification).toHaveBeenCalledWith({
      title: 'downloads.notifyCompleteTitle',
      body: 'downloads.notifyCompleteMany',
    });
  });

  it('stays silent while the window is focused', async () => {
    setBackground(false);
    notifyDownloadCompleted('/a/one.txt');
    await flushTimers();

    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('asks for permission once and skips the toast when it is refused', async () => {
    setBackground(true);
    mocks.isPermissionGranted.mockResolvedValue(false);
    mocks.requestPermission.mockResolvedValue('denied');

    expect(await ensureNotificationPermission()).toBe(false);

    notifyDownloadCompleted('/a/one.txt');
    await flushTimers();

    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('drops queued completions when listeners shut down', async () => {
    setBackground(true);
    notifyDownloadCompleted('/a/one.txt');
    resetSystemNotifications();
    await flushTimers();

    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});
