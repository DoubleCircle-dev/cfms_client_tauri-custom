import { describe, expect, it, vi } from 'vitest';
import type { SettingsEntry } from '$lib/settings-entries';

const order = vi.hoisted(() => [] as string[]);

vi.mock('$lib/file-auto-check-events', () => ({
  initFileAutoCheck: async () => { order.push('file-auto-check'); },
  disposeFileAutoCheck: () => { order.push('dispose-file-auto-check'); },
  refreshFileAutoCheckState: async () => {},
}));

vi.mock('$lib/desktop-shell', () => ({
  initDesktopShell: async () => { order.push('desktop-shell'); },
}));

vi.mock('$lib/api', () => ({
  getLocalIpAddresses: async () => ['192.0.2.10'],
}));

import {
  disposeCustomModules,
  getCustomParentRoute,
  getCustomNavigationItems,
  getCustomPublicUtilityRoutes,
  getCustomRouteTitle,
  isCustomFeatureEnabled,
  mergeCustomMessages,
  mergeSettingsEntries,
  registerCustomModule,
  runCustomStartup,
} from './registry';

const entry = (href: string): SettingsEntry => ({
  labelKey: `${href}.title`,
  descriptionKey: `${href}.description`,
  icon: 'home',
  href,
  group: 'personalization',
});

// Runs before any test registers extra modules, so these assertions describe the
// fork's shipped contributions only.
describe('built-in contributions', () => {
  it('serves the toolbox from the account-free utility shell', () => {
    expect(getCustomPublicUtilityRoutes()).toEqual(['/home/tools']);
  });

  it('places the notification history below transfers and the rest below the pinned folders', () => {
    const items = getCustomNavigationItems();
    const slotOf = (id: string) => items.find((item) => item.id === id)?.slot ?? 'top';

    expect(items.map((item) => item.id)).toEqual(['notifications', 'chat', 'tools']);
    expect(slotOf('notifications')).toBe('top');
    expect(slotOf('chat')).toBe('belowFavorites');
    expect(slotOf('tools')).toBe('belowFavorites');
  });

  it('contributes the window and file-sync settings pages', () => {
    expect(mergeSettingsEntries([]).map((item) => item.href))
      .toEqual(['/home/settings/window', '/home/settings/file-sync', '/home/settings/custom-extensions']);
  });

  it('registers extensions through the feature injection', () => {
    expect(isCustomFeatureEnabled('extensions')).toBe(true);
    expect(getCustomParentRoute('/home/custom-extensions/view')).toBe('/home/overview');
    expect(getCustomParentRoute('/home/files')).toBeUndefined();
  });

  it('titles only the routes it owns', () => {
    expect(getCustomRouteTitle('/home/notifications')).toBe('notifications.title');
    expect(getCustomRouteTitle('/home/chat')).toBe('chat.title');
    expect(getCustomRouteTitle('/home/tools')).toBe('tools.title');
    expect(getCustomRouteTitle('/home/files')).toBeUndefined();
    expect(getCustomRouteTitle('/home/chat/thread')).toBeUndefined();
  });
});

describe('mergeSettingsEntries', () => {
  const base = [entry('/a'), entry('/b'), entry('/c')];

  it('inserts a contribution directly after its anchor', () => {
    registerCustomModule({ id: 'test-anchored', settingsEntries: [{ entry: entry('/fork'), after: '/b' }] });

    const hrefs = mergeSettingsEntries(base).map((item) => item.href);

    expect(hrefs.indexOf('/fork')).toBe(hrefs.indexOf('/b') + 1);
    expect(hrefs.indexOf('/c')).toBeGreaterThan(hrefs.indexOf('/fork'));
  });

  it('appends when the anchor is gone, so an entry is never dropped', () => {
    registerCustomModule({ id: 'test-orphan', settingsEntries: [{ entry: entry('/orphan'), after: '/removed' }] });
    registerCustomModule({ id: 'test-plain', settingsEntries: [{ entry: entry('/plain') }] });

    const hrefs = mergeSettingsEntries(base).map((item) => item.href);

    expect(hrefs).toContain('/orphan');
    expect(hrefs).toContain('/plain');
    expect(hrefs.indexOf('/orphan')).toBeGreaterThan(hrefs.indexOf('/c'));
    expect(hrefs.indexOf('/plain')).toBeGreaterThan(hrefs.indexOf('/c'));
  });

  it('leaves the caller catalogue untouched', () => {
    mergeSettingsEntries(base);

    expect(base.map((item) => item.href)).toEqual(['/a', '/b', '/c']);
  });
});

describe('mergeCustomMessages', () => {
  interface Catalog {
    keep: string;
    nested: { keep: string; replace: string };
    retired: Record<string, string>;
    added?: { title: string };
  }

  const base: Catalog = {
    keep: 'upstream',
    nested: { keep: 'upstream', replace: 'upstream' },
    retired: { note: 'gone in this fork', keep: 'still here' },
  };

  it('overrides leaves without disturbing their siblings', () => {
    registerCustomModule({
      id: 'test-messages',
      messages: {
        en: { nested: { replace: 'fork' }, added: { title: 'Fork only' } },
        zh_CN: { nested: { replace: '分支' }, added: { title: '仅分支' } },
        suppress: ['retired.note'],
      },
    });

    const merged = mergeCustomMessages('en', base);

    expect(merged.keep).toBe('upstream');
    expect(merged.nested).toEqual({ keep: 'upstream', replace: 'fork' });
    expect(merged.added).toEqual({ title: 'Fork only' });
    expect(base.nested.replace).toBe('upstream');
    expect(base).not.toHaveProperty('added');
  });

  it('drops catalog keys the fork retires', () => {
    const merged = mergeCustomMessages('zh_CN', base);

    expect(merged.retired).toEqual({ keep: 'still here' });
    expect(merged.nested.replace).toBe('分支');
  });
});

describe('module lifecycle', () => {
  it('rejects a duplicate module id', () => {
    registerCustomModule({ id: 'test-duplicate' });

    expect(() => registerCustomModule({ id: 'test-duplicate' })).toThrow(/Duplicate custom module id/);
  });

  it('starts modules in registration order and disposes them in reverse', async () => {
    order.length = 0;
    registerCustomModule({
      id: 'test-lifecycle-a',
      startup: () => { order.push('start-a'); },
      dispose: () => { order.push('dispose-a'); },
    });
    registerCustomModule({
      id: 'test-lifecycle-b',
      startup: () => { order.push('start-b'); },
      dispose: () => { order.push('dispose-b'); },
    });

    await runCustomStartup();
    disposeCustomModules();

    const lifecycle = order.filter((step) => /^(start|dispose)-[ab]$/.test(step));
    expect(lifecycle).toEqual(['start-a', 'start-b', 'dispose-b', 'dispose-a']);
  });

  it('runs the fork runtime services during start-up, in order', async () => {
    order.length = 0;

    await runCustomStartup();

    expect(order.indexOf('file-auto-check')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('desktop-shell')).toBeGreaterThan(order.indexOf('file-auto-check'));
  });
});
