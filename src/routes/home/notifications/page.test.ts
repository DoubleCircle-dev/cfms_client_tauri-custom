// @vitest-environment jsdom

import '$lib/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationStore } from '$lib/stores.svelte';

import NotificationsPage from './+page.svelte';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

beforeEach(() => {
  locale.set('en');
  notificationStore.clear();
  notificationStore.clearHistory();
  gotoMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('notification history page', () => {
  it('shows an empty state before anything has been notified', () => {
    render(NotificationsPage);

    expect(screen.getByText('No notifications yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear history' })).toHaveProperty('disabled', true);
  });

  it('lists the newest notification first with its level filter', () => {
    notificationStore.info('Synced the folder');
    notificationStore.error('Upload failed');

    render(NotificationsPage);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Upload failed');
    expect(rows[1].textContent).toContain('Synced the folder');
  });

  it('filters by level and keeps the toast stack untouched', async () => {
    notificationStore.info('Kept');
    notificationStore.success('Done');

    render(NotificationsPage);
    await fireEvent.click(screen.getByRole('button', { name: /^Error/ }));

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No notifications match this filter.')).toBeTruthy();
    expect(notificationStore.entries).toHaveLength(2);
  });

  it('expands the items behind a grouped notification', async () => {
    notificationStore.error('2 downloads failed', 8000, {
      groupKey: 'downloads',
      groupTitle: 'Downloads failed',
      itemText: 'First failed',
      summaryText: (count) => `${count} downloads failed`,
    });
    notificationStore.error('Second failed', 8000, {
      groupKey: 'downloads',
      groupTitle: 'Downloads failed',
      itemText: 'Second failed',
      summaryText: (count) => `${count} downloads failed`,
    });

    render(NotificationsPage);
    expect(screen.getByText('2 downloads failed')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: '2 entries' }));
    expect(screen.getByText('First failed')).toBeTruthy();
    expect(screen.getByText('Second failed')).toBeTruthy();
  });

  it('clears the history and goes back to the transfer page', async () => {
    notificationStore.info('Something happened');
    render(NotificationsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(notificationStore.history).toHaveLength(0);

    await fireEvent.click(screen.getByRole('button', { name: 'Back to transfers' }));
    expect(gotoMock).toHaveBeenCalledWith('/home/tasks');
  });
});
