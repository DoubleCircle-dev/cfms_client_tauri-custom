import type { CustomModule } from '../types';

/** Close-button policy and system tray settings page. */
export const desktopShell: CustomModule = {
  id: 'desktop-shell',
  settingsEntries: [
    {
      // Device-scoped, so it is reachable before signing in and never synced
      // with the account.
      entry: {
        labelKey: 'settings.window.title',
        descriptionKey: 'settings.window.description',
        icon: 'window',
        href: '/home/settings/window',
        group: 'personalization',
        requiresAuth: false,
        platformScope: 'desktop',
      },
      after: '/home/settings/behavior',
    },
  ],
};
