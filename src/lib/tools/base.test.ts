import { describe, expect, it } from 'vitest';

import { baseDecode, baseEncode } from './base';
import fixture from './fixtures/pytk-expected.json';

const binaryText = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i));

function fixtureValue(suffix: string): string {
  const value = fixture[`base_${suffix}` as keyof typeof fixture];
  if (typeof value !== 'string') throw new Error(`missing fixture base_${suffix}`);
  return value;
}

describe('base encodings', () => {
  it.each(['BASE64', 'BASE58', 'BASE62', 'BASE85', 'BASE91'] as const)(
    'round-trips %s for plain text',
    (codec) => {
      const text = 'Hello World';
      expect(baseEncode(text, codec)).toBe(fixtureValue(`hello_${codec}_enc`));
      expect(baseDecode(baseEncode(text, codec), codec)).toBe(text);
    },
  );

  it.each(['BASE64', 'BASE58', 'BASE62', 'BASE85', 'BASE91'] as const)(
    'round-trips %s for all 256 byte values',
    (codec) => {
      const encoded = baseEncode(binaryText, codec);
      expect(encoded).toBe(fixtureValue(`binary_${codec}_enc`));
      expect(baseDecode(encoded, codec)).toBe(binaryText);
    },
  );

  it.each(['BASE64', 'BASE58', 'BASE62', 'BASE85', 'BASE91'] as const)(
    'round-trips %s for unicode text',
    (codec) => {
      const text = '中文测试 ABC 123';
      expect(baseEncode(text, codec)).toBe(fixtureValue(`unicode_${codec}_enc`));
      expect(baseDecode(baseEncode(text, codec), codec)).toBe(text);
    },
  );

  it('strips base85 adobe markers on decode', () => {
    const encoded = baseEncode('Hello World', 'BASE85');
    expect(baseDecode(`<~${encoded}~>`, 'BASE85')).toBe('Hello World');
  });

  it('handles zero padding like Python', () => {
    const zeros = '\x00\x00\x00\x00\x00';
    for (const codec of ['BASE58', 'BASE62'] as const) {
      expect(baseDecode(baseEncode(zeros, codec), codec)).toBe(zeros);
    }
  });

  it('rejects unsupported codecs', () => {
    expect(() => baseEncode('x', 'BASE99')).toThrowError('base.unsupported');
  });

  it('rejects invalid base58 characters', () => {
    expect(() => baseDecode('0OIl', 'BASE58')).toThrow();
  });
});
