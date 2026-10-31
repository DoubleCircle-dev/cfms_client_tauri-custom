import type { CustomModule } from '../types';

/** File-sync policy page (check interval, update queue, Git tracking). */
export const fileSync: CustomModule = {
  id: 'file-sync',
  settingsEntries: [
    {
      entry: {
        labelKey: 'settings.fileSync.title',
        descriptionKey: 'settings.fileSync.description',
        icon: 'update',
        href: '/home/settings/file-sync',
        group: 'dataOperations',
        scopeKey: 'settings.overview.scope.accountDevice',
        requiresAuth: true,
      },
      after: '/home/settings/window',
    },
  ],
};
