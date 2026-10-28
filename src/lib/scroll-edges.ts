/**
 * Scroll-edge helpers for the chat message list.
 *
 * Browsers report fractional scroll offsets on scaled displays, so both edges
 * are detected with a tolerance rather than an exact comparison. A container
 * that is not overflowing reports `scrollHeight === clientHeight`, which must
 * count as both "at top" and "at bottom".
 */

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export const SCROLL_EDGE_TOLERANCE = 8;

export function isScrolledToTop(
  metrics: ScrollMetrics,
  tolerance = SCROLL_EDGE_TOLERANCE,
): boolean {
  if (!Number.isFinite(metrics.scrollTop)) return true;
  return metrics.scrollTop <= tolerance;
}

export function isScrolledToBottom(
  metrics: ScrollMetrics,
  tolerance = SCROLL_EDGE_TOLERANCE,
): boolean {
  const { scrollTop, scrollHeight, clientHeight } = metrics;
  if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) {
    return true;
  }
  // Nothing to scroll: the list is short enough to fit on screen.
  if (scrollHeight <= clientHeight) return true;
  return scrollHeight - scrollTop - clientHeight <= tolerance;
}
