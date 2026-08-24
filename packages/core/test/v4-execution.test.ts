import { describe, expect, it } from 'vitest';
import { decodeHookPermissions } from '../src/hooks.js';
import type { PoolKey } from '../src/pool-key.js';
import { createV4ExecutionPlans, executeV4Plan, type ExecutionOutcome } from '../src/v4-execution.js';

const hookAddress = `0x${((1n << 7n) | (1n << 6n)).toString(16).padStart(40, '0')}` as const;
const poolKey: PoolKey = {
  currency0: `0x${'00'.repeat(20)}`,
  currency1: `0x${'01'.repeat(20)}`,
  fee: 500,
  tickSpacing: 10,
  hooks: hookAddress,
};

describe('explicit V4 execution planning', () => {
  it('plans only executable operations against the supplied PoolManager', () => {
    const plans = createV4ExecutionPlans(
      { poolKey, poolManager: `0x${'22'.repeat(20)}` },
      decodeHookPermissions(hookAddress),
    );
    const items = plans.plan(42, 100);
    expect(items.length).toBeGreaterThan(50);
    expect(items.every((item) => item.to === `0x${'22'.repeat(20)}`)).toBe(true);
    expect(items.some((item) => item.operation.kind === 'swap')).toBe(true);
    expect(items.some((item) => item.operation.kind === 'flash')).toBe(false);
    expect(items[0]!.data.startsWith('0x')).toBe(true);
  });

  it('rejects mismatched contexts and executes sequentially through an injected executor', async () => {
    const permissions = decodeHookPermissions(hookAddress);

    expect(() =>
      createV4ExecutionPlans(
        { poolKey: { ...poolKey, hooks: `0x${'11'.repeat(20)}` }, poolManager: `0x${'22'.repeat(20)}` },
        permissions,
      ),
    ).toThrow(TypeError);

    const plans = createV4ExecutionPlans({ poolKey, poolManager: `0x${'22'.repeat(20)}` }, permissions);
    const items = plans.plan(7, 10);
    const calls: string[] = [];
    const outcomes = await executeV4Plan(items.slice(0, 3), async ({ item }): Promise<ExecutionOutcome> => {
      calls.push(item.data);
      return { status: 'success' as const };
    });
    expect(outcomes).toHaveLength(3);
    expect(calls).toHaveLength(3);
  });
});
