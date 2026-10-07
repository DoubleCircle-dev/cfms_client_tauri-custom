import { normalizeAccessRules, type AccessRulesRecord } from '$lib/access-rules';
import { batchRulesTargetKey, type BatchRulesTarget } from './batch-access-rules';

/** Ignore JSON formatting and property order when comparing an editor baseline. */
export function accessRulesDraftFingerprint(rules: AccessRulesRecord, inherit: boolean): string {
  return JSON.stringify(canonical({ rules: normalizeAccessRules(rules), inherit }));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Explorer uses folder: keys; the rules API uses directory: keys. */
export function accessRulesTemplateKey(targets: BatchRulesTarget[], focusedItemKey: string | null): string {
  const focusedKey = focusedItemKey?.replace(/^folder:/, 'directory:');
  const focused = targets.find((target) => batchRulesTargetKey(target) === focusedKey);
  return batchRulesTargetKey(focused ?? targets[0]);
}
