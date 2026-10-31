// CFMS Client — fork injection registry.
//
// Seam files (upstream files the fork keeps) call the getters below; the actual
// contributions live in `./modules`. Reading a contribution never triggers a
// side effect, so this module can be imported from `settings-entries.ts` or
// `i18n.ts` during their own module evaluation.

import type { SettingsEntry } from '$lib/settings-entries';
import { CUSTOM_MODULES } from './modules/index';
import type {
  CustomModule,
  CustomNavigationItem,
  CustomRouteTitle,
  CustomSettingsEntry,
  MessageCatalog,
} from './types';

export type CustomMessageLocale = 'en' | 'zh_CN';

const modules: CustomModule[] = [...CUSTOM_MODULES];

/**
 * Adds a module after the built-in ones. Reserved for runtime registration
 * (tests, and any future plugin host); feature code belongs in `./modules`.
 */
export function registerCustomModule(module: CustomModule): void {
  if (modules.some((existing) => existing.id === module.id)) {
    throw new Error(`Duplicate custom module id: ${module.id}`);
  }
  modules.push(module);
}

export function getCustomModules(): readonly CustomModule[] {
  return modules;
}

export function getCustomSettingsEntries(): CustomSettingsEntry[] {
  return modules.flatMap((module) => [...(module.settingsEntries ?? [])]);
}

/**
 * Splices the fork's settings entries into the upstream catalog.
 *
 * A contribution names the entry it follows, so the resulting order matches
 * what the settings page had before the entries moved out of the catalog.
 */
export function mergeSettingsEntries(base: readonly SettingsEntry[]): SettingsEntry[] {
  const merged = [...base];
  for (const { entry, after } of getCustomSettingsEntries()) {
    const anchor = after ? merged.findIndex((candidate) => candidate.href === after) : -1;
    if (anchor === -1) merged.push(entry);
    else merged.splice(anchor + 1, 0, entry);
  }
  return merged;
}

export function getCustomPublicUtilityRoutes(): string[] {
  return modules.flatMap((module) => [...(module.publicUtilityRoutes ?? [])]);
}

export function getCustomNavigationItems(): CustomNavigationItem[] {
  return modules.flatMap((module) => [...(module.navigationItems ?? [])]);
}

/** Title translation key for an exact pathname, or `undefined` when unclaimed. */
export function getCustomRouteTitle(pathname: string): string | undefined {
  for (const module of modules) {
    const match = module.routeTitles?.find((title) => title.path === pathname);
    if (match) return match.titleKey;
  }
  return undefined;
}

function isCatalog(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeCatalog(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = merged[key];
    merged[key] = isCatalog(value) && isCatalog(current)
      ? mergeCatalog(current, value)
      : value;
  }
  return merged;
}

function suppressKey(catalog: Record<string, unknown>, dottedPath: string): void {
  const parts = dottedPath.split('.');
  let node: Record<string, unknown> = catalog;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (!isCatalog(next)) return;
    node = next;
  }
  delete node[parts[parts.length - 1]];
}

/**
 * Layers the fork's strings over a base catalog.
 *
 * The base catalogs stay byte-identical to upstream, so an upstream release
 * never conflicts with a fork string. Overrides win per leaf; `suppress` drops
 * base keys the fork retires.
 */
export function mergeCustomMessages<T>(locale: CustomMessageLocale, base: T): T {
  let merged = base as unknown as Record<string, unknown>;
  for (const module of modules) {
    const overlay = module.messages?.[locale];
    if (!overlay) continue;
    merged = mergeCatalog(merged, overlay as Record<string, unknown>);
  }
  for (const module of modules) {
    for (const key of module.messages?.suppress ?? []) suppressKey(merged, key);
  }
  return merged as T;
}

/** Runs every module's start-up hook in registration order. */
export async function runCustomStartup(): Promise<void> {
  for (const module of modules) {
    await module.startup?.();
  }
}

/** Runs every module's dispose hook in reverse registration order. */
export function disposeCustomModules(): void {
  for (const module of [...modules].reverse()) {
    const result = module.dispose?.();
    if (result instanceof Promise) {
      void result.catch((error: unknown) => {
        console.warn(`[cfms] Custom module "${module.id}" failed to dispose.`, error);
      });
    }
  }
}

/** Re-exported so seam files can type their inputs without reaching into `./types`. */
export type {
  CustomModule,
  CustomNavigationItem,
  CustomRouteTitle,
  CustomSettingsEntry,
  MessageCatalog,
};
