// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ChatPage from './+page.svelte';

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

const mocks = vi.hoisted(() => ({
  scanLocalChatbox: vi.fn(),
  listDirectory: vi.fn(),
  resolveNodePath: vi.fn(),
  readServerDocument: vi.fn(),
  getDocument: vi.fn(),
  openLocalPath: vi.fn(),
  uploadChatRecord: vi.fn(),
  currentUsername: 'alice',
}));

const originalAnimate = Element.prototype.animate;

beforeAll(() => {
  Element.prototype.animate = vi.fn(() => {
    const animation = {
      cancel: vi.fn(),
      commitStyles: vi.fn(),
      currentTime: 0,
      effect: null,
      finished: Promise.resolve(),
      finish: vi.fn(),
      id: '',
      oncancel: null,
      onfinish: null,
      onremove: null,
      pending: false,
      persist: vi.fn(),
      play: vi.fn(),
      playbackRate: 1,
      playState: 'finished',
      ready: Promise.resolve(),
      remove: vi.fn(),
      replaceState: 'active',
      reverse: vi.fn(),
      startTime: 0,
      timeline: null,
      updatePlaybackRate: vi.fn(),
    } as unknown as Animation;
    queueMicrotask(() => animation.onfinish?.(new Event('finish') as AnimationPlaybackEvent));
    return animation;
  });
});

afterAll(() => {
  Element.prototype.animate = originalAnimate;
});

vi.mock('$lib/api/files', () => ({
  getDocument: mocks.getDocument,
  listDirectory: mocks.listDirectory,
  openLocalPath: mocks.openLocalPath,
  readServerDocument: mocks.readServerDocument,
  resolveNodePath: mocks.resolveNodePath,
  scanLocalChatbox: mocks.scanLocalChatbox,
  uploadChatRecord: mocks.uploadChatRecord,
}));

vi.mock('$lib/stores.svelte', () => ({
  authStore: {
    get username() {
      return mocks.currentUsername;
    },
  },
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

interface RealRoomFixture {
  id: string;
  files: {
    name: string;
    path: string;
    kind: string;
    size: number;
    content: string | null;
    read_error?: 'permission_denied' | 'read_failed' | null;
    truncated: boolean;
  }[];
}

// The regression fixture is captured from a real chatbox folder and lives in
// the system temp directory rather than the repository. Skip the local-mode
// regression test when that capture is unavailable instead of failing the
// whole suite.
const REAL_ROOMS = ((): RealRoomFixture[] | null => {
  try {
    return JSON.parse(
      readFileSync(`${process.env.TEMP}/chatbox-real.json`, 'utf8'),
    ) as RealRoomFixture[];
  } catch {
    return null;
  }
})();

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
  it('shows a structured explanation for a local record that cannot be read', async () => {
    localStorage.setItem('cfms:chatbox:mode', 'local');
    localStorage.setItem('cfms:chatbox:localPath', 'C:/fake/chatbox');
    mocks.scanLocalChatbox.mockResolvedValue([
      {
        id: 'restricted-room',
        files: [
          {
            name: 'restricted-user.txt',
            path: 'C:/fake/chatbox/restricted-room/restricted-user.txt',
            kind: 'text',
            size: 20,
            content: null,
            read_error: 'permission_denied',
            truncated: false,
          },
        ],
      },
    ]);

    render(ChatPage);

    expect(await screen.findByText('chat.unreadableRecordsTitle')).toBeTruthy();
    expect(screen.getByText('restricted-user.txt')).toBeTruthy();
    expect(screen.getByText('chat.localPermissionDenied')).toBeTruthy();
    expect(screen.getByText('chat.localPermissionAction')).toBeTruthy();
    expect(screen.queryByText('chat.noMessages')).toBeNull();
  });

  it.skipIf(REAL_ROOMS === null)('updates the room header when switching rooms and uses folder names as room ids', async () => {
    localStorage.setItem('cfms:chatbox:mode', 'local');
    localStorage.setItem('cfms:chatbox:localPath', 'C:/fake/chatbox');
    mocks.scanLocalChatbox.mockResolvedValue(REAL_ROOMS!);

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
  it('shows a structured explanation when the server denies access to a chat record', async () => {
    mocks.resolveNodePath.mockResolvedValue({
      node_ids: ['/', '.runtime', 'chatbox-folder-id'],
    });
    mocks.listDirectory.mockImplementation(async (folderId: string | null) => {
      if (folderId === 'chatbox-folder-id') {
        return {
          folders: [{ id: 'restricted-room-id', name: 'restricted-room', created_time: 100 }],
          documents: [],
          parent_id: null,
        };
      }
      return {
        folders: [],
        documents: [{ id: 'restricted-record-id', title: '6025d18.txt' }],
        parent_id: folderId,
      };
    });
    mocks.readServerDocument.mockRejectedValue(new Error('Access denied: download permission required'));

    render(ChatPage);
    await waitFor(() => {
      expect(roomCards().length).toBe(1);
    });

    const card = roomCards()[0].closest('.chat-room-card') as HTMLElement;
    await fireEvent.click(card);

    expect(await screen.findByText('chat.unreadableRecordsTitle')).toBeTruthy();
    expect(screen.getByText('6025d18.txt')).toBeTruthy();
    expect(screen.getByText('chat.serverPermissionDenied')).toBeTruthy();
    expect(screen.getByText('chat.serverPermissionAction')).toBeTruthy();
    expect(screen.queryByText('chat.noMessages')).toBeNull();
    expect(await screen.findByRole('textbox', { name: 'chat.speakerName' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'chat.uploadRecord' })).toBeNull();
  });

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

  it('defaults to the current account name, hashes it, timestamps, and saves each message when spoken', async () => {
    const accountHash = createHash('sha256').update('alice').digest('hex').slice(0, 7);
    mocks.resolveNodePath.mockResolvedValue({
      node_ids: ['/', '.runtime', 'chatbox-folder-id'],
    });
    mocks.listDirectory.mockImplementation(async (folderId: string | null) => {
      if (folderId === 'chatbox-folder-id') {
        return {
          folders: [{ id: 'room-folder-id', name: 'room-id', created_time: 100 }],
          documents: [],
          parent_id: null,
        };
      }
      return {
        folders: [],
        documents: [{ id: 'record-id', title: `${accountHash}.txt` }],
        parent_id: folderId,
      };
    });
    mocks.readServerDocument.mockResolvedValue({
      content: '# time | msg\n2026-08-12 20:15:00 | existing\n',
      size: 50,
      truncated: false,
    });
    mocks.uploadChatRecord.mockResolvedValue({
      file_name: `${accountHash}.txt`,
      overwritten: true,
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(ChatPage);
    await waitFor(() => expect(roomCards().length).toBe(1));
    await fireEvent.click(roomCards()[0].closest('.chat-room-card') as HTMLElement);

    const speakerName = screen.getByRole('textbox', { name: 'chat.speakerName' });
    expect((speakerName as HTMLInputElement).value).toBe('alice');
    const hashCheckbox = screen.getByRole('checkbox', { name: 'chat.hashSpeakerName' });
    expect((hashCheckbox as HTMLInputElement).checked).toBe(true);
    await fireEvent.input(screen.getByRole('textbox', { name: 'chat.message' }), {
      target: { value: 'new message' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'chat.speak' }));

    await waitFor(() => {
      expect(mocks.uploadChatRecord).toHaveBeenCalledWith(
        'room-folder-id',
        accountHash,
        expect.stringMatching(
          /^# time \| msg\n2026-08-12 20:15:00 \| existing\n\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| new message\n$/,
        ),
        expect.any(String),
      );
    });
    expect(confirm).toHaveBeenCalledWith(`chat.appendRecordConfirm:${accountHash}.txt`);
    expect((speakerName as HTMLInputElement).disabled).toBe(true);
    expect((hashCheckbox as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('new message')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'chat.uploadRecord' })).toBeNull();
  });

  it('uses the custom speaker name when hash conversion is unchecked', async () => {
    mocks.resolveNodePath.mockResolvedValue({
      node_ids: ['/', '.runtime', 'chatbox-folder-id'],
    });
    mocks.listDirectory.mockImplementation(async (folderId: string | null) => {
      if (folderId === 'chatbox-folder-id') {
        return {
          folders: [{ id: 'room-folder-id', name: 'room-id', created_time: 100 }],
          documents: [],
          parent_id: null,
        };
      }
      return { folders: [], documents: [], parent_id: folderId };
    });
    mocks.readServerDocument.mockResolvedValue({
      content: '',
      size: 0,
      truncated: false,
    });
    mocks.uploadChatRecord.mockResolvedValue({
      file_name: 'custom-speaker.txt',
      overwritten: false,
    });

    render(ChatPage);
    await waitFor(() => expect(roomCards().length).toBe(1));
    await fireEvent.click(roomCards()[0].closest('.chat-room-card') as HTMLElement);

    const speakerName = await screen.findByRole('textbox', { name: 'chat.speakerName' });
    await fireEvent.input(speakerName, { target: { value: 'custom-speaker' } });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'chat.hashSpeakerName' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'chat.message' }), {
      target: { value: 'hello' },
    });
    await fireEvent.keyDown(screen.getByRole('textbox', { name: 'chat.message' }), {
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
    });

    await waitFor(() => {
      expect(mocks.uploadChatRecord).toHaveBeenCalledWith(
        'room-folder-id',
        'custom-speaker',
        expect.stringMatching(
          /^# time \| msg\n\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| hello\n$/,
        ),
        expect.any(String),
      );
    });
  });
});
