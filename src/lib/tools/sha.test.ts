import { describe, expect, it } from 'vitest';

import { sha256Bytes, sha256Hex, sha512Bytes } from './sha';

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('sha256', () => {
  it('matches the reference vector for "Hello World"', () => {
    expect(sha256Hex('Hello World')).toBe(
      'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
    );
  });

  it('matches empty input', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('handles multi-block input', () => {
    expect(sha256Hex('a'.repeat(200))).toBe(
      'c2a908d98f5df987ade41b5fce213067efbcc21ef2240212a41e54b5e7c28ae5',
    );
  });
});

describe('sha512', () => {
  it('matches the empty string vector', () => {
    expect(hex(sha512Bytes(new Uint8Array(0)))).toBe(
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce'
      + '47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    );
  });

  it('matches "abc" vector', () => {
    const text = new TextEncoder().encode('abc');
    expect(hex(sha512Bytes(text))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a'
      + '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });
});
