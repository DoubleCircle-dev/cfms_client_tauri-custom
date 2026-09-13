/**
 * Explaining a refused operation.
 *
 * "Access denied" is the one message a user cannot act on: it does not say
 * which capability was refused, whether the account is missing a grant, or
 * whether a rule on this particular document is what stopped them. This module
 * turns the evidence the client actually holds into something answerable.
 *
 * Two sources are kept apart on purpose:
 *
 *  - the account's own permission names, which the UI already gates its
 *    buttons on (`hasPermission('delete_document')` and friends);
 *  - whatever the server answered at the moment it refused, which is the only
 *    source that knows about per-object access rules.
 *
 * A capability is therefore reported as granted only when a covering
 * permission is really held, as denied when the server just refused it, and as
 * unverified when the client has no evidence either way. Guessing would be
 * worse than saying nothing: a user sent to an administrator to request a
 * permission they already hold wastes everyone's time, and a user told they
 * "lack download_document" when that name does not even exist on the server
 * learns to distrust the panel.
 */

/** An operation a document or directory can allow or refuse. */
export type Capability = 'view' | 'download' | 'modify' | 'delete';

/**
 * Permission names that grant each capability, restricted to the vocabulary
 * this client verifies itself.
 *
 * The names are the server's own (`Permissions` in cfms_on_websocket), so a
 * row that reads "granted" really does mean the account holds the permission
 * the server checks.
 *
 * Downloads are missing on purpose: the server gates them on the *object's*
 * access rules rather than on an account-level permission, so there is no name
 * to list. See {@link CAPABILITY_ACCESS_TYPES}.
 */
const CAPABILITY_PERMISSIONS: Record<Capability, readonly string[]> = {
  view: ['view_metadata', 'list_revisions'],
  download: [],
  modify: ['rename_document', 'rename_directory', 'move', 'set_metadata_tags'],
  delete: ['delete_document', 'delete_directory'],
};

/**
 * The access type the server evaluates on the object itself.
 *
 * `check_access_requirements(user, access_type)` accepts `read`, `write`,
 * `move` and `manage`, and the handlers pass `read` for fetching a document's
 * bytes and for listing a directory. Only the mappings that were read out of
 * the server are listed; a capability without one is described by its account
 * permissions alone rather than by a guess.
 */
const CAPABILITY_ACCESS_TYPES: Partial<Record<Capability, ServerAccessType>> = {
  view: 'read',
  download: 'read',
};

export type ServerAccessType = 'read' | 'write' | 'move' | 'manage';

/**
 * Why the server refused, as far as its wording says.
 *
 * The server answers an access-rule refusal with "Access denied" and a missing
 * account permission with "Permission denied" (`conclude_access_denial` versus
 * `conclude_permission_denial`), so the two are distinguishable without
 * guessing — and they send the user to different places: one to whoever owns
 * the object's rules, the other to whoever grants account permissions.
 */
export type DenialKind = 'object-rule' | 'account-permission' | 'unknown';

export const CAPABILITIES: readonly Capability[] = ['view', 'download', 'modify', 'delete'];

export interface CapabilityRow {
  capability: Capability;
  /** The object access type this capability is evaluated against, when known. */
  accessType: ServerAccessType | null;
  /** Permission names the client verifies for this capability. */
  permissions: readonly string[];
  /** Those names the account holds. */
  granted: readonly string[];
  /** Those names the account does not hold. */
  missing: readonly string[];
  /**
   * `denied` for the capability the server refused, `granted` when a covering
   * permission is held, `unverified` otherwise.
   */
  state: 'granted' | 'denied' | 'unverified';
}

export interface PermissionExplanation {
  /** The capability the server refused. */
  refused: Capability;
  rows: CapabilityRow[];
  /** Groups the signed-in account belongs to. */
  groups: readonly string[];
  /**
   * True when the account holds a permission covering the refused capability
   * and the server refused it anyway — which points at an access rule on the
   * object rather than at the account's grants.
   */
  blockedByObjectRule: boolean;
  /** Permission names reported missing by the server itself, when it named any. */
  serverMissing: readonly string[];
  /** Which gate refused: the object's access rules, the account's permissions, or unknown. */
  denialKind: DenialKind;
  /** The server's own wording, stripped of transport metadata. */
  serverMessage: string | null;
}

/** Permission names that would cover `capability`. */
export function permissionsFor(capability: Capability): readonly string[] {
  return CAPABILITY_PERMISSIONS[capability];
}

/** The object access type for `capability`, when the client knows it. */
export function accessTypeFor(capability: Capability): ServerAccessType | null {
  return CAPABILITY_ACCESS_TYPES[capability] ?? null;
}

/** Classify a refusal from the wording the server used. */
export function denialKindFromMessage(message: string | null | undefined): DenialKind {
  const text = (message ?? '').toLowerCase();
  if (/\bpermission denied\b/.test(text)) return 'account-permission';
  if (/\baccess denied\b/.test(text)) return 'object-rule';
  return 'unknown';
}

/**
 * Keys the server has used, or plausibly uses, to name a missing permission in
 * the structured payload of a refusal. Reading a few candidates keeps the
 * panel working against servers that phrase it differently; an absent payload
 * simply leaves the list empty.
 */
const MISSING_PERMISSION_KEYS = [
  'missing_permissions',
  'required_permissions',
  'missing_permission',
  'required_permission',
];

/** Pull whatever permission names a refusal payload happens to contain. */
export function missingPermissionsFromPayload(
  payload: Record<string, unknown> | null | undefined,
): string[] {
  if (!payload) return [];
  const found: string[] = [];
  for (const key of MISSING_PERMISSION_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      found.push(value.trim());
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) found.push(item.trim());
      }
    }
  }
  return [...new Set(found)];
}

export interface ExplainDenialInput {
  /** The capability the server refused. */
  capability: Capability;
  /** The account's effective permission names. */
  permissions: readonly string[];
  /** The account's groups, for the permission-source section. */
  groups?: readonly string[];
  /** Structured data the server attached to its refusal, when there was any. */
  serverPayload?: Record<string, unknown> | null;
  /** The server's own wording, when there was any. */
  serverMessage?: string | null;
}

/**
 * Build the explanation for one refusal.
 *
 * `manage_system` is treated as covering everything, matching the shortcut the
 * file workspace already applies when it gates its own buttons.
 */
export function explainPermissionDenial({
  capability,
  permissions,
  groups = [],
  serverPayload = null,
  serverMessage = null,
}: ExplainDenialInput): PermissionExplanation {
  const held = new Set(permissions);
  const unrestricted = held.has('manage_system');

  const rows = CAPABILITIES.map((current): CapabilityRow => {
    const names = CAPABILITY_PERMISSIONS[current];
    const granted = names.filter((name) => held.has(name));
    const missing = names.filter((name) => !held.has(name));
    const state: CapabilityRow['state'] = current === capability
      ? 'denied'
      : granted.length > 0 || (unrestricted && names.length > 0)
        ? 'granted'
        : 'unverified';
    return {
      capability: current,
      accessType: CAPABILITY_ACCESS_TYPES[current] ?? null,
      permissions: names,
      granted,
      missing,
      state,
    };
  });

  const refusedRow = rows.find((row) => row.capability === capability);
  const coversRefusal = unrestricted || (refusedRow?.granted.length ?? 0) > 0;

  return {
    refused: capability,
    rows,
    groups: [...groups],
    // A refusal that contradicts a permission we can see is the interesting
    // case: the object's own rule is doing the blocking, not the account.
    blockedByObjectRule: coversRefusal,
    serverMissing: missingPermissionsFromPayload(serverPayload),
    denialKind: denialKindFromMessage(serverMessage),
    serverMessage: serverMessage?.trim() ? serverMessage.trim() : null,
  };
}
