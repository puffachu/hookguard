import { describe, expect, it } from 'vitest';
import { encodeV4Operation } from '../src/v4-encoding.js';
import type { PoolKey } from '../src/pool-key.js';

const key: PoolKey = {
  currency0: `0x${'00'.repeat(20)}`,
  currency1: `0x${'01'.repeat(20)}`,
  fee: 500,
  tickSpacing: 10,
  hooks: `0x${((1n << 7n) | (1n << 6n)).toString(16).padStart(40, '0')}`,
};

describe('canonical V4 operation encoding', () => {
  it('encodes swap, liquidity, and donation selectors', () => {
    expect(encodeV4Operation(key, { kind: 'swap', amount: -1000n, zeroForOne: true }).slice(0, 10)).toBe('0xf3cd914c');
    expect(encodeV4Operation(key, { kind: 'add', amount: 1n }).slice(0, 10)).toBe('0x5a6bcfda');
    expect(encodeV4Operation(key, { kind: 'remove', amount: 2n }).slice(0, 10)).toBe('0x5a6bcfda');
    expect(encodeV4Operation(key, { kind: 'donate', amount: 3n }).slice(0, 10)).toBe('0x234266d7');
  });

  it('rejects unsafe or malformed requests', () => {
    const zeroHook: PoolKey = { ...key, hooks: `0x${'00'.repeat(20)}` };
    expect(() => encodeV4Operation(zeroHook, { kind: 'swap', amount: -1n })).toThrow(TypeError);
    expect(() => encodeV4Operation(key, { kind: 'swap', amount: 0n })).toThrow(RangeError);
  });
});
