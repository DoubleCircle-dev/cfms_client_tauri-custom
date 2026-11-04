import assert from 'node:assert/strict';
import test from 'node:test';

import { isVersionLine, resolveConflicts } from './git-merge-version.mjs';

test('recognises the version lines of every driven manifest', () => {
  assert.equal(isVersionLine('version = "0.58.0"'), true);
  assert.equal(isVersionLine('  "version": "0.58.0",'), true);
  assert.equal(isVersionLine('\t<string>58000</string>'), true);
  assert.equal(isVersionLine('version = { workspace = true }'), false);
  assert.equal(isVersionLine('<string>CFMS Client</string>'), false);
});

test('keeps the Custom version when only the version line conflicts', () => {
  const merged = [
    '{',
    '  "name": "x",',
    '<<<<<<< custom',
    '  "version": "0.57.0-custom-0.3",',
    '=======',
    '  "version": "0.58.0",',
    '>>>>>>> upstream',
    '  "scripts": {',
    '    "check": "svelte-check"',
    '  }',
    '}',
  ].join('\n');

  const outcome = resolveConflicts(merged);

  assert.equal(outcome.resolved, 1);
  assert.equal(outcome.unresolved, 0);
  assert.match(outcome.text, /"version": "0\.57\.0-custom-0\.3",/);
  assert.match(outcome.text, /"check": "svelte-check"/);
  assert.doesNotMatch(outcome.text, /<<<<<<<|=======|>>>>>>>/);
});

test('resolves every workspace version in a Cargo.lock block', () => {
  const merged = [
    '[[package]]',
    'name = "cfms-client"',
    '<<<<<<< custom',
    'version = "0.57.0-custom-0.3"',
    '=======',
    'version = "0.58.0"',
    '>>>>>>> upstream',
    '[[package]]',
    'name = "cfms-core"',
    '<<<<<<< custom',
    'version = "0.57.0-custom-0.3"',
    '=======',
    'version = "0.58.0"',
    '>>>>>>> upstream',
  ].join('\n');

  const outcome = resolveConflicts(merged);

  assert.equal(outcome.resolved, 2);
  assert.equal(
    outcome.text.match(/version = "0\.57\.0-custom-0\.3"/g)?.length,
    2,
  );
});

test('leaves conflicts that are more than a version bump untouched', () => {
  const merged = [
    '<<<<<<< custom',
    'version = "0.57.0-custom-0.3"',
    'edition = "2021"',
    '=======',
    'version = "0.58.0"',
    'edition = "2024"',
    'wasmi = "2"',
    '>>>>>>> upstream',
  ].join('\n');

  const outcome = resolveConflicts(merged);

  assert.equal(outcome.resolved, 0);
  assert.equal(outcome.unresolved, 1);
  assert.equal(outcome.text, merged);
});

test('merges resolved and unresolved blocks in the same file', () => {
  const merged = [
    '<<<<<<< custom',
    'version = "0.57.0-custom-0.3"',
    '=======',
    'version = "0.58.0"',
    '>>>>>>> upstream',
    'tray = "2"',
    '<<<<<<< custom',
    'edition = "2021"',
    '=======',
    'edition = "2024"',
    '>>>>>>> upstream',
  ].join('\n');

  const outcome = resolveConflicts(merged);

  assert.equal(outcome.resolved, 1);
  assert.equal(outcome.unresolved, 1);
  assert.match(outcome.text, /^version = "0\.57\.0-custom-0\.3"\ntray = "2"\n<<<<<<< custom/);
});
