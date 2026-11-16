// Compatibility barrel for fork modules that still consume the pre-v0.60 store paths.
export { authStore } from './features/authentication/auth-state.svelte.ts';
export { serverStateStore } from './features/connection/connection-state.svelte.ts';
export { disclaimerStore } from './features/connection/disclaimer-state.svelte.ts';
export { eventLog } from './features/diagnostics/event-log.svelte.ts';
export { fileShortcutValidationStore } from './features/files/shortcut-state.svelte.ts';
export { downloadStore } from './features/transfers/download-state.svelte.ts';
export { uploadStore } from './features/transfers/upload-state.svelte.ts';
export { floatingProgressStore } from './shared/notifications/progress.svelte.ts';
export { notificationStore } from './shared/notifications/notifications.svelte.ts';
export { chromeStore } from './shared/ui/chrome-state.svelte.ts';
export type { FileShortcutValidationPayload } from './features/files/shortcut-state.svelte.ts';
export type { NotificationAction, NotificationEntry, NotificationHistoryEntry, NotificationOptions, NotificationType } from './shared/notifications/notifications.svelte.ts';
export type { FloatingProgressEntry } from './shared/notifications/progress.svelte.ts';
