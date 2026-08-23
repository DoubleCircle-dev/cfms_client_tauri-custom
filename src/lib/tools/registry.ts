/**
 * Registry describing every built-in utility in the 小工具 page.
 *
 * Mirrors the tab list in CFMS工具箱_v1.10.0.pyw (`CryptoPanel._build_ui`).
 * `encode`/`decode` receive the raw text plus the current key values and
 * return the transformed text; they may throw `ToolError`.
 */

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
import { baseDecode, baseEncode, BASE_CODECS } from './base';
import { encodingDecode, encodingEncode, ENCODING_OPTIONS } from './encodings';

export interface ToolKeySpec {
  labelKey: string;
  defaultValue: string;
  options?: readonly string[];
}

export type ToolFunction = (text: string, keys: string[]) => string;

export interface ToolDefinition {
  id: string;
  tabLabelKey: string;
  hintKey: string;
  keySpecs: ToolKeySpec[];
  encode: ToolFunction;
  /** When absent the tool is single-action (e.g. "计算" for SHA-256). */
  decode?: ToolFunction;
  /** When encode is idempotent (Atbash) both buttons call the same function. */
  symmetric?: boolean;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'ascii',
    tabLabelKey: 'tools.tabs.ascii',
    hintKey: 'tools.hints.ascii',
    keySpecs: [],
    encode: (_text, keys) => asciiEncode(_text),
    decode: (_text) => asciiDecode(_text),
  },
  {
    id: 'a1z26',
    tabLabelKey: 'tools.tabs.a1z26',
    hintKey: 'tools.hints.a1z26',
    keySpecs: [],
    encode: (text) => a1z26Encode(text),
    decode: (text) => a1z26Decode(text),
  },
  {
    id: 'radix',
    tabLabelKey: 'tools.tabs.radix',
    hintKey: 'tools.hints.radix',
    keySpecs: [
      { labelKey: 'tools.keys.sourceRadix', defaultValue: '10' },
      { labelKey: 'tools.keys.targetRadix', defaultValue: '16' },
    ],
    encode: (text, keys) => radixEncode(text, keys[0], keys[1]),
    decode: (text, keys) => radixDecode(text, keys[0], keys[1]),
  },
  {
    id: 'base',
    tabLabelKey: 'tools.tabs.base',
    hintKey: 'tools.hints.base',
    keySpecs: [{ labelKey: 'tools.keys.baseCodec', defaultValue: 'BASE64', options: BASE_CODECS }],
    encode: (text, keys) => baseEncode(text, keys[0]),
    decode: (text, keys) => baseDecode(text, keys[0]),
  },
  {
    id: 'morse',
    tabLabelKey: 'tools.tabs.morse',
    hintKey: 'tools.hints.morse',
    keySpecs: [],
    encode: (text) => morseEncode(text),
    decode: (text) => morseDecode(text),
  },
  {
    id: 'baconian',
    tabLabelKey: 'tools.tabs.baconian',
    hintKey: 'tools.hints.baconian',
    keySpecs: [],
    encode: (text) => baconianEncode(text),
    decode: (text) => baconianDecode(text),
  },
  {
    id: 'caesar',
    tabLabelKey: 'tools.tabs.caesar',
    hintKey: 'tools.hints.caesar',
    keySpecs: [{ labelKey: 'tools.keys.caesarShift', defaultValue: '3' }],
    encode: (text, keys) => caesarEncode(text, keys[0]),
    decode: (text, keys) => caesarDecode(text, keys[0]),
  },
  {
    id: 'atbash',
    tabLabelKey: 'tools.tabs.atbash',
    hintKey: 'tools.hints.atbash',
    keySpecs: [],
    encode: (text) => atbash(text),
    decode: (text) => atbash(text),
    symmetric: true,
  },
  {
    id: 'vigenere',
    tabLabelKey: 'tools.tabs.vigenere',
    hintKey: 'tools.hints.vigenere',
    keySpecs: [{ labelKey: 'tools.keys.secretKey', defaultValue: '' }],
    encode: (text, keys) => vigenereEncode(text, keys[0]),
    decode: (text, keys) => vigenereDecode(text, keys[0]),
  },
  {
    id: 'keyword',
    tabLabelKey: 'tools.tabs.keyword',
    hintKey: 'tools.hints.keyword',
    keySpecs: [{ labelKey: 'tools.keys.secretKey', defaultValue: '' }],
    encode: (text, keys) => keywordEncode(text, keys[0]),
    decode: (text, keys) => keywordDecode(text, keys[0]),
  },
  {
    id: 'simple',
    tabLabelKey: 'tools.tabs.simple',
    hintKey: 'tools.hints.simple',
    keySpecs: [{ labelKey: 'tools.keys.substitutionAlphabet', defaultValue: '' }],
    encode: (text, keys) => simpleEncode(text, keys[0]),
    decode: (text, keys) => simpleDecode(text, keys[0]),
  },
  {
    id: 'adfgvx',
    tabLabelKey: 'tools.tabs.adfgvx',
    hintKey: 'tools.hints.adfgvx',
    keySpecs: [
      { labelKey: 'tools.keys.secretKey', defaultValue: '' },
      { labelKey: 'tools.keys.adfgvxSquare', defaultValue: '' },
    ],
    encode: (text, keys) => adfgvxEncode(text, keys[0], keys[1]),
    decode: (text, keys) => adfgvxDecode(text, keys[0], keys[1]),
  },
  {
    id: 'encoding',
    tabLabelKey: 'tools.tabs.encoding',
    hintKey: 'tools.hints.encoding',
    keySpecs: [
      { labelKey: 'tools.keys.sourceEncoding', defaultValue: 'UTF-8', options: ENCODING_OPTIONS },
      { labelKey: 'tools.keys.targetEncoding', defaultValue: 'GBK', options: ENCODING_OPTIONS },
    ],
    encode: (text, keys) => encodingEncode(text, keys),
    decode: (text, keys) => encodingDecode(text, keys),
  },
  {
    id: 'sha256',
    tabLabelKey: 'tools.tabs.sha256',
    hintKey: 'tools.hints.sha256',
    keySpecs: [],
    encode: (text) => sha256Tool(text),
  },
];

/** The matrix tool is rendered by a dedicated panel, not the generic tabs. */
export const MATRIX_TOOL_ID = 'matrix';
