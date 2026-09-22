// @vitest-environment jsdom

// Regression guard for the "全部文件 page hangs on loading, then every button
// is dead" bug.
//
// The page used to prune `openingInProgress` / `openingProgress` from an
// `$effect` that read those maps and then wrote a brand-new Map back into them
// unconditionally. Svelte 5 tracks that read, so the write re-invalidated the
// effect, which wrote again — an endless flush loop that never yields the main
// thread. Mounting the page is therefore the assertion: with the loop in place
// `render()` never returns, and the timeout below is what fails.

import { cleanup, render, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  getDownloadTasks: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  listDirectoryPage: mocks.listDirectoryPage,
  listDirectory: mocks.listDirectory,
  loadUserPreference: mocks.loadUserPreference,
  getDownloadTasks: mocks.getDownloadTasks,
  classifyUploadPath: vi.fn(),
  getDocument: vi.fn(),
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

afterEach(() => {
  cleanup();
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
});
