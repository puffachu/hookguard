import { describe, expect, it } from 'vitest';
import { decodeHookPermissions, describePermissions } from '../src/hooks.js';

const ALL_FLAGS = (1n << 14n) - 1n;

describe('hook permission decoder', () => {
  it('decodes no permissions for zero address flags', () => {
    const hook = decodeHookPermissions(`0x${'00'.repeat(20)}`);
    expect(hook.enabled).toEqual([]);
    expect(hook.flags).toBe(0n);
    expect(describePermissions(hook)).toBe('No hook callbacks');
  });

  it('decodes beforeSwap and afterSwap bits using V4 flag positions', () => {
    const value = (1n << 7n) | (1n << 6n);
    const hook = decodeHookPermissions(`0x${value.toString(16).padStart(40, '0')}`);
    expect(hook.has('beforeSwap')).toBe(true);
    expect(hook.has('afterSwap')).toBe(true);
    expect(hook.has('beforeInitialize')).toBe(false);
  });

  it('decodes every supported flag independently and normalizes case', () => {
    for (let bit = 0; bit <= 13; bit += 1) {
      const value = 1n << BigInt(bit);
      const hook = decodeHookPermissions(`0X${value.toString(16).padStart(40, '0').toUpperCase()}`);
      expect(hook.enabled).toHaveLength(1);
    }
  });

  it('masks non-permission low address bytes without treating them as callbacks', () => {
    const valid = `0x${ALL_FLAGS.toString(16).padStart(40, '0')}`;
    expect(decodeHookPermissions(valid).enabled).toHaveLength(14);
    expect(() => decodeHookPermissions(`${valid}extra`)).toThrow(TypeError);
  });

  it('rejects malformed addresses', () => {
    expect(() => decodeHookPermissions('0x123')).toThrow(TypeError);
    expect(() => decodeHookPermissions('0xzz')).toThrow(TypeError);
  });
});
