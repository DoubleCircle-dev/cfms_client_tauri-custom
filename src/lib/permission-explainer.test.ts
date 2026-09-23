import { describe, expect, it } from 'vitest';
import {
  explainPermissionDenial,
  missingPermissionsFromPayload,
  permissionsFor,
} from './permission-explainer';

describe('permission explainer', () => {
  it('reports the refused capability as denied', () => {
    const explanation = explainPermissionDenial({
      capability: 'download',
      permissions: ['view_metadata'],
    });

    expect(explanation.refused).toBe('download');
    const refused = explanation.rows.find((row) => row.capability === 'download');
    expect(refused?.state).toBe('denied');
    expect(explanation.rows).toHaveLength(4);
  });

  it('separates held permissions from missing ones', () => {
    const explanation = explainPermissionDenial({
      capability: 'delete',
      permissions: ['view_metadata', 'delete_document', 'rename_document'],
    });
    const view = explanation.rows.find((row) => row.capability === 'view');
    const modify = explanation.rows.find((row) => row.capability === 'modify');
    const remove = explanation.rows.find((row) => row.capability === 'delete');

    expect(view?.state).toBe('granted');
    expect(view?.granted).toEqual(['view_metadata']);
    expect(view?.missing).toEqual(['list_revisions']);
    expect(modify?.granted).toContain('rename_document');
    expect(remove?.state).toBe('denied');
    expect(remove?.missing).toEqual(['delete_directory']);
  });

  it('does not claim a capability it has no evidence for', () => {
    const explanation = explainPermissionDenial({
      capability: 'delete',
      permissions: [],
    });
    const download = explanation.rows.find((row) => row.capability === 'download');

    // Nothing covers downloads client-side, and it was not the refused one.
    expect(download?.state).toBe('unverified');
    expect(download?.granted).toEqual([]);
    expect(permissionsFor('download')).toEqual([]);
  });

  it('treats the refusal of a permission the account holds as an object rule', () => {
    const covered = explainPermissionDenial({
      capability: 'delete',
      permissions: ['delete_document'],
    });
    expect(covered.blockedByObjectRule).toBe(true);

    const uncovered = explainPermissionDenial({
      capability: 'delete',
      permissions: ['view_metadata'],
    });
    expect(uncovered.blockedByObjectRule).toBe(false);

    // manage_system is accepted as covering everything, like the file
    // workspace already does when it gates its own buttons.
    const administrator = explainPermissionDenial({
      capability: 'download',
      permissions: ['manage_system'],
    });
    expect(administrator.blockedByObjectRule).toBe(true);
  });

  it('carries the groups and the server wording through', () => {
    const explanation = explainPermissionDenial({
      capability: 'view',
      permissions: [],
      groups: ['Research Group'],
      serverMessage: '  permission denied  ',
    });

    expect(explanation.groups).toEqual(['Research Group']);
    expect(explanation.serverMessage).toBe('permission denied');
    expect(
      explainPermissionDenial({
        capability: 'view',
        permissions: [],
        serverMessage: '   ',
      }).serverMessage,
    ).toBeNull();
  });
});

describe('missing permission payloads', () => {
  it('reads single names, lists, and both spellings', () => {
    expect(missingPermissionsFromPayload({ missing_permission: 'download_document' }))
      .toEqual(['download_document']);
    expect(
      missingPermissionsFromPayload({
        required_permissions: ['read_document', 'download_document'],
      }),
    ).toEqual(['read_document', 'download_document']);
  });

  it('ignores payloads that name nothing and drops duplicates', () => {
    expect(missingPermissionsFromPayload(null)).toEqual([]);
    expect(missingPermissionsFromPayload({})).toEqual([]);
    expect(missingPermissionsFromPayload({ reason: 'denied' })).toEqual([]);
    expect(
      missingPermissionsFromPayload({
        missing_permissions: ['download_document'],
        required_permission: 'download_document',
      }),
    ).toEqual(['download_document']);
  });
});
