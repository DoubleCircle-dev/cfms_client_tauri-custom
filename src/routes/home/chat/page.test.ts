// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ChatPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  scanLocalChatbox: vi.fn(),
  listDirectory: vi.fn(),
  resolveNodePath: vi.fn(),
  readServerDocument: vi.fn(),
  getDocument: vi.fn(),
  openLocalPath: vi.fn(),
}));

vi.mock('$lib/api/files', () => ({
  getDocument: mocks.getDocument,
  listDirectory: mocks.listDirectory,
  openLocalPath: mocks.openLocalPath,
  readServerDocument: mocks.readServerDocument,
  resolveNodePath: mocks.resolveNodePath,
  scanLocalChatbox: mocks.scanLocalChatbox,
}));

vi.mock('$lib/stores.svelte', () => ({
  notificationStore: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('$lib/user-facing-errors', () => ({
  formatUserFacingError: (error: unknown) => String(error),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(
      run: (
        translate: (
          key: string,
          options?: { values?: Record<string, string | number> },
        ) => string,
      ) => void,
    ) {
      run((key, options) =>
        options?.values
          ? `${key}:${Object.values(options.values).join(':')}`
          : key,
      );
      return () => undefined;
    },
  },
}));

const REAL_ROOMS = JSON.parse(
  readFileSync(`${process.env.TEMP}/chatbox-real.json`, 'utf8'),
) as {
  id: string;
  files: {
    name: string;
    path: string;
    kind: string;
    size: number;
    content: string | null;
    truncated: boolean;
  }[];
}[];

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

function roomCards(): HTMLElement[] {
  return screen
    .getAllByRole('button')
    .filter((button) => button.classList.contains('chat-room-rename'));
}

describe('chat page local mode', () => {
  it('updates the room header when switching rooms and uses folder names as room ids', async () => {
    localStorage.setItem('cfms:chatbox:mode', 'local');
    localStorage.setItem('cfms:chatbox:localPath', 'C:/fake/chatbox');
    mocks.scanLocalChatbox.mockResolvedValue(REAL_ROOMS);

    render(ChatPage);

    await waitFor(() => {
      expect(screen.getAllByRole('button').some((b) => b.textContent?.includes('8月12日会议通知'))).toBe(true);
    });

    const cards = roomCards();
    expect(cards.length).toBeGreaterThan(1);
    const targetCard = cards[cards.length - 1].closest('.chat-room-card') as HTMLElement;
    const targetName = targetCard.querySelector('.chat-room-name')?.textContent ?? '';
    await fireEvent.click(targetCard);

    await waitFor(() => {
      const active = document.querySelector('.chat-room-card--active .chat-room-name');
      expect(active?.textContent).toBe(targetName);
    });
    const header = document.querySelector('.chat-view-header');
    expect(header?.textContent).toContain(targetName);
  });
});

describe('chat page online mode', () => {
  it('lists rooms by folder name (room id), includes the public room, and displays the folder name in the header', async () => {
    mocks.resolveNodePath.mockResolvedValue({
      node_ids: ['/', '.runtime', 'chatbox-folder-id'],
    });
    mocks.listDirectory.mockImplementation(async (folderId: string | null) => {
      if (folderId === 'chatbox-folder-id') {
        return {
          folders: [
            { id: 'dir-8-12', name: 'b55215f8-6958-453f-899f-8d6dbdd0d332', created_time: 100 },
            { id: 'dir-audio', name: 'ade46a55-db85-4660-9e74-ea25eb06fc47', created_time: 200 },
            { id: 'dir-special', name: '00000000-0000-0000-000000000000', created_time: 300 },
          ],
          documents: [],
          parent_id: null,
        };
      }
      return { folders: [], documents: [], parent_id: folderId };
    });
    mocks.readServerDocument.mockResolvedValue({
      content: '# time | msg\n2026-08-12 20:15:00 | hello\n',
      size: 10,
      truncated: false,
    });

    render(ChatPage);

    await waitFor(() => {
      expect(screen.getAllByRole('button').some((b) => b.textContent?.includes('8月12日会议通知'))).toBe(true);
    });

    const cards = roomCards();
    // The 00000000… room is a normal conversation room now.
    expect(cards.length).toBe(3);
    // Created-time descending order puts the public room first.
    let header = document.querySelector('.chat-view-header');
    expect(header?.textContent).toContain('公共聊天室');
    expect(header?.textContent).not.toContain('dir-audio');

    const secondCard = cards[1].closest('.chat-room-card') as HTMLElement;
    await fireEvent.click(secondCard);
    await waitFor(() => {
      const active = document.querySelector('.chat-room-card--active .chat-room-name');
      expect(active?.textContent).toContain('音频线索分析');
    });
    header = document.querySelector('.chat-view-header');
    expect(header?.textContent).toContain('ade46a55-db85-4660-9e74-ea25eb06fc47');
    // Server directory ids must never appear as the displayed room id.
    expect(header?.textContent).not.toContain('dir-audio');
  });

  it('switches the online chatbox source between the two server folders', async () => {
    mocks.resolveNodePath.mockResolvedValue({
      node_ids: ['/', 'echo', 'chatbox-folder-id'],
    });
    mocks.listDirectory.mockResolvedValue({
      folders: [],
      documents: [],
      parent_id: null,
    });

    render(ChatPage);
    await waitFor(() => {
      expect(mocks.resolveNodePath).toHaveBeenCalledWith('/.runtime/chatbox');
    });

    const echoButton = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('chat.sourceEcho'));
    expect(echoButton).toBeTruthy();
    await fireEvent.click(echoButton as HTMLElement);

    await waitFor(() => {
      expect(mocks.resolveNodePath).toHaveBeenCalledWith('/回响/.reserved/chatbox');
    });
  });
});
