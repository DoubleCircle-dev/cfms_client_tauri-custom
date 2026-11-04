import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeCustomMessages } from './injection/registry';
import { en } from './i18n/messages/en';
import { zh_CN as zhCN } from './i18n/messages/zh-CN';

const catalogs = {
  en: mergeCustomMessages('en', en) as Record<string, unknown>,
  zh_CN: mergeCustomMessages('zh_CN', zhCN) as Record<string, unknown>,
};

const sourceRoot = path.resolve(__dirname, '..');
// Deliberately narrow: a dotted literal is only treated as a translation key
// when it sits in a rendering position. Capability identifiers such as
// `files.metadata.read` and command ids such as `files.back` share the dotted
// shape but are not translated.
const keyPatterns = [
  /\$t\(\s*['"]([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)['"]/g,
  /(?:labelKey|descriptionKey|titleKey|scopeKey):\s*['"]([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)['"]/g,
  // Keys stored as data, e.g. the capability-label map on the extensions page.
  /:\s*['"](settings(?:\.[A-Za-z0-9_]+)+)['"]/g,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|svelte)$/.test(entry) && !/\.test\.ts$/.test(entry) ? [full] : [];
  });
}

function literalKeys(): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const file of sourceFiles(sourceRoot)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of keyPatterns) {
      for (const match of text.matchAll(pattern)) {
        const key = match[1];
        const locations = keys.get(key) ?? [];
        locations.push(path.relative(sourceRoot, file));
        keys.set(key, locations);
      }
    }
  }
  return keys;
}

function hasKey(catalog: Record<string, unknown>, key: string): boolean {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

describe('translation key coverage', () => {
  it('resolves every literal key the app renders in both catalogs', () => {
    const missing: string[] = [];
    for (const [key, locations] of literalKeys()) {
      for (const locale of ['en', 'zh_CN'] as const) {
        if (!hasKey(catalogs[locale], key)) {
          missing.push(`${locale}: ${key} (${[...new Set(locations)].join(', ')})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
