import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectSourceFacts,
  extractFluentCatalogKeys,
  extractTypeScriptCatalogKeys,
  isTranslationKeyUsed,
} from './check-unused-i18n.mjs';

test('extracts leaf keys from a TypeScript translation object', () => {
  const keys = extractTypeScriptCatalogKeys(`
    export const en = {
      common: { save: 'Save', cancel: 'Cancel' },
      title: 'Title',
    } as const;
  `, 'en');

  assert.deepEqual([...keys].sort(), ['common.cancel', 'common.save', 'title']);
});

test('extracts Fluent message and term identifiers', () => {
  const keys = extractFluentCatalogKeys(`
message = Message
-brand = Brand
  .attribute = ignored
`);

  assert.deepEqual([...keys].sort(), ['-brand', 'message']);
});

test('recognizes exact and resolvable template-literal usages', () => {
  const facts = collectSourceFacts([
    `translate('common.save'); const channels = ['stable', 'beta'];`,
    'translate(`settings.updates.${channel}Description`);',
  ]);

  assert.equal(isTranslationKeyUsed('common.save', facts), true);
  assert.equal(isTranslationKeyUsed('common.cancel', facts), false);
  assert.equal(isTranslationKeyUsed('settings.updates.stableDescription', facts), true);
  assert.equal(isTranslationKeyUsed('settings.updates.alphaDescription', facts), false);
});

test('recognizes concatenated keys in conditional expressions', () => {
  const facts = collectSourceFacts([
    "translate(scanning ? 'files.batchRules.scanDenied' : 'files.batchRules.problem.' + problem.kind);",
    "const kinds = ['denied', 'missing'];",
    "translate('files.batchRules.item.' + (busy ? 'working' : item.status));",
    "const statuses = ['success', 'failed'];",
  ]);

  assert.equal(isTranslationKeyUsed('files.batchRules.scanDenied', facts), true);
  assert.equal(isTranslationKeyUsed('files.batchRules.problem.denied', facts), true);
  assert.equal(isTranslationKeyUsed('files.batchRules.problem.missing', facts), true);
  assert.equal(isTranslationKeyUsed('files.batchRules.problem.unused', facts), false);
  assert.equal(isTranslationKeyUsed('files.batchRules.item.working', facts), true);
  assert.equal(isTranslationKeyUsed('files.batchRules.item.success', facts), true);
});

test('recognizes frontend translation keys returned by Rust', () => {
  const facts = collectSourceFacts([
    'return Err("publicKey.storageUnavailable".into());',
  ]);

  assert.equal(isTranslationKeyUsed('publicKey.storageUnavailable', facts), true);
  assert.equal(isTranslationKeyUsed('publicKey.unused', facts), false);
});
