import { describe, expect, it } from 'vitest';
import {
  findReplySourceIndex,
  findReplySourceSpan,
  type ReplySourceMessage,
} from './reply-reference';

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

describe('shortened quotes', () => {
  // Records written by the export tooling keep only the opening of the quoted
  // message and end it with an ellipsis, e.g.
  //   `2025-07-20 19:30:24 | … // e17e013 -> 不过我自己的话倾向于认为...`
  // against the message `不过我自己的话倾向于认为是设计者的小趣味 …`.
  const original: ReplySourceMessage[] = [
    {
      user: 'e17e013',
      time: '2025-07-20 19:28:29',
      content: '不过我自己的话倾向于认为是设计者的小趣味 因为至今为止我们都没有发现这二者有任何进一步的关联',
    },
    { user: '5860faf', time: '2025-07-20 19:30:24', content: '其实硬要说关联的话还是有 都有人工智能相关的话题？' },
  ];

  it('resolves a quote that was cut short with an ellipsis', () => {
    expect(
      findReplySourceIndex(original, 2, { user: 'e17e013', text: '不过我自己的话倾向于认为...' }),
    ).toBe(0);
    expect(
      findReplySourceIndex(original, 2, { user: 'e17e013', text: '不过我自己的话倾向于认为…' }),
    ).toBe(0);
  });

  it('ignores an already truncated quote whose marker repeats', () => {
    expect(
      findReplySourceIndex(original, 2, { user: 'e17e013', text: '不过我自己的话倾向于认为……' }),
    ).toBe(0);
  });

  it('still refuses a quote whose marker leaves no text at all', () => {
    expect(findReplySourceIndex(original, 2, { user: 'e17e013', text: '...' })).toBe(-1);
    expect(findReplySourceIndex(original, 2, { user: 'e17e013', text: '…' })).toBe(-1);
  });

  it('tolerates whitespace differences between the two copies', () => {
    expect(
      findReplySourceIndex(original, 2, {
        user: 'e17e013',
        text: '不过我自己的话倾向于认为是设计者的小趣味\u3000因为',
      }),
    ).toBe(0);
  });
});

describe('messages split across record lines', () => {
  // A multi-line message is stored as one timestamped line per line, so the
  // parsed list holds a run of lines sharing speaker and timestamp.
  const split: ReplySourceMessage[] = [
    { user: 'alice', time: '2025-07-20 19:00:00', content: '第一行内容比较长' },
    { user: 'alice', time: '2025-07-20 19:00:00', content: '第二行内容也不短' },
    { user: 'bob', time: '2025-07-20 19:00:00', content: '插一句' },
    { user: 'carol', time: '2025-07-20 19:05:00', content: '回复' },
  ];

  it('matches the whole run and reports its span', () => {
    expect(
      findReplySourceSpan(split, 3, { user: 'alice', text: '第一行内容比较长 第二行内容也不短' }),
    ).toEqual({ start: 0, end: 1 });
  });

  it('matches the whole run when only its opening was quoted', () => {
    expect(
      findReplySourceSpan(split, 3, { user: 'alice', text: '第一行...' }),
    ).toEqual({ start: 0, end: 1 });
  });

  it('prefers a single line when the quote matches it exactly', () => {
    expect(
      findReplySourceSpan(split, 3, { user: 'alice', text: '第二行内容也不短' }),
    ).toEqual({ start: 1, end: 1 });
  });

  it('does not merge lines from different speakers', () => {
    expect(
      findReplySourceSpan(split, 3, { user: 'alice', text: '第一行内容比较长 插一句' }),
    ).toBeNull();
  });
});
