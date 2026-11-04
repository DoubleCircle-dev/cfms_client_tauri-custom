import { MAINTAINER_EXTENSION_KEY_ID } from '$lib/injection/modules/extensions/api';

export type ExtensionTrustLevel = 'bundled' | 'maintainer' | 'third_party' | 'unknown';

export function classifyExtensionTrust(
  signingKeyId: string | null | undefined,
  bundled = false,
): ExtensionTrustLevel {
  if (bundled) return 'bundled';
  if (!signingKeyId) return 'unknown';
  return signingKeyId === MAINTAINER_EXTENSION_KEY_ID ? 'maintainer' : 'third_party';
}

export function canAutoUpdateExtension(
  installedKeyId: string | null | undefined,
  candidateKeyId: string,
): boolean {
  return classifyExtensionTrust(installedKeyId) === 'maintainer'
    && classifyExtensionTrust(candidateKeyId) === 'maintainer';
}
