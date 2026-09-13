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
    username: 'admin',
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
    username: 'admin',
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
  vi.clearAllMocks();
});

describe('management audit log filters', () => {
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
