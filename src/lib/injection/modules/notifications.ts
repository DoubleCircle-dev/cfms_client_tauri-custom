import type { CustomModule } from '../types';

/** Session-scoped notification history page. */
export const notificationsCenter: CustomModule = {
  id: 'notifications',
  navigationItems: [
    {
      // Sits directly below transfers in the primary list.
      id: 'notifications',
      labelKey: 'notifications.title',
      href: '/home/notifications',
      icon: 'history',
      exact: true,
      slot: 'top',
    },
  ],
  routeTitles: [{ path: '/home/notifications', titleKey: 'notifications.title' }],
};
