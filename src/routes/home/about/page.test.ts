// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/i18n';
import type { UpdateCheckPause } from '$lib/update-check-pause';
import AboutPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  loadAppVersion: vi.fn(),
  protocolVersion: vi.fn(),
  getProtocolVersionSettings: vi.fn(),
  setProtocolVersionOverride: vi.fn(),
  protocolSettings: {
    clientVersion: 27,
    minAcceptedVersion: 27,
    overrideVersion: null as number | null,
    selectableVersions: [27, 26, 25, 24, 22, 20],
  },
  initializeHighlights: vi.fn(async () => {}),
  hasAvailableHighlights: vi.fn(() => false),
  appUpdateState: {
    channel: 'stable',
    automaticCheckPause: { mode: 'active' } as UpdateCheckPause,
    isAutomaticCheckPaused: false,
    automaticCheckSettled: false,
    checked: false,
    checking: false,
    update: null,
    error: null,
    installing: false,
    installed: false,
    installError: null,
    progress: {
      phase: 'idle',
      downloadedBytes: 0,
      totalBytes: null,
      progress: null,
    },
    ensureChannel: vi.fn(async () => 'stable'),
    ensureAutomaticCheckPause: vi.fn(async () => ({ mode: 'active' } as const)),
    check: vi.fn(async () => null),
    install: vi.fn(async () => {}),
  },
}));

vi.mock('$lib/app-info', () => ({ loadAppVersion: mocks.loadAppVersion }));
vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  protocolVersion: mocks.protocolVersion,
  getProtocolVersionSettings: mocks.getProtocolVersionSettings,
  setProtocolVersionOverride: mocks.setProtocolVersionOverride,
}));
vi.mock('$lib/app-update-state.svelte', () => ({ appUpdateState: mocks.appUpdateState }));
vi.mock('$lib/release-highlights/state.svelte', () => ({
  releaseHighlightsState: {
    initialize: mocks.initializeHighlights,
    hasAvailableHighlights: mocks.hasAvailableHighlights,
    openManually: vi.fn(),
  },
}));

beforeEach(() => {
  locale.set('en');
  mocks.loadAppVersion.mockReset();
  mocks.protocolVersion.mockReset();
  mocks.getProtocolVersionSettings.mockReset();
  mocks.setProtocolVersionOverride.mockReset();
  mocks.initializeHighlights.mockClear();
  mocks.hasAvailableHighlights.mockClear();
  mocks.appUpdateState.ensureChannel.mockClear();
  mocks.loadAppVersion.mockResolvedValue('0.46.1');
  mocks.protocolVersion.mockResolvedValue(24);
  mocks.protocolSettings.overrideVersion = null;
  mocks.protocolSettings.minAcceptedVersion = 27;
  mocks.getProtocolVersionSettings.mockImplementation(async () => ({ ...mocks.protocolSettings }));
  mocks.setProtocolVersionOverride.mockImplementation(async (version: number | null) => ({
    ...mocks.protocolSettings,
    overrideVersion: version,
    minAcceptedVersion: version ?? mocks.protocolSettings.clientVersion,
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('about page', () => {
  it('renders the product identity and passes one shared version read to update context', async () => {
    const { container } = render(AboutPage);

    expect(screen.getByRole('heading', { level: 2, name: 'CFMS Client' })).toBeTruthy();
    expect(screen.getByText('Confidential File Management System')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('0.46.1')).toBeTruthy());
    expect(screen.getByText('Current version')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('Apache License 2.0')).toBeTruthy();
    expect(screen.getByText('© 2025–2026 Creeper Team')).toBeTruthy();
    expect(container.querySelector('.product-heading')).toBeTruthy();
    expect(container.querySelector('.product-meta')).toBeNull();
    expect(container.querySelector('.app-mark')).toBeNull();
    expect(mocks.loadAppVersion).toHaveBeenCalledOnce();
    expect(mocks.protocolVersion).toHaveBeenCalledOnce();
  });

  it('exposes loading semantics while product metadata is pending', () => {
    mocks.loadAppVersion.mockReturnValue(new Promise(() => {}));
    mocks.protocolVersion.mockReturnValue(new Promise(() => {}));
    const { container } = render(AboutPage);

    expect(container.querySelectorAll('.technical-value[aria-busy="true"]')).toHaveLength(2);
    expect(container.querySelectorAll('.technical-value .visually-hidden')).toHaveLength(2);
  });

  it('shows localized unknown values when metadata reads fail', async () => {
    mocks.loadAppVersion.mockRejectedValue(new Error('version unavailable'));
    mocks.protocolVersion.mockRejectedValue(new Error('protocol unavailable'));
    const { container } = render(AboutPage);

    await waitFor(() => {
      const values = [...container.querySelectorAll('.technical-value')].map((node) => node.textContent?.trim());
      expect(values).toEqual(['Unknown', 'Unknown']);
    });
    expect(container.querySelectorAll('.technical-value[aria-busy="false"]')).toHaveLength(2);
  });

  it('relaxes the accepted protocol range from the compatibility picker', async () => {
    const { container } = render(AboutPage);
    const select = await protocolPicker(container);

    expect(select.value).toBe('27');
    expect(screen.getByText('Only protocol version 27 is accepted.')).toBeTruthy();

    await fireEvent.change(select, { target: { value: '25' } });

    await waitFor(() => expect(mocks.setProtocolVersionOverride).toHaveBeenCalledWith(25));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Protocol versions 25 to 27 are accepted. Some features may not work against an older server.',
        ),
      ).toBeTruthy(),
    );
  });

  it('restores the compiled-in range when the default option is picked again', async () => {
    mocks.protocolSettings.overrideVersion = 25;
    mocks.protocolSettings.minAcceptedVersion = 25;
    const { container } = render(AboutPage);
    const select = await protocolPicker(container);

    expect(select.value).toBe('25');

    await fireEvent.change(select, { target: { value: '27' } });

    await waitFor(() => expect(mocks.setProtocolVersionOverride).toHaveBeenCalledWith(null));
  });

  it('reports a failed compatibility write and restores the picker', async () => {
    mocks.setProtocolVersionOverride.mockRejectedValue(new Error('disk offline'));
    const { container } = render(AboutPage);
    const select = await protocolPicker(container);

    await fireEvent.change(select, { target: { value: '24' } });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent?.trim()).toBe(
        'Protocol compatibility settings could not be saved: disk offline',
      ),
    );
    expect(select.value).toBe('27');
  });
});

async function protocolPicker(container: HTMLElement): Promise<HTMLSelectElement> {
  return waitFor(() => {
    const element = container.querySelector<HTMLSelectElement>('.protocol-compatibility select');
    if (!element) throw new Error('protocol compatibility picker not rendered');
    return element;
  });
}
