import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

let app: ReturnType<typeof createServer>;
beforeAll(() => {
  app = createServer();
});

describe('REST API', () => {
  it('exposes health and supported chains', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.chains).toHaveLength(6);
  });

  it('validates input and analyzes a hook', async () => {
    const invalid = await request(app).post('/v1/analyze').send({ address: '0x1', chain: 'base' });
    expect(invalid.status).toBe(400);
    const address = `0x${((1n << 17n) | (1n << 16n)).toString(16).padStart(40, '0')}`;
    const response = await request(app).post('/v1/analyze').send({ address, chain: 8453, sequences: 5, seed: 7 });
    expect(response.status).toBe(200);
    expect(response.body.chainName).toBe('base');
    expect(JSON.parse(response.text).operations).toHaveLength(35);
  });

  it('validates and executes counterfactual replay requests', async () => {
    const invalid = await request(app).post('/v1/replay').send({ txHash: '0x1' });
    expect(invalid.status).toBe(400);
    const unavailable = await request(app)
      .post('/v1/replay')
      .send({
        txHash: `0x${'a'.repeat(64)}`,
        chain: 999,
      });
    expect(unavailable.status).toBe(422);
    const missing = await request(app)
      .post('/v1/replay')
      .send({
        txHash: `0x${'a'.repeat(64)}`,
        chain: 1,
      });
    expect(missing.status).toBe(422);
  });

  it('executes counterfactual replay with an injected provider', async () => {
    const replayApp = createServer({
      replayProviderFactory: () => ({
        request: async ({ method }: { method: string }) => {
          if (method !== 'eth_chainId') throw new Error('unexpected method');
          return '0x1';
        },
        getTransactionReceipt: async () => ({
          status: '0x1',
          blockNumber: '0xa',
          gasUsed: '0x5208',
          effectiveGasPrice: '0xb2d05e00',
          logs: [],
        }),
      }),
    });
    const response = await request(replayApp)
      .post('/v1/replay')
      .send({
        txHash: `0x${'a'.repeat(64)}`,
        chain: 'ethereum',
      });
    expect(response.status).toBe(200);
    expect(response.body.baseline.status).toBe('success');
    expect(response.body.chainName).toBe('ethereum');
  });

  it('falls back from metadata replay to unsupported-chain handling', async () => {
    const response = await request(app)
      .post('/v1/replay')
      .send({ txHash: `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, chain: 'polygon' });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/RPC HTTP|replay failed|not found/i);
  });

  it('handles unknown routes and unsupported chains', async () => {
    expect((await request(app).get('/missing')).status).toBe(404);
    expect(
      (
        await request(app)
          .post('/v1/analyze')
          .send({ address: `0x${'0'.repeat(40)}`, chain: 999 })
      ).status,
    ).toBe(422);
  });
});

describe('live validation endpoint', () => {
  it('validates request shape and returns offline fallback without credentials', async () => {
    const invalid = await request(app).post('/v1/live-validate').send({ address: '0x1', chain: 'base' });
    expect(invalid.status).toBe(400);
    const response = await request(app)
      .post('/v1/live-validate')
      .send({ address: `0x${'1'.repeat(40)}`, chain: 'ethereum', retries: 0 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ chainId: 1, status: 'missing', chainIdVerified: true });
  });
});

describe('historical simulation endpoint', () => {
  it('validates requests and executes through an injected simulator', async () => {
    const invalid = await request(app).post('/v1/replay/simulate').send({ txHash: '0x1' });
    expect(invalid.status).toBe(400);

    const simulationApp = createServer({
      historicalSimulationFactory: () => async () => ({
        transactionHash: `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
        chainId: 1,
        chainName: 'ethereum',
        parentBlockNumber: 9n,
        baseline: { scenario: 'baseline', status: 'success', blockNumber: 9n, gasUsed: 21000n },
        scenarios: [{ scenario: 'more-gas', status: 'success', blockNumber: 10n, gasUsed: 25000n }],
      }),
    });
    const response = await request(simulationApp)
      .post('/v1/replay/simulate')
      .send({
        txHash: `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
        scenarios: [{ label: 'more-gas', blockNumber: 10, overrides: { gas: '0x61a8' } }],
      });
    expect(response.status).toBe(200);
    expect(response.body.parentBlockNumber).toBe('9');
    expect(response.body.scenarios[0]).toMatchObject({ gasUsed: '25000' });
  });
});

describe('explicit V4 execution planning endpoint', () => {
  it('returns deterministic canonical calldata for a supplied PoolKey', async () => {
    const hook = `0x${((1n << 7n) | (1n << 6n)).toString(16).padStart(40, '0')}`;
    const response = await request(app)
      .post('/v1/analyze')
      .send({
        address: hook,
        chain: 'base',
        sequences: 1,
        execution: {
          poolManager: `0x${'22'.repeat(20)}`,
          currency0: `0x${'00'.repeat(20)}`,
          currency1: `0x${'01'.repeat(20)}`,
          fee: 500,
          tickSpacing: 10,
          count: 50,
          seed: 42,
        },
      });
    expect(response.status).toBe(200);
    const plan = response.body.executionPlan;
    expect(plan.requestedCount).toBe(50);
    expect(plan.executableCount).toBeGreaterThan(25);
    expect(plan.items.every((item: { to: string }) => item.to === `0x${'22'.repeat(20)}`)).toBe(true);
    expect(plan.items.some((item: { operation: { kind: string } }) => item.operation.kind === 'swap')).toBe(true);
    expect(plan.poolIdContext.poolKey.hooks).toBe(hook);
  });

  it('executes opt-in calls with typed evidence through a mocked JSON-RPC transport', async () => {
    let requests = 0;
    const hook = `0x${((1n << 7n) | (1n << 6n)).toString(16).padStart(40, '0')}`;
    const executionApp = createServer();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requests,
          result: requests % 3 === 1 ? '0xa' : undefined,
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const response = await request(executionApp)
        .post('/v1/analyze')
        .send({
          address: hook,
          chain: 'base',
          rpcUrl: 'http://127.0.0.1:1/rpc',
          sequences: 1,
          execution: {
            poolManager: `0x${'22'.repeat(20)}`,
            currency0: `0x${'00'.repeat(20)}`,
            currency1: `0x${'01'.repeat(20)}`,
            fee: 500,
            tickSpacing: 10,
            count: 2,
            seed: 42,
            execute: true,
            blockNumber: 99,
          },
        });
      expect(response.status).toBe(200);
      expect(response.body.executionPlan.executionMode).toBe('read-only-simulation');
      expect(response.body.executionPlan.executedCount).toBe(2);
      for (const outcome of response.body.executionPlan.outcomes) {
        expect(outcome).toMatchObject({
          targetPoolManager: `0x${'22'.repeat(20)}`,
          blockNumber: '99',
        });
        expect(outcome.selector).toMatch(/^0x[0-9a-f]{8}$/);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
