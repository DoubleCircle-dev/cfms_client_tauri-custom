/**
 * Base encodings ported from CFMS工具箱_v1.10.0.pyw.
 *
 * BASE64/BASE85 mirror Python's `base64` module (b64encode/b64decode with
 * validate=False, a85encode/a85decode with adobe=False); BASE58/BASE62/BASE91
 * are direct ports of the helpers in the reference program. Byte strings use
 * BigInt for the arbitrary-precision arithmetic Python relies on.
 */

import { fail, ToolError } from './errors';
import { concatBytes, utf8Decode, utf8Encode } from './sha';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE91_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"';

// ---------------------------------------------------------------------------
// BASE64 (Python base64.b64encode / b64decode with validate=False)
// ---------------------------------------------------------------------------

function base64EncodeBytes(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const b0 = data[i];
    const b1 = i + 1 < data.length ? data[i + 1] : 0;
    const b2 = i + 2 < data.length ? data[i + 2] : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < data.length ? BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < data.length ? BASE64_ALPHABET[b2 & 63] : '=';
  }
  return out;
}

function base64DecodeBytes(text: string): Uint8Array {
  // Python's b64decode(validate=False) discards non-alphabet characters
  // (including whitespace), keeps '=' padding, then requires that the data
  // length is not congruent to 1 modulo 4 before decoding.
  const chars: string[] = [];
  for (const ch of text) {
    if (BASE64_ALPHABET.includes(ch) || ch === '=') chars.push(ch);
  }
  const dataLength = chars.filter((ch) => ch !== '=').length;
  if (dataLength % 4 === 1) {
    fail('base64.invalidLength', { length: String(dataLength) });
  }
  while (chars.length % 4 !== 0) chars.push('=');
  const out: number[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    const c0 = BASE64_ALPHABET.indexOf(chars[i]);
    const c1 = chars[i + 1] === '=' ? 0 : BASE64_ALPHABET.indexOf(chars[i + 1]);
    const c2 = chars[i + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(chars[i + 2]);
    const c3 = chars[i + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(chars[i + 3]);
    out.push((c0 << 2) | (c1 >> 4));
    if (chars[i + 2] !== '=') out.push(((c1 & 15) << 4) | (c2 >> 2));
    if (chars[i + 3] !== '=') out.push(((c2 & 3) << 6) | c3);
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// ASCII85 (Python base64.a85encode / a85decode with adobe=False)
// ---------------------------------------------------------------------------

const A85_CHARS = '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

function ascii85EncodeBytes(data: Uint8Array): string {
  if (data.length === 0) return '';
  const padding = (4 - (data.length % 4)) % 4;
  const padded = padding === 0 ? data : concatBytes(data, new Uint8Array(padding));
  const chunks: string[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    const word =
      ((padded[i] * 256 + padded[i + 1]) * 256 + padded[i + 2]) * 256 + padded[i + 3];
    if (word === 0) {
      chunks.push('z');
      continue;
    }
    const v1 = Math.floor(word / 614125);
    const rest = word % 614125;
    const v2 = Math.floor(rest / 85);
    const v3 = word % 85;
    chunks.push(
      A85_CHARS[Math.floor(v1 / 85)] +
      A85_CHARS[v1 % 85] +
      A85_CHARS[Math.floor(v2 / 85)] +
      A85_CHARS[v2 % 85] +
      A85_CHARS[v3],
    );
  }
  if (padding) {
    const last = chunks[chunks.length - 1];
    chunks[chunks.length - 1] = (last === 'z' ? '!!!!!' : last).slice(0, 5 - padding);
  }
  return chunks.join('');
}

function ascii85DecodeBytes(text: string): Uint8Array {
  const decoded: number[][] = [];
  let current: number[] = [];
  const stream = text + 'uuuu';
  for (const ch of stream) {
    const code = ch.charCodeAt(0);
    if (code >= 33 && code <= 117) {
      current.push(code - 33);
      if (current.length === 5) {
        let acc = 0;
        for (const value of current) acc = acc * 85 + value;
        if (acc > 0xffffffff) fail('base85.overflow');
        decoded.push([(acc >>> 24) & 255, (acc >>> 16) & 255, (acc >>> 8) & 255, acc & 255]);
        current = [];
      }
    } else if (ch === 'z') {
      if (current.length) fail('base85.zInside');
      decoded.push([0, 0, 0, 0]);
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\v') {
      // Python ignores these whitespace characters.
      continue;
    } else {
      fail('base85.invalidChar', { char: ch });
    }
  }
  const joined: number[] = [];
  for (const group of decoded) joined.push(...group);
  const padding = 4 - current.length;
  if (padding > 0) joined.length = joined.length - padding;
  return Uint8Array.from(joined);
}

// ---------------------------------------------------------------------------
// BASE58 / BASE62 (BigInt ports)
// ---------------------------------------------------------------------------

function intToBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array(0);
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value & 0xffn));
    value >>= 8n;
  }
  return Uint8Array.from(bytes.reverse());
}

function baseNEncode(data: Uint8Array, alphabet: string): string {
  const radix = BigInt(alphabet.length);
  let value = 0n;
  for (const byte of data) value = (value << 8n) | BigInt(byte);
  const digits: string[] = [];
  while (value > 0n) {
    digits.push(alphabet[Number(value % radix)]);
    value /= radix;
  }
  let pad = 0;
  for (const byte of data) {
    if (byte === 0) pad += 1;
    else break;
  }
  return alphabet[0].repeat(pad) + digits.reverse().join('');
}

function baseNDecode(text: string, alphabet: string): Uint8Array {
  const radix = BigInt(alphabet.length);
  let value = 0n;
  for (const ch of text) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) fail('base.invalidChar', { char: ch });
    value = value * radix + BigInt(idx);
  }
  let pad = 0;
  for (const ch of text) {
    if (ch === alphabet[0]) pad += 1;
    else break;
  }
  const body = intToBytes(value);
  const out = new Uint8Array(pad + body.length);
  out.set(body, pad);
  return out;
}

// ---------------------------------------------------------------------------
// BASE91 (bit-level port)
// ---------------------------------------------------------------------------

function base91EncodeBytes(data: Uint8Array): string {
  let b = 0;
  let n = 0;
  const out: string[] = [];
  for (const byte of data) {
    b |= byte << n;
    n += 8;
    if (n > 13) {
      let v = b & 8191;
      if (v > 88) {
        b >>= 13;
        n -= 13;
      } else {
        v = b & 16383;
        b >>= 14;
        n -= 14;
      }
      out.push(BASE91_ALPHABET[v % 91]);
      out.push(BASE91_ALPHABET[Math.floor(v / 91)]);
    }
  }
  if (n) {
    out.push(BASE91_ALPHABET[b % 91]);
    if (n > 7 || b > 90) out.push(BASE91_ALPHABET[Math.floor(b / 91)]);
  }
  return out.join('');
}

function base91DecodeBytes(text: string): Uint8Array {
  let v = -1;
  let b = 0;
  let n = 0;
  const out: number[] = [];
  for (const ch of text) {
    const c = BASE91_ALPHABET.indexOf(ch);
    if (c < 0) fail('base.invalidChar', { char: ch });
    if (v < 0) {
      v = c;
    } else {
      v += c * 91;
      b |= v << n;
      n += (v & 8191) > 88 ? 13 : 14;
      while (n > 7) {
        out.push(b & 255);
        b >>= 8;
        n -= 8;
      }
      v = -1;
    }
  }
  if (v !== -1) out.push((b | (v << n)) & 255);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// Public API (mirrors `_base_encode` / `_base_decode`)
// ---------------------------------------------------------------------------

export const BASE_CODECS = ['BASE64', 'BASE58', 'BASE62', 'BASE85', 'BASE91'] as const;
export type BaseCodec = (typeof BASE_CODECS)[number];

export function isBaseCodec(value: string): value is BaseCodec {
  return (BASE_CODECS as readonly string[]).includes(value);
}

export function baseEncode(text: string, name: string): string {
  const codec = name.toUpperCase();
  const data = utf8Encode(text);
  switch (codec) {
    case 'BASE64':
      return base64EncodeBytes(data);
    case 'BASE58':
      return baseNEncode(data, BASE58_ALPHABET);
    case 'BASE62':
      return baseNEncode(data, BASE62_ALPHABET);
    case 'BASE85':
      return ascii85EncodeBytes(data);
    case 'BASE91':
      return base91EncodeBytes(data);
    default:
      fail('base.unsupported', { name: codec });
  }
}

export function baseDecode(text: string, name: string): string {
  const codec = name.toUpperCase();
  try {
    let raw: Uint8Array;
    if (codec === 'BASE64') {
      raw = base64DecodeBytes(text);
    } else if (codec === 'BASE85') {
      let t = text.trim();
      if (t.startsWith('<~') && t.endsWith('~>')) t = t.slice(2, -2);
      raw = ascii85DecodeBytes(t);
    } else if (codec === 'BASE58') {
      raw = baseNDecode(text.trim(), BASE58_ALPHABET);
    } else if (codec === 'BASE62') {
      raw = baseNDecode(text.trim(), BASE62_ALPHABET);
    } else if (codec === 'BASE91') {
      raw = base91DecodeBytes(text.trim());
    } else {
      fail('base.unsupported', { name: codec });
    }
    return utf8Decode(raw);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    fail('base.decodeFailed');
  }
}
