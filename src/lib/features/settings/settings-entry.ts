import type { IconName } from '$lib/shared/ui/icons';

export type SettingsPlatformScope = 'all' | 'mobile' | 'desktop';

export type SettingsGroupId =
  | 'personalization'
  | 'accessSecurity'
  | 'dataOperations'
  | 'maintenance';

export interface SettingsEntry {
  labelKey: string;
  descriptionKey: string;
  icon: IconName;
  href: string;
  group: SettingsGroupId;
  scopeKey?: string;
  tone?: 'default' | 'danger';
  requiresAuth?: boolean;
  platformScope?: SettingsPlatformScope;
  feature?: string;
}
