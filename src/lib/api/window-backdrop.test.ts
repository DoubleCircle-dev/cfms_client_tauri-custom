import { expect, it, vi } from 'vitest';
import { setWindowBackdrop } from './core';

const mocks = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue('solid') }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

it('passes the palette canvas RGB through the native backdrop IPC', async () => {
  await expect(setWindowBackdrop('dark', false, [25, 37, 30])).resolves.toBe('solid');
  expect(mocks.invoke).toHaveBeenCalledWith('set_window_backdrop', {
    theme: 'dark', enabled: false, solidColor: [25, 37, 30],
  });
});
