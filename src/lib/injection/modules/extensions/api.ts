import { invoke } from '@tauri-apps/api/core';

export const DECLARATIVE_HOST_API_VERSION = '1.0.0';
export const WASM_HOST_API_VERSION = 'api-custom-v2';
export const MAINTAINER_EXTENSION_KEY_ID = 'cfms-plugin';

export type ExtensionCapability =
  | 'files.metadata.read'
  | 'files.list'
  | 'files.search'
  | 'files.updates.check'
  | 'files.sync.full'
  | 'tasks.read'
  | 'transfers.download.enqueue'
  | 'account.summary.read'
  | 'preferences.read'
  | 'preferences.write'
  | 'events.subscribe'
  | 'ui.confirm'
  | 'ui.notify';

export type ExtensionBackgroundTrigger =
  | { type: 'on_enable'; workflow: string }
  | { type: 'on_login'; workflow: string }
  | { type: 'interval'; workflow: string; minutes: number }
  | { type: 'event'; workflow: string; event: string };

export interface ExtensionNavigationEntry {
  id: string;
  label: string;
  icon: string;
  page: string;
}

export interface ExtensionManifest {
  schema_version: number;
  id: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  host_api: string;
  min_client_version: string;
  platforms: string[];
  entrypoints: {
    navigation: ExtensionNavigationEntry[];
    settings: Array<{ id: string; label: string; page: string }>;
    workflows: Array<{ id: string; label: string; workflow: string }>;
  };
  requested_capabilities: ExtensionCapability[];
  background_triggers: ExtensionBackgroundTrigger[];
  content_hashes: Record<string, string>;
  runtime?: { kind: 'wasm'; module: string };
}

export interface ExtensionInstallation {
  manifest: ExtensionManifest;
  package_digest: string;
  signing_key_id: string | null;
  install_epoch: string;
  state: 'installed' | 'error' | 'suspended' | string;
  installed_at: number;
  previous_version: string | null;
  last_error: string | null;
  disk_bytes: number;
}

export interface ExtensionAccountState {
  enabled: boolean;
  installEpoch: string;
  grantedCapabilities: ExtensionCapability[];
  settings: unknown;
  staleInstallation: boolean;
}

export interface CatalogExtension {
  manifest: ExtensionManifest;
  download_url: string;
  sha256: string;
  signature: string;
  key_id: string;
  revoked: boolean;
  revocation_reason: string | null;
}

export interface ExtensionCatalog {
  schema_version: number;
  generated_at: number;
  extensions: CatalogExtension[];
}

export interface ExtensionOverview {
  installed: ExtensionInstallation[];
  accountStates: Record<string, ExtensionAccountState>;
  catalog: ExtensionCatalog | null;
  trustedKeysConfigured: boolean;
  hostApiVersion: string;
  supportedHostApiVersions: string[];
}

export interface DeclarativePage {
  schema_version: number;
  title: string;
  description?: string;
  class_name?: string;
  styles?: DeclarativeStyleRule[];
  blocks: DeclarativeBlock[];
}

export interface DeclarativeStyleRule {
  selector: string;
  media?: string;
  declarations: Record<string, string>;
}

type TabScope = { group: string; id: string };
type StyledBlock = { class_name?: string; tab?: TabScope };

export interface DeclarativeTab {
  id: string;
  label: string;
}

export type DeclarativeAction =
  | ({
      id: string;
      label: string;
      kind?: 'workflow';
      workflow: string;
      result_id?: string;
      tone?: 'primary' | 'secondary' | 'danger';
      class_name?: string;
    })
  | ({
      id: string;
      label: string;
      kind: 'clear';
      form_id: string;
      field_ids: string[];
      result_id?: string;
      tone?: 'primary' | 'secondary' | 'danger';
      class_name?: string;
    })
  | ({
      id: string;
      label: string;
      kind: 'copy';
      result_id: string;
      tone?: 'primary' | 'secondary' | 'danger';
      class_name?: string;
    });

export type DeclarativeBlock =
  | ({ type: 'tabs'; id: string; label: string; tabs: DeclarativeTab[]; default_tab?: string } & StyledBlock)
  | ({ type: 'result'; id: string; label: string; copy_label?: string; variant?: 'textarea' | 'banner' } & StyledBlock)
  | ({ type: 'text'; text: string; style?: 'body' | 'caption' | 'heading' } & StyledBlock)
  | ({ type: 'status_card'; title: string; value: string; description?: string; tone?: 'default' | 'success' | 'warning' | 'danger' } & StyledBlock)
  | ({ type: 'alert'; title?: string; message: string; tone?: 'info' | 'success' | 'warning' | 'danger' } & StyledBlock)
  | ({ type: 'progress'; label: string; value: number; max?: number } & StyledBlock)
  | ({ type: 'list'; title?: string; items: Array<{ title: string; description?: string; value?: string }> } & StyledBlock)
  | ({ type: 'table'; title?: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>> } & StyledBlock)
  | ({ type: 'empty_state'; title: string; description?: string } & StyledBlock)
  | ({
      type: 'form';
      id: string;
      fields: Array<{
        id: string;
        label: string;
        type: 'text' | 'textarea' | 'digit' | 'number' | 'toggle' | 'select';
        options?: string[];
        default?: unknown;
        class_name?: string;
      }>;
    } & StyledBlock)
  | ({ type: 'actions'; actions: DeclarativeAction[] } & StyledBlock)
  | { type: 'css'; css: string };

export interface DeclarativeWorkflow {
  schema_version: number;
  start: string;
  nodes: Array<Record<string, unknown> & { id: string; type: string }>;
}

export function getExtensionOverview(): Promise<ExtensionOverview> {
  return invoke('get_extension_overview');
}

export function importExtensionPackage(path: string): Promise<ExtensionInstallation> {
  return invoke('import_extension_package', { path });
}

export function refreshExtensionCatalog(): Promise<ExtensionCatalog> {
  return invoke('refresh_extension_catalog');
}

export function installExtensionFromCatalog(
  extensionId: string,
  allowThirdParty = false,
): Promise<ExtensionInstallation> {
  return invoke('install_extension_from_catalog', { extensionId, allowThirdParty });
}

export function rollbackExtension(extensionId: string): Promise<ExtensionInstallation> {
  return invoke('rollback_extension', { extensionId });
}

export function uninstallExtension(extensionId: string): Promise<void> {
  return invoke('uninstall_extension', { extensionId });
}

export function setExtensionEnabled(
  extensionId: string,
  enabled: boolean,
  grantedCapabilities: ExtensionCapability[],
): Promise<void> {
  return invoke('set_extension_enabled', { extensionId, enabled, grantedCapabilities });
}

export function readExtensionPage(extensionId: string, page: string): Promise<DeclarativePage> {
  return invoke('read_extension_page', { extensionId, page });
}

export function readExtensionWorkflow(extensionId: string, workflow: string): Promise<DeclarativeWorkflow> {
  return invoke('read_extension_workflow', { extensionId, workflow });
}

export function executeExtensionModule<T = unknown>(
  extensionId: string,
  input: unknown,
): Promise<T> {
  return invoke('execute_extension_module', { extensionId, input });
}

export function executeExtensionHostCall<T = unknown>(
  extensionId: string,
  capability: ExtensionCapability,
  args: unknown = {},
  userConfirmed?: boolean,
): Promise<T> {
  return invoke('execute_extension_host_call', {
    extensionId,
    capability,
    arguments: args,
    userConfirmed,
  });
}
