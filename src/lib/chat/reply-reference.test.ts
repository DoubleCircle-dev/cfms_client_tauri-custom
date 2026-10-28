import { describe, expect, it } from 'vitest';
import { findReplySourceIndex, type ReplySourceMessage } from './reply-reference';

const messages: ReplySourceMessage[] = [
  { user: 'alice', content: '早上好' },
  { user: 'bob', content: '服务器已经恢复了' },
  { user: 'alice', content: '收到，我去确认一下' },
  { user: 'bob', content: '收到，我去确认一下' },
];

describe('findReplySourceIndex', () => {
  it('resolves an exact quoted message to the nearest earlier occurrence', () => {
    expect(findReplySourceIndex(messages, 4, { user: 'alice', text: '早上好' })).toBe(0);
    expect(
      findReplySourceIndex(messages, 4, { user: 'bob', text: '服务器已经恢复了' }),
    ).toBe(1);
  });

  it('matches the nearest sender when the same text was said twice', () => {
    expect(findReplySourceIndex(messages, 4, { user: 'bob', text: '收到，我去确认一下' })).toBe(3);
    expect(findReplySourceIndex(messages, 4, { user: 'alice', text: '收到，我去确认一下' })).toBe(2);
  });

  it('never resolves to the reply itself or to later messages', () => {
    expect(findReplySourceIndex(messages, 0, { user: 'alice', text: '早上好' })).toBe(-1);
    expect(findReplySourceIndex(messages, 2, { user: 'bob', text: '服务器已经恢复了' })).toBe(1);
  });

  it('still resolves when only a truncated preview is stored', () => {
    const long: ReplySourceMessage[] = [
      { user: 'alice', content: '这是一段非常长的发言，用来验证前缀匹配是否生效' },
    ];
    expect(findReplySourceIndex(long, 1, { user: 'alice', text: '这是一段非常长的发言' })).toBe(0);
  });

  it('reports a missing source when nothing matches', () => {
    expect(findReplySourceIndex(messages, 4, { user: 'carol', text: '早上好' })).toBe(-1);
    expect(findReplySourceIndex(messages, 4, { user: 'alice', text: '不存在的内容' })).toBe(-1);
    expect(findReplySourceIndex([], 0, { user: 'alice', text: '早上好' })).toBe(-1);
  });

  it('does not treat an empty quote as matching everything', () => {
    expect(findReplySourceIndex(messages, 4, { user: 'alice', text: '' })).toBe(-1);
  });
});
