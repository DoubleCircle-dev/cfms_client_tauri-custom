import { describe, expect, it } from 'vitest';
import { shouldOfferConnectionReturn } from './public-utility-navigation';

describe('public utility connection recovery', () => {
  it.each([
    '/home/settings',
    '/home/settings/connection',
    '/home/about',
    '/home/tools',
  ])('offers a connection return from %s while signed out and disconnected', (pathname) => {
    expect(shouldOfferConnectionReturn(pathname, false, false)).toBe(true);
  });

  it('does not replace normal session navigation', () => {
    expect(shouldOfferConnectionReturn('/home/settings', true, false)).toBe(false);
    expect(shouldOfferConnectionReturn('/home/settings', false, true)).toBe(false);
    expect(shouldOfferConnectionReturn('/home/files', false, false)).toBe(false);
  });
});
