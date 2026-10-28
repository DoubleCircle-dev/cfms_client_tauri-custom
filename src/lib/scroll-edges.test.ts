import { describe, expect, it } from 'vitest';

import { isScrolledToBottom, isScrolledToTop } from './scroll-edges';

describe('scroll edges', () => {
  it('treats a list shorter than the viewport as both top and bottom', () => {
    const short = { scrollTop: 0, scrollHeight: 320, clientHeight: 480 };
    expect(isScrolledToTop(short)).toBe(true);
    expect(isScrolledToBottom(short)).toBe(true);
  });

  it('detects the top edge within the tolerance', () => {
    expect(isScrolledToTop({ scrollTop: 0, scrollHeight: 2000, clientHeight: 600 })).toBe(true);
    expect(isScrolledToTop({ scrollTop: 6, scrollHeight: 2000, clientHeight: 600 })).toBe(true);
    expect(isScrolledToTop({ scrollTop: 40, scrollHeight: 2000, clientHeight: 600 })).toBe(false);
  });

  it('detects the bottom edge within the tolerance', () => {
    const metrics = { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 };
    expect(isScrolledToBottom(metrics)).toBe(true);
    expect(isScrolledToBottom({ ...metrics, scrollTop: 1396 })).toBe(true);
    expect(isScrolledToBottom({ ...metrics, scrollTop: 1200 })).toBe(false);
  });

  it('falls back to the safe answer when the metrics are not numbers yet', () => {
    expect(isScrolledToTop({ scrollTop: Number.NaN, scrollHeight: 0, clientHeight: 0 })).toBe(true);
    expect(
      isScrolledToBottom({ scrollTop: Number.NaN, scrollHeight: 2000, clientHeight: 600 }),
    ).toBe(true);
  });
});
