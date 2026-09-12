import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { addMessages, init, locale, _ as t } from 'svelte-i18n';
import { en } from './i18n/messages/en';
import { zh_CN as zhCN } from './i18n/messages/zh-CN';

/**
 * The wording a check produces has to follow the active language and read
 * correctly for one file and for several.
 *
 * The summaries used to be *stored* as finished sentences — `2 file(s) need
 * update` — so they were English whatever the interface language, and wrong for
 * any count. They are counts now, and this is where they become prose.
 */
beforeAll(() => {
  addMessages('en', en);
  addMessages('zh-CN', zhCN);
  init({ fallbackLocale: 'en', initialLocale: 'en' });
});

function render(key: string, values: Record<string, number>): string {
  return get(t)(key, { values });
}

describe('check history wording', () => {
  it('agrees with the count in English', () => {
    locale.set('en');
    expect(render('files.checkHistoryUpdates', { count: 1 })).toBe('1 file needs update');
    expect(render('files.checkHistoryUpdates', { count: 2 })).toBe('2 files need update');
    expect(render('files.checkHistoryScope', { dirs: 1, docs: 1 })).toBe('1 folder, 1 document');
    expect(render('files.checkHistoryScope', { dirs: 2, docs: 8 })).toBe('2 folders, 8 documents');
    expect(render('files.checkHistoryBadgeChanges', { count: 1 })).toBe('1 change');
    expect(render('files.checkHistoryBadgeChanges', { count: 3 })).toBe('3 changes');
  });

  it('reads naturally in Chinese, where the count never changes the noun', () => {
    locale.set('zh-CN');
    expect(render('files.checkHistoryUpdates', { count: 1 })).toBe('1 个文件需要更新');
    expect(render('files.checkHistoryUpdates', { count: 2 })).toBe('2 个文件需要更新');
    expect(render('files.checkHistoryScope', { dirs: 2, docs: 8 })).toBe('2 个子目录，8 个文档');
  });

  it('names every kind of change the snapshot diff can report', () => {
    locale.set('en');
    expect(render('files.serverChangesNewFiles', { count: 1 })).toBe('1 new file');
    expect(render('files.serverChangesModifiedFiles', { count: 2 })).toBe('2 modified files');
    expect(render('files.serverChangesDeletedFolders', { count: 3 })).toBe('3 deleted folders');
  });

  it('reads correctly in the sync prompts too', () => {
    locale.set('en');
    expect(render('files.syncOverwriteMessage', { count: 1 }))
      .toContain('1 local file differs');
    expect(render('files.syncOverwriteMessage', { count: 2 }))
      .toContain('2 local files differ');
    expect(render('files.syncAllDenied', { count: 1 })).toContain('refused 1 file (');
    expect(render('files.syncAllDenied', { count: 2 })).toContain('refused 2 files (');
    expect(render('files.syncDeleteMessage', { count: 1 })).toContain('Delete the local copy?');
    expect(render('files.syncDeleteMessage', { count: 2 })).toContain('Delete the local copies?');
  });

  it('has the same keys in both languages', () => {
    const keys = (value: unknown, prefix = ''): string[] => {
      if (typeof value !== 'object' || value === null) return [prefix];
      return Object.entries(value).flatMap(([key, child]) =>
        keys(child, prefix ? `${prefix}.${key}` : key));
    };
    const enKeys = keys(en).sort();
    const zhKeys = keys(zhCN).sort();

    expect(zhKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
    expect(enKeys.filter((key) => !zhKeys.includes(key))).toEqual([]);
  });
});
