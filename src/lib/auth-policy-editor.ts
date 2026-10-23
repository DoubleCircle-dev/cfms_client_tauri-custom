import type { AuthPolicy, AuthPolicyReplacement, AuthPolicyStep, AuthPurpose } from './api/types';

export const AUTH_PURPOSES: AuthPurpose[] = ['login', 'mfa', 'escalation'];

/** Send only edited purposes with the revisions from the loaded snapshot. */
export function changedAuthPolicies(
  original: Record<AuthPurpose, AuthPolicy>,
  draft: Record<AuthPurpose, AuthPolicyStep[][]>,
): AuthPolicyReplacement[] {
  return AUTH_PURPOSES.filter((purpose) => JSON.stringify(original[purpose].chains) !== JSON.stringify(draft[purpose]))
    .map((purpose) => ({ purpose, expected_revision: original[purpose].revision, chains: draft[purpose] }));
}
