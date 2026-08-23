import { describe, expect, it } from 'vitest';

import {
  a1z26Decode,
  a1z26Encode,
  adfgvxDecode,
  adfgvxEncode,
  asciiDecode,
  asciiEncode,
  atbash,
  baconianDecode,
  baconianEncode,
  caesarDecode,
  caesarEncode,
  keywordDecode,
  keywordEncode,
  morseDecode,
  morseEncode,
  radixDecode,
  radixEncode,
  sha256Tool,
  simpleDecode,
  simpleEncode,
  vigenereDecode,
  vigenereEncode,
} from './ciphers';
import { ToolError } from './errors';

describe('caesar', () => {
  it('encodes and decodes with a shift', () => {
    expect(caesarEncode('Hello, World! XYZ', '3')).toBe('Khoor, Zruog! ABC');
    expect(caesarDecode('Khoor, Zruog! ABC', '3')).toBe('Hello, World! XYZ');
  });

  it('rejects a non-integer shift', () => {
    expect(() => caesarEncode('Hello', 'abc')).toThrow(ToolError);
  });
});

describe('vigenère', () => {
  it('encodes and decodes with a letter key', () => {
    expect(vigenereEncode('Hello World', 'KEY')).toBe('Rijvs Uyvjn');
    expect(vigenereDecode('Rijvs Uyvjn', 'KEY')).toBe('Hello World');
  });

  it('supports numeric keys (Gronsfeld)', () => {
    expect(vigenereEncode('Hello', '123')).toBe('Igomq');
  });

  it('rejects an empty key', () => {
    expect(() => vigenereEncode('Hello', '')).toThrow(ToolError);
  });
});

describe('atbash', () => {
  it('mirrors the alphabet', () => {
    expect(atbash('Hello World')).toBe('Svool Dliow');
    expect(atbash(atbash('Hello World'))).toBe('Hello World');
  });
});

describe('A1Z26', () => {
  it('encodes letters to numbers', () => {
    expect(a1z26Encode('Hello World')).toBe('8-5-12-12-15-23-15-18-12-4');
  });

  it('decodes numbers to letters', () => {
    expect(a1z26Decode('8-5-12-12-15 23-15-18-12-4')).toBe('HELLOWORLD');
  });

  it('rejects out-of-range numbers', () => {
    expect(() => a1z26Decode('27')).toThrow(ToolError);
  });
});

describe('keyword cipher', () => {
  it('encodes and decodes', () => {
    expect(keywordEncode('Hello World', 'KEYWORD')).toBe('Aoggj Ujngw');
    expect(keywordDecode('Aoggj Ujngw', 'KEYWORD')).toBe('Hello World');
  });
});

describe('simple substitution', () => {
  it('encodes and decodes with a 26-letter alphabet', () => {
    expect(simpleEncode('Hello World', 'QWERTYUIOPASDFGHJKLZXCVBNM')).toBe('Itssg Vgksr');
    expect(simpleDecode('Itssg Vgksr', 'QWERTYUIOPASDFGHJKLZXCVBNM')).toBe('Hello World');
  });

  it('rejects an invalid alphabet', () => {
    expect(() => simpleEncode('Hello', 'SHORT')).toThrow(ToolError);
  });
});

describe('baconian', () => {
  it('encodes and decodes', () => {
    expect(baconianEncode('HELLO')).toBe('AABBB AABAA ABABB ABABB ABBBA');
    expect(baconianDecode('AABBBAABAAABABBABABBABBBA')).toBe('HELLO');
  });

  it('accepts 0/1 input', () => {
    expect(baconianDecode('00111 00100 01011 01011 01110')).toBe('HELLO');
  });
});

describe('morse', () => {
  it('encodes and decodes', () => {
    expect(morseEncode('Hello World 123')).toBe(
      '.... . .-.. .-.. --- / .-- --- .-. .-.. -.. / .---- ..--- ...--',
    );
    expect(morseDecode('.... . .-.. .-.. --- / .-- --- .-. .-.. -..')).toBe('HELLO WORLD');
  });
});

describe('sha256 tool', () => {
  it('hashes text', () => {
    expect(sha256Tool('Hello World')).toBe(
      'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
    );
  });
});

describe('ascii', () => {
  it('encodes and decodes unicode code points', () => {
    expect(asciiEncode('Hello 世界')).toBe('72 101 108 108 111 32 19990 30028');
    expect(asciiDecode('72 101 108 108 111 32 19990 30028')).toBe('Hello 世界');
  });

  it('supports hex input (base-0 semantics)', () => {
    expect(asciiDecode('0x48 0x69')).toBe('Hi');
  });
});

describe('radix conversion', () => {
  it('converts between bases', () => {
    expect(radixEncode('255', '10', '16')).toBe('FF');
    expect(radixDecode('FF', '10', '16')).toBe('255');
    expect(radixEncode('1296', '10', '36')).toBe('100');
  });

  it('rejects out-of-range bases', () => {
    expect(() => radixEncode('10', '1', '16')).toThrow(ToolError);
  });
});

describe('ADFGVX', () => {
  it('encodes and decodes', () => {
    const encoded = adfgvxEncode('HELLO WORLD', 'KEY', 'SQUARE');
    expect(encoded).toBe('DGAGAXAGGAGAFGFADFFDAFGA');
    expect(adfgvxDecode(encoded, 'KEY', 'SQUARE')).toBe('HELLOWORLD');
  });

  it('rejects missing keys', () => {
    expect(() => adfgvxEncode('HELLO', '', 'SQUARE')).toThrow(ToolError);
  });
});
