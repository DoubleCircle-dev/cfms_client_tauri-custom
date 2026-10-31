import type { CustomModule } from '../types';

/** Offline puzzle-solving toolbox; reachable without an account. */
export const tools: CustomModule = {
  id: 'tools',
  // The toolbox needs no server and no session, so the utility shell serves it.
  publicUtilityRoutes: ['/home/tools'],
  navigationItems: [
    {
      id: 'tools',
      labelKey: 'tools.title',
      href: '/home/tools',
      icon: 'tools',
      exact: true,
      slot: 'belowFavorites',
    },
  ],
  routeTitles: [{ path: '/home/tools', titleKey: 'tools.title' }],
};
