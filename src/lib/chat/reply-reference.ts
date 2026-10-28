// CFMS Client — resolving a chat reply back to the message it quotes.
//
// Chat records are plain text lines, so a reply only carries the quoted
// speaker and the quoted text: there is no message id to look up. Resolution
// therefore walks the room backwards from the reply and matches on both.
//
// The comparison has to tolerate three ways the two copies drift apart:
//
// 1. The quote is often a shortened preview — records written by the export
//    tooling end it with `...` after a dozen characters or so.
// 2. Line breaks inside a message become separate record lines, so one logical
//    message can land in the parsed list as a run of lines sharing one speaker
//    and one timestamp.
// 3. Whitespace (indentation, full-width spaces, tabs) survives the round trip
//    differently in each copy.

export interface ReplyReference {
  user: string;
  text: string;
}

export interface ReplySourceMessage {
  user: string;
  content: string;
  /** Record timestamp; consecutive lines of one message share it. */
  time?: string;
}

export interface ReplySourceSpan {
  /** Index of the first message of the quoted message. */
  start: number;
  /** Index of its last message, equal to `start` for a single-line message. */
  end: number;
}

/** A quote shortened for the record ends with a marker like `...` or `…`. */
const TRUNCATION_MARKER = /(?:\.{2,}|…+|⋯+)\s*$/;

/** Zero-width characters survive copy/paste but never appear in both copies. */
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;

/**
 * Upper bound on how many record lines one logical message may span. A real
 * message is a handful of lines; the cap keeps a pathological run of identical
 * timestamps from joining half the room.
 */
const MAX_RUN_LINES = 20;

function normalize(value: string): string {
  return value.replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
}

/**
 * Drops a trailing ellipsis, which only says "the quote continues" and is never
 * part of the message itself.
 */
function stripTruncationMarker(value: string): string {
  let result = value;
  for (;;) {
    const next = result.replace(TRUNCATION_MARKER, '').trim();
    // An all-marker quote carries no text of its own; keep the original so the
    // empty reference cannot match every message in the room.
    if (next === result || !next) return result;
    result = next;
  }
}

/**
 * Ranks how well a candidate matches the quote. Lower is better, `null` means
 * no match at all: `0` identical, `1` the quote is the candidate's opening.
 *
 * Only the "quote is shorter" direction is accepted. The opposite direction —
 * a record line that is shorter than the quote — would match any message whose
 * text merely happens to open the quote, which in a room full of short replies
 * jumps to the wrong bubble far more often than it helps.
 */
function matchTier(candidate: string, reference: string): number | null {
  if (!candidate || !reference) return null;
  if (candidate === reference) return 0;
  if (candidate.startsWith(reference)) return 1;
  return null;
}

/** Last index of the run of lines that belong to the message starting at `start`. */
function runEnd(
  messages: readonly ReplySourceMessage[],
  start: number,
  limit: number,
): number {
  const first = messages[start];
  if (!first) return start;

  let end = start;
  while (end + 1 < limit && end + 1 - start < MAX_RUN_LINES) {
    const next = messages[end + 1];
    // Lines of one message are written back to back under the same timestamp;
    // a repeated timestamp alone is not enough, the speaker has to match too.
    if (!next || next.user !== first.user || !first.time || next.time !== first.time) break;
    end += 1;
  }
  return end;
}

/**
 * Returns the span of messages a reply quotes, or `null` when the quoted
 * message is no longer part of the record.
 *
 * The search walks backwards, so the nearest earlier match wins — that is the
 * message the user most likely meant when the same text was said twice. Only
 * messages *before* the reply are considered, so quoting your own earlier
 * wording resolves to that earlier occurrence instead of looping onto the reply
 * itself.
 */
export function findReplySourceSpan(
  messages: readonly ReplySourceMessage[],
  messageIndex: number,
  reference: ReplyReference,
): ReplySourceSpan | null {
  const limit = Math.min(messageIndex, messages.length);
  if (limit <= 0) return null;

  const referenceText = stripTruncationMarker(normalize(reference.text));
  if (!referenceText) return null;

  let bestTier = Number.POSITIVE_INFINITY;
  let best: ReplySourceSpan | null = null;

  const consider = (tier: number, span: ReplySourceSpan) => {
    if (!best || tier < bestTier) {
      bestTier = tier;
      best = span;
      return;
    }
    if (tier !== bestTier) return;

    // Equal evidence: the longer span explains more of the quote, and between
    // spans of the same length the nearest earlier one is the likelier source.
    const length = span.end - span.start;
    const bestLength = best.end - best.start;
    if (length > bestLength || (length === bestLength && span.start > best.start)) {
      best = span;
    }
  };

  for (let start = limit - 1; start >= 0; start -= 1) {
    const message = messages[start];
    if (!message || message.user !== reference.user) continue;

    const end = runEnd(messages, start, limit);

    if (end > start) {
      // The quote may span several record lines, so try the whole run as well:
      // when it matches, every one of those lines belongs to the highlight, and
      // a run that ties with a single line wins because it accounts for the
      // rest of the quoted text.
      const joined = normalize(
        messages
          .slice(start, end + 1)
          .map((item) => item.content)
          .join(' '),
      );
      const tier = matchTier(joined, referenceText);
      if (tier !== null) consider(tier, { start, end });
    }

    const single = matchTier(normalize(message.content), referenceText);
    if (single !== null) consider(single, { start, end: start });
  }

  return best;
}

/**
 * Convenience wrapper for callers that only need the first message of the
 * quoted message, or `-1` when it cannot be resolved.
 */
export function findReplySourceIndex(
  messages: readonly ReplySourceMessage[],
  messageIndex: number,
  reference: ReplyReference,
): number {
  return findReplySourceSpan(messages, messageIndex, reference)?.start ?? -1;
}
