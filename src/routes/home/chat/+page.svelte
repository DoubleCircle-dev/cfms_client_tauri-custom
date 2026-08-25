<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { open } from '@tauri-apps/plugin-dialog';
  import { openUrl } from '@tauri-apps/plugin-opener';

  import Icon from '$lib/components/Icon.svelte';
  import { DEFAULT_ROOM_NAMES, DEFAULT_USER_NAMES } from '$lib/chatbox/names';
  import {
    getDocument,
    listDirectory,
    openLocalPath,
    readServerDocument,
    resolveNodePath,
    scanLocalChatbox,
  } from '$lib/api/files';
  import { notificationStore } from '$lib/stores.svelte';
  import { formatUserFacingError } from '$lib/user-facing-errors';

  const ROOM_NAMES_KEY = 'cfms:chatbox:roomNames';
  const USER_NAMES_KEY = 'cfms:chatbox:userNames';
  const MODE_KEY = 'cfms:chatbox:mode';
  const LOCAL_PATH_KEY = 'cfms:chatbox:localPath';
  const SOURCE_KEY = 'cfms:chatbox:source';

  const CHATBOX_SOURCES = [
    {
      id: 'runtime',
      path: '/.runtime/chatbox',
      segments: ['.runtime', 'chatbox'],
      labelKey: 'chat.sourceRuntime',
    },
    {
      id: 'echo',
      path: '/回响/.reserved/chatbox',
      segments: ['回响', '.reserved', 'chatbox'],
      labelKey: 'chat.sourceEcho',
    },
  ] as const;
  type ChatboxSourceId = (typeof CHATBOX_SOURCES)[number]['id'];

  const BUBBLE_COLORS = [
    '#ffffff',
    '#b8e4ff',
    '#c8f7c5',
    '#fff5b8',
    '#ffe0ec',
    '#e8d5ff',
    '#ffddc4',
    '#b8f0f0',
  ];
  const STRIP_COLORS = [
    '#e0e0e0',
    '#6cc4f5',
    '#5cd65c',
    '#f0d800',
    '#f580a8',
    '#b070f0',
    '#f09050',
    '#40c8c8',
  ];
  const URL_PATTERN = /https?:\/\/[^\s)]+/g;
  const REPLY_PATTERN = /\s*\/\/\s*(\w{7})\s*->\s*(.*)$/s;

  interface ReplyRef {
    user: string;
    text: string;
  }

  interface ChatMessage {
    user: string;
    time: string;
    content: string;
    replyRef: ReplyRef | null;
  }

  interface ChatAttachment {
    id: string;
    name: string;
    kind: 'image' | 'audio' | 'other';
    path?: string;
  }

  interface NonformatBlock {
    file: string;
    lines: string[];
  }

  interface ChatRoom {
    /** Server directory ID used for API calls (online mode only). */
    id: string;
    /** Chatbox folder name — the real room ID used for display and renames. */
    roomId: string;
    name: string;
    createdTime: number | null;
    messages: ChatMessage[];
    attachments: ChatAttachment[];
    nonformat: NonformatBlock[];
    loaded: boolean;
    failed?: boolean;
  }

  type ChatMode = 'online' | 'local';

  let chatboxFolderId = $state<string | null>(null);
  let rooms = $state<ChatRoom[]>([]);
  let selectedRoomId = $state<string | null>(null);
  let loadingRooms = $state(false);
  let loadingRoomId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let showNonformat = $state(false);
  let mode = $state<ChatMode>(loadMode());
  let localPath = $state<string | null>(loadLocalPath());
  let chatboxSource = $state<ChatboxSourceId>(loadChatboxSource());
  let roomNames = $state<Record<string, string>>({
    ...DEFAULT_ROOM_NAMES,
    ...loadJson(ROOM_NAMES_KEY),
  });
  let userNames = $state<Record<string, string>>({
    ...DEFAULT_USER_NAMES,
    ...loadJson(USER_NAMES_KEY),
  });

  const selectedRoom = $derived(
    rooms.find((room) => room.roomId === selectedRoomId) ?? null,
  );
  const selectedColorMap = $derived.by(() => {
    const map = new Map<string, { bg: string; strip: string }>();
    if (!selectedRoom) return map;
    const seen: string[] = [];
    for (const message of selectedRoom.messages) {
      if (!seen.includes(message.user)) seen.push(message.user);
    }
    seen.forEach((userId, index) => {
      map.set(userId, {
        bg: BUBBLE_COLORS[index % BUBBLE_COLORS.length],
        strip: STRIP_COLORS[index % STRIP_COLORS.length],
      });
    });
    return map;
  });
  const activeChatboxPath = $derived(
    CHATBOX_SOURCES.find((source) => source.id === chatboxSource)?.path ?? '',
  );

  onMount(() => {
    if (mode === 'local') {
      if (localPath) void scanLocal();
    } else {
      void refresh();
    }
  });

  function loadMode(): ChatMode {
    try {
      return localStorage.getItem(MODE_KEY) === 'local' ? 'local' : 'online';
    } catch {
      return 'online';
    }
  }

  function loadLocalPath(): string | null {
    try {
      return localStorage.getItem(LOCAL_PATH_KEY);
    } catch {
      return null;
    }
  }

  function loadChatboxSource(): ChatboxSourceId {
    try {
      const saved = localStorage.getItem(SOURCE_KEY);
      return CHATBOX_SOURCES.some((source) => source.id === saved)
        ? (saved as ChatboxSourceId)
        : 'runtime';
    } catch {
      return 'runtime';
    }
  }

  function loadJson(key: string): Record<string, string> {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  function persistJson(key: string, value: Record<string, string>) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage failures; renames are a convenience feature.
    }
  }

  function displayName(userId: string): string {
    return (
      userNames[userId] ?? DEFAULT_USER_NAMES[userId] ?? `${userId.slice(0, 8)}…`
    );
  }

  function roomDisplayName(roomId: string): string {
    return (
      roomNames[roomId] ?? DEFAULT_ROOM_NAMES[roomId] ?? `${roomId.slice(0, 8)}…`
    );
  }

  async function findChatboxFolder(source: ChatboxSourceId): Promise<string | null> {
    const config =
      CHATBOX_SOURCES.find((item) => item.id === source) ?? CHATBOX_SOURCES[0];
    // Preferred: the node_lookup server extension resolves paths directly.
    try {
      const lookup = await resolveNodePath(config.path);
      const ids = lookup.node_ids ?? [];
      const folderId = ids[ids.length - 1];
      if (folderId && folderId !== '/') return folderId;
    } catch {
      // Fall through to walking the root listing.
    }

    let current: string | null = null;
    for (const segment of config.segments) {
      const listing = await listDirectory(current);
      const folder = listing.folders.find((item) => item.name === segment);
      if (!folder) return null;
      current = folder.id;
    }
    return current;
  }

  async function refresh() {
    if (mode === 'local') {
      await scanLocal();
      return;
    }
    error = null;
    loadingRooms = true;
    try {
      chatboxFolderId = await findChatboxFolder(chatboxSource);
      if (!chatboxFolderId) {
        rooms = [];
        error = $t('chat.chatboxNotFound');
        return;
      }

      const listing = await listDirectory(chatboxFolderId);
      rooms = listing.folders.map((folder) => ({
        id: folder.id,
        roomId: folder.name,
        name: roomDisplayName(folder.name),
        createdTime: folder.created_time ?? null,
        messages: [],
        attachments: [],
        nonformat: [],
        loaded: false,
      }));
      // Newest rooms first (folder creation time is the cheap, server-light
      // proxy; local mode sorts by the real last-message time instead).
      rooms.sort((a, b) => {
        const timeA = a.createdTime ?? 0;
        const timeB = b.createdTime ?? 0;
        return timeB - timeA;
      });

      // Load room details lazily on selection to keep server requests low
      // (frequent scans can trigger server-side rate limiting).
      if (!selectedRoomId && rooms.length > 0) {
        selectedRoomId = rooms[0].roomId;
      }
    } catch (err) {
      error = $t('chat.loadFailed', {
        values: { error: formatUserFacingError(err) },
      });
    } finally {
      loadingRooms = false;
    }
  }

  async function switchChatboxSource(next: ChatboxSourceId) {
    if (next === chatboxSource) return;
    chatboxSource = next;
    try {
      localStorage.setItem(SOURCE_KEY, next);
    } catch {
      // Ignore storage failures; the source still applies for this session.
    }
    selectedRoomId = null;
    rooms = [];
    error = null;
    showNonformat = false;
    if (mode === 'online') await refresh();
  }

  async function scanLocal() {
    if (!localPath) {
      rooms = [];
      selectedRoomId = null;
      return;
    }
    error = null;
    loadingRooms = true;
    try {
      const scanned = await scanLocalChatbox(localPath);
      const parsed: ChatRoom[] = scanned.map((room) => {
        const messages: ChatMessage[] = [];
        const nonformat: NonformatBlock[] = [];
        const attachments: ChatAttachment[] = [];
        for (const file of room.files) {
          if (file.kind === 'text' && file.content !== null) {
            const userId = file.name.endsWith('.txt')
              ? file.name.slice(0, -4)
              : file.name;
            const result = parseRoomText(userId, file.content);
            messages.push(...result.messages);
            if (result.nonformat.length > 0 && result.messages.length > 0) {
              nonformat.push({ file: file.name, lines: result.nonformat });
            }
          } else {
            attachments.push({
              id: '',
              name: file.name,
              kind: attachmentKind(file.name),
              path: file.path,
            });
          }
        }
        messages.sort((a, b) => a.time.localeCompare(b.time));
        return {
          id: room.id,
          roomId: room.id,
          name: roomDisplayName(room.id),
          createdTime: null,
          messages,
          attachments,
          nonformat,
          loaded: true,
        };
      });
      parsed.sort((a, b) => {
        const lastA = a.messages[a.messages.length - 1]?.time ?? '';
        const lastB = b.messages[b.messages.length - 1]?.time ?? '';
        return lastB.localeCompare(lastA);
      });
      rooms = parsed;
      if (!selectedRoomId && rooms.length > 0) {
        selectedRoomId = rooms[0].roomId;
      }
    } catch (err) {
      error = $t('chat.loadFailed', {
        values: { error: formatUserFacingError(err) },
      });
    } finally {
      loadingRooms = false;
    }
  }

  async function pickLocalFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: $t('chat.pickFolder'),
      });
      if (typeof selected === 'string' && selected) {
        localPath = selected;
        try {
          localStorage.setItem(LOCAL_PATH_KEY, selected);
        } catch {
          // Storage failures only lose the remembered path.
        }
        await scanLocal();
      }
    } catch (err) {
      error = $t('chat.loadFailed', {
        values: { error: formatUserFacingError(err) },
      });
    }
  }

  async function switchMode(next: ChatMode) {
    if (next === mode) return;
    mode = next;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Ignore storage failures; the mode still applies for this session.
    }
    selectedRoomId = null;
    rooms = [];
    error = null;
    showNonformat = false;
    if (next === 'local') {
      if (localPath) await scanLocal();
    } else {
      await refresh();
    }
  }

  async function loadRoomDetails(roomId: string) {
    if (loadingRoomId === roomId) return;
    loadingRoomId = roomId;
    try {
      const room = rooms.find((item) => item.roomId === roomId);
      if (!room) return;
      const listing = await listDirectory(room.id);

      const messages: ChatMessage[] = [];
      const nonformat: NonformatBlock[] = [];
      const attachments: ChatAttachment[] = [];

      const textFiles = listing.documents.filter((doc) =>
        doc.title.toLowerCase().endsWith('.txt'),
      );

      for (const doc of textFiles) {
        const userId = doc.title.slice(0, -4);
        try {
          const file = await readServerDocument(doc.id);
          const parsed = parseRoomText(userId, file.content);
          messages.push(...parsed.messages);
          if (parsed.nonformat.length > 0 && parsed.messages.length > 0) {
            nonformat.push({ file: doc.title, lines: parsed.nonformat });
          }
        } catch {
          // A single unreadable record should not break the whole room.
        }
      }

      for (const doc of listing.documents) {
        if (doc.title.toLowerCase().endsWith('.txt')) continue;
        attachments.push({
          id: doc.id,
          name: doc.title,
          kind: attachmentKind(doc.title),
        });
      }

      messages.sort((a, b) => a.time.localeCompare(b.time));

      const index = rooms.findIndex((item) => item.roomId === roomId);
      if (index >= 0) {
        rooms[index] = {
          ...rooms[index],
          messages,
          attachments,
          nonformat,
          loaded: true,
        };
      }
    } catch {
      const index = rooms.findIndex((item) => item.roomId === roomId);
      if (index >= 0) rooms[index] = { ...rooms[index], loaded: true, failed: true };
    } finally {
      loadingRoomId = null;
    }
  }

  function parseRoomText(
    userId: string,
    text: string,
  ): { messages: ChatMessage[]; nonformat: string[] } {
    const messages: ChatMessage[] = [];
    const nonformat: string[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line === '# time | msg') continue;
      if (line.startsWith('#') || !line.includes(' | ')) {
        nonformat.push(line);
        continue;
      }
      const separator = line.indexOf(' | ');
      const time = line.slice(0, separator);
      let content = line.slice(separator + 3);
      let replyRef: ReplyRef | null = null;
      const match = REPLY_PATTERN.exec(content);
      if (match) {
        replyRef = { user: match[1], text: match[2].trim() };
        content = content.slice(0, match.index);
      }
      messages.push({ user: userId, time, content, replyRef });
    }
    messages.sort((a, b) => a.time.localeCompare(b.time));
    return { messages, nonformat };
  }

  function attachmentKind(name: string): 'image' | 'audio' | 'other' {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio';
    return 'other';
  }

  function formatCreatedTime(timestamp: number | null): string {
    if (!timestamp) return '';
    return new Date(timestamp * 1000).toLocaleString();
  }

  function formatLastMessageTime(room: ChatRoom): string {
    const last = room.messages[room.messages.length - 1];
    return last ? last.time : '';
  }

  function selectRoom(roomId: string) {
    selectedRoomId = roomId;
    showNonformat = false;
    const room = rooms.find((item) => item.roomId === roomId);
    if (room && !room.loaded) void loadRoomDetails(roomId);
  }

  function renameRoom(roomId: string) {
    const current = roomNames[roomId] ?? '';
    const next = window.prompt($t('chat.roomNamePrompt'), current);
    if (next === null) return;
    if (next.trim()) {
      roomNames = { ...roomNames, [roomId]: next.trim() };
    } else {
      const copy = { ...roomNames };
      delete copy[roomId];
      roomNames = copy;
    }
    persistJson(ROOM_NAMES_KEY, roomNames);
  }

  function renameUser(userId: string) {
    const current = userNames[userId] ?? '';
    const next = window.prompt($t('chat.userNamePrompt'), current);
    if (next === null) return;
    if (next.trim()) {
      userNames = { ...userNames, [userId]: next.trim() };
    } else {
      const copy = { ...userNames };
      delete copy[userId];
      userNames = copy;
    }
    persistJson(USER_NAMES_KEY, userNames);
  }

  async function downloadAttachment(attachment: ChatAttachment) {
    if (attachment.path) {
      try {
        await openLocalPath(attachment.path);
      } catch (err) {
        notificationStore.error(formatUserFacingError(err));
      }
      return;
    }
    try {
      await getDocument(attachment.id, attachment.name);
      notificationStore.success(
        $t('chat.downloadQueued', { values: { name: attachment.name } }),
      );
    } catch (err) {
      notificationStore.error(formatUserFacingError(err));
    }
  }

  async function openLink(event: MouseEvent, url: string) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function splitUrls(content: string): { text: string; url: string | null }[] {
    const parts: { text: string; url: string | null }[] = [];
    let cursor = 0;
    for (const match of content.matchAll(URL_PATTERN)) {
      const index = match.index ?? 0;
      if (index > cursor) parts.push({ text: content.slice(cursor, index), url: null });
      parts.push({ text: match[0], url: match[0] });
      cursor = index + match[0].length;
    }
    if (cursor < content.length) parts.push({ text: content.slice(cursor), url: null });
    return parts;
  }

  function nonformatLineCount(): number {
    return (selectedRoom?.nonformat ?? []).reduce(
      (total, block) => total + block.lines.length,
      0,
    );
  }
</script>

<svelte:head><title>{$t('chat.title')}</title></svelte:head>

<div class="chat-page">
  <header class="chat-header">
    <div class="chat-header-text">
      <h1>{$t('chat.title')}</h1>
      <p>{$t('chat.description')}</p>
    </div>
    <div class="chat-header-actions">
      <div class="chat-mode-toggle" role="group" aria-label={$t('chat.mode')}>
        <button
          type="button"
          class="chat-mode-button"
          class:chat-mode-button--active={mode === 'online'}
          onclick={() => switchMode('online')}
        >
          {$t('chat.modeOnline')}
        </button>
        <button
          type="button"
          class="chat-mode-button"
          class:chat-mode-button--active={mode === 'local'}
          onclick={() => switchMode('local')}
        >
          {$t('chat.modeLocal')}
        </button>
      </div>
      {#if mode === 'online'}
        <div class="chat-mode-toggle" role="group" aria-label={$t('chat.sourceLabel')}>
          {#each CHATBOX_SOURCES as source (source.id)}
            <button
              type="button"
              class="chat-mode-button"
              class:chat-mode-button--active={chatboxSource === source.id}
              title={source.path}
              onclick={() => switchChatboxSource(source.id)}
            >
              {$t(source.labelKey)}
            </button>
          {/each}
        </div>
      {/if}
      {#if mode === 'local'}
        <button type="button" class="chat-refresh" onclick={pickLocalFolder}>
          <Icon name="folder" size="17px" />
          <span>{$t('chat.pickFolder')}</span>
        </button>
      {/if}
      <button type="button" class="chat-refresh" disabled={loadingRooms} onclick={() => refresh()}>
        <Icon name="refresh" size="17px" />
        <span>{$t('chat.refresh')}</span>
      </button>
    </div>
  </header>

  <p class="chat-mode-hint">
    {mode === 'online'
      ? $t('chat.onlineHint', { values: { path: activeChatboxPath } })
      : $t('chat.localHint')}
  </p>

  {#if error}
    <div class="chat-error" role="alert">
      <Icon name="errorFilled" size="18px" />
      <span>{error}</span>
    </div>
  {/if}

  <div class="chat-body">
    <aside class="chat-rooms" aria-label={$t('chat.title')}>
      {#if mode === 'local' && !localPath && !loadingRooms}
        <div class="chat-state">
          <Icon name="folder" size="28px" />
          <p>{$t('chat.noLocalPath')}</p>
          <button type="button" class="chat-state-button" onclick={pickLocalFolder}>
            {$t('chat.pickFolder')}
          </button>
        </div>
      {:else if loadingRooms && rooms.length === 0}
        <div class="chat-state">
          <Icon name="chat" size="28px" />
          <p>{$t('chat.loadingRooms')}</p>
        </div>
      {:else if rooms.length === 0 && !error}
        <div class="chat-state">
          <Icon name="chat" size="28px" />
          <p>{$t('chat.noRooms')}</p>
        </div>
      {:else}
        <div class="chat-room-list">
          {#each rooms as room (room.roomId)}
            <div
              class="chat-room-card"
              class:chat-room-card--active={room.roomId === selectedRoomId}
              role="button"
              tabindex="0"
              title={$t('chat.selectRoom')}
              onclick={() => selectRoom(room.roomId)}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectRoom(room.roomId);
                }
              }}
            >
              <span class="chat-room-name">{roomDisplayName(room.roomId)}</span>
              <span class="chat-room-meta">
                {#if room.loaded}
                  {$t('chat.messagesCount', { values: { count: room.messages.length } })}
                  {#if formatLastMessageTime(room)}
                    · {$t('chat.lastMessage', { values: { time: formatLastMessageTime(room) } })}
                  {/if}
                {:else if room.createdTime}
                  {$t('chat.createdTime', { values: { time: formatCreatedTime(room.createdTime) } })}
                {:else}
                  …
                {/if}
              </span>
              <button
                type="button"
                class="chat-room-rename"
                title={$t('chat.renameRoom')}
                onclick={(event) => {
                  event.stopPropagation();
                  renameRoom(room.roomId);
                }}
              >
                <Icon name="edit" size="14px" />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </aside>

    <section class="chat-view" aria-label={$t('chat.title')}>
      {#if selectedRoom}
        <header class="chat-view-header">
          <div>
            <h2>{roomDisplayName(selectedRoom.roomId)}</h2>
            <p>
              {$t('chat.roomId', { values: { id: selectedRoom.roomId } })}
              {#if selectedRoom.createdTime}
                · {$t('chat.createdTime', { values: { time: formatCreatedTime(selectedRoom.createdTime) } })}
              {/if}
            </p>
          </div>
          <div class="chat-view-actions">
            {#if nonformatLineCount() > 0}
              <button
                type="button"
                class="chat-action"
                class:chat-action--active={showNonformat}
                onclick={() => (showNonformat = !showNonformat)}
              >
                <Icon name="formatListBulleted" size="16px" />
                <span>{$t('chat.nonformat', { values: { count: nonformatLineCount() } })}</span>
              </button>
            {/if}
          </div>
        </header>

        {#if loadingRoomId === selectedRoom.roomId && !selectedRoom.loaded}
          <div class="chat-state">
            <Icon name="chat" size="28px" />
            <p>{$t('chat.loadingRoom')}</p>
          </div>
        {:else if selectedRoom.messages.length === 0}
          <div class="chat-state">
            <Icon name="chat" size="28px" />
            <p>{$t('chat.noMessages')}</p>
          </div>
        {:else}
          <div class="chat-messages">
            {#each selectedRoom.messages as message, index (index)}
              {@const colors = selectedColorMap.get(message.user) ?? { bg: BUBBLE_COLORS[0], strip: STRIP_COLORS[0] }}
              <article class="chat-msg">
                <div class="chat-msg-header">
                  <button
                    type="button"
                    class="chat-user-name"
                    title={$t('chat.renameUser')}
                    onclick={() => renameUser(message.user)}
                  >
                    {displayName(message.user)}
                  </button>
                  <span class="chat-msg-time">{message.time}</span>
                </div>
                <div class="chat-bubble" style:background={colors.bg} style:border-color={colors.strip}>
                  {#if message.replyRef}
                    <div class="chat-reply">
                      <span class="chat-reply-arrow">↩</span>
                      <strong>{displayName(message.replyRef.user)}</strong>
                      <span class="chat-reply-text">
                        ：{message.replyRef.text.length > 60
                          ? `${message.replyRef.text.slice(0, 60)}…`
                          : message.replyRef.text}
                      </span>
                    </div>
                    <div class="chat-reply-sep"></div>
                  {/if}
                  <div class="chat-content">
                    {#each splitUrls(message.content) as part, partIndex (partIndex)}
                      {#if part.url}
                        <a
                          href={part.url}
                          class="chat-link"
                          onclick={(event) => openLink(event, part.url as string)}
                        >{part.text}</a>
                      {:else}
                        {part.text}
                      {/if}
                    {/each}
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {/if}

        {#if showNonformat && selectedRoom.nonformat.length > 0}
          <section class="chat-nonformat">
            <h3>{$t('chat.nonformatTitle')}</h3>
            {#each selectedRoom.nonformat as block, index (index)}
              <div class="chat-nonformat-block">
                <p class="chat-nonformat-file">{block.file}</p>
                {#each block.lines as line, lineIndex (lineIndex)}
                  <code>{line}</code>
                {/each}
              </div>
            {/each}
          </section>
        {/if}

        <footer class="chat-attachments">
          <span class="chat-attachments-label">{$t('chat.attachments')}</span>
          {#if selectedRoom.attachments.length === 0}
            <span class="chat-attachments-empty">{$t('chat.noAttachments')}</span>
          {:else}
            {#each selectedRoom.attachments as attachment, index (attachment.id)}
              <button
                type="button"
                class="chat-attachment"
                title={$t('chat.downloadQueued', { values: { name: attachment.name } })}
                onclick={() => downloadAttachment(attachment)}
              >
                <Icon name="attachment" size="14px" />
                <span>{$t('chat.attachment', { values: { index: index + 1 } })}: {attachment.name}</span>
              </button>
            {/each}
          {/if}
        </footer>
      {:else if mode === 'local' && !localPath}
        <div class="chat-state">
          <Icon name="folder" size="32px" />
          <p>{$t('chat.noLocalPath')}</p>
        </div>
      {:else if !error}
        <div class="chat-state">
          <Icon name="chat" size="32px" />
          <p>{$t('chat.noRooms')}</p>
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .chat-page {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
  }

  .chat-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.1rem 1.25rem 0.9rem;
  }

  .chat-header-text h1 {
    margin: 0;
    color: var(--explorer-text);
    font-family: var(--font-md3-sans);
    font-size: 1.15rem;
    font-weight: 700;
  }

  .chat-header-text p {
    margin: 0.25rem 0 0;
    color: var(--explorer-text-muted);
    font-size: 0.78rem;
    line-height: 1.5;
  }

  .chat-header-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.5rem;
  }

  .chat-mode-toggle {
    display: inline-flex;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-small);
    overflow: hidden;
  }

  .chat-mode-button {
    border: 0;
    padding: 0.4rem 0.7rem;
    color: var(--explorer-text-muted);
    background: transparent;
    font-size: 0.75rem;
  }

  .chat-mode-button + .chat-mode-button {
    border-left: 1px solid var(--explorer-border);
  }

  .chat-mode-button:hover {
    background: var(--explorer-surface-hover);
  }

  .chat-mode-button--active {
    color: var(--explorer-text);
    background: var(--explorer-surface-selected);
    font-weight: 650;
  }

  .chat-refresh {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-small);
    padding: 0.4rem 0.7rem;
    color: var(--explorer-text);
    background: var(--explorer-surface-raised);
    font-size: 0.75rem;
  }

  .chat-refresh:hover:not(:disabled) {
    background: var(--explorer-surface-hover);
  }

  .chat-refresh:disabled {
    opacity: 0.55;
  }

  .chat-mode-hint {
    margin: 0 1.25rem 0.75rem;
    color: var(--explorer-text-muted);
    font-size: 0.7rem;
  }

  .chat-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 1.25rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--explorer-danger) 45%, transparent);
    border-radius: var(--explorer-radius-medium);
    padding: 0.6rem 0.8rem;
    color: var(--explorer-danger);
    background: color-mix(in srgb, var(--explorer-danger) 8%, transparent);
    font-size: 0.78rem;
  }

  .chat-body {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: minmax(230px, 300px) minmax(0, 1fr);
    gap: 0.9rem;
    padding: 0 1.25rem 1.25rem;
  }

  .chat-rooms {
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-medium);
    padding: 0.5rem;
    background: var(--explorer-surface);
  }

  .chat-room-list {
    display: grid;
    gap: 0.35rem;
  }

  .chat-room-card {
    position: relative;
    display: grid;
    width: 100%;
    gap: 0.15rem;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small);
    padding: 0.55rem 2rem 0.55rem 0.7rem;
    color: var(--explorer-text);
    background: transparent;
    text-align: left;
  }

  .chat-room-card:hover {
    background: var(--explorer-surface-hover);
  }

  .chat-room-card--active {
    border-color: color-mix(in srgb, var(--explorer-accent) 35%, transparent);
    background: var(--explorer-surface-selected);
  }

  .chat-room-rename {
    position: absolute;
    top: 50%;
    right: 0.45rem;
    display: grid;
    width: 24px;
    height: 24px;
    transform: translateY(-50%);
    place-items: center;
    border: 0;
    border-radius: 6px;
    padding: 0;
    color: var(--explorer-text-muted);
    background: transparent;
    cursor: pointer;
  }

  .chat-room-card:hover .chat-room-rename,
  .chat-room-card--active .chat-room-rename {
    display: grid;
  }

  .chat-room-rename:hover {
    color: var(--explorer-accent);
    background: var(--explorer-surface-hover);
  }

  .chat-room-name {
    overflow: hidden;
    font-size: 0.85rem;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-room-meta {
    overflow: hidden;
    color: var(--explorer-text-muted);
    font-size: 0.68rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-state {
    display: flex;
    min-height: 180px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 0.7rem;
    color: var(--explorer-text-muted);
    font-size: 0.8rem;
    text-align: center;
  }

  .chat-state :global(.material-symbols-rounded) {
    color: var(--explorer-text-muted);
  }

  .chat-state-button {
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-small);
    padding: 0.4rem 0.8rem;
    color: var(--explorer-text);
    background: var(--explorer-surface-raised);
    font-size: 0.75rem;
  }

  .chat-state-button:hover {
    background: var(--explorer-surface-hover);
  }

  .chat-view {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-medium);
    background: var(--explorer-surface);
  }

  .chat-view-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
    border-bottom: 1px solid var(--explorer-border);
    padding: 0.8rem 1rem;
  }

  .chat-view-header h2 {
    margin: 0;
    color: var(--explorer-text);
    font-family: var(--font-md3-sans);
    font-size: 0.95rem;
    font-weight: 700;
  }

  .chat-view-header p {
    margin: 0.2rem 0 0;
    color: var(--explorer-text-muted);
    font-size: 0.68rem;
  }

  .chat-view-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.4rem;
  }

  .chat-action {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-small);
    padding: 0.35rem 0.6rem;
    color: var(--explorer-text);
    background: var(--explorer-surface-raised);
    font-size: 0.7rem;
  }

  .chat-action--active {
    border-color: color-mix(in srgb, var(--explorer-accent) 50%, transparent);
    color: var(--explorer-accent);
  }

  .chat-messages {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 0.9rem 1rem;
    background: color-mix(in srgb, var(--explorer-background) 55%, var(--explorer-surface));
  }

  .chat-msg {
    margin-bottom: 0.7rem;
  }

  .chat-msg-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.2rem;
  }

  .chat-user-name {
    border: 0;
    padding: 0;
    color: var(--explorer-text);
    background: transparent;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
  }

  .chat-user-name:hover {
    color: var(--explorer-accent);
  }

  .chat-msg-time {
    color: var(--explorer-text-muted);
    font-size: 0.64rem;
  }

  .chat-bubble {
    border: 2px solid;
    border-radius: 8px;
    padding: 0;
  }

  .chat-reply {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    padding: 0.45rem 0.7rem 0.2rem;
    color: #888;
    font-size: 0.72rem;
  }

  .chat-reply-arrow {
    color: #6cc4f5;
  }

  .chat-reply strong {
    color: #409eff;
  }

  .chat-reply-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-reply-sep {
    height: 1px;
    margin: 0.3rem 0.7rem 0;
    background: #e0e0e0;
  }

  .chat-content {
    padding: 0.45rem 0.7rem 0.7rem;
    color: #191919;
    font-size: 0.85rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .chat-link {
    color: #2980b9;
    text-decoration: underline;
  }

  .chat-nonformat {
    max-height: 45%;
    overflow-y: auto;
    border-top: 1px solid var(--explorer-border);
    padding: 0.8rem 1rem;
    background: color-mix(in srgb, #fff3e0 85%, var(--explorer-background));
  }

  .chat-nonformat h3 {
    margin: 0 0 0.5rem;
    color: #a0522d;
    font-size: 0.78rem;
  }

  .chat-nonformat-block {
    margin-bottom: 0.6rem;
  }

  .chat-nonformat-file {
    margin: 0 0 0.2rem;
    color: #8a5a33;
    font-size: 0.7rem;
    font-weight: 700;
  }

  .chat-nonformat code {
    display: block;
    margin: 0.1rem 0;
    color: #5d4037;
    font-size: 0.72rem;
    white-space: pre-wrap;
  }

  .chat-attachments {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    border-top: 1px solid var(--explorer-border);
    padding: 0.6rem 1rem;
  }

  .chat-attachments-label {
    color: var(--explorer-text-muted);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .chat-attachments-empty {
    color: var(--explorer-text-muted);
    font-size: 0.7rem;
  }

  .chat-attachment {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: 0.3rem;
    overflow: hidden;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-small);
    padding: 0.3rem 0.55rem;
    color: var(--explorer-text);
    background: var(--explorer-surface-raised);
    font-size: 0.7rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-attachment:hover {
    background: var(--explorer-surface-hover);
  }

  @media (max-width: 820px) {
    .chat-body {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(160px, 34%) minmax(0, 1fr);
    }
  }
</style>
