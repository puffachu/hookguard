import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { CHAINS } from '../../packages/core/src/chains.js';
import { executeV4PlanOnFork } from '../../packages/core/src/v4-fork-executor.js';

const RUN_LIVE = Boolean(process.env.HOOKGUARD_LIVE_TESTS);
const hook = process.env.HOOKGUARD_SMOKE_HOOK ?? '0x00000000000000000000000000000000000000c0';
const poolKey = {
  currency0: (process.env.HOOKGUARD_SMOKE_CURRENCY0 ?? `0x${'00'.repeat(20)}`) as `0x${string}`,
  currency1: (process.env.HOOKGUARD_SMOKE_CURRENCY1 ?? `0x${'01'.repeat(20)}`) as `0x${string}`,
  fee: Number(process.env.HOOKGUARD_SMOKE_FEE ?? 500),
  tickSpacing: Number(process.env.HOOKGUARD_SMOKE_TICK_SPACING ?? 10),
  hooks: hook as `0x${string}`,
};

describe('opt-in real Anvil V4 fork smoke', () => {
  it.skipIf(!RUN_LIVE)(
    'classifies canonical calls on a temporary chain fork',
    async () => {
      const report = await executeV4PlanOnFork(
        { poolKey, poolManager: CHAINS.base.v4PoolManager },
        { seed: 42, count: 10, transport: async () => undefined },
      );
      expect(report.executedCount).toBeGreaterThan(0);
      expect(report.outcomes.every((outcome) => outcome.status === 'success')).toBe(true);
    },
    30000,
  );
});
