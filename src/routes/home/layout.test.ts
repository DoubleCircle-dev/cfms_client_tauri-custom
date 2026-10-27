import '$lib/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { writable } from 'svelte/store';
import { locale } from 'svelte-i18n';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authStore, serverStateStore } from '$lib/stores.svelte';
import WorkspaceLayout from './+layout.svelte';

const mocks = vi.hoisted(() => ({ goto: vi.fn() }));
vi.hoisted(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/stores', () => ({ page: writable({ url: new URL('https://example.test/home/files') }) }));
vi.mock('$lib/platform', () => ({ supportsKeyboardShortcuts: () => false, isMobilePlatform: () => false }));
vi.mock('$lib/api', async (original) => ({ ...await original<typeof import('$lib/api')>(), loadUserPreference: async () => ({}) }));

beforeEach(() => {
  locale.set('en');
  authStore.apply({ user_id: 'self-id', username: 'alice', nickname: 'Alice', has_token: true, token_exp: 1_900_000_000, groups: [], permissions: [] });
  serverStateStore.updateConnection(true, 'wss://example.test', false);
  mocks.goto.mockReset();
});
afterEach(() => { cleanup(); authStore.clear(); serverStateStore.clear(); });
afterAll(() => vi.unstubAllGlobals());

it('opens My account from the account menu for an ordinary user and closes the flyout', async () => {
  render(WorkspaceLayout, { children: createRawSnippet(() => ({ render: () => '<div>Workspace content</div>' })) });
  await fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
  const entry = screen.getByRole('menuitem', { name: 'My account' });
  const menuItems = screen.getAllByRole('menuitem');
  expect(menuItems.indexOf(entry)).toBeLessThan(menuItems.findIndex((item) => item.textContent?.includes('Log out')));
  await fireEvent.click(entry);
  expect(mocks.goto).toHaveBeenCalledWith('/home/settings/account');
  expect(screen.queryByRole('menu')).toBeNull();
});
