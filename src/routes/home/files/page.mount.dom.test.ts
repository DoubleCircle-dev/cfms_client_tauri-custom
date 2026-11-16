// Regression guard for the "全部文件 page hangs on loading, then every button
// is dead" bug.
//
// The page used to prune `openingInProgress` / `openingProgress` from an
// `$effect` that read those maps and then wrote a brand-new Map back into them
// unconditionally. Svelte 5 tracks that read, so the write re-invalidated the
// effect, which wrote again — an endless flush loop that never yields the main
// thread. Mounting the page is therefore the assertion: with the loop in place
// `render()` never returns, and the timeout below is what fails.

import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from '$app/state';
import type { DownloadTaskDto, ServerDocumentEntry } from '$lib/api/types';
import { cancelDownload } from '$lib/api/downloads';
import { fileUpdateTracker } from '$lib/file-update-tracker.svelte';
import { downloadStore } from '$lib/stores.svelte';
import type { LocalDocumentState } from '$lib/sync-all.svelte';
import FilesPage from './+page.svelte';

// `svelte/motion` builds a module-scope MediaQuery, so `matchMedia` has to exist
// before any import is evaluated. `vi.hoisted` runs first; jsdom does not
// implement it.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
});

const mocks = vi.hoisted(() => ({
  listDirectoryPage: vi.fn(),
  listDirectory: vi.fn(),
  loadUserPreference: vi.fn(),
  getDownloadTasks: vi.fn((_status?: string) => Promise.resolve([] as DownloadTaskDto[])),
  getDocument: vi.fn(async (_documentId: string, _path: string) => ({ task_id: 'task-1' })),
  openDownloadedDocument: vi.fn(async (_path: string) => true),
  loadServerDocument: vi.fn(async (_documentId: string, _parentId: string | null) => null),
  readLocalDocumentState: vi.fn(async (doc: ServerDocumentEntry, pathParts: string[]): Promise<LocalDocumentState> => ({
    doc,
    path: [...pathParts, doc.title].join('/'),
    localHash: null,
    existsLocally: false,
    isCurrent: false,
    mismatched: false,
  })),
  readLocalDocumentStates: vi.fn(async (_documents: ServerDocumentEntry[], _pathParts: string[]) => [] as LocalDocumentState[]),
}));

vi.mock('$lib/api', () => ({
  listDirectoryPage: mocks.listDirectoryPage,
  listDirectory: mocks.listDirectory,
  loadUserPreference: mocks.loadUserPreference,
  getDownloadTasks: mocks.getDownloadTasks,
  classifyUploadPath: vi.fn(),
  getDocument: mocks.getDocument,
  openDownloadedDocument: vi.fn(),
  getRevision: vi.fn(),
  inspectUploadDirectoryConflicts: vi.fn(),
  createDirectory: vi.fn(),
  deleteDirectory: vi.fn(),
  deleteDocument: vi.fn(),
  deleteRevision: vi.fn(),
  ensureDownloadSubdirectory: vi.fn(),
  getAccessRules: vi.fn(),
  getDirectoryInfo: vi.fn(),
  getDocumentInfo: vi.fn(),
  grantAccess: vi.fn(),
  listRevisions: vi.fn(),
  moveDirectory: vi.fn(),
  moveDocument: vi.fn(),
  renameDirectory: vi.fn(),
  renameDocument: vi.fn(),
  resolveNodePath: vi.fn(),
  revokeAccess: vi.fn(),
  setAccessRules: vi.fn(),
  setCurrentRevision: vi.fn(),
  setDocumentTags: vi.fn(),
  searchFiles: vi.fn(),
  uploadDirectory: vi.fn(),
  uploadDocumentFile: vi.fn(),
  uploadNewRevision: vi.fn(),
  viewAccessEntries: vi.fn(),
}));

vi.mock('$lib/api/downloads', () => ({
  cancelDownload: vi.fn(),
  getDownloadTasks: mocks.getDownloadTasks,
}));

vi.mock('$lib/api/files', async () => {
  const actual = await vi.importActual<typeof import('$lib/api/files')>('$lib/api/files');
  return { ...actual, openDownloadedDocument: mocks.openDownloadedDocument };
});

vi.mock('$lib/sync-all.svelte', () => ({
  loadServerDocument: mocks.loadServerDocument,
  makeDownloadPath: (parts: string[]) => parts.join('/'),
  readLocalDocumentState: mocks.readLocalDocumentState,
  readLocalDocumentStates: mocks.readLocalDocumentStates,
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/home/files') },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => undefined),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

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

beforeEach(() => {
  mocks.getDownloadTasks.mockResolvedValue([]);
  mocks.getDocument.mockResolvedValue({ task_id: 'task-1' });
  mocks.openDownloadedDocument.mockResolvedValue(true);
  mocks.loadServerDocument.mockResolvedValue(null);
  mocks.readLocalDocumentState.mockImplementation(async (doc, pathParts) => ({
    doc,
    path: [...pathParts, doc.title].join('/'),
    localHash: null,
    existsLocally: false,
    isCurrent: false,
    mismatched: false,
  }));
  mocks.readLocalDocumentStates.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  Object.defineProperty(page, 'url', {
    configurable: true,
    value: new URL('http://localhost/home/files'),
  });
  // The store is a module singleton, so a task seeded by one test would
  // otherwise leak into the next one.
  downloadStore.setAll([]);
  vi.clearAllMocks();
});

function pageResponse() {
  return {
    folders: [
      {
        id: 'folder-docs',
        name: 'documents-folder',
        parent_id: null,
        size: 0,
        last_modified: 0,
      },
    ],
    documents: [
      {
        id: 'doc-1',
        title: 'readme-document',
        parent_id: null,
        size: 12,
        last_modified: 0,
        sha256: 'a'.repeat(64),
      },
    ],
    parent_id: null,
    next_cursor: null,
    has_more: false,
  };
}

function downloadTask(overrides: Partial<DownloadTaskDto> = {}): DownloadTaskDto {
  return {
    task_id: 'task-1',
    file_id: 'doc-1',
    filename: 'readme-document',
    file_path: 'C:/downloads/readme-document',
    status: 'downloading',
    progress: 0,
    current_bytes: 0,
    total_bytes: 100,
    message: null,
    error: null,
    created_at: 1,
    started_at: 1,
    completed_at: null,
    priority: 0,
    retry_count: 0,
    max_retries: 3,
    scheduled_time: null,
    stage: 0,
    bandwidth_limit: null,
    pause_position: null,
    supports_resume: true,
    ...overrides,
  };
}

describe('files page', () => {
  it('finishes mounting and shows the listing instead of hanging on loading', async () => {
    mocks.listDirectoryPage.mockResolvedValue(pageResponse());
    mocks.loadUserPreference.mockResolvedValue(null);
    mocks.getDownloadTasks.mockResolvedValue([]);

    const { container } = render(FilesPage);
    flushSync();

    // The reported failure was the spinner never going away, which left every
    // `!loading`-gated command disabled.
    await waitFor(() => {
      expect(container.querySelector('.file-table-loading')).toBeNull();
    });

    // The server's listing reached the table.
    expect(container.textContent).toContain('readme-document');
    expect(container.textContent).toContain('documents-folder');
  });

  it('compares a requested child directory against its own snapshot', async () => {
    mocks.listDirectoryPage.mockResolvedValue(pageResponse());
    mocks.loadUserPreference.mockResolvedValue(null);
    mocks.getDownloadTasks.mockResolvedValue([]);
    Object.defineProperty(page, 'url', {
      configurable: true,
      value: new URL('http://localhost/home/files?folder=folder-target&name=Target'),
    });
    const compareSnapshot = vi.spyOn(fileUpdateTracker, 'compareSnapshot');

    const { container } = render(FilesPage);
    flushSync();

    await waitFor(() => {
      expect(container.querySelector('.file-table-loading')).toBeNull();
    });

    expect(compareSnapshot).toHaveBeenCalledWith(
      'folder-target',
      expect.any(Array),
      expect.any(Array),
    );
    compareSnapshot.mockRestore();
  });

  it('marks a local copy that differs from the server revision', async () => {
    mocks.listDirectoryPage.mockResolvedValue(pageResponse());
    mocks.loadUserPreference.mockResolvedValue(null);
    mocks.getDownloadTasks.mockResolvedValue([]);
    mocks.readLocalDocumentStates.mockResolvedValue([
      {
        doc: pageResponse().documents[0],
        path: 'readme-document',
        localHash: 'b'.repeat(64),
        existsLocally: true,
        isCurrent: false,
        mismatched: true,
      },
    ]);

    const { container } = render(FilesPage);
    flushSync();

    await waitFor(() => {
      expect(container.querySelector('.file-table-loading')).toBeNull();
    });
    await waitFor(() => {
      const row = container.querySelector('[data-selection-key="document:doc-1"]');
      expect(row).not.toBeNull();
      expect(row!.querySelector('[data-outdated]')).not.toBeNull();
    });
    const row = container.querySelector('[data-selection-key="document:doc-1"]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('[data-not-downloaded]')).toBeNull();
  });

  it('opens a verified local copy without starting another download', async () => {
    mocks.listDirectoryPage.mockResolvedValue(pageResponse());
    mocks.loadUserPreference.mockResolvedValue(null);
    mocks.getDownloadTasks.mockResolvedValue([]);
    mocks.readLocalDocumentState.mockResolvedValue({
      doc: pageResponse().documents[0],
      path: 'readme-document',
      localHash: 'a'.repeat(64),
      existsLocally: true,
      isCurrent: true,
      mismatched: false,
    });

    const { container } = render(FilesPage);
    flushSync();
    await waitFor(() => {
      expect(container.querySelector('.file-table-loading')).toBeNull();
    });

    await fireEvent.dblClick(container.querySelector('[data-selection-key="document:doc-1"]')!);
    await waitFor(() => {
      expect(mocks.openDownloadedDocument).toHaveBeenCalledExactlyOnceWith('readme-document');
    });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it('verifies a newly downloaded copy before opening it', async () => {
    mocks.listDirectoryPage.mockResolvedValue(pageResponse());
    mocks.loadUserPreference.mockResolvedValue(null);
    mocks.getDownloadTasks.mockResolvedValue([]);
    mocks.readLocalDocumentState
      .mockResolvedValueOnce({
        doc: pageResponse().documents[0],
        path: 'readme-document',
        localHash: null,
        existsLocally: false,
        isCurrent: false,
        mismatched: false,
      })
      .mockResolvedValueOnce({
        doc: pageResponse().documents[0],
        path: 'readme-document',
        localHash: 'a'.repeat(64),
        existsLocally: true,
        isCurrent: true,
        mismatched: false,
      });
    mocks.getDocument.mockImplementationOnce(async (documentId: string, path: string) => {
      downloadStore.upsert(downloadTask({
        task_id: 'download-before-open',
        file_id: documentId,
        filename: path,
        file_path: path,
        status: 'completed',
        progress: 1,
      }));
      return { task_id: 'download-before-open' };
    });

    const { container } = render(FilesPage);
    flushSync();
    await waitFor(() => {
      expect(container.querySelector('.file-table-loading')).toBeNull();
    });

    await fireEvent.dblClick(container.querySelector('[data-selection-key="document:doc-1"]')!);
    await waitFor(() => {
      expect(mocks.openDownloadedDocument).toHaveBeenCalledExactlyOnceWith('readme-document');
    });
    expect(mocks.getDocument).toHaveBeenCalledExactlyOnceWith('doc-1', 'readme-document');
  });

  it('reuses and cancels an active transfer while opening a document', async () => {
    mocks.listDirectoryPage.mockResolvedValue(pageResponse());
    mocks.loadUserPreference.mockResolvedValue(null);
    mocks.getDownloadTasks.mockResolvedValue([]);
    mocks.readLocalDocumentState.mockResolvedValue({
      doc: pageResponse().documents[0],
      path: 'readme-document',
      localHash: null,
      existsLocally: false,
      isCurrent: false,
      mismatched: false,
    });

    const { container } = render(FilesPage);
    flushSync();
    await waitFor(() => {
      expect(container.querySelector('.file-table-loading')).toBeNull();
    });

    downloadStore.upsert(downloadTask({ progress: 0.25 }));
    await fireEvent.dblClick(container.querySelector('[data-selection-key="document:doc-1"]')!);
    const cancelButton = await waitFor(() => {
      const button = container.querySelector('.file-table-row-cancel');
      expect(button).not.toBeNull();
      return button!;
    });
    await fireEvent.click(cancelButton);
    expect(cancelDownload).toHaveBeenCalledExactlyOnceWith('task-1');
    expect(mocks.getDocument).not.toHaveBeenCalled();

    downloadStore.upsert(downloadTask({ status: 'cancelled', progress: 0.25 }));
    await waitFor(() => {
      expect(container.querySelector('.file-table-row-cancel')).toBeNull();
    });
  });

  it('reports a running download on the document row itself', async () => {
    mocks.listDirectoryPage.mockResolvedValue(pageResponse());
    mocks.loadUserPreference.mockResolvedValue(null);
    mocks.getDownloadTasks.mockResolvedValue([]);

    const { container } = render(FilesPage);
    flushSync();
    await waitFor(() => {
      expect(container.querySelector('.file-table-loading')).toBeNull();
    });

    // Seed after mounting: the page loads the task list on mount and would
    // otherwise replace whatever the test put in the store.
    downloadStore.upsert(downloadTask({ file_id: 'doc-1', progress: 0.5 }));
    flushSync();

    const row = container.querySelector('[data-selection-key="document:doc-1"]');
    expect(row).not.toBeNull();
    expect(row!.classList.contains('file-table-row--transferring')).toBe(true);
    expect(row!.getAttribute('style')).toMatch(/--row-transfer-progress:\s*50%/);
  });

  it('cancels an active download from its document row', async () => {
    mocks.listDirectoryPage.mockResolvedValue(pageResponse());
    mocks.loadUserPreference.mockResolvedValue(null);
    mocks.getDownloadTasks.mockResolvedValue([]);

    const { container } = render(FilesPage);
    flushSync();
    await waitFor(() => {
      expect(container.querySelector('.file-table-loading')).toBeNull();
    });

    downloadStore.upsert(downloadTask({ file_id: 'doc-1', progress: 0.5 }));
    flushSync();
    const cancelButton = container.querySelector('.file-table-row-cancel');
    expect(cancelButton).not.toBeNull();

    await fireEvent.click(cancelButton!);
    expect(cancelDownload).toHaveBeenCalledExactlyOnceWith('task-1');
  });

  it('leaves settled tasks off the row', async () => {
    mocks.listDirectoryPage.mockResolvedValue(pageResponse());
    mocks.loadUserPreference.mockResolvedValue(null);
    mocks.getDownloadTasks.mockResolvedValue([]);

    const { container } = render(FilesPage);
    flushSync();
    await waitFor(() => {
      expect(container.querySelector('.file-table-loading')).toBeNull();
    });

    downloadStore.upsert(downloadTask({ file_id: 'doc-1', status: 'completed', progress: 1 }));
    flushSync();

    const row = container.querySelector('[data-selection-key="document:doc-1"]');
    expect(row!.classList.contains('file-table-row--transferring')).toBe(false);
  });
});
