import { describe, expect, it } from 'vitest';

import { convertEncoding, encodingDecode, encodingEncode } from './encodings';
import { ToolError } from './errors';

const GBK_GARBLED = '\u00d6\u00d0\u00ce\u00c4\u00b2\u00e2\u00ca\u00d4'; // ÖÐÎÄ²âÊÔ
const BIG5_GARBLED = '\u00a4\u00a4\u00a4\u00e5\u00b4\u00fa\u00b8\u00d5'; // ¤¤¤å´ú¸Õ
const SHIFT_JIS_GARBLED = '\u0082\u00b1\u0082\u00f1\u0082\u00c9\u0082\u00bf\u0082\u00cd';
const EUC_JP_GARBLED = '\u00a4\u00b3\u00a4\u00f3\u00a4\u00cb\u00a4\u00c1\u00a4\u00cf';
const UTF8_GARBLED = 'ä½\u00a0å¥½';

describe('encoding conversion', () => {
  it('repairs UTF-8 mojibake displayed as latin-1', () => {
    expect(convertEncoding(UTF8_GARBLED, 'ISO-8859-1', 'UTF-8')).toBe('你好');
  });

  it('repairs GBK mojibake', () => {
    expect(convertEncoding(GBK_GARBLED, 'ISO-8859-1', 'GBK')).toBe('中文测试');
  });

  it('supports the reverse key order via the decode direction', () => {
    expect(encodingDecode(GBK_GARBLED, ['GBK', 'ISO-8859-1'])).toBe('中文测试');
    expect(encodingEncode(GBK_GARBLED, ['ISO-8859-1', 'GBK'])).toBe('中文测试');
  });

  it('repairs Big5 mojibake', () => {
    expect(convertEncoding(BIG5_GARBLED, 'ISO-8859-1', 'Big5')).toBe('中文測試');
  });

  it('repairs Shift_JIS mojibake', () => {
    expect(convertEncoding(SHIFT_JIS_GARBLED, 'ISO-8859-1', 'Shift_JIS')).toBe('こんにちは');
  });

  it('repairs EUC-JP mojibake', () => {
    expect(convertEncoding(EUC_JP_GARBLED, 'ISO-8859-1', 'EUC-JP')).toBe('こんにちは');
  });

  it('fails on unencodable characters like Python', () => {
    expect(() => convertEncoding('中文', 'ASCII', 'UTF-8')).toThrow(ToolError);
  });

  it('fails on invalid byte sequences', () => {
    expect(() => convertEncoding('\u00ff\u00ff', 'ISO-8859-1', 'GBK')).toThrow(ToolError);
  });
});
