<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { open } from '@tauri-apps/plugin-dialog';
  import { openUrl } from '@tauri-apps/plugin-opener';

  import FluentButton from '$lib/components/FluentButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import { DEFAULT_ROOM_NAMES, DEFAULT_USER_NAMES } from '$lib/chatbox/names';
  import { findReplySourceSpan, type ReplySourceSpan } from '$lib/chat/reply-reference';
  import {
    getDocument,
    listDirectory,
    openLocalPath,
    readServerDocument,
    resolveNodePath,
    scanLocalChatbox,
    uploadChatRecord,
    type LocalChatboxReadError,
  } from '$lib/api/files';
  import { isAccessDeniedError } from '$lib/api/server-errors';
  import { authStore, notificationStore } from '$lib/stores.svelte';
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
  const REPLY_PATTERN = /([\s\S]*)\s*\/\/\s*(.+?)\s*->\s*(.*)$/;
  const REPLY_HIGHLIGHT_MS = 1600;

  interface ReplyRef {
    user: string;
    text: string;
  }

  type ReplyTarget = ReplyRef;

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

  interface UnreadableRecord {
    file: string;
    source: 'local' | 'server';
    reason: LocalChatboxReadError;
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
    unreadableRecords: UnreadableRecord[];
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
  let composeSpeakerName = $state(authStore.username ?? '');
  let hashSpeakerName = $state(true);
  let composeMessage = $state('');
  let composeTextarea = $state<HTMLTextAreaElement | undefined>(undefined);
  let replyTarget = $state<ReplyTarget | null>(null);
  let messagesEl = $state<HTMLDivElement | null>(null);
  let highlightedSpan = $state<ReplySourceSpan | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  let composeValidationError = $state<string | null>(null);
  let uploadingChatRecord = $state(false);
  let speakerLocked = $state(false);
  let overwriteApprovedFor: string | null = null;
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

  onDestroy(() => {
    if (highlightTimer) clearTimeout(highlightTimer);
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
    return userNames[userId]
      ?? DEFAULT_USER_NAMES[userId]
      ?? (userId.length > 32 ? `${userId.slice(0, 8)}…` : userId);
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
        unreadableRecords: [],
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
    resetComposer();
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
        const unreadableRecords: UnreadableRecord[] = [];
        for (const file of room.files) {
          if (file.kind === 'text') {
            if (file.read_error) {
              unreadableRecords.push({
                file: file.name,
                source: 'local',
                reason: file.read_error,
              });
            } else if (file.content !== null) {
              const userId = file.name.endsWith('.txt')
                ? file.name.slice(0, -4)
                : file.name;
              const result = parseRoomText(userId, file.content);
              messages.push(...result.messages);
              if (result.nonformat.length > 0 && result.messages.length > 0) {
                nonformat.push({ file: file.name, lines: result.nonformat });
              }
            } else {
              unreadableRecords.push({
                file: file.name,
                source: 'local',
                reason: 'read_failed',
              });
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
          unreadableRecords,
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
    resetComposer();
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
      const unreadableRecords: UnreadableRecord[] = [];

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
        } catch (err) {
          unreadableRecords.push({
            file: doc.title,
            source: 'server',
            reason: isAccessDeniedError(err) ? 'permission_denied' : 'read_failed',
          });
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
          unreadableRecords,
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
        replyRef = { user: match[2], text: match[3].trim() };
        content = match[1].trimEnd();
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

  /** Quotes keep the record's line breaks; the preview reads as one line. */
  function replyPreview(text: string): string {
    const flat = text.replace(/\s+/gu, ' ').trim();
    return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
  }

  function selectRoom(roomId: string) {
    if (roomId !== selectedRoomId) {
      resetComposer();
    }
    selectedRoomId = roomId;
    showNonformat = false;
    const room = rooms.find((item) => item.roomId === roomId);
    if (room && !room.loaded) void loadRoomDetails(roomId);
  }

  function resetComposer() {
    composeMessage = '';
    replyTarget = null;
    composeSpeakerName = authStore.username ?? '';
    hashSpeakerName = true;
    composeValidationError = null;
    speakerLocked = false;
    overwriteApprovedFor = null;
  }

  async function accountNameHash(username: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(username.trim()),
    );
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 7);
  }

  function normalizedSpeakerName(): string {
    return composeSpeakerName.trim().replace(/\.txt$/i, '').trim();
  }

  async function effectiveSpeakerName(): Promise<string> {
    const name = normalizedSpeakerName();
    return hashSpeakerName ? accountNameHash(name) : name;
  }

  function isValidSpeakerName(name: string): boolean {
    return Boolean(name)
      && name !== '.'
      && name !== '..'
      && !name.endsWith('.')
      && !name.endsWith(' ')
      && new TextEncoder().encode(name).length <= 128
      && !/[\/\\:*?"<>|\u0000-\u001f]/.test(name);
  }

  function formatChatTimestamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function replyUserId(message: ChatMessage): string | null {
    const matchingUsers = new Set(
      selectedRoom?.messages
        .map((item) => item.user)
        .filter((user) => user.toLocaleLowerCase() === message.user.toLocaleLowerCase()),
    );
    return matchingUsers.size === 1 ? message.user : null;
  }

  function startReply(message: ChatMessage) {
    const userId = replyUserId(message);
    if (!userId) {
      notificationStore.info($t('chat.replyUnavailable'));
      return;
    }
    replyTarget = { user: userId, text: message.content };
    composeValidationError = null;
    void tick().then(() => composeTextarea?.focus());
  }

  /**
   * Walks backwards from a reply to the message it quotes. Records carry no
   * stable message id, so the reference is matched against the sender plus the
   * quoted text; see `findReplySourceSpan` for the matching rules.
   */
  function replySourceSpan(messageIndex: number, ref: ReplyRef): ReplySourceSpan | null {
    return findReplySourceSpan(selectedRoom?.messages ?? [], messageIndex, ref);
  }

  /** Scrolls a quoted message back into view and flashes it for a moment. */
  function jumpToReply(messageIndex: number, ref: ReplyRef) {
    const span = replySourceSpan(messageIndex, ref);
    if (!span) {
      notificationStore.info($t('chat.replySourceMissing'));
      return;
    }

    const target = messagesEl?.querySelector<HTMLElement>(
      `[data-message-index="${span.start}"]`,
    );
    if (!target) return;

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    highlightedSpan = span;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightedSpan = null;
      highlightTimer = null;
    }, REPLY_HIGHLIGHT_MS);
  }

  async function appendComposeMessage() {
    const speakerName = normalizedSpeakerName();
    if (!isValidSpeakerName(speakerName)) {
      composeValidationError = $t('chat.invalidSpeakerName');
      return;
    }
    const content = composeMessage.trim();
    if (!content) {
      composeValidationError = $t('chat.emptyMessage');
      return;
    }
    const targetRoom = selectedRoom;
    const targetReply = replyTarget;
    if (!targetRoom || mode !== 'online' || !targetRoom.loaded || uploadingChatRecord) return;
    if (targetReply && content.includes('\n')) {
      composeValidationError = $t('chat.replySingleLine');
      return;
    }
    uploadingChatRecord = true;
    try {
      const user = await effectiveSpeakerName();
      const time = formatChatTimestamp(new Date());
      const filename = `${user}.txt`;
      const targetKey = `${targetRoom.roomId}:${filename.toLowerCase()}`;
      const listing = await listDirectory(targetRoom.id);
      const existingDocument = listing.documents.find(
        (document) => document.title.toLowerCase() === filename.toLowerCase(),
      );
      if (existingDocument && overwriteApprovedFor !== targetKey) {
        if (!window.confirm($t('chat.appendRecordConfirm', { values: { name: filename } }))) {
          return;
        }
        overwriteApprovedFor = targetKey;
      }

      // The quoted message may be multi-line, but a record line cannot be:
      // writing the newlines through would push the rest of the quote onto a
      // line without a timestamp, which parses as loose text instead of a
      // message. Flattening keeps the whole quote on the reply's own line, and
      // the in-memory copy mirrors the record so both sides read the same.
      const quoted = targetReply ? targetReply.text.replace(/\s+/gu, ' ').trim() : '';
      const newMessage: ChatMessage = {
        user,
        time,
        content,
        replyRef: targetReply ? { user: targetReply.user, text: quoted } : null,
      };
      let existingContent = '';
      if (existingDocument) {
        const existingRecord = await readServerDocument(existingDocument.id);
        if (existingRecord.truncated) {
          throw new Error($t('chat.recordTooLargeToAppend'));
        }
        existingContent = existingRecord.content;
      }
      const messageLines = content.split(/\r?\n/);
      if (targetReply) {
        messageLines[messageLines.length - 1] += ` // ${targetReply.user} -> ${quoted}`;
      }
      const timestampedMessageLines = messageLines
        .map((line) => `${time} | ${line}`)
        .join('\n');
      const recordContent = existingContent
        ? `${existingContent}${existingContent.endsWith('\n') ? '' : '\n'}${timestampedMessageLines}\n`
        : `# time | msg\n${timestampedMessageLines}\n`;
      await uploadChatRecord(targetRoom.id, user, recordContent, crypto.randomUUID());

      const updatedRoom: ChatRoom = {
        ...targetRoom,
        messages: [...targetRoom.messages, newMessage]
          .sort((a, b) => a.time.localeCompare(b.time)),
        unreadableRecords: targetRoom.unreadableRecords.filter(
          (record) => record.file.toLowerCase() !== filename.toLowerCase(),
        ),
      };
      rooms = rooms.map((room) => room.roomId === updatedRoom.roomId ? updatedRoom : room);
      if (selectedRoomId === targetRoom.roomId) {
        speakerLocked = true;
        composeMessage = '';
        replyTarget = null;
        composeValidationError = null;
      }
    } catch (err) {
      notificationStore.error(formatUserFacingError(err));
    } finally {
      uploadingChatRecord = false;
    }
  }

  function handleComposeMessageKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void appendComposeMessage();
    }
  }

  function cancelReply() {
    replyTarget = null;
    composeValidationError = null;
    composeTextarea?.focus();
  }

  function unreadableRecordReason(record: UnreadableRecord): string {
    if (record.source === 'local') {
      return $t(
        record.reason === 'permission_denied'
          ? 'chat.localPermissionDenied'
          : 'chat.localReadFailed',
      );
    }
    return $t(
      record.reason === 'permission_denied'
        ? 'chat.serverPermissionDenied'
        : 'chat.serverReadFailed',
    );
  }

  function unreadableRecordAction(record: UnreadableRecord): string {
    if (record.source === 'local') {
      return $t(
        record.reason === 'permission_denied'
          ? 'chat.localPermissionAction'
          : 'chat.localReadAction',
      );
    }
    return $t(
      record.reason === 'permission_denied'
        ? 'chat.serverPermissionAction'
        : 'chat.serverReadAction',
    );
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

  function clearUserNameOverride(userId: string) {
    const copy = { ...userNames };
    delete copy[userId];
    userNames = copy;
  }

  function isUserNameOverridden(userId: string): boolean {
    const current = userNames[userId];
    // Only counts when the stored name differs from the shipped default; a
    // decoded real name happens to equal its default and is not an override.
    return current !== undefined && current !== DEFAULT_USER_NAMES[userId];
  }

  function renameUser(userId: string) {
    const current = userNames[userId] ?? '';
    const next = window.prompt($t('chat.userNamePrompt'), current);
    if (next === null) return;
    if (next.trim()) {
      userNames = { ...userNames, [userId]: next.trim() };
    } else {
      clearUserNameOverride(userId);
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

<div class="chat-page workspace-page">
  <header class="chat-header">
    <div class="chat-header-text cfms-heading-copy">
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
        <FluentButton appearance="subtle" onclick={pickLocalFolder}>
          <Icon name="folder" size="16px" />
          <span>{$t('chat.pickFolder')}</span>
        </FluentButton>
      {/if}
      <IconButton
        icon="refresh"
        label={$t('chat.refresh')}
        disabled={loadingRooms}
        onclick={() => refresh()}
      />
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
          <FluentButton appearance="outline" onclick={pickLocalFolder}>
            {$t('chat.pickFolder')}
          </FluentButton>
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
        {:else}
          <div class="chat-messages" bind:this={messagesEl}>
            {#if selectedRoom.messages.length === 0 && selectedRoom.unreadableRecords.length === 0}
              <div class="chat-state">
                <Icon name="chat" size="28px" />
                <p>{$t('chat.noMessages')}</p>
              </div>
            {/if}
            {#each selectedRoom.messages as message, index (index)}
              {@const colors = selectedColorMap.get(message.user) ?? { bg: BUBBLE_COLORS[0], strip: STRIP_COLORS[0] }}
              <article
                class="chat-msg"
                class:chat-msg--highlight={highlightedSpan !== null
                  && index >= highlightedSpan.start
                  && index <= highlightedSpan.end}
                data-message-index={index}
              >
                <div class="chat-msg-header">
                  <button
                    type="button"
                    class="chat-user-name"
                    title={$t('chat.renameUser')}
                    onclick={() => renameUser(message.user)}
                  >
                    {displayName(message.user)}
                  </button>
                  {#if isUserNameOverridden(message.user)}
                    <button
                      type="button"
                      class="chat-user-name-reset"
                      title={$t('chat.restoreUserName')}
                      onclick={() => clearUserNameOverride(message.user)}
                    >
                      <Icon name="undo" size="14px" />
                    </button>
                  {/if}
                  <span class="chat-msg-time">{message.time}</span>
                  {#if mode === 'online' && selectedRoom.loaded && authStore.username}
                    <button
                      type="button"
                      class="chat-msg-reply"
                      disabled={uploadingChatRecord || !replyUserId(message)}
                      title={$t(replyUserId(message) ? 'chat.reply' : 'chat.replyUnavailable')}
                      onclick={() => startReply(message)}
                    >{$t('chat.reply')}</button>
                  {/if}
                </div>
                <div class="chat-bubble" style:background={colors.bg} style:border-color={colors.strip}>
                  {#if message.replyRef}
                    <button
                      type="button"
                      class="chat-reply"
                      title={$t('chat.jumpToReply')}
                      onclick={() => jumpToReply(index, message.replyRef as ReplyRef)}
                    >
                      <span class="chat-reply-arrow">↩</span>
                      <strong>{displayName(message.replyRef.user)}</strong>
                      <span class="chat-reply-text">：{replyPreview(message.replyRef.text)}</span>
                    </button>
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

        {#if selectedRoom.unreadableRecords.length > 0}
          <section class="chat-unreadable-records" aria-labelledby="chat-unreadable-records-title">
            <h3 id="chat-unreadable-records-title">
              <Icon name="lock" size="16px" />
              {$t('chat.unreadableRecordsTitle')}
            </h3>
            {#each selectedRoom.unreadableRecords as record, index (`${record.source}:${record.file}:${index}`)}
              <article class="chat-unreadable-record">
                <dl>
                  <div>
                    <dt>{$t('chat.unreadableFile')}</dt>
                    <dd>{record.file}</dd>
                  </div>
                  <div>
                    <dt>{$t('chat.unreadableReason')}</dt>
                    <dd>{unreadableRecordReason(record)}</dd>
                  </div>
                  <div>
                    <dt>{$t('chat.unreadableAction')}</dt>
                    <dd>{unreadableRecordAction(record)}</dd>
                  </div>
                </dl>
              </article>
            {/each}
          </section>
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

        {#if mode === 'online' && selectedRoom.loaded && authStore.username}
          <form
            class="chat-composer"
            onsubmit={(event) => {
              event.preventDefault();
              void appendComposeMessage();
            }}
          >
            <div class="chat-composer-settings">
              <label class="chat-compose-field chat-composer-name">
                <span>{$t('chat.speakerName')}</span>
                <input
                  type="text"
                  class="cfms-native-field"
                  data-focus-ring="delegated"
                  bind:value={composeSpeakerName}
                  disabled={uploadingChatRecord || speakerLocked}
                  maxlength="128"
                  autocomplete="off"
                  aria-describedby="chat-record-time-hint"
                  oninput={() => {
                    composeValidationError = null;
                    overwriteApprovedFor = null;
                  }}
                />
              </label>
              <label class="chat-composer-hash">
                <input
                  type="checkbox"
                  class="cfms-native-checkbox"
                  data-focus-ring="delegated"
                  bind:checked={hashSpeakerName}
                  disabled={uploadingChatRecord || speakerLocked}
                  onchange={() => {
                    composeValidationError = null;
                    overwriteApprovedFor = null;
                  }}
                />
                <span>{$t('chat.hashSpeakerName')}</span>
              </label>
            </div>
            {#if replyTarget}
              <div class="chat-reply-composer">
                <span class="chat-reply-composer-icon" aria-hidden="true">↩</span>
                <div class="chat-reply-composer-copy">
                  <strong>{$t('chat.replyingTo', { values: { name: displayName(replyTarget.user) } })}</strong>
                  <span>{replyTarget.text}</span>
                </div>
                <button
                  type="button"
                  class="chat-reply-composer-cancel"
                  aria-label={$t('chat.cancelReply')}
                  disabled={uploadingChatRecord}
                  onclick={cancelReply}
                >×</button>
              </div>
            {/if}
            <div class="chat-compose-entry">
              <label class="chat-compose-field">
                <span>{$t('chat.message')}</span>
                <textarea
                  class="cfms-native-field"
                  data-focus-ring="delegated"
                  bind:this={composeTextarea}
                  bind:value={composeMessage}
                  disabled={uploadingChatRecord}
                  rows="2"
                  aria-describedby="chat-record-time-hint"
                  onkeydown={handleComposeMessageKeydown}
                  oninput={() => (composeValidationError = null)}
                ></textarea>
              </label>
              <FluentButton
                type="submit"
                appearance="primary"
                disabled={uploadingChatRecord || !composeMessage.trim()}
              >
                <Icon name="arrowForward" size="16px" />
                <span>{$t(uploadingChatRecord ? 'chat.sendingMessage' : 'chat.speak')}</span>
              </FluentButton>
            </div>
            <p id="chat-record-time-hint" class="chat-compose-hint">{$t('chat.recordTimeHint')}</p>
            {#if composeValidationError}
              <p class="chat-compose-error" role="alert">{composeValidationError}</p>
            {/if}
          </form>
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
    gap: 16px;
    padding: 20px 20px 12px;
  }

  .chat-header-text h1 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font: 600 20px/28px var(--font-md3-sans);
    letter-spacing: -0.01em;
  }

  .chat-header-text p {
    max-width: 68ch;
    margin: 4px 0 0;
    color: var(--color-md3-on-surface-variant);
    font: 400 12px/16px var(--font-md3-sans);
  }

  .chat-header-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }

  /* Segmented toggle matching the tools page tabs. */
  .chat-mode-toggle {
    display: inline-flex;
    gap: 2px;
    border-radius: var(--borderRadiusXLarge);
    padding: 4px;
    background: var(--colorNeutralBackground3);
  }

  .chat-mode-button {
    border: 0;
    border-radius: calc(var(--borderRadiusXLarge) - 4px);
    padding: 6px 12px;
    color: var(--colorNeutralForeground3);
    background: transparent;
    font: 500 12px/16px var(--fontFamilyBase);
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--durationFaster) var(--curveEasyEase), color var(--durationFaster) var(--curveEasyEase);
  }

  .chat-mode-button:hover {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .chat-mode-button--active {
    color: var(--colorBrandForeground2);
    background: var(--colorBrandBackground2);
    font-weight: 600;
  }

  .chat-mode-button--active:hover {
    color: var(--colorBrandForeground2);
    background: var(--colorBrandBackground2);
  }

  .chat-mode-hint {
    margin: 0 20px 12px;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .chat-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 20px 12px;
    border: 1px solid var(--colorStatusDangerBorder1);
    border-radius: var(--borderRadiusMedium);
    padding: 8px 12px;
    color: var(--colorStatusDangerForeground1);
    background: var(--colorStatusDangerBackground1);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .chat-body {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: minmax(230px, 300px) minmax(0, 1fr);
    gap: 12px;
    padding: 0 20px 20px;
  }

  .chat-rooms {
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--explorer-border);
    border-radius: var(--borderRadiusLarge);
    padding: 8px;
    background: var(--explorer-surface);
  }

  .chat-room-list {
    display: grid;
    gap: 4px;
  }

  .chat-room-card {
    position: relative;
    display: grid;
    width: 100%;
    gap: 2px;
    border: 1px solid transparent;
    border-radius: var(--borderRadiusMedium);
    padding: 8px 30px 8px 10px;
    color: var(--explorer-text);
    background: transparent;
    text-align: left;
    cursor: pointer;
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
    right: 6px;
    display: grid;
    width: 24px;
    height: 24px;
    transform: translateY(-50%);
    place-items: center;
    border: 0;
    border-radius: var(--borderRadiusSmall);
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
    color: var(--colorNeutralForeground1);
    font: 600 13px/18px var(--fontFamilyBase);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-room-meta {
    overflow: hidden;
    color: var(--colorNeutralForeground3);
    font: 400 11px/14px var(--fontFamilyBase);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-state {
    display: flex;
    min-height: 180px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 10px;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
    text-align: center;
  }

  .chat-state :global(.cfms-icon) {
    color: var(--colorNeutralForeground3);
  }

  .chat-view {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--explorer-border);
    border-radius: var(--borderRadiusLarge);
    background: var(--explorer-surface);
  }

  .chat-view-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--explorer-border);
    padding: 12px 16px;
  }

  .chat-view-header h2 {
    margin: 0;
    color: var(--colorNeutralForeground1);
    font: 600 14px/20px var(--fontFamilyBase);
  }

  .chat-view-header p {
    margin: 2px 0 0;
    color: var(--colorNeutralForeground3);
    font: 400 11px/14px var(--fontFamilyBase);
  }

  .chat-view-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
  }

  .chat-composer {
    display: grid;
    flex: none;
    gap: 8px;
    border-top: 1px solid var(--explorer-border);
    padding: 10px 16px;
    background: var(--explorer-surface);
  }

  .chat-composer-settings {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
  }

  .chat-composer-name {
    width: min(340px, 100%);
  }

  .chat-composer-hash {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding-bottom: 8px;
    color: var(--colorNeutralForeground2);
    font: 400 12px/16px var(--fontFamilyBase);
    cursor: pointer;
  }

  .chat-composer-hash input {
    width: 16px;
    height: 16px;
    accent-color: var(--colorBrandBackground);
    cursor: pointer;
  }

  .chat-composer-hash input:disabled {
    cursor: not-allowed;
  }

  .chat-composer-hash:focus-within,
  .chat-compose-field:focus-within {
    outline: 2px solid var(--color-md3-primary-emphasis, var(--colorBrandStroke));
    outline-offset: 2px;
    border-radius: var(--borderRadiusSmall);
  }

  @media (forced-colors: active) {
    .chat-composer-hash:focus-within,
    .chat-compose-field:focus-within {
      outline-color: Highlight;
    }
  }

  .chat-compose-field {
    display: grid;
    gap: 6px;
    color: var(--colorNeutralForeground1);
    font: 600 12px/16px var(--fontFamilyBase);
  }

  .chat-compose-field input,
  .chat-compose-field textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium);
    padding: 8px 10px;
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1);
    font: 400 13px/20px var(--fontFamilyBase);
  }

  .chat-compose-entry {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .chat-reply-composer {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    border-inline-start: 3px solid var(--colorBrandStroke);
    border-radius: var(--borderRadiusSmall);
    padding: 6px 8px;
    background: var(--colorNeutralBackground2);
  }

  .chat-reply-composer-icon {
    flex: none;
    color: var(--colorBrandForeground1);
    font: 600 14px/18px var(--fontFamilyBase);
  }

  .chat-reply-composer-copy {
    display: grid;
    min-width: 0;
    gap: 1px;
    flex: 1;
    color: var(--colorNeutralForeground2);
    font: 400 11px/15px var(--fontFamilyBase);
  }

  .chat-reply-composer-copy strong {
    color: var(--colorBrandForeground1);
    font-weight: 600;
  }

  .chat-reply-composer-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-reply-composer-cancel {
    display: grid;
    width: 26px;
    height: 26px;
    flex: none;
    place-items: center;
    border-radius: var(--borderRadiusSmall);
    color: var(--colorNeutralForeground3);
    font: 400 18px/1 var(--fontFamilyBase);
    cursor: pointer;
  }

  .chat-reply-composer-cancel:hover:not(:disabled) {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .chat-reply-composer-cancel:disabled {
    cursor: not-allowed;
  }

  .chat-compose-entry .chat-compose-field {
    flex: 1;
  }

  .chat-compose-entry :global(.cfms-button) {
    flex: none;
  }

  .chat-compose-hint {
    margin: 0;
    color: var(--colorNeutralForeground3);
    font: 400 11px/16px var(--fontFamilyBase);
  }

  .chat-compose-error {
    margin: 0;
    color: var(--colorStatusDangerForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .chat-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium);
    padding: 5px 10px;
    color: var(--colorNeutralForeground2);
    background: transparent;
    font: 400 12px/16px var(--fontFamilyBase);
    cursor: pointer;
    transition: background-color var(--durationFaster) var(--curveEasyEase), border-color var(--durationFaster) var(--curveEasyEase);
  }

  .chat-action:hover {
    background: var(--colorNeutralBackground1Hover);
  }

  .chat-action--active {
    border-color: color-mix(in srgb, var(--colorBrandStroke) 50%, transparent);
    color: var(--colorBrandForeground1);
  }

  .chat-messages {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    background: color-mix(in srgb, var(--explorer-background) 55%, var(--explorer-surface));
  }

  .chat-msg {
    margin-bottom: 10px;
  }

  .chat-msg-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 3px;
  }

  .chat-user-name {
    border: 0;
    padding: 0;
    color: var(--colorNeutralForeground1);
    background: transparent;
    font: 600 12px/16px var(--fontFamilyBase);
    cursor: pointer;
  }

  .chat-user-name:hover {
    color: var(--colorBrandForeground1);
  }

  .chat-user-name-reset {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    color: var(--colorNeutralForeground3);
    background: transparent;
    font-size: 0.7rem;
    cursor: pointer;
    opacity: 0.6;
    transition: background-color 90ms ease, color 90ms ease, opacity 90ms ease;
  }

  .chat-user-name-reset:hover {
    color: var(--colorBrandForeground1);
    background: var(--colorNeutralBackground1Hover);
    opacity: 1;
  }

  .chat-msg-time {
    color: var(--colorNeutralForeground4, var(--colorNeutralForeground3));
    font: 400 10px/14px var(--fontFamilyBase);
  }

  .chat-msg-reply {
    border: 0;
    border-radius: var(--borderRadiusSmall);
    padding: 1px 5px;
    color: var(--colorBrandForeground1);
    background: transparent;
    font: 400 10px/14px var(--fontFamilyBase);
    cursor: pointer;
  }

  .chat-msg-reply:hover:not(:disabled) {
    background: var(--colorNeutralBackground1Hover);
  }

  .chat-msg-reply:disabled {
    color: var(--colorNeutralForegroundDisabled);
    cursor: not-allowed;
  }

  /* Bubble interiors intentionally keep a fixed light palette: they mirror the
     original chatbox rendering, whose bubble colours are always light. Theme
     tokens would flip unreadably in dark mode, so dark-on-light stays here. */
  .chat-bubble {
    border: 2px solid;
    border-radius: var(--borderRadiusMedium);
    padding: 0;
  }

  .chat-reply {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 4px;
    border: none;
    border-radius: var(--borderRadiusSmall) var(--borderRadiusSmall) 0 0;
    padding: 7px 10px 3px;
    background: transparent;
    color: rgba(0, 0, 0, 0.55);
    font: 400 11px/16px var(--fontFamilyBase);
    text-align: start;
    cursor: pointer;
  }

  .chat-reply:hover {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.72);
  }

  .chat-reply:focus-visible {
    outline: 2px solid #409eff;
    outline-offset: -2px;
  }

  .chat-msg--highlight .chat-bubble {
    outline: 2px solid #409eff;
    outline-offset: 2px;
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
    margin: 4px 10px 0;
    background: rgba(0, 0, 0, 0.12);
  }

  .chat-content {
    padding: 7px 10px 11px;
    color: #191919;
    font: 400 13px/20px var(--fontFamilyBase);
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
    padding: 12px 16px;
    background: var(--colorStatusWarningBackground1);
  }

  .chat-nonformat h3 {
    margin: 0 0 8px;
    color: var(--colorStatusWarningForeground1);
    font: 600 12px/16px var(--fontFamilyBase);
  }

  .chat-nonformat-block {
    margin-bottom: 8px;
  }

  .chat-nonformat-file {
    margin: 0 0 3px;
    color: var(--colorStatusWarningForeground1);
    font: 600 11px/14px var(--fontFamilyBase);
  }

  .chat-nonformat code {
    display: block;
    margin: 2px 0;
    color: var(--colorNeutralForeground2);
    font: 400 11px/16px var(--fontFamilyMonospace);
    white-space: pre-wrap;
  }

  .chat-unreadable-records {
    min-height: 0;
    flex: 0 1 32%;
    max-height: 32%;
    overflow-y: auto;
    border-top: 1px solid var(--explorer-border);
    padding: 12px 16px;
    background: color-mix(
      in srgb,
      var(--explorer-surface-raised) 72%,
      var(--explorer-background)
    );
  }

  .chat-unreadable-records h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    color: var(--colorNeutralForeground1);
    font: 600 12px/16px var(--fontFamilyBase);
  }

  .chat-unreadable-record {
    border-inline-start: 3px solid var(--explorer-accent);
    border-radius: var(--borderRadiusMedium);
    padding: 8px 10px;
    background: var(--explorer-surface);
  }

  .chat-unreadable-record + .chat-unreadable-record {
    margin-top: 6px;
  }

  .chat-unreadable-record dl,
  .chat-unreadable-record dl div {
    display: grid;
    gap: 3px 10px;
  }

  .chat-unreadable-record dl div {
    grid-template-columns: minmax(5rem, auto) minmax(0, 1fr);
    align-items: baseline;
  }

  .chat-unreadable-record dl {
    margin: 0;
  }

  .chat-unreadable-record dt {
    color: var(--colorNeutralForeground3);
    font: 600 11px/14px var(--fontFamilyBase);
  }

  .chat-unreadable-record dd {
    min-width: 0;
    margin: 0;
    color: var(--colorNeutralForeground1);
    font: 400 11px/16px var(--fontFamilyBase);
    overflow-wrap: anywhere;
  }

  .chat-attachments {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    border-top: 1px solid var(--explorer-border);
    padding: 10px 16px;
  }

  .chat-attachments-label {
    color: var(--colorNeutralForeground3);
    font: 600 11px/14px var(--fontFamilyBase);
  }

  .chat-attachments-empty {
    color: var(--colorNeutralForeground3);
    font: 400 11px/14px var(--fontFamilyBase);
  }

  .chat-attachment {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: 5px;
    overflow: hidden;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium);
    padding: 4px 9px;
    color: var(--colorNeutralForeground2);
    background: transparent;
    font: 400 11px/14px var(--fontFamilyBase);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--durationFaster) var(--curveEasyEase);
  }

  .chat-attachment:hover {
    background: var(--colorNeutralBackground1Hover);
  }

  @media (max-width: 820px) {
    .chat-body {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(160px, 34%) minmax(0, 1fr);
    }
  }
</style>
