// CFMS Client — Fluent icon slugs the fork adds.
//
// `scripts/generate-fluent-icons.mjs` merges this map into the upstream
// `$lib/fluent/icon-map` while generating `icons.generated.ts`, so neither of
// those upstream files carries a fork line. An upstream merge that disagrees
// with the generated file is resolved by running `pnpm assets:fluent`.

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
