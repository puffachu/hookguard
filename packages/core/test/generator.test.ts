import { describe, expect, it } from 'vitest';
import { generateSequence } from '../src/generator.js';
import { decodeHookPermissions } from '../src/hooks.js';

describe('adversarial sequence generator', () => {
  it('is deterministic by seed', () => {
    const first = generateSequence(42);
    const second = generateSequence(42);
    expect(first).toEqual(second);
  });

  it('produces distinct seeds and covers all operation kinds over many runs', () => {
    const kinds = new Set<string>();
    let collisions = 0;
    for (let seed = 0; seed < 500; seed += 1) {
      kinds.add(generateSequence(seed)[0]!.kind);
      collisions += generateSequence(seed).length === generateSequence(seed + 1).length ? 1 : 0;
    }
    expect(kinds.size).toBeGreaterThanOrEqual(6);
    expect(collisions).toBeGreaterThan(0);
  });

  it('includes extreme values, reentrancy, flash sources, boundaries, and negative ticks', () => {
    const operations = Array.from({ length: 500 }, (_, seed) => generateSequence(seed)).flat();
    expect(operations.some((op) => op.amount === 2n ** 256n - 1n)).toBe(true);
    expect(operations.some((op) => op.amount === 1n)).toBe(true);
    expect(operations.filter((op) => op.reentrant).length).toBeGreaterThan(50);
    expect(operations.filter((op) => op.source !== 'internal').map((op) => op.source)).toContain('aave-flash');
    expect(operations.map((op) => op.tickLower)).toContain(-887220);
    expect(operations.map((op) => op.tickUpper)).toContain(887220);
  });

  it('accepts permission context and validates bounds', () => {
    const permissions = decodeHookPermissions('0x00000000000000000000000000000000000000c0');
    expect(generateSequence(1, permissions, 2)).toHaveLength(2);
    expect(() => generateSequence(1.2)).toThrow(RangeError);
    expect(() => generateSequence(1, undefined, 0)).toThrow(RangeError);
    expect(() => generateSequence(1, undefined, 50001)).toThrow(RangeError);
  });
});

describe('permission-aware generation', () => {
  it('only emits operations enabled by V4 hook permissions', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const operations = generateSequence(seed, decodeHookPermissions('0x00000000000000000000000000000000000000c0'));
      expect(operations.map((operation) => operation.kind)).toSatisfy((kinds: string[]) =>
        kinds.every((kind) => kind === 'swap' || kind === 'swap-back' || kind === 'flash'),
      );
    }

    const liquidityHook = decodeHookPermissions(
      `0x${((1n << 11n) | (1n << 9n) | (1n << 3n)).toString(16).padStart(40, '0')}`,
    );
    expect(generateSequence(7, liquidityHook).map((operation) => operation.kind)).toEqual(
      expect.arrayContaining(['add', 'remove', 'flash']),
    );
    expect(generateSequence(7, liquidityHook)).toSatisfy((operations: { kind: string }[]) =>
      operations.every((operation) => operation.kind !== 'donate'),
    );
  });
});

describe('permission-aware generation by operation class', () => {
  it('enables donate only when donate callbacks are declared and retains flash coverage', () => {
    const donatePermissions = decodeHookPermissions(`0x${((1n << 5n) | (1n << 4n)).toString(16).padStart(40, '0')}`);
    for (let seed = 0; seed < 200; seed += 1) {
      const kinds = generateSequence(seed, donatePermissions).map((operation) => operation.kind);
      expect(kinds).toSatisfy((enabled: string[]) => enabled.every((kind) => kind === 'donate' || kind === 'flash'));
    }

    const kinds = Array.from({ length: 500 }, (_, seed) => generateSequence(seed, donatePermissions))
      .flat()
      .map((operation) => operation.kind);
    expect(kinds).toContain('donate');
    expect(kinds).toContain('flash');
  });
});
