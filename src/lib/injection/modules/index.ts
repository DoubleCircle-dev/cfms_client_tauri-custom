// CFMS Client — fork module list.
//
// This directory is the fork's own surface: upstream merges never touch it, so
// adding a feature is an append here plus one seam line in the upstream file
// that reads the registry. Start-up hooks run in this order.

import type { CustomModule } from '../types';
import { customMessages } from './custom-messages';
import { notificationsCenter } from './notifications';
import { chat } from './chat';
import { tools } from './tools';
import { desktopShell } from './desktop-shell';
import { fileSync } from './file-sync';
import { runtimeServices } from './runtime-services';

export const CUSTOM_MODULES: readonly CustomModule[] = [
  customMessages,
  notificationsCenter,
  chat,
  tools,
  desktopShell,
  fileSync,
  runtimeServices,
];
