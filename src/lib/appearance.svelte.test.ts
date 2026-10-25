import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/svelte';
import { appearanceStore } from './appearance.svelte';

const mocks = vi.hoisted(() => ({
  nativeTheme: vi.fn().mockResolvedValue(undefined),
  backdrop: vi.fn().mockResolvedValue('solid'),
  fluent: vi.fn(),
}));
vi.mock('$lib/api', () => ({ loadAppearancePreference: vi.fn(), saveAppearancePreference: vi.fn() }));
vi.mock('$lib/api/core', () => ({ setWindowBackdrop: mocks.backdrop }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setTheme: mocks.nativeTheme }) }));
vi.mock('./fluent/runtime', () => ({ applyFluentTheme: mocks.fluent }));

afterEach(() => vi.unstubAllGlobals());

it('serializes native theme changes, ignores stale Mica acknowledgements, and disables material in forced colors', async () => {
  const forcedColors = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', (query: string) => query.includes('forced-colors')
    ? forcedColors : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const dispose = appearanceStore.init();
  await waitFor(() => expect(mocks.backdrop).toHaveBeenCalledOnce());
  mocks.backdrop.mockClear();

  let resolveOld!: (mode: string) => void;
  let resolveNew!: (mode: string) => void;
  mocks.backdrop.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
  appearanceStore.apply({ color_scheme: 'light', reduce_motion: 'never' });
  await waitFor(() => expect(mocks.backdrop).toHaveBeenCalledWith('light', true));
  appearanceStore.apply({ color_scheme: 'dark', reduce_motion: 'always' });
  expect(document.documentElement.dataset.windowBackdrop).toBe('solid');
  resolveOld('mica');
  await waitFor(() => expect(mocks.backdrop).toHaveBeenLastCalledWith('dark', true));
  expect(document.documentElement.dataset.windowBackdrop).toBe('solid');
  resolveNew('solid');
  await waitFor(() => expect(mocks.fluent).toHaveBeenLastCalledWith('dark', true));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.dataset.reduceMotion).toBe('true');

  forcedColors.matches = true;
  appearanceStore.apply({ color_scheme: 'light', reduce_motion: 'system' });
  await waitFor(() => expect(mocks.backdrop).toHaveBeenLastCalledWith('light', false));
  dispose();
});
