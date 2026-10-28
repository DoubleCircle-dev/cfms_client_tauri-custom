// CFMS Client — resolving a chat reply back to the message it quotes.
//
// Chat records are plain text lines, so a reply only carries the quoted
// speaker and the quoted text: there is no message id to look up. Resolution
// therefore walks the room backwards from the reply and matches on both.

export interface ReplyReference {
  user: string;
  text: string;
}

export interface ReplySourceMessage {
  user: string;
  content: string;
}

/**
 * Returns the index of the message a reply quotes, or `-1` when the quoted
 * message is no longer part of the record.
 *
 * The search walks backwards, so the nearest earlier match wins — that is the
 * message the user most likely meant when the same text was said twice. Only
 * messages *before* the reply are considered, so quoting your own earlier
 * wording resolves to that earlier occurrence instead of looping onto the
 * reply itself. A preview truncated in the UI still resolves, because the
 * stored reference keeps the full text and is compared as a prefix as well.
 */
export function findReplySourceIndex(
  messages: readonly ReplySourceMessage[],
  messageIndex: number,
  reference: ReplyReference,
): number {
  for (let index = Math.min(messageIndex, messages.length) - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (!candidate || candidate.user !== reference.user) continue;
    if (candidate.content === reference.text) return index;
    if (reference.text.length > 0 && candidate.content.startsWith(reference.text)) return index;
  }

  return -1;
}
