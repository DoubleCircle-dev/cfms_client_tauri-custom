// Fork helpers around the generated Fluent icon set.
//
// `$lib/icons` stays byte-identical to upstream so a merge never touches it.

import { ICON_VARIANTS, type IconName } from '$lib/icons';

export function isIconName(value: string): value is IconName {
  return Object.prototype.hasOwnProperty.call(ICON_VARIANTS, value);
}
