import { describe, expect, it } from 'vitest';
import { canAutoUpdateExtension, classifyExtensionTrust } from './trust';

describe('extension trust classification', () => {
  it('distinguishes bundled, maintainer, third-party, and missing signing identities', () => {
    expect(classifyExtensionTrust(null, true)).toBe('bundled');
    expect(classifyExtensionTrust('cfms-plugin')).toBe('maintainer');
    expect(classifyExtensionTrust('trusted-community')).toBe('third_party');
    expect(classifyExtensionTrust(null)).toBe('unknown');
  });

  it('allows automatic updates only when both versions use the maintainer key', () => {
    expect(canAutoUpdateExtension('cfms-plugin', 'cfms-plugin')).toBe(true);
    expect(canAutoUpdateExtension('trusted-community', 'trusted-community')).toBe(false);
    expect(canAutoUpdateExtension('cfms-plugin', 'trusted-community')).toBe(false);
    expect(canAutoUpdateExtension(null, 'cfms-plugin')).toBe(false);
  });
});
