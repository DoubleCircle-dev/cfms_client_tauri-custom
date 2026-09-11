// CFMS Client — Documents the server refuses to download.
//
// A document can be listed — so it shows up in the tree with a title and a
// revision — while its bytes are blocked by an access rule. The sync mirrors
// such a document as a same-named placeholder inside the download root.
//
// Without remembering *why* that placeholder is there, every later check
// compares an empty stand-in against a real server revision, calls it outdated,
// and offers an update that can only ever fail the same way again. The record
// below is what stops that loop; the retry that would end it happens in the
// sync, which still attempts every recorded document once per run so a
// permission granted in the meantime is picked up on its own.
//
// The record is scoped to the signed-in account, exactly like the check
// history: a denial belongs to one user on one server. It is never permanent —
// every check re-tests it — because the only thing that is really permanent is
// that access rules can change at any time.

import { getDocumentInfo } from '$lib/api/files';
import { isDocumentAccessDenied } from '$lib/api/server-errors';

const KEY_PREFIX = 'cfms:denied-documents:v1';

export interface DeniedDocumentScope {
  serverAddress: string | null | undefined;
  username: string | null | undefined;
}

/** What the sync needs to find and retry a denied document later. */
export interface DeniedDocument {
  /** Server document id. */
  docId: string;
  /** Download-root-relative path of the placeholder standing in for it. */
  path: string;
}

/** Storage key for one account, or `null` while the account is unknown. */
function storageKey(scope: DeniedDocumentScope | null | undefined): string | null {
  const serverAddress = scope?.serverAddress?.trim();
  const username = scope?.username?.trim();
  if (!serverAddress || !username) return null;
  return `${KEY_PREFIX}:${encodeURIComponent(serverAddress)}:${encodeURIComponent(username)}`;
}

class DeniedDocumentStore {
  /** docId → record. */
  private records = $state<Map<string, DeniedDocument>>(new Map());
  private key: string | null = null;

  /** Number of documents currently known to be undownloadable. */
  get count(): number {
    return this.records.size;
  }

  /** Every recorded document, for the sync to retry. */
  list(): DeniedDocument[] {
    return [...this.records.values()];
  }

  isDenied(docId: string): boolean {
    return this.records.has(docId);
  }

  /**
   * Point the record at an account. Dropping it on a change keeps a denial from
   * one server or user from hiding a perfectly reachable document on another.
   */
  useAccountScope(scope: DeniedDocumentScope | null | undefined) {
    const next = storageKey(scope);
    if (next === this.key) return;
    this.key = next;
    this.replaceWith([]);
    if (next) this.restore(next);
  }

  /** Remember that `doc` could not be fetched, so the check stops offering it. */
  mark(doc: DeniedDocument) {
    if (!doc.docId || !doc.path) return;
    const records = new Map(this.records);
    records.set(doc.docId, { docId: doc.docId, path: doc.path });
    this.replaceWith([...records.values()]);
    this.persist();
  }

  /** The document is fetchable again (or gone) — forget the record. */
  clear(docId: string) {
    if (!this.records.has(docId)) return;
    const records = new Map(this.records);
    records.delete(docId);
    this.replaceWith([...records.values()]);
    this.persist();
  }

  /**
   * Ask the server whether this document can be read at all.
   *
   * `get_document_info` applies the very same `check_access_requirements` rule
   * that blocks the download, but answers with metadata instead of a file — no
   * transfer task, no bytes. That is what lets a check tell a refused document
   * apart from an update that merely has not been fetched yet, on its first
   * try rather than after a failed download.
   *
   * Anything that is not a document-level refusal counts as reachable: a rate
   * limit or a dropped connection says nothing about this document, and hiding
   * a real update behind one would be worse than reporting it.
   */
  async probeDocumentAccess(docId: string): Promise<boolean> {
    try {
      await getDocumentInfo(docId);
      return true;
    } catch (err) {
      return !isDocumentAccessDenied(err);
    }
  }

  /** Forget every record, e.g. after a sign-out. */
  clearAll() {
    if (this.records.size === 0) return;
    this.replaceWith([]);
    this.persist();
  }

  private replaceWith(items: readonly DeniedDocument[]) {
    const records = new Map<string, DeniedDocument>();
    for (const item of items) {
      if (!item?.docId || !item.path) continue;
      records.set(item.docId, { docId: item.docId, path: item.path });
    }
    this.records = records;
  }

  private restore(key: string) {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.replaceWith(
        parsed.filter((item): item is DeniedDocument =>
          !!item && typeof item.docId === 'string' && typeof item.path === 'string'),
      );
    } catch {
      // Malformed local state is not worth failing a sign-in over.
    }
  }

  private persist() {
    if (typeof window === 'undefined' || !this.key) return;
    try {
      window.localStorage.setItem(this.key, JSON.stringify([...this.records.values()]));
    } catch {
      // Ignore storage errors.
    }
  }
}

export const deniedDocuments = new DeniedDocumentStore();
