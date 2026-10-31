// CFMS Client — Fluent icon slugs the fork adds.
//
// `scripts/generate-fluent-icons.mjs` reads `$lib/fluent/icon-map` (which spreads
// this map) and writes `icons.generated.ts`. The generated file is therefore a
// pure artifact: an upstream merge that disagrees with it is resolved by running
// `pnpm assets:fluent`, not by hand-editing either file.

export const CUSTOM_ICON_MAP = {
  tools: 'toolbox',
  chat: 'chat',
  attachment: 'attach',
  gridOn: 'grid',
  // Desktop shell: window chrome and the close-button prompt.
  window: 'window',
  minimizeToTray: 'arrow_minimize',
  quit: 'power',
  // Update mirror indicator.
  mirrorDownload: 'cloud_arrow_down',
} as const;
