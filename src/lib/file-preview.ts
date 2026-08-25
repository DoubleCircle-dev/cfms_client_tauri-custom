// File preview helpers shared by the explorer preview panel.

// iconv-lite relies on Node's `buffer`; install the browser polyfill before
// it evaluates so text decoding works inside WebView2.
import { Buffer } from 'buffer';
import iconv from 'iconv-lite';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

export type PreviewKind = 'image' | 'audio' | 'text';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
const TEXT_EXTS = ['txt', 'md', 'yaml', 'yml'];

/** Classify a file name into a preview kind, or null when unsupported. */
export function previewKindFor(filename: string): PreviewKind | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (TEXT_EXTS.includes(ext)) return 'text';
  return null;
}

/** Decode a base64 string into raw bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface DecodedText {
  text: string;
  encoding: string;
}

/**
 * Decode raw text bytes using BOM detection first, then a strict UTF-8
 * attempt, falling back to GBK (the most common legacy encoding for Chinese
 * text files).
 */
export function decodeTextBytes(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: iconv.decode(bytes.subarray(3), 'utf-8'), encoding: 'UTF-8' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: iconv.decode(bytes.subarray(2), 'utf-16le'), encoding: 'UTF-16LE' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: iconv.decode(bytes.subarray(2), 'utf-16be'), encoding: 'UTF-16BE' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    // Not valid UTF-8 — fall through to a legacy encoding.
  }
  return { text: iconv.decode(bytes, 'gbk'), encoding: 'GBK' };
}
