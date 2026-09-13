/**
 * Character encoding conversion (乱码修复) ported from the 小工具 panel of
 * CFMS工具箱_v1.10.0.pyw.
 *
 * Python's strict codec semantics (raise on unencodable characters or invalid
 * byte sequences) are approximated by a round-trip check, since iconv-lite
 * replaces rather than errors by default.
 */

// The bundled iconv-lite relies on Node's `buffer`; install the browser
// polyfill before it evaluates so the encoding tool works inside WebView2.
//
// `buffer` is a CommonJS package. Vite's dev pre-bundling exposes it with a
// default export (the `module.exports` object) rather than a named `Buffer`
// export, so destructure from the default import instead of using a named
// import (which throws "does not provide an export named 'Buffer'").
import bufferModule from 'buffer';
const { Buffer } = bufferModule;

import iconv from 'iconv-lite';

import { fail, ToolError } from './errors';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

export const ENCODING_OPTIONS = [
  'UTF-8',
  'GBK',
  'GB2312',
  'Big5',
  'Shift_JIS',
  'EUC-JP',
  'ISO-8859-1',
  'ASCII',
] as const;

export type EncodingName = (typeof ENCODING_OPTIONS)[number];

function iconvName(name: string): string {
  switch (name.toUpperCase()) {
    case 'UTF-8':
      return 'utf-8';
    case 'GBK':
      return 'gbk';
    case 'GB2312':
      return 'gb2312';
    case 'BIG5':
      return 'big5';
    case 'SHIFT_JIS':
      return 'shift_jis';
    case 'EUC-JP':
      return 'euc-jp';
    case 'ISO-8859-1':
      return 'iso-8859-1';
    case 'ASCII':
      return 'ascii';
    default:
      fail('encodings.unsupported', { name });
  }
}

function encodeStrict(text: string, encoding: string): Uint8Array {
  const encoded = iconv.encode(text, iconvName(encoding));
  const roundTrip = iconv.decode(encoded, iconvName(encoding));
  if (roundTrip !== text) fail('encodings.encodeFailed', { encoding });
  return new Uint8Array(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function decodeStrict(bytes: Uint8Array, encoding: string): string {
  const decoded = iconv.decode(bytes, iconvName(encoding));
  const reEncoded = iconv.encode(decoded, iconvName(encoding));
  const reBytes = new Uint8Array(
    reEncoded.buffer.slice(reEncoded.byteOffset, reEncoded.byteOffset + reEncoded.byteLength),
  );
  if (!bytesEqual(reBytes, bytes)) {
    fail('encodings.decodeFailed', { encoding });
  }
  return decoded;
}

/**
 * Mirror of Python `_enc_convert`: encode `text` with `sourceEncoding`, then
 * decode the resulting bytes with `targetEncoding`.
 */
export function convertEncoding(
  text: string,
  sourceEncoding: string,
  targetEncoding: string,
): string {
  try {
    const bytes = encodeStrict(text, sourceEncoding);
    return decodeStrict(bytes, targetEncoding);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    fail('encodings.convertFailed');
  }
}

export function encodingEncode(text: string, keys: string[]): string {
  return convertEncoding(text, keys[0], keys[1]);
}

export function encodingDecode(text: string, keys: string[]): string {
  return convertEncoding(text, keys[1], keys[0]);
}
