import { createLightTheme, createDarkTheme, type BrandVariants, type Theme } from '@fluentui/tokens';

export const UI_FONT = '"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Microsoft YaHei UI", "PingFang SC", "CFMS Noto Sans SC Subset", "Noto Sans SC", sans-serif';
export const MONO_FONT = '"CFMS JetBrains Mono Subset", "JetBrains Mono", ui-monospace, Consolas, "CFMS Noto Sans SC Subset", monospace';

const brand: BrandVariants = {
  10: '#001326', 20: '#00233f', 30: '#003254', 40: '#004269',
  50: '#004577', 60: '#004e8c', 70: '#005a9e', 80: '#0067c0',
  90: '#1976cd', 100: '#3587d7', 110: '#5598e0', 120: '#75aae8',
  130: '#97bdf0', 140: '#b7d2f6', 150: '#d8eaff', 160: '#eff6ff',
};

const common = {
  fontFamilyBase: UI_FONT,
  fontFamilyNumeric: UI_FONT,
  fontFamilyMonospace: MONO_FONT,
  borderRadiusLarge: '8px',
  lineHeightBase500: '26px',
};

export const lightTheme: Theme = {
  ...createLightTheme(brand), ...common,
  colorNeutralBackground3: '#f3f3f3',
  colorStrokeFocus2: '#0067c0',
};

export const darkTheme: Theme = {
  ...createDarkTheme(brand), ...common,
  colorNeutralBackground1: '#292929',
  colorNeutralBackground2: '#252525',
  colorNeutralBackground3: '#202020',
  colorNeutralForeground3: '#d6d6d6',
  colorStatusDangerForeground1: '#ff99a4',
  colorNeutralForegroundOnBrand: '#202020',
  colorBrandBackground: '#60cdff',
  colorBrandBackgroundHover: '#7cd7ff',
  colorBrandBackgroundPressed: '#4bb4df',
  colorBrandBackgroundSelected: '#60cdff',
  colorBrandBackground2: '#173d50',
  colorBrandBackground2Hover: '#1c4b61',
  colorBrandBackground2Pressed: '#153343',
  colorBrandForeground1: '#60cdff',
  colorBrandForeground2: '#60cdff',
  colorBrandForeground2Hover: '#7cd7ff',
  colorBrandForeground2Pressed: '#4bb4df',
  colorBrandForegroundLink: '#60cdff',
  colorBrandForegroundLinkHover: '#7cd7ff',
  colorBrandForegroundLinkPressed: '#4bb4df',
  colorBrandForegroundLinkSelected: '#60cdff',
  colorCompoundBrandBackground: '#60cdff',
  colorCompoundBrandBackgroundHover: '#7cd7ff',
  colorCompoundBrandBackgroundPressed: '#4bb4df',
  colorCompoundBrandForeground1: '#60cdff',
  colorCompoundBrandForeground1Hover: '#7cd7ff',
  colorCompoundBrandForeground1Pressed: '#4bb4df',
  colorNeutralForeground2BrandHover: '#60cdff',
  colorNeutralForeground2BrandPressed: '#4bb4df',
  colorNeutralForeground2BrandSelected: '#60cdff',
  colorNeutralForeground3BrandHover: '#60cdff',
  colorNeutralForeground3BrandPressed: '#4bb4df',
  colorNeutralForeground3BrandSelected: '#60cdff',
  colorBrandStroke1: '#60cdff',
  colorBrandStroke2: '#30677f',
  colorCompoundBrandStroke: '#60cdff',
  colorCompoundBrandStrokeHover: '#7cd7ff',
  colorCompoundBrandStrokePressed: '#4bb4df',
  colorStrokeFocus2: '#60cdff',
};

export function fluentTheme(scheme: 'light' | 'dark', reduceMotion = false): Theme {
  const theme = scheme === 'dark' ? darkTheme : lightTheme;
  if (!reduceMotion) return theme;
  return Object.fromEntries(Object.entries(theme).map(([key, value]) =>
    [key, key.startsWith('duration') ? '0.01ms' : value],
  )) as Theme;
}
