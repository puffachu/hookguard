import { describe, expect, it, vi } from 'vitest';
import { interpretTrace, prepareHistoricalSimulation, simulateWithExecutor } from '../src/historical-replay.js';

const hash = `0x${'a'.repeat(64)}`;
const transaction = {
  blockNumber: '0xb',
  gas: '0x186a0',
  raw: '0x02f86c01',
};
const provider = {
  request: vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) =>
    method === 'eth_chainId'
      ? '0x1'
      : method === 'eth_getTransactionByHash' && (Array.isArray(params) && params[0]) === hash
        ? transaction
        : null,
  ),
};

describe('real historical replay', () => {
  it('validates and pins a transaction to its parent block', async () => {
    const prepared = await prepareHistoricalSimulation(provider, { txHash: hash });
    expect(prepared).toMatchObject({ chainId: 1, chainName: 'ethereum', parentBlockNumber: 10n });
    await expect(prepareHistoricalSimulation(provider, { txHash: '0x1234' })).rejects.toThrow(TypeError);
    await expect(
      prepareHistoricalSimulation(provider, {
        txHash: hash,
        chain: 8453,
        scenarios: [{ label: 'same-state' }],
      }),
    ).rejects.toThrow('Expected base');
  });

  it('interprets real call traces deterministically', () => {
    expect(interpretTrace({ gasUsed: '0x5208', logs: [{}, { calls: [{ logs: [{}] }] }] })).toEqual({
      status: 'success',
      gasUsed: 21000n,
      logCount: 3,
    });
    expect(interpretTrace({ gasUsed: '0x1', error: 'revert' })).toEqual({
      status: 'reverted',
      error: 'revert',
      gasUsed: 1n,
      logCount: 0,
    });
    expect(() => interpretTrace({})).toThrow('Unexpected trace');
  });

  it('executes baseline and alternative scenarios through the executor', async () => {
    const prepared = await prepareHistoricalSimulation(provider, {
      txHash: hash,
      scenarios: [
        { label: 'more-gas', overrides: { gas: '0x30d40' } },
        { label: 'later-block', blockNumber: 11n },
      ],
    });
    const execute = vi.fn(async ({ transaction, parentBlockNumber, scenario }) => ({
      status: ((scenario?.overrides?.gas ?? transaction.gas) === '0x30d40' ? 'success' : 'success') as 'success',
      blockNumber: scenario?.blockNumber ?? parentBlockNumber,
      gasUsed: BigInt(scenario?.overrides?.gas ?? (transaction.gas as string)) / 10n,
      logCount: 1,
    }));
    const report = await simulateWithExecutor(prepared, execute);
    expect(report.parentBlockNumber).toBe(10n);
    expect(report.baseline.gasUsed).toBe(10000n);
    expect(report.scenarios[0]?.gasUsed).toBe(20000n);
    expect(report.scenarios[1]?.blockNumber).toBe(11n);
    expect(execute).toHaveBeenCalledTimes(3);
    for (const call of execute.mock.calls) {
      expect(call[0].parentBlockNumber).toBe(10n);
      expect(call[0].transaction.raw).toBe('0x02f86c01');
    }
  });

  it('requires transactions to exist', async () => {
    await expect(prepareHistoricalSimulation(provider, { txHash: `0x${'b'.repeat(64)}` })).rejects.toThrow(
      'Transaction not found',
    );
  });
});

describe('historical simulation limits', () => {
  it('rejects more than the bounded scenario count before starting forks', async () => {
    const { MAX_SIMULATION_SCENARIOS } = await import('../src/historical-replay.js');
    const scenarios = Array.from({ length: MAX_SIMULATION_SCENARIOS + 1 }, (_, index) => ({
      label: `scenario-${index}`,
    }));
    await expect(prepareHistoricalSimulation(provider, { txHash: hash })).resolves.toBeTruthy();
    await expect(
      (async () => {
        const { simulateHistoricalTransaction } = await import('../src/historical-replay.js');
        return simulateHistoricalTransaction(
          provider,
          { txHash: hash, scenarios },
          {
            forkUrl: 'https://example.invalid',
            anvilPath: '/bin/false',
          },
        );
      })(),
    ).rejects.toThrow(RangeError);
  });
});
