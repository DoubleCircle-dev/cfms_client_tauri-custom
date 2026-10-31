import type { CustomModule } from '../types';
import { customEn } from '../messages/en';
import { customZhCn } from '../messages/zh-CN';

/**
 * Every string the fork adds to the base catalogs.
 *
 * The fork ships extensions on mobile as well, so the base catalog's
 * "desktop only" note is suppressed rather than overridden.
 */
export const customMessages: CustomModule = {
  id: 'custom-messages',
  messages: {
    en: customEn,
    zh_CN: customZhCn,
    suppress: ['settings.extensions.mobileUnavailable'],
  },
};
