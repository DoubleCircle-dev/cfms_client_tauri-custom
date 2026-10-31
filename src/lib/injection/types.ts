// CFMS Client — fork injection contract.
//
// Everything the fork adds to upstream code is registered here instead of being
// written into upstream files. A contribution point is the only change a seam
// file needs: upstream files keep one stable line, and the fork's own modules
// live in `./modules` where upstream merges never reach them.
//
// Rules for a module:
//   * Data (`messages`, `settingsEntries`, `navigationItems`, `routeTitles`,
//     `publicUtilityRoutes`) must be inert — plain values, no side effects, so
//     seam files can read them during module evaluation.
//   * Behaviour (`startup`, `dispose`) may import feature code, but only
//     through a dynamic `import()` inside the hook. Keeping the module graph
//     inert is what lets `settings-entries.ts` and `i18n.ts` depend on the
//     registry without pulling in the whole fork.

import type { IconName } from '$lib/icons';
import type { SettingsEntry } from '$lib/settings-entries';

/** Nested translation catalog mirroring the base catalogs' shape. */
export interface MessageCatalog {
  readonly [key: string]: string | MessageCatalog;
}

export interface CustomMessages {
  en?: MessageCatalog;
  zh_CN?: MessageCatalog;
  /** Base-catalog keys the fork retires, as dotted paths. */
  suppress?: readonly string[];
}

/** An extra settings entry, with the ordering the catalog needs. */
export interface CustomSettingsEntry {
  entry: SettingsEntry;
  /**
   * `href` of the catalog entry this one follows. Entries are appended when
   * the anchor is absent, so a newer upstream release never drops a fork entry.
   */
  after?: string;
}

/** An extra workspace-navigation destination. */export interface CustomNavigationItem {
  /** Unique across every module; also the `{#each}` key. */
  id: string;
  /** Translation key, resolved by the workspace layout. */
  labelKey: string;
  href: string;
  icon: IconName;
  /** Exact-path matching. Defaults to `true`, matching fork routes. */
  exact?: boolean;
  /** Hidden while signed out. Defaults to `true`. */
  requiresAuth?: boolean;
  /**
   * Where the item renders. `top` joins the primary workspace links;
   * `belowFavorites` renders under the pinned folders, below the sidebar's
   * scrolling list.
   */
  slot?: 'top' | 'belowFavorites';
}

/** Title shown in the workspace header for one exact route. */
export interface CustomRouteTitle {
  path: string;
  titleKey: string;
}

/** One unit of fork functionality. */
export interface CustomModule {
  /** Unique, stable identifier used for diagnostics and tests. */
  id: string;
  messages?: CustomMessages;
  settingsEntries?: readonly CustomSettingsEntry[];
  /** Extra paths served by the account-free utility shell. */
  publicUtilityRoutes?: readonly string[];
  navigationItems?: readonly CustomNavigationItem[];
  routeTitles?: readonly CustomRouteTitle[];
  /** Runs once during root-layout start-up, in registration order. */
  startup?: () => void | Promise<void>;
  /** Runs when the root layout unmounts, in reverse registration order. */
  dispose?: () => void | Promise<void>;
}
