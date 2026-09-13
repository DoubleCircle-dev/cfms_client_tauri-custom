import { platform, type Platform } from '@tauri-apps/plugin-os';
import { isTauriRuntime } from './tauri-runtime';

/**
 * Platform reported by the native shell.
 *
 * Returns `null` outside Tauri (browser previews), where `platform()` throws
 * synchronously because no OS-plugin internals are injected. Callers treat
 * `null` as a desktop-class platform, which matches the preview host.
 */
function detectPlatform(): Platform | null {
  if (!isTauriRuntime()) return null;
  return platform();
}

export function isMobilePlatform(value: Platform | null = detectPlatform()): boolean {
  return value === 'android' || value === 'ios';
}

export function supportsKeyboardShortcuts(value: Platform | null = detectPlatform()): boolean {
  return !isMobilePlatform(value);
}
