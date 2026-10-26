// @vitest-environment jsdom

import '$lib/i18n';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
import { dialogStore } from '$lib/dialogs.svelte';
import ManagePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  viewAuditLogs: vi.fn(),
  getUserInfo: vi.fn(),
  getUserAvatar: vi.fn(),
  listUsers: vi.fn(),
  resetUserPassword: vi.fn(),
  getUserAuthentication: vi.fn(),
  getManagedTwoFactorStatus: vi.fn(),
  disableManagedTwoFactor: vi.fn(),
}));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  viewAuditLogs: mocks.viewAuditLogs,
  getUserInfo: mocks.getUserInfo,
  getUserAvatar: mocks.getUserAvatar,
  listUsers: mocks.listUsers,
  resetUserPassword: mocks.resetUserPassword,
  getUserAuthentication: mocks.getUserAuthentication,
  getManagedTwoFactorStatus: mocks.getManagedTwoFactorStatus,
  disableManagedTwoFactor: mocks.disableManagedTwoFactor,
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
  menuScale: () => ({ duration: 0 }),
  popScale: () => ({ duration: 0 }),
  snackbarMotion: () => ({ duration: 0 }),
  staggeredList: () => ({ duration: 0 }),
}));

vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));

function auditEntry(id: string, action: string) {
  return {
    id,
    action,
    user_id: 'aabbccdd-0000-4000-8000-000000000002' as string | null,
    target: null,
    data: null,
    result: 0,
    remote_address: '192.0.2.10',
    logged_time: 1_786_600_000,
  };
}

function auditPage(entries: ReturnType<typeof auditEntry>[], nextCursor: string | null = null) {
  return {
    entries,
    page_size: 128,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
  };
}

async function openAuditLogs() {
  render(ManagePage);
  await fireEvent.click(screen.getByRole('tab', { name: 'Logs' }));
  await waitFor(() => expect(mocks.viewAuditLogs).toHaveBeenCalledWith(null, 128, []));
}

beforeEach(() => {
  locale.set('en');
  authStore.clear();
  serverStateStore.clear();
  authStore.apply({
    username: 'admin', user_id: 'aabbccdd-0000-4000-8000-000000000002',
    nickname: 'Administrator',
    has_token: true,
    token_exp: 1_900_000_000,
    permissions: ['view_audit_logs'],
    groups: [],
  });
  mocks.viewAuditLogs.mockReset();
  mocks.listUsers.mockReset();
  mocks.getUserInfo.mockReset().mockResolvedValue({
    user_id: 'aabbccdd-0000-4000-8000-000000000002', username: 'alice', nickname: 'Alice',
    status: 'active', permissions: [], effective_permissions: [], effective_own_permissions: [],
    effective_inherited_permissions: [], groups: [], last_login: 1786600000,
  });
  mocks.getUserAvatar.mockReset().mockResolvedValue(null);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
});

afterEach(() => {
  cleanup();
  authStore.clear();
  serverStateStore.clear();
  notificationStore.clear();
  vi.useRealTimers();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('management account context menu', () => {
  it('resets another account with configuration permission without reading authentication inventory', async () => {
    authStore.permissions = ['list_users', 'super_configure_auth_methods'];
    authStore.escalationExp = Date.now() / 1000 + 300;
    mocks.listUsers.mockResolvedValue([{ user_id: 'other-id', username: 'alice', nickname: 'Alice', groups: [], effective_permissions: [], last_login: null }]);
    mocks.resetUserPassword.mockResolvedValue(true);
    render(ManagePage);
    await fireEvent.contextMenu((await screen.findAllByRole('listitem'))[0]);
    expect(screen.queryByRole('menuitem', { name: 'Authentication' })).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText('New Password'), { target: { value: 'new-password' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(mocks.resetUserPassword).toHaveBeenCalledWith('other-id', 'new-password', false, false));
    expect(mocks.getUserAuthentication).not.toHaveBeenCalled();
    expect(mocks.getManagedTwoFactorStatus).not.toHaveBeenCalled();
    expect(authStore.isLoggedIn).toBe(true);
  });
  it('deletes a TOTP credential without requiring cross-user inventory permission or elevation', async () => {
    authStore.permissions = ['list_users', 'super_configure_auth_methods'];
    mocks.listUsers.mockResolvedValue([{ user_id: 'other-id', username: 'alice', nickname: 'Alice', groups: [], effective_permissions: [], last_login: null }]);
    mocks.disableManagedTwoFactor.mockResolvedValue(true);
    const confirm = vi.spyOn(dialogStore, 'confirm').mockResolvedValue(true);
    render(ManagePage);
    await fireEvent.contextMenu((await screen.findAllByRole('listitem'))[0]);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Account management' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Delete TOTP credential' }));
    await waitFor(() => expect(mocks.disableManagedTwoFactor).toHaveBeenCalledWith('other-id'));
    expect(mocks.getManagedTwoFactorStatus).not.toHaveBeenCalled();
    expect(mocks.getUserAuthentication).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
  it.each([false, true])('copies the selected account ID and reports clipboard failure=%s', async (fails) => {
    authStore.permissions = ['list_users'];
    const users = ['alice', 'bob'].map((username) => ({
      user_id: `${username}-full-user-id`, username, nickname: username,
      groups: [], effective_permissions: [], last_login: null,
    }));
    mocks.listUsers.mockResolvedValue(users);
    const writeText = fails
      ? vi.fn().mockRejectedValue(new Error('denied'))
      : vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(ManagePage);
    const rows = await screen.findAllByRole('listitem');
    await fireEvent.contextMenu(rows[1]);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy user ID' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(users[1].user_id));
    if (fails) {
      await waitFor(() => expect(notificationStore.entries[0]).toMatchObject({
        type: 'error', text: 'Failed to copy user ID.',
      }));
    } else {
      expect(notificationStore.entries).toHaveLength(0);
    }
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('management audit logs', () => {
  it('keeps user IDs compact on click while log IDs still expand', async () => {
    const first = auditEntry('audit-record-1', 'login');
    const second = auditEntry('audit-record-2', 'login');
    const anonymous = { ...auditEntry('audit-record-3', 'login'), user_id: null };
    mocks.viewAuditLogs.mockResolvedValue(auditPage([first, second, anonymous]));

    await openAuditLogs();
    expect(await screen.findByRole('columnheader', { name: 'User ID' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Username' })).toBeNull();
    const users = screen.getAllByRole('button', { name: /^Preview user / });
    expect(users).toHaveLength(2);
    expect(users[0].textContent?.trim()).toBe('aabbccd…');
    await fireEvent.click(users[0]);
    expect(users[0].textContent?.trim()).toBe('aabbccd…');
    expect(users[0].getAttribute('aria-expanded')).toBe('false');
    expect(users[1].getAttribute('aria-expanded')).toBe('false');
    const logIds = screen.getAllByRole('button', { name: 'Expand full audit log ID' });
    expect(logIds).toHaveLength(3);
    await fireEvent.click(logIds[0]);
    expect(logIds[0].textContent?.trim()).toBe(first.id);
    expect(mocks.getUserInfo).not.toHaveBeenCalled();
    const rows = screen.getAllByRole('row');
    expect(rows[3].querySelectorAll('td')[2].textContent?.trim()).toBe('—');
  });

  it.each(['contextmenu', 'longpress'])('copies the complete user ID using %s', async (interaction) => {
    const entry = auditEntry('audit-record-1', 'login');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mocks.viewAuditLogs.mockResolvedValue(auditPage([entry]));

    await openAuditLogs();
    const user = await screen.findByRole('button', { name: /^Preview user / });
    if (interaction === 'contextmenu') {
      await fireEvent.contextMenu(user);
    } else {
      vi.useFakeTimers();
      const press = new Event('pointerdown', { bubbles: true });
      Object.assign(press, { pointerType: 'touch', button: 0 });
      await fireEvent(user, press);
      await vi.advanceTimersByTimeAsync(550);
      await fireEvent.pointerUp(user, { pointerType: 'touch' });
      await fireEvent.click(user);
    }
    expect(writeText).toHaveBeenCalledWith(entry.user_id);
    expect(user.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows one preview at a time, shares duplicate user lookups, and reuses the existing details modal', async () => {
    mocks.viewAuditLogs.mockResolvedValue(auditPage([auditEntry('log-1', 'login'), auditEntry('log-2', 'login')]));
    await openAuditLogs();
    const users = screen.getAllByRole('button', { name: /^Preview user / });
    vi.useFakeTimers();
    await fireEvent.pointerEnter(users[0]);
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getAllByRole('dialog', { name: 'User preview' })).toHaveLength(1);
    await fireEvent.pointerEnter(users[1]);
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getAllByRole('dialog', { name: 'User preview' })).toHaveLength(1);
    expect(mocks.getUserInfo).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'View user details' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole('dialog', { name: 'User preview' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'User Details: alice' })).toBeTruthy();
    expect(mocks.getUserInfo).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(users[1]);
  });

  it('preserves expanded log IDs and their table when preview context changes', async () => {
    mocks.viewAuditLogs.mockResolvedValue(auditPage([auditEntry('log-record-1', 'login')]));
    await openAuditLogs();
    const log = screen.getByRole('button', { name: 'Expand full audit log ID' });
    const table = screen.getByRole('table');
    await fireEvent.click(log);
    authStore.permissionSnapshotRevision += 1;
    await waitFor(() => expect(screen.getByRole('button', { name: 'Collapse audit log ID' })).toBe(log));
    expect(log.textContent).toBe('log-record-1');
    expect(screen.getByRole('table')).toBe(table);
  });

  it('does not replace a newer user preview with a late response from another row', async () => {
    const first = auditEntry('log-1', 'login');
    const second = { ...auditEntry('log-2', 'login'), user_id: 'bob-id' };
    mocks.viewAuditLogs.mockResolvedValue(auditPage([first, second]));
    let resolve!: (info: unknown) => void;
    mocks.getUserInfo.mockReturnValueOnce(new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce({ user_id: 'bob-id', username: 'bob', nickname: 'Bob', status: 'active' });
    await openAuditLogs();
    const triggers = screen.getAllByRole('button', { name: /^Preview user / });
    vi.useFakeTimers();
    await fireEvent.pointerEnter(triggers[0]);
    await vi.advanceTimersByTimeAsync(300);
    await fireEvent.pointerEnter(triggers[1]);
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByText('@bob')).toBeTruthy();
    resolve({ user_id: first.user_id, username: 'stale', nickname: 'Stale' });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('@bob')).toBeTruthy();
    expect(screen.queryByText('@stale')).toBeNull();
    expect(mocks.getUserAvatar).toHaveBeenCalledExactlyOnceWith('bob-id');
  });

  it.each(['refresh', 'permission', 'server'])('clears preview data on %s and ignores late replies', async (change) => {
    mocks.viewAuditLogs.mockResolvedValue(auditPage([auditEntry('log-1', 'login')]));
    let resolve!: (info: unknown) => void;
    mocks.getUserInfo.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await openAuditLogs();
    vi.useFakeTimers();
    await fireEvent.pointerEnter(screen.getByRole('button', { name: /^Preview user / }));
    await vi.advanceTimersByTimeAsync(300);
    if (change === 'refresh') await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    if (change === 'permission') authStore.permissionSnapshotRevision += 1;
    if (change === 'server') serverStateStore.remoteAddress = 'different-server';
    await vi.advanceTimersByTimeAsync(0);
    resolve({ user_id: 'old', username: 'stale' });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.getUserAvatar).not.toHaveBeenCalled();
    await fireEvent.pointerEnter(screen.getByRole('button', { name: /^Preview user / }));
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.getUserInfo).toHaveBeenCalledTimes(2);
  });

  it('uses the preview before opening user details on touch', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
    mocks.viewAuditLogs.mockResolvedValue(auditPage([auditEntry('log-1', 'login')]));
    await openAuditLogs();
    const trigger = screen.getByRole('button', { name: /^Preview user / });
    vi.useFakeTimers();
    const enter = new Event('pointerenter', { bubbles: true });
    Object.assign(enter, { pointerType: 'touch' });
    await fireEvent(trigger, enter);
    const press = new Event('pointerdown', { bubbles: true });
    Object.assign(press, { pointerType: 'touch', button: 0 });
    await fireEvent(trigger, press);
    await fireEvent.pointerUp(trigger);
    await fireEvent.click(trigger);
    expect(mocks.getUserInfo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByRole('dialog', { name: 'User preview' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'User Details: alice' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'View user details' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole('dialog', { name: 'User Details: alice' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'User preview' })).toBeNull();
    expect(mocks.getUserInfo).toHaveBeenCalledWith({ userId: auditEntry('', '').user_id });
  });

  it('resets pagination on filter changes and carries filters through next and previous pages', async () => {
    mocks.viewAuditLogs
      .mockResolvedValueOnce(auditPage([
        auditEntry('audit-1', 'login'),
        auditEntry('audit-2', 'create_directory'),
      ], 'unfiltered-next'))
      .mockResolvedValueOnce(auditPage([
        auditEntry('audit-3', 'login'),
      ], 'filtered-next'))
      .mockResolvedValueOnce(auditPage([
        auditEntry('audit-4', 'create_directory'),
      ]))
      .mockResolvedValueOnce(auditPage([
        auditEntry('audit-3', 'login'),
      ], 'filtered-next'))
      .mockResolvedValueOnce(auditPage([
        auditEntry('audit-5', 'create_directory'),
      ]))
      .mockResolvedValueOnce(auditPage([
        auditEntry('audit-6', 'diagnostics'),
      ]));

    await openAuditLogs();
    await fireEvent.click(screen.getByRole('button', { name: 'Filter audit logs; 0 active' }));
    await fireEvent.click(screen.getByRole('option', { name: 'login' }));
    await fireEvent.click(screen.getByRole('option', { name: 'create_directory' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(mocks.viewAuditLogs).toHaveBeenLastCalledWith(
      null,
      128,
      ['create_directory', 'login'],
    ));

    const nextButton = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    await waitFor(() => expect(nextButton.disabled).toBe(false));
    await fireEvent.click(nextButton);
    await waitFor(() => expect(mocks.viewAuditLogs).toHaveBeenLastCalledWith(
      'filtered-next',
      128,
      ['create_directory', 'login'],
    ));

    const previousButton = screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement;
    await waitFor(() => expect(previousButton.disabled).toBe(false));
    await fireEvent.click(previousButton);
    await waitFor(() => expect(mocks.viewAuditLogs).toHaveBeenLastCalledWith(
      null,
      128,
      ['create_directory', 'login'],
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Remove login filter' }));
    await waitFor(() => expect(mocks.viewAuditLogs).toHaveBeenLastCalledWith(
      null,
      128,
      ['create_directory'],
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(mocks.viewAuditLogs).toHaveBeenLastCalledWith(null, 128, []));
    expect(mocks.viewAuditLogs).toHaveBeenCalledTimes(6);
  });

  it('keeps observed actions available and offers recovery from an unknown-action empty result', async () => {
    mocks.viewAuditLogs
      .mockResolvedValueOnce(auditPage([auditEntry('audit-1', 'login')]))
      .mockResolvedValueOnce(auditPage([]))
      .mockResolvedValueOnce(auditPage([auditEntry('audit-2', 'login')]));

    await openAuditLogs();
    await fireEvent.click(screen.getByRole('button', { name: 'Filter audit logs; 0 active' }));
    const input = screen.getByLabelText('Search or enter an audit action');
    await fireEvent.input(input, { target: { value: 'unknown_extension_action' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(await screen.findByText('No audit logs match the selected actions.')).toBeTruthy();
    await fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' }).at(-1)!);
    await waitFor(() => expect(mocks.viewAuditLogs).toHaveBeenLastCalledWith(null, 128, []));

    await fireEvent.click(screen.getByRole('button', { name: 'Filter audit logs; 0 active' }));
    expect(screen.getByRole('option', { name: 'login' })).toBeTruthy();
  });
});
