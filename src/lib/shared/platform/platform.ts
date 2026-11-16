import { platform, type Platform } from '$lib/shared/platform/native-os';
import { isTauri } from '$lib/shared/platform/native-core';

/**
 * Platform reported by the native shell.
 *
 * Returns `null` outside Tauri (browser previews), where `platform()` throws
 * synchronously because no OS-plugin internals are injected. Callers treat
 * `null` as a desktop-class platform, which matches the preview host.
 */
function detectPlatform(): Platform | null {
  if (!isTauri()) return null;
  return platform();
}

export function isMobilePlatform(value: Platform | null = detectPlatform()): boolean {
  return value === 'android' || value === 'ios';
}

export function isAndroidPlatform(value: Platform | null = detectPlatform()): boolean {
  return value === 'android';
}

export function supportsKeyboardShortcuts(value: Platform | null = detectPlatform()): boolean {
  return !isMobilePlatform(value);
}
