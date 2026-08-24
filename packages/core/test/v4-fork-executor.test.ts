import { describe, expect, it } from 'vitest';
import { poolId } from '../src/pool-key.js';
import { decodeHookPermissions } from '../src/hooks.js';
import { createForkExecutor, createJsonRpcTransport, executeV4PlanOnFork } from '../src/v4-fork-executor.js';

const hook = `0x${((1n << 7n) | (1n << 6n)).toString(16).padStart(40, '0')}` as const;
const context = {
  poolKey: {
    currency0: `0x${'00'.repeat(20)}`,
    currency1: `0x${'01'.repeat(20)}`,
    fee: 500,
    tickSpacing: 10,
    hooks: hook,
  },
  poolManager: `0x${'22'.repeat(20)}`,
} as const;

describe('fork-backed V4 executor', () => {
  it('classifies success and revert outcomes', async () => {
    const executor = createForkExecutor({
      transport: async (method, params) => {
        if (method === 'eth_estimateGas') return undefined;
        if (method !== 'eth_call') throw new Error(`unexpected ${method}`);
        if ((params[0] as { data: string }).data === '0x123456') throw new Error('revert');
      },
      blockNumber: 42n,
    });
    const outcomes = await Promise.all([
      executor({
        poolManager: context.poolManager,
        item: {
          to: context.poolManager,
          data: '0x123400',
          operation: { kind: 'swap', amount: 1n, zeroForOne: true, source: 'internal', label: 'test' },
          poolKey: context.poolKey,
          operationLabel: 'swap' as const,
          selectorIntent: 'test',
        },
      }),
      executor({
        poolManager: context.poolManager,
        item: {
          to: context.poolManager,
          data: '0x123456',
          operation: { kind: 'swap', amount: 1n, zeroForOne: true, source: 'internal', label: 'test' },
          poolKey: context.poolKey,
          operationLabel: 'swap' as const,
          selectorIntent: 'test',
        },
      }),
    ]);
    expect(outcomes[0]).toMatchObject({ status: 'success', selector: '0x123400' });
    expect(outcomes[1]).toMatchObject({ status: 'reverted', rpcError: 'revert', revertReason: 'revert' });
  });

  it('plans and executes an explicit sequence on a fork', async () => {
    let calls = 0;
    const outcomes = await executeV4PlanOnFork(context, {
      seed: 42,
      count: 30,
      transport: async (method, params) => {
        calls += 1;
        expect(['eth_blockNumber', 'eth_estimateGas', 'eth_call']).toContain(method);
        if (method !== 'eth_call') return method === 'eth_blockNumber' ? '0xa' : undefined;
        expect(params[1]).toBe('0xa');
        return undefined;
      },
    });
    expect(outcomes.executedCount).toBeGreaterThan(15);
    expect(calls).toBe(outcomes.executedCount * 3);
    expect(decodeHookPermissions(hook).enabled.length).toBeGreaterThan(0);
  });
});
describe('fork execution risk mapping', () => {
  it('scores reverted calls and reports executed count', async () => {
    let call = 0;
    const report = await executeV4PlanOnFork(context, {
      seed: 42,
      count: 30,
      transport: async () => {
        call += 1;
        if (call % 3 === 0 && (call - 3) % 3 === 0) throw new Error('expected revert: custom reason');
        return undefined;
      },
    });
    expect(report.executedCount).toBe(report.outcomes.length);
    expect(report.violations.some((violation) => violation.invariant === 'fork-call-reverted')).toBe(true);
    expect(report.riskScore).toBe(30);
  });
});

describe('fork executor evidence and transport safety', () => {
  it('captures pinned blocks, gas estimates, pool identity, and timestamps', async () => {
    const timestamp = new Date('2025-01-01T00:00:00.000Z');
    const outcome = await createForkExecutor({
      blockNumber: 99n,
      now: () => timestamp,
      transport: async (method) => (method === 'eth_estimateGas' ? '0x5208' : undefined),
    })({
      poolManager: context.poolManager,
      item: {
        operation: { kind: 'swap', amount: 1n, zeroForOne: true, source: 'internal', label: 'evidence' },
        poolKey: context.poolKey,
        to: context.poolManager,
        data: '0xf3cd914c',
        operationLabel: 'swap',
        selectorIntent: 'exact-input currency0 for currency1',
      },
    });
    expect(outcome).toMatchObject({
      status: 'success',
      targetPoolManager: context.poolManager,
      selector: '0xf3cd914c',
      operationLabel: 'swap',
      gasUsed: 21000n,
      blockNumber: 99n,
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(outcome.poolId).toBe(poolId(context.poolKey));
  });

  it('resolves latest block once per call and distinguishes malformed RPC responses', async () => {
    const methods: string[] = [];
    let call = 0;
    const executor = createForkExecutor({
      transport: async (method) => {
        methods.push(method);
        if (method === 'eth_blockNumber') return call === 0 ? '0xb' : { invalid: true };
        if (method === 'eth_estimateGas') return undefined;
        call += 1;
        return undefined;
      },
      now: () => new Date(0),
    });
    await expect(
      executor({
        poolManager: context.poolManager,
        item: {
          operation: { kind: 'swap', amount: 1n, zeroForOne: true, source: 'internal', label: 'latest' },
          poolKey: context.poolKey,
          to: context.poolManager,
          data: '0xf3cd914c',
          operationLabel: 'swap',
          selectorIntent: 'test',
        },
      }),
    ).resolves.toMatchObject({ status: 'success', blockNumber: 11n });
    await expect(
      executor({
        poolManager: context.poolManager,
        item: {
          operation: { kind: 'swap', amount: 1n, zeroForOne: true, source: 'internal', label: 'malformed' },
          poolKey: context.poolKey,
          to: context.poolManager,
          data: '0xf3cd914c',
          operationLabel: 'swap',
          selectorIntent: 'test',
        },
      }),
    ).resolves.toMatchObject({ status: 'reverted', rpcError: 'eth_blockNumber returned malformed quantity' });
    expect(methods[0]).toBe('eth_blockNumber');
  });

  it('requires an RPC endpoint when no URL is configured for the selected chain', async () => {
    process.env.POLYGON_RPC_URL = '';
    try {
      expect(() => createJsonRpcTransport({ chain: 'polygon' })).toThrow('No RPC URL configured for chain 137');
    } finally {
      delete process.env.POLYGON_RPC_URL;
    }
  });
});
