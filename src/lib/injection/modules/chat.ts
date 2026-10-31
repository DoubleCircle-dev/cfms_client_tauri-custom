import type { CustomModule } from '../types';

/** Server chatbox reader and simulated message composer. */
export const chat: CustomModule = {
  id: 'chat',
  navigationItems: [
    {
      id: 'chat',
      labelKey: 'chat.title',
      href: '/home/chat',
      icon: 'chat',
      exact: true,
      slot: 'belowFavorites',
    },
  ],
  routeTitles: [{ path: '/home/chat', titleKey: 'chat.title' }],
};
