// @vitest-environment jsdom

import '$lib/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '$lib/stores.svelte';
import ManagePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  viewAuditLogs: vi.fn(),
}));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  viewAuditLogs: mocks.viewAuditLogs,
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
  menuScale: () => ({ duration: 0 }),
  popScale: () => ({ duration: 0 }),
  snackbarMotion: () => ({ duration: 0 }),
  staggeredList: () => ({ duration: 0 }),
}));

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
  authStore.apply({
    username: 'admin', user_id: 'aabbccdd-0000-4000-8000-000000000002',
    nickname: 'Administrator',
    has_token: true,
    token_exp: 1_900_000_000,
    permissions: ['view_audit_logs'],
    groups: [],
  });
  mocks.viewAuditLogs.mockReset();
});

afterEach(() => {
  cleanup();
  authStore.clear();
  vi.useRealTimers();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.clearAllMocks();
});

describe('management audit logs', () => {
  it('replaces the username column with compact user IDs that expand independently', async () => {
    const first = auditEntry('audit-record-1', 'login');
    const second = auditEntry('audit-record-2', 'login');
    const anonymous = { ...auditEntry('audit-record-3', 'login'), user_id: null };
    mocks.viewAuditLogs.mockResolvedValue(auditPage([first, second, anonymous]));

    await openAuditLogs();
    expect(await screen.findByRole('columnheader', { name: 'User ID' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Username' })).toBeNull();
    const users = screen.getAllByRole('button', { name: 'Expand full user ID' });
    expect(users).toHaveLength(2);
    expect(users[0].textContent?.trim()).toBe('aabbccd…');
    expect(users[0].title).toBe(first.user_id);
    await fireEvent.click(users[0]);
    expect(users[0].textContent?.trim()).toBe(first.user_id);
    expect(users[0].getAttribute('aria-expanded')).toBe('true');
    expect(users[1].getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button', { name: 'Expand full audit log ID' })).toHaveLength(3);
    await fireEvent.click(users[0]);
    expect(users[0].textContent?.trim()).toBe('aabbccd…');
    const rows = screen.getAllByRole('row');
    expect(rows[3].querySelectorAll('td')[2].textContent?.trim()).toBe('—');
  });

  it.each(['contextmenu', 'longpress'])('copies the complete user ID using %s', async (interaction) => {
    const entry = auditEntry('audit-record-1', 'login');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mocks.viewAuditLogs.mockResolvedValue(auditPage([entry]));

    await openAuditLogs();
    const user = await screen.findByRole('button', { name: 'Expand full user ID' });
    if (interaction === 'contextmenu') {
      await fireEvent.contextMenu(user);
    } else {
      vi.useFakeTimers();
      await fireEvent.pointerDown(user, { pointerType: 'touch' });
      await vi.advanceTimersByTimeAsync(550);
      await fireEvent.pointerUp(user, { pointerType: 'touch' });
      await fireEvent.click(user);
    }
    expect(writeText).toHaveBeenCalledWith(entry.user_id);
    expect(user.getAttribute('aria-expanded')).toBe('false');
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
