/**
 * Text cipher / conversion utilities ported from CFMS工具箱_v1.10.0.pyw.
 *
 * The functions intentionally mirror the Python behavior including input
 * validation and error messages (surfaced through localized i18n keys).
 */

import { fail } from './errors';
import { sha256Hex } from './sha';

export const MORSE_MAP: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.',
  F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---',
  P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--',
  Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.',
  '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.',
  '$': '...-..-', '@': '.--.-.',
};

const MORSE_REV: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_MAP).map(([key, value]) => [value, key]),
);

const RADIX_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const ADFGVX_ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ADFGVX_SYMS = 'ADFGVX';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseStrictInt(value: string, radix = 10): number {
  const s = value.trim();
  if (!/^[+-]?\d+$/.test(s)) fail('ciphers.integer');
  return parseInt(s, radix);
}

function parseRadixToBigInt(text: string, radix: number): bigint {
  let s = text.trim();
  if (!s) fail('ciphers.radix.number');
  let negative = false;
  if (s.startsWith('-') || s.startsWith('+')) {
    negative = s.startsWith('-');
    s = s.slice(1);
  }
  if (!s) fail('ciphers.radix.number');
  if (
    (radix === 16 && /^0[xX]/.test(s)) ||
    (radix === 8 && /^0[oO]/.test(s)) ||
    (radix === 2 && /^0[bB]/.test(s))
  ) {
    s = s.slice(2);
  }
  if (!s) fail('ciphers.radix.number');
  let n = 0n;
  for (const ch of s) {
    const digit = RADIX_DIGITS.indexOf(ch.toUpperCase());
    if (digit < 0 || digit >= radix) fail('ciphers.radix.parse', { radix: String(radix) });
    n = n * BigInt(radix) + BigInt(digit);
  }
  return negative ? -n : n;
}

function bigIntToRadix(value: bigint, radix: number): string {
  if (value === 0n) return '0';
  const negative = value < 0n;
  let n = negative ? -value : value;
  const digits: string[] = [];
  const r = BigInt(radix);
  while (n > 0n) {
    digits.push(RADIX_DIGITS[Number(n % r)]);
    n /= r;
  }
  return (negative ? '-' : '') + digits.reverse().join('');
}

function shiftLetters(text: string, shift: number): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      out += String.fromCharCode(((code - 65 + shift) % 26 + 26) % 26 + 65);
    } else if (code >= 97 && code <= 122) {
      out += String.fromCharCode(((code - 97 + shift) % 26 + 26) % 26 + 97);
    } else {
      out += ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Caesar
// ---------------------------------------------------------------------------

function parseCaesarShift(shiftText: string): number {
  return (parseStrictInt(shiftText || '0') % 26 + 26) % 26;
}

export function caesarEncode(text: string, shiftText: string): string {
  return shiftLetters(text, parseCaesarShift(shiftText));
}

export function caesarDecode(text: string, shiftText: string): string {
  return shiftLetters(text, -parseCaesarShift(shiftText));
}

// ---------------------------------------------------------------------------
// Vigenère (numeric key => Gronsfeld)
// ---------------------------------------------------------------------------

function vigenereShifts(key: string): number[] {
  if (/^\d+$/.test(key)) {
    return [...key].map((ch) => Number(ch));
  }
  return [...key.toUpperCase()]
    .filter((ch) => ch >= 'A' && ch <= 'Z')
    .map((ch) => ch.charCodeAt(0) - 65);
}

function vigenereRun(text: string, key: string, decode: boolean): string {
  const shifts = vigenereShifts(key);
  if (shifts.length === 0) fail('ciphers.vigenere.key');
  let out = '';
  let ki = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      const delta = decode ? -shifts[ki % shifts.length] : shifts[ki % shifts.length];
      out += String.fromCharCode(((code - 65 + delta) % 26 + 26) % 26 + 65);
      ki += 1;
    } else if (code >= 97 && code <= 122) {
      const delta = decode ? -shifts[ki % shifts.length] : shifts[ki % shifts.length];
      out += String.fromCharCode(((code - 97 + delta) % 26 + 26) % 26 + 97);
      ki += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

export function vigenereEncode(text: string, key: string): string {
  return vigenereRun(text, key, false);
}

export function vigenereDecode(text: string, key: string): string {
  return vigenereRun(text, key, true);
}

// ---------------------------------------------------------------------------
// Atbash
// ---------------------------------------------------------------------------

export function atbash(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      out += String.fromCharCode(90 - (code - 65));
    } else if (code >= 97 && code <= 122) {
      out += String.fromCharCode(122 - (code - 97));
    } else {
      out += ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// A1Z26
// ---------------------------------------------------------------------------

export function a1z26Encode(text: string): string {
  const parts: string[] = [];
  for (const ch of text.toUpperCase()) {
    if (ch >= 'A' && ch <= 'Z') parts.push(String(ch.charCodeAt(0) - 64));
  }
  return parts.join('-');
}

export function a1z26Decode(text: string): string {
  const parts = text.trim().split(/[\s,，、;；-]+/).filter(Boolean);
  if (parts.length === 0) fail('ciphers.a1z26.numbers');
  let out = '';
  for (const part of parts) {
    if (!/^\d+$/.test(part)) fail('ciphers.a1z26.invalid', { value: part });
    const n = parseInt(part, 10);
    if (n < 1 || n > 26) fail('ciphers.a1z26.range', { value: String(n) });
    out += String.fromCharCode(64 + n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Keyword substitution
// ---------------------------------------------------------------------------

function keywordAlphabet(key: string): string {
  const seen: string[] = [];
  for (const ch of key.toUpperCase()) {
    if (ch >= 'A' && ch <= 'Z' && !seen.includes(ch)) seen.push(ch);
  }
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (!seen.includes(ch)) seen.push(ch);
  }
  return seen.join('');
}

function keywordSub(text: string, key: string, decode: boolean): string {
  if (!key) fail('ciphers.keyword.key');
  const alphabet = keywordAlphabet(key);
  const table = new Map<string, string>();
  if (decode) {
    for (let i = 0; i < alphabet.length; i++) {
      table.set(alphabet[i], String.fromCharCode(65 + i));
    }
  } else {
    for (let i = 0; i < 26; i++) {
      table.set(String.fromCharCode(65 + i), alphabet[i]);
    }
  }
  let out = '';
  for (const ch of text) {
    const upper = ch.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') {
      const mapped = table.get(upper) ?? upper;
      out += ch === ch.toLowerCase() && ch >= 'a' && ch <= 'z' ? mapped.toLowerCase() : mapped;
    } else {
      out += ch;
    }
  }
  return out;
}

export function keywordEncode(text: string, key: string): string {
  return keywordSub(text, key, false);
}

export function keywordDecode(text: string, key: string): string {
  return keywordSub(text, key, true);
}

// ---------------------------------------------------------------------------
// Simple substitution (26-letter alphabet)
// ---------------------------------------------------------------------------

function simpleAlphabet(alphabet: string): string {
  const filtered = [...alphabet.toUpperCase()].filter((ch) => ch >= 'A' && ch <= 'Z').join('');
  if (filtered.length !== 26 || new Set(filtered).size !== 26) {
    fail('ciphers.simple.alphabet');
  }
  return filtered;
}

function simpleSub(text: string, alphabet: string, decode: boolean): string {
  const alph = simpleAlphabet(alphabet);
  const table = new Map<string, string>();
  if (decode) {
    for (let i = 0; i < alph.length; i++) {
      table.set(alph[i], String.fromCharCode(65 + i));
    }
  } else {
    for (let i = 0; i < 26; i++) {
      table.set(String.fromCharCode(65 + i), alph[i]);
    }
  }
  let out = '';
  for (const ch of text) {
    const upper = ch.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') {
      const mapped = table.get(upper) ?? upper;
      out += ch === ch.toLowerCase() && ch >= 'a' && ch <= 'z' ? mapped.toLowerCase() : mapped;
    } else {
      out += ch;
    }
  }
  return out;
}

export function simpleEncode(text: string, alphabet: string): string {
  return simpleSub(text, alphabet, false);
}

export function simpleDecode(text: string, alphabet: string): string {
  return simpleSub(text, alphabet, true);
}

// ---------------------------------------------------------------------------
// Baconian
// ---------------------------------------------------------------------------

export function baconianEncode(text: string): string {
  const out: string[] = [];
  for (const ch of text.toUpperCase()) {
    if (ch >= 'A' && ch <= 'Z') {
      const n = ch.charCodeAt(0) - 65;
      let group = '';
      for (let i = 4; i >= 0; i--) {
        group += (n >> i) & 1 ? 'B' : 'A';
      }
      out.push(group);
    }
  }
  return out.join(' ');
}

export function baconianDecode(text: string): string {
  const cleaned = [...text.toUpperCase().replaceAll('0', 'A').replaceAll('1', 'B')]
    .filter((ch) => ch === 'A' || ch === 'B')
    .join('');
  if (!cleaned) fail('ciphers.baconian.none');
  if (cleaned.length % 5 !== 0) fail('ciphers.baconian.length');
  let out = '';
  for (let i = 0; i < cleaned.length; i += 5) {
    const group = cleaned.slice(i, i + 5);
    let n = 0;
    for (const ch of group) n = (n << 1) | (ch === 'B' ? 1 : 0);
    if (n > 25) fail('ciphers.baconian.invalid', { group });
    out += String.fromCharCode(65 + n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Morse
// ---------------------------------------------------------------------------

export function morseEncode(text: string): string {
  const words: string[] = [];
  for (const word of text.toUpperCase().split(/\s+/)) {
    if (!word) continue;
    const codes = [...word].filter((ch) => MORSE_MAP[ch] !== undefined).map((ch) => MORSE_MAP[ch]);
    if (codes.length > 0) words.push(codes.join(' '));
  }
  return words.join(' / ');
}

export function morseDecode(text: string): string {
  const words: string[] = [];
  for (const word of text.replaceAll('／', '/').split('/')) {
    const chars = word
      .split(/\s+/)
      .filter((code) => MORSE_REV[code] !== undefined)
      .map((code) => MORSE_REV[code]);
    if (chars.length > 0) words.push(chars.join(''));
  }
  return words.join(' ');
}

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

export function sha256Tool(text: string): string {
  return sha256Hex(text);
}

// ---------------------------------------------------------------------------
// ASCII / Unicode ordinal conversion
// ---------------------------------------------------------------------------

export function asciiEncode(text: string): string {
  return [...text].map((ch) => String(ch.codePointAt(0))).join(' ');
}

export function asciiDecode(text: string): string {
  const parts = text.trim().split(/[\s,，、;；]+/).filter(Boolean);
  if (parts.length === 0) fail('ciphers.ascii.numbers');
  let out = '';
  for (const part of parts) {
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) n = parseInt(part.slice(2), 16);
    else if (/^0[bB][01]+$/.test(part)) n = parseInt(part.slice(2), 2);
    else if (/^0[oO][0-7]+$/.test(part)) n = parseInt(part.slice(2), 8);
    else if (/^[+-]?\d+$/.test(part)) n = parseInt(part, 10);
    else fail('ciphers.ascii.invalid', { value: part });
    if (n < 0 || n > 0x10ffff) fail('ciphers.ascii.range', { value: String(n) });
    out += String.fromCodePoint(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Radix conversion (2–36)
// ---------------------------------------------------------------------------

export function radixConvert(text: string, sourceRadix: number, targetRadix: number): string {
  return bigIntToRadix(parseRadixToBigInt(text, sourceRadix), targetRadix);
}

function parseRadixSetting(value: string): number {
  const radix = parseStrictInt(value || '10');
  if (radix < 2 || radix > 36) fail('ciphers.radix.range');
  return radix;
}

export function radixEncode(text: string, sourceText: string, targetText: string): string {
  return radixConvert(text, parseRadixSetting(sourceText), parseRadixSetting(targetText));
}

export function radixDecode(text: string, sourceText: string, targetText: string): string {
  return radixConvert(text, parseRadixSetting(targetText), parseRadixSetting(sourceText));
}

// ---------------------------------------------------------------------------
// ADFGVX
// ---------------------------------------------------------------------------

interface AdfgvxGrid {
  grid: string[][];
  positions: Map<string, [number, number]>;
}

function adfgvxGrid(key: string): AdfgvxGrid {
  const seen: string[] = [];
  for (const ch of (key.toUpperCase() + ADFGVX_ALPH)) {
    if (ADFGVX_ALPH.includes(ch) && !seen.includes(ch)) seen.push(ch);
  }
  const grid: string[][] = [];
  for (let i = 0; i < 6; i++) grid.push(seen.slice(i * 6, i * 6 + 6));
  const positions = new Map<string, [number, number]>();
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) positions.set(grid[r][c], [r, c]);
  }
  return { grid, positions };
}

function adfgvxColumnOrder(square: string): number[] {
  return [...Array(square.length).keys()].sort(
    (a, b) => square.charCodeAt(a) - square.charCodeAt(b),
  );
}

export function adfgvxEncode(text: string, key: string, square: string): string {
  const k = key.toUpperCase();
  const sq = square.toUpperCase();
  if (!k) fail('ciphers.adfgvx.key');
  if (!sq) fail('ciphers.adfgvx.square');
  const { positions } = adfgvxGrid(k);
  const n = sq.length;
  let plain = [...text.toUpperCase()].filter((ch) => positions.has(ch)).join('');
  if (!plain) fail('ciphers.adfgvx.noPlain');
  while ((2 * plain.length) % n !== 0) plain += 'A';
  let syms = '';
  for (const ch of plain) {
    const [r, c] = positions.get(ch)!;
    syms += ADFGVX_SYMS[r] + ADFGVX_SYMS[c];
  }
  const rows: string[] = [];
  for (let i = 0; i < syms.length; i += n) rows.push(syms.slice(i, i + n));
  const order = adfgvxColumnOrder(sq);
  let out = '';
  for (const c of order) {
    for (const row of rows) out += row[c];
  }
  return out;
}

export function adfgvxDecode(text: string, key: string, square: string): string {
  const k = key.toUpperCase();
  const sq = square.toUpperCase();
  if (!k) fail('ciphers.adfgvx.key');
  if (!sq) fail('ciphers.adfgvx.square');
  const { grid } = adfgvxGrid(k);
  const reverse = new Map<string, string>();
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      reverse.set(ADFGVX_SYMS[r] + ADFGVX_SYMS[c], grid[r][c]);
    }
  }
  const n = sq.length;
  const cipherText = [...text.toUpperCase()].filter((ch) => ADFGVX_SYMS.includes(ch)).join('');
  if (!cipherText || cipherText.length % n !== 0) {
    fail('ciphers.adfgvx.length', { square: sq });
  }
  const rowsCount = cipherText.length / n;
  const order = adfgvxColumnOrder(sq);
  const columns = new Map<number, string>();
  let idx = 0;
  for (const c of order) {
    columns.set(c, cipherText.slice(idx, idx + rowsCount));
    idx += rowsCount;
  }
  let syms = '';
  for (let r = 0; r < rowsCount; r++) {
    for (let c = 0; c < n; c++) syms += columns.get(c)![r];
  }
  let out = '';
  for (let i = 0; i < syms.length; i += 2) {
    const pair = syms.slice(i, i + 2);
    if (pair.length < 2) break;
    out += reverse.get(pair) ?? '?';
  }
  return out.replace(/A+$/, '');
}
