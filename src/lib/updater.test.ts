import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onEvent: null as ((event: unknown) => void) | null,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    constructor(onmessage: (event: unknown) => void) {
      mocks.onEvent = onmessage;
    }
  },
  invoke: mocks.invoke,
}));

vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

import { installAppUpdate } from './updater';

describe('installAppUpdate progress', () => {
  beforeEach(() => {
    mocks.onEvent = null;
    mocks.invoke.mockResolvedValue(undefined);
  });

  it('resets progress and updates the source when a fallback is selected', async () => {
    const snapshots: Parameters<Parameters<typeof installAppUpdate>[0]>[0][] = [];
    await installAppUpdate((snapshot) => snapshots.push(snapshot));

    mocks.onEvent?.({ event: 'MirrorSelected', data: { mirror: 'fast-mirror', bytesPerSecond: 100 } });
    mocks.onEvent?.({ event: 'Started', data: { contentLength: 100 } });
    mocks.onEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
    mocks.onEvent?.({ event: 'MirrorSelected', data: { mirror: 'fallback-mirror', bytesPerSecond: 20 } });

    expect(snapshots.at(-1)).toMatchObject({
      phase: 'downloading',
      downloadedBytes: 0,
      totalBytes: null,
      mirror: 'fallback-mirror',
      mirrorBytesPerSecond: 20,
    });
  });
});
