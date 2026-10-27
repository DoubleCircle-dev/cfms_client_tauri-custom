import { Channel, invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateChannel = 'stable' | 'beta' | 'alpha';
export type UpdateSource = 'official' | 'custom';

export interface AppUpdateMetadata {
  currentVersion: string;
  version: string;
  date?: string | null;
  body?: string | null;
  channel: UpdateChannel;
  releaseUrl: string;
  installMode: 'desktop' | 'android-apk';
}

export type AppUpdateDownloadEvent =
  | { event: 'Probing'; data: { candidates: number } }
  | { event: 'MirrorSelected'; data: { mirror: string; bytesPerSecond: number } }
  | { event: 'Started'; data: { contentLength?: number | null } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

export interface UpdateProgressSnapshot {
  phase: 'idle' | 'probing' | 'downloading' | 'installing' | 'finished';
  downloadedBytes: number;
  totalBytes: number | null;
  progress: number | null;
  /** Source picked by the mirror probe, or `null` for a direct download. */
  mirror: string | null;
  /** Throughput measured for the selected source, in bytes per second. */
  mirrorBytesPerSecond: number | null;
}

export async function checkAppUpdate(
  channel: UpdateChannel,
  source: UpdateSource,
): Promise<AppUpdateMetadata | null> {
  return invoke<AppUpdateMetadata | null>('check_app_update', { channel, source });
}

export async function installAppUpdate(
  onProgress: (snapshot: UpdateProgressSnapshot) => void,
): Promise<void> {
  let downloadedBytes = 0;
  let totalBytes: number | null = null;
  let mirror: string | null = null;
  let mirrorBytesPerSecond: number | null = null;

  const progressChannel = new Channel<AppUpdateDownloadEvent>((event) => {
    if (event.event === 'Probing') {
      downloadedBytes = 0;
      totalBytes = null;
      mirror = null;
      mirrorBytesPerSecond = null;
      onProgress(toSnapshot('probing', downloadedBytes, totalBytes, mirror, mirrorBytesPerSecond));
      return;
    }

    if (event.event === 'MirrorSelected') {
      mirror = event.data.mirror;
      mirrorBytesPerSecond = event.data.bytesPerSecond;
      onProgress(toSnapshot('downloading', downloadedBytes, totalBytes, mirror, mirrorBytesPerSecond));
      return;
    }

    if (event.event === 'Started') {
      downloadedBytes = 0;
      totalBytes = event.data.contentLength ?? null;
      onProgress(toSnapshot('downloading', downloadedBytes, totalBytes, mirror, mirrorBytesPerSecond));
      return;
    }

    if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength;
      onProgress(toSnapshot('downloading', downloadedBytes, totalBytes, mirror, mirrorBytesPerSecond));
      return;
    }

    onProgress(toSnapshot('installing', downloadedBytes, totalBytes, mirror, mirrorBytesPerSecond));
  });

  await invoke('install_app_update', { onEvent: progressChannel });
  onProgress(toSnapshot('finished', downloadedBytes, totalBytes, mirror, mirrorBytesPerSecond));
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function toSnapshot(
  phase: UpdateProgressSnapshot['phase'],
  downloadedBytes: number,
  totalBytes: number | null,
  mirror: string | null,
  mirrorBytesPerSecond: number | null,
): UpdateProgressSnapshot {
  const progress =
    totalBytes && totalBytes > 0
      ? Math.min(downloadedBytes / totalBytes, 1)
      : null;

  return {
    phase,
    downloadedBytes,
    totalBytes,
    progress,
    mirror,
    mirrorBytesPerSecond,
  };
}
