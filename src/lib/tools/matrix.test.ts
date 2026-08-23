import { describe, expect, it } from 'vitest';

import { MT19937 } from './matrix';
import { matrixDecode, matrixEncode, matrixTranspose } from './matrix';
import fixture from './fixtures/pytk-expected.json';

interface MatrixFixtureCase {
  ip: string;
  port: number;
  rev: number;
  key: string;
  matrix: number[][];
  endpoint: string;
  checksum: number;
  rbf_class: number | null;
  rbf_distance: number;
  valid: boolean;
  transposed: number[][];
}

const matrixCases = (fixture.matrix as unknown as MatrixFixtureCase[]);

describe('MT19937 CPython parity', () => {
  it('reproduces Python 3.14 randrange(10) for a string seed', () => {
    const rng = MT19937.fromStringSeed('726791|1|192.168.1.100|7573');
    expect(Array.from({ length: 20 }, () => rng.randrange(10))).toEqual([
      4, 4, 0, 9, 3, 9, 3, 1, 8, 7, 9, 4, 1, 9, 0, 7, 0, 6, 0, 9,
    ]);
  });
});

describe('matrix encode', () => {
  it.each(matrixCases)('matches the pytk output for $ip:$port', (case_) => {
    const matrix = matrixEncode(case_.ip, case_.port, case_.rev, case_.key);
    expect(matrix).toEqual(case_.matrix);
  });

  it('defaults revision and decoy key like the pytk panel', () => {
    const explicit = matrixEncode('192.168.1.100', 7573, 1, '726791');
    expect(matrixEncode('192.168.1.100', 7573)).toEqual(explicit);
  });

  it('rejects invalid IPs', () => {
    expect(() => matrixEncode('999.1.1.1', 7573)).toThrowError('matrix.ipInvalid');
    expect(() => matrixEncode('not-an-ip', 7573)).toThrowError('matrix.ipInvalid');
  });

  it('rejects out-of-range ports', () => {
    expect(() => matrixEncode('127.0.0.1', 70000)).toThrowError('matrix.portRange');
  });
});

describe('matrix decode', () => {
  it.each(matrixCases)('round-trips the generated matrix for $ip:$port', (case_) => {
    const info = matrixDecode(case_.matrix);
    expect(info.endpoint).toBe(case_.endpoint);
    expect(info.checksum).toBe(case_.checksum);
    expect(info.rbfClass).toBe(case_.rbf_class);
    expect(info.rbfDistance).toBe(case_.rbf_distance);
    expect(info.valid).toBe(true);
  });

  it('flags a corrupted matrix as invalid', () => {
    const matrix = matrixEncode('10.0.0.1', 443, 2, '123456');
    // Cell (0,5) carries payload data; flipping it must break validation.
    matrix[0][5] = (matrix[0][5] + 1) % 10;
    const info = matrixDecode(matrix);
    expect(info.valid).toBe(false);
  });

  it('rejects non-7×7 matrices', () => {
    expect(() => matrixDecode([[1, 2]])).toThrowError('matrix.size');
  });
});

describe('matrix transpose', () => {
  it('matches the pytk transpose', () => {
    const case_ = matrixCases[0];
    expect(matrixTranspose(case_.matrix)).toEqual(case_.transposed);
  });

  it('rejects non-square matrices', () => {
    expect(() => matrixTranspose([[1, 2], [3]])).toThrowError('matrix.square');
  });
});
