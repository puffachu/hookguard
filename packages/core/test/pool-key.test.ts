import { describe, expect, it } from 'vitest';
import { normalizePoolKey, poolId } from '../src/pool-key.js';

const zero = `0x${'00'.repeat(20)}` as const;
const one = `0x${'01'.repeat(20)}` as const;
const hook = `0x${((1n << 7n) | (1n << 6n)).toString(16).padStart(40, '0')}` as const;
const key = { currency0: zero, currency1: one, fee: 500, tickSpacing: 10, hooks: hook };

describe('explicit V4 PoolKey', () => {
  it('normalizes addresses and computes canonical ABI-encoded PoolID', () => {
    expect(normalizePoolKey(key)).toEqual(key);
    expect(poolId(key)).toBe('0xbf974dfda63b40a1c0849444afef3251737b0bce0c565549585452e9541effcb');
  });

  it('validates numeric and address boundaries', () => {
    expect(() => normalizePoolKey({ ...key, fee: -1 })).toThrow(RangeError);
    expect(() => normalizePoolKey({ ...key, fee: 0x1000000 })).toThrow(RangeError);
    expect(() => normalizePoolKey({ ...key, tickSpacing: -(2 ** 23) })).toThrow(RangeError);
    expect(() => normalizePoolKey({ ...key, tickSpacing: 2 ** 23 })).toThrow(RangeError);
    expect(() => normalizePoolKey({ ...key, hooks: '0x1234' as never })).toThrow(TypeError);
    expect(() => normalizePoolKey({ ...key, currency1: zero as never })).toThrow(TypeError);
    expect(() => normalizePoolKey({ ...key, currency0: one as never, currency1: zero as never })).toThrow(TypeError);
  });
});
