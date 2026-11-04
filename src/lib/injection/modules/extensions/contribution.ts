import type { CustomModule } from '../../types';

export const extensions: CustomModule = {
  id: 'extensions',
  features: ['extensions'],
  parentRoutes: [
    { path: '/home/custom-extensions/view', parent: '/home/overview' },
  ],
  settingsEntries: [
    {
      entry: {
        labelKey: 'settings.extensions.title',
        descriptionKey: 'settings.extensions.description',
        icon: 'extensions',
        href: '/home/settings/custom-extensions',
        group: 'maintenance',
        feature: 'extensions',
      },
      after: '/home/settings/data',
    },
  ],
};
