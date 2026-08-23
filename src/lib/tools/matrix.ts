/**
 * 7×7 IP/port puzzle matrix tool ported from CFMS工具箱_v1.10.0.pyw.
 *
 * The generator reproduces CPython's `random.Random(str)` seeding exactly:
 * Python 3.11+ builds the seed integer from `utf8(text) + sha512(utf8(text))`
 * and feeds its little-endian 32-bit limbs to MT19937's init_by_array.
 * `randrange(10)` (rejection sampling over getrandbits(4)) fills the grid.
 */

import { fail } from './errors';
import { concatBytes, sha512Bytes, utf8Encode } from './sha';

// ---------------------------------------------------------------------------
// MT19937 (CPython-compatible)
// ---------------------------------------------------------------------------

export class MT19937 {
  private readonly mt = new Uint32Array(624);
  private index = 624;

  /** Seed exactly like CPython `random.Random(string)`. */
  static fromStringSeed(text: string): MT19937 {
    const bytes = utf8Encode(text);
    const digest = sha512Bytes(bytes);
    const total = concatBytes(bytes, digest);
    const n = Math.ceil(total.length / 4);
    const words = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let word = 0;
      for (let k = 0; k < 4; k++) {
        const idx = total.length - 1 - (i * 4 + k);
        word |= (idx >= 0 ? total[idx] : 0) << (8 * k);
      }
      words[i] = word >>> 0;
    }
    const mt = new MT19937();
    mt.initByArray(words);
    return mt;
  }

  private initGenrand(seed: number): void {
    this.mt[0] = seed >>> 0;
    for (let mti = 1; mti < 624; mti++) {
      const prev = this.mt[mti - 1];
      this.mt[mti] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + mti) >>> 0;
    }
  }

  private initByArray(key: Uint32Array): void {
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    const k = Math.max(624, key.length);
    for (let iteration = 0; iteration < k; iteration++) {
      const prev = this.mt[i - 1];
      const mixed = Math.imul(prev ^ (prev >>> 30), 1664525);
      this.mt[i] = ((this.mt[i] ^ mixed) + j + key[j]) >>> 0;
      i += 1;
      j += 1;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let iteration = 0; iteration < 623; iteration++) {
      const prev = this.mt[i - 1];
      const mixed = Math.imul(prev ^ (prev >>> 30), 1566083941);
      this.mt[i] = ((this.mt[i] ^ mixed) - i) >>> 0;
      i += 1;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
    }
    this.mt[0] = 0x80000000;
    this.index = 624;
  }

  genrand(): number {
    if (this.index >= 624) {
      let kk = 0;
      for (; kk < 227; kk++) {
        const y = (this.mt[kk] & 0x80000000) | (this.mt[kk + 1] & 0x7fffffff);
        this.mt[kk] = (this.mt[kk + 397] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)) >>> 0;
      }
      for (; kk < 623; kk++) {
        const y = (this.mt[kk] & 0x80000000) | (this.mt[kk + 1] & 0x7fffffff);
        this.mt[kk] = (this.mt[kk - 227] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)) >>> 0;
      }
      const y = (this.mt[623] & 0x80000000) | (this.mt[0] & 0x7fffffff);
      this.mt[623] = (this.mt[396] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)) >>> 0;
      this.index = 0;
    }
    let y = this.mt[this.index];
    this.index += 1;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  getrandbits(bits: number): number {
    if (bits <= 0) return 0;
    if (bits >= 32) return this.genrand();
    return this.genrand() >>> (32 - bits);
  }

  /** Random integer in [0, n) using the same rejection sampling as CPython. */
  randrange(n: number): number {
    const bits = 32 - Math.clz32(n);
    let r = this.getrandbits(bits);
    while (r >= n) r = this.getrandbits(bits);
    return r;
  }
}

// ---------------------------------------------------------------------------
// Matrix encode / decode
// ---------------------------------------------------------------------------

const MATRIX_WEIGHTS = [1, 3, 7, 9];

function matrixLayerPath(
  maps: number,
  size: number,
  kernel: number,
  count: number,
  partial = false,
): number[] {
  const start = (maps - 1) % 7;
  const direction = size % 2 === 0 ? 1 : -1;
  const cycle = Array.from({ length: 7 }, (_, index) =>
    (((start + direction * index * kernel) % 7) + 7) % 7,
  );
  if (partial) return [cycle[0], cycle[2], cycle[4]];
  return cycle.slice(0, count);
}

const MATRIX_PATHS: ReadonlyArray<readonly number[]> = [
  matrixLayerPath(6, 28, 5, 3),
  matrixLayerPath(6, 14, 2, 3),
  matrixLayerPath(16, 10, 5, 3, true),
  matrixLayerPath(16, 5, 2, 3),
  matrixLayerPath(120, 1, 5, 5),
];

function matrixChecksum(payload: string): number {
  let total = 0;
  for (let index = 0; index < payload.length; index++) {
    total += Number(payload[index]) * MATRIX_WEIGHTS[index % MATRIX_WEIGHTS.length];
  }
  return ((-total) % 10 + 10) % 10;
}

function matrixHamming74(value: number): number[] {
  if (value < 0 || value > 9) fail('matrix.rbfClass');
  const d1 = (value >> 3) & 1;
  const d2 = (value >> 2) & 1;
  const d3 = (value >> 1) & 1;
  const d4 = value & 1;
  const p1 = d1 ^ d2 ^ d4;
  const p2 = d1 ^ d3 ^ d4;
  const p3 = d2 ^ d3 ^ d4;
  return [p1, p2, d1, p3, d2, d3, d4];
}

const MATRIX_RBF_CODES: ReadonlyArray<readonly number[]> = Array.from({ length: 10 }, (_, value) =>
  matrixHamming74(value),
);

function parseIpv4(ip: string): number[] {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) fail('matrix.ipInvalid');
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) fail('matrix.ipInvalid');
    if (part.length > 1 && part.startsWith('0')) fail('matrix.ipInvalid');
    const octet = parseInt(part, 10);
    if (octet > 255) fail('matrix.ipInvalid');
    octets.push(octet);
  }
  return octets;
}

export function matrixEncode(
  ip: string,
  port: number,
  revision = 1,
  decoyKey = '726791',
): number[][] {
  const octets = parseIpv4(ip);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail('matrix.portRange');
  const fields = [
    ...octets.map((octet) => String(octet).padStart(3, '0')),
    String(port).padStart(5, '0'),
  ];
  const payload = fields.join('');
  const rng = MT19937.fromStringSeed(`${decoyKey}|${revision}|${ip.trim()}|${port}`);
  const matrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 7 }, () => rng.randrange(10)),
  );
  for (let row = 0; row < MATRIX_PATHS.length; row++) {
    const columns = MATRIX_PATHS[row];
    const field = fields[row];
    for (let i = 0; i < columns.length; i++) {
      matrix[row][columns[i]] = Number(field[i]);
    }
  }
  const check = matrixChecksum(payload);
  matrix[5] = matrixHamming74(check);
  matrix[6][(10 - 1) % 7] = check;
  return matrix;
}

export interface MatrixDecodeResult {
  endpoint: string;
  octets: number[];
  port: number;
  checksum: number;
  rbfClass: number | null;
  rbfDistance: number;
  valid: boolean;
}

function hammingDistance(a: readonly number[], b: readonly number[]): number {
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance;
}

export function matrixDecode(matrix: number[][]): MatrixDecodeResult {
  if (matrix.length !== 7 || matrix.some((row) => row.length !== 7)) {
    fail('matrix.size');
  }
  if (matrix.some((row) => row.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 9))) {
    fail('matrix.digits');
  }
  const fields = MATRIX_PATHS.map((columns, row) =>
    columns.map((column) => String(matrix[row][column])).join(''),
  );
  const octets = fields.slice(0, 4).map((field) => parseInt(field, 10));
  const port = parseInt(fields[4], 10);
  const payload = fields.join('');
  const expectedCheck = matrixChecksum(payload);
  const f6 = matrix[5];
  if (f6.some((bit) => bit !== 0 && bit !== 1)) fail('matrix.f6');
  const distances = MATRIX_RBF_CODES.map((code) => hammingDistance(f6, code));
  const nearestDistance = Math.min(...distances);
  const nearestClasses = distances
    .map((distance, value) => (distance === nearestDistance ? value : -1))
    .filter((value) => value >= 0);
  const rbfClass = nearestClasses.length === 1 ? nearestClasses[0] : null;
  const storedClass = matrix[6][(10 - 1) % 7];
  const rangesValid =
    octets.every((octet) => octet >= 0 && octet <= 255) && port >= 0 && port <= 65535;
  const checksumValid = rbfClass === expectedCheck && storedClass === expectedCheck;
  return {
    endpoint: `${octets.join('.')}:${port}`,
    octets,
    port,
    checksum: expectedCheck,
    rbfClass,
    rbfDistance: nearestDistance,
    valid: rangesValid && checksumValid,
  };
}

export function matrixTranspose(matrix: number[][]): number[][] {
  if (matrix.length === 0 || matrix.some((row) => row.length !== matrix.length)) {
    fail('matrix.square');
  }
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}
