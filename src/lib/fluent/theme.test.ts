import { describe, expect, it } from 'vitest';
import { darkTheme, lightTheme, fluentTheme } from './theme';

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('Fluent operational themes', () => {
  for (const [scheme, theme] of Object.entries({ light: lightTheme, dark: darkTheme })) {
    it(scheme + ' keeps working text, errors and primary-action labels legible', () => {
      for (const background of [theme.colorNeutralBackground1, theme.colorNeutralBackground2, theme.colorNeutralBackground3]) {
        for (const text of [theme.colorNeutralForeground1, theme.colorNeutralForeground3, theme.colorBrandForeground1, theme.colorStatusDangerForeground1]) {
          expect(contrast(text, background), text + ' on ' + background).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const background of [theme.colorBrandBackground, theme.colorBrandBackgroundHover, theme.colorBrandBackgroundPressed]) {
        expect(contrast(theme.colorNeutralForegroundOnBrand, background)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it('reduces shadow-root token motion without mutating the normal theme', () => {
    const reduced = fluentTheme('dark', true);
    expect(reduced.durationNormal).toBe('0.01ms');
    expect(reduced.durationSlow).toBe('0.01ms');
    expect(darkTheme.durationNormal).toBe('200ms');
    expect(reduced.colorBrandBackground).toBe(darkTheme.colorBrandBackground);
  });
});
