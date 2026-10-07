import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListDirectoryPageResponse } from '$lib/api/types';
import { BatchAccessRulesController, batchRulesSessionProblem, type BatchRulesProblem, type BatchRulesTarget } from './batch-access-rules';

const doc = (id: string): BatchRulesTarget => ({ objectType: 'document', objectId: id, name: id });
const folder = (id: string): BatchRulesTarget => ({ objectType: 'directory', objectId: id, name: id });
const rules = { read: [{ match: 'any' as const, match_groups: [] }] };
function page(folders: string[] = [], documents: string[] = [], cursor: string | null = null): ListDirectoryPageResponse {
  return {
    folders: folders.map((id) => ({ id, name: id, created_time: null })),
    documents: documents.map((id) => ({ id, title: id, size: null, last_modified: null })),
    parent_id: null, has_more: cursor !== null, next_cursor: cursor, page_size: 128,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(targets = [doc('a'), doc('b')]) {
  const fetchPage = vi.fn().mockResolvedValue(page());
  const setRules = vi.fn().mockResolvedValue(true);
  const onChange = vi.fn();
  let problem: BatchRulesProblem | null = null;
  const controller = new BatchAccessRulesController(targets, {
    fetchPage, setRules, onChange, guard: () => problem, requestTimeoutMs: 0,
  });
  return { controller, fetchPage, setRules, onChange, setGuard: (next: BatchRulesProblem | null) => { problem = next; } };
}
async function flush() { for (let i = 0; i < 20; i += 1) await Promise.resolve(); }

afterEach(() => vi.useRealTimers());

describe('batch access rule discovery', () => {
  it('freezes and deduplicates mixed selected objects without reading their existing rules', async () => {
    const targets = [folder('a'), doc('b'), doc('b')];
    const { controller, fetchPage, setRules } = setup(targets);
    targets[0].objectId = 'changed';
    await controller.discover(rules, true, false);
    await controller.apply();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(setRules.mock.calls.map(([type, id]) => [type, id])).toEqual([['directory', 'a'], ['document', 'b']]);
    expect(controller.snapshot.results.every((item) => item.status === 'success')).toBe(true);
  });

  it('fetches every cursor page, deduplicates overlapping roots and writes descendants first', async () => {
    const { controller, fetchPage, setRules } = setup([folder('root'), folder('child'), doc('file')]);
    fetchPage.mockImplementation(async (id: string, cursor: string | null) => {
      if (id === 'root' && cursor === null) return page(['child'], [], 'next');
      if (id === 'root') return page([], ['file']);
      return id === 'child' ? page(['grandchild'], ['child-file']) : page();
    });
    await controller.discover({}, false, true);
    expect(fetchPage).toHaveBeenCalledWith('root', 'next', 128);
    expect(fetchPage.mock.calls.filter(([id]) => id === 'child')).toHaveLength(1);
    await controller.apply();
    const written = setRules.mock.calls.map(([, id]) => id);
    expect(new Set(written).size).toBe(5);
    expect(written.indexOf('grandchild')).toBeLessThan(written.indexOf('child'));
    expect(written.indexOf('child-file')).toBeLessThan(written.indexOf('child'));
    expect(written.indexOf('child')).toBeLessThan(written.indexOf('root'));
    expect(written.indexOf('file')).toBeLessThan(written.indexOf('root'));
  });

  it('retains discoveries from a partial directory and scans other branches, requiring explicit incomplete coverage approval', async () => {
    const { controller, fetchPage, setRules } = setup([folder('root'), folder('other')]);
    fetchPage.mockImplementation(async (id: string, cursor: string | null) => {
      if (id === 'other') return page([], ['other-file']);
      if (cursor === null) return page([], ['known'], 'next');
      throw 'Server returned 403: denied';
    });
    await controller.discover({}, true, true);
    expect(controller.snapshot.scanIssues).toHaveLength(1);
    expect(controller.snapshot.targets.map((item) => item.objectId)).toContain('other-file');
    await controller.apply();
    expect(setRules).not.toHaveBeenCalled();
    await controller.apply(true);
    expect(setRules).toHaveBeenCalledTimes(4);
    expect(controller.snapshot.scanIssues).toHaveLength(1);
  });

  it.each(['repeat', 'missing'])('detects a %s cursor without looping', async (kind) => {
    const { controller, fetchPage } = setup([folder('root')]);
    fetchPage.mockResolvedValue(kind === 'repeat' ? page([], [], 'same') : { ...page(), has_more: true });
    await controller.discover({}, true, true);
    expect(fetchPage).toHaveBeenCalledTimes(kind === 'repeat' ? 2 : 1);
    expect(controller.snapshot.scanIssues[0].problem.kind).toBe('cursor');
  });

  it('detects hierarchy cycles and produces each known target once', async () => {
    const { controller, fetchPage } = setup([folder('a')]);
    fetchPage.mockImplementation(async (id: string) => page([id === 'a' ? 'b' : 'a']));
    await controller.discover({}, true, true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(controller.snapshot.scanIssues[0].problem.kind).toBe('cycle');
    expect(controller.snapshot.results).toHaveLength(2);
  });

  it('pauses discovery on throttling and resumes from its original cursor after the remaining cooldown', async () => {
    vi.useFakeTimers();
    const { controller, fetchPage } = setup([folder('root')]);
    fetchPage.mockResolvedValueOnce(page([], ['known'], 'next'));
    for (let i = 0; i < 3; i += 1) fetchPage.mockRejectedValueOnce('Server returned 429: slow\nCFMS_ERROR_DATA:{"retry_after_seconds":2}');
    fetchPage.mockResolvedValue(page([], ['last']));
    const scan = controller.discover({}, true, true);
    await flush();
    await vi.advanceTimersByTimeAsync(4_000);
    await scan;
    expect(controller.snapshot.phase).toBe('paused');
    expect(controller.snapshot.scanComplete).toBe(false);
    const resume = controller.resumeScan();
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2_000);
    await resume;
    expect(fetchPage).toHaveBeenLastCalledWith('root', 'next', 128);
    expect(controller.snapshot.phase).toBe('ready');
    expect(controller.snapshot.targets).toHaveLength(3);
  });

  it('can restart a failed scan and clears obsolete discoveries and issues', async () => {
    const { controller, fetchPage } = setup([folder('root')]);
    fetchPage.mockRejectedValueOnce('Server returned 404: gone');
    await controller.discover({}, true, true);
    expect(controller.snapshot.scanIssues).toHaveLength(1);
    await controller.discover({}, true, true);
    expect(controller.snapshot.scanIssues).toHaveLength(0);
  });
});

describe('batch access rule execution and recovery', () => {
  it.each([400, 403, 404, 409, 500])('continues after a %s rejection and retries only failed objects', async (status) => {
    const { controller, setRules } = setup();
    setRules.mockRejectedValueOnce(`Server returned ${status}: rejected`);
    await controller.discover({}, true, false);
    await controller.apply();
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['failed', 'success']);
    await controller.retryFailed();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'b', 'a']);
    expect(controller.snapshot.runTotal).toBe(1);
    expect(controller.snapshot.runCompleted).toBe(1);
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['success', 'success']);
  });

  it.each([401, 999])('stops on %s, preserving pending objects for explicit continuation', async (status) => {
    const { controller, setRules } = setup();
    setRules.mockRejectedValueOnce(`Server returned ${status}: blocked`);
    await controller.discover({}, true, false);
    await controller.apply();
    expect(setRules).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe('stopped');
    await controller.continuePending();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'a', 'b']);
  });

  it.each([429, 503])('honors %s server delays and makes at most two automatic retries before pausing the whole batch', async (status) => {
    vi.useFakeTimers();
    const { controller, setRules } = setup();
    for (let i = 0; i < 3; i += 1) setRules.mockRejectedValueOnce(`Server returned ${status}: busy\nCFMS_ERROR_DATA:{"retry_after_seconds":5}`);
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    expect(setRules).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(setRules).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_001);
    await run;
    expect(setRules).toHaveBeenCalledTimes(3);
    expect(controller.snapshot.phase).toBe('paused');
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['failed', 'pending']);
    const resumed = controller.continuePending();
    await flush();
    expect(setRules).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5_000);
    await resumed;
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'a', 'a', 'a', 'b']);
  });

  it('uses 2 then 4 second fallback delays and allows immediately stopping a wait', async () => {
    vi.useFakeTimers();
    const { controller, setRules } = setup();
    setRules.mockRejectedValue('Server returned 429: slow');
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(setRules).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(setRules).toHaveBeenCalledTimes(2);
    controller.stop();
    await run;
    expect(controller.snapshot.phase).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for the in-flight write and retains its real success when stopped', async () => {
    const pending = deferred<boolean>();
    const { controller, setRules } = setup();
    setRules.mockReturnValueOnce(pending.promise);
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    controller.stop();
    expect(controller.snapshot.stopRequested).toBe(true);
    expect(controller.snapshot.phase).toBe('running');
    pending.resolve(true);
    await run;
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['success', 'pending']);
    await controller.continuePending();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'b']);
  });

  it.each([false, undefined, null])('treats an unexpected %s acknowledgement as unconfirmed, never as success', async (value) => {
    const { controller, setRules } = setup();
    setRules.mockResolvedValueOnce(value);
    await controller.discover({}, true, false);
    await controller.apply();
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['unconfirmed', 'pending']);
    await controller.retryFailed();
    expect(setRules).toHaveBeenCalledTimes(1);
    await controller.resubmitUnconfirmed();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'a']);
  });

  it('does not retry transport failures or include uncertain writes in pending continuation', async () => {
    const { controller, setRules } = setup();
    setRules.mockRejectedValueOnce(new Error('Connection failed: no response'));
    await controller.discover({}, true, false);
    await controller.apply();
    expect(setRules).toHaveBeenCalledTimes(1);
    await controller.continuePending();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'b']);
    expect(controller.snapshot.results[0].status).toBe('unconfirmed');
  });

  it('checks identity and permission before every request without turning unsent objects into failures', async () => {
    const { controller, setRules, setGuard } = setup();
    setRules.mockImplementationOnce(async () => { setGuard({ kind: 'identity' }); return true; });
    await controller.discover({}, true, false);
    await controller.apply();
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['success', 'pending']);
    await controller.continuePending();
    expect(setRules).toHaveBeenCalledTimes(1);
    setGuard(null);
    await controller.continuePending();
    expect(setRules).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate submissions, ignores callbacks after disposal and never sends the next write', async () => {
    const pending = deferred<boolean>();
    const { controller, setRules, onChange } = setup();
    setRules.mockReturnValueOnce(pending.promise);
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    await controller.continuePending();
    controller.dispose();
    const callbacks = onChange.mock.calls.length;
    pending.resolve(true);
    await run;
    expect(onChange).toHaveBeenCalledTimes(callbacks);
    expect(setRules).toHaveBeenCalledTimes(1);
  });

  it('keeps the submitted rules immutable across edits and request-side mutation', async () => {
    const { controller, setRules } = setup();
    const draft = { read: [{ match: 'any' as const, match_groups: [] }] };
    await controller.discover(draft, false, false);
    draft.read.length = 0;
    setRules.mockImplementationOnce(async (_type, _id, sentRules) => { sentRules.read.length = 0; return true; });
    await controller.apply();
    expect(setRules.mock.calls[1][2].read).toHaveLength(1);
    expect(setRules.mock.calls[1][3]).toBe(false);
  });
});

describe('batch session guards', () => {
  const identity = { server: 'server', username: 'alice' };
  const session = { ...identity, loggedIn: true, permitted: true, connected: true, lockdown: false, bypassLockdown: false };
  it.each([
    [{ server: 'other' }, 'identity'], [{ username: 'bob' }, 'identity'],
    [{ loggedIn: false }, 'session'], [{ permitted: false }, 'permission'],
    [{ connected: false }, 'disconnected'], [{ lockdown: true }, 'lockdown'],
  ] as const)('guards changed session state %j', (change, kind) => {
    expect(batchRulesSessionProblem(identity, { ...session, ...change })?.kind).toBe(kind);
  });
  it('allows a server-authorized lockdown bypass', () => {
    expect(batchRulesSessionProblem(identity, { ...session, lockdown: true, bypassLockdown: true })).toBeNull();
  });
});
