import { setTheme } from '@fluentui/web-components/theme/set-theme.js';
import { fluentTheme } from './theme';

export function applyFluentTheme(scheme: 'light' | 'dark', reduceMotion: boolean) {
  setTheme(fluentTheme(scheme, reduceMotion));
}
