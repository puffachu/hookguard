import { describe, expect, it } from 'vitest';
import { defaultProviderUrl, monitorHookDeployments } from '../src/deployment-monitor.js';
import type { JsonRpcLike } from '../src/replay.js';

const hookAddress = `0x${(1n << 7n).toString(16).padStart(40, '0')}`;

class FakeProvider implements JsonRpcLike {
  constructor(private readonly responses: Record<string, unknown>) {}

  async request({ method }: { method: string }): Promise<unknown> {
    const value = this.responses[method];
    if (value instanceof Error) throw value;
    return structuredClone(value);
  }
}

describe('hook deployment monitor', () => {
  it('scans batches across multiple chains and decodes permissions', async () => {
    const result = await monitorHookDeployments(
      (name: string) => {
        if (name === 'base') {
          return new FakeProvider({
            eth_blockNumber: '0x2',
            eth_getLogs: [
              {
                address: hookAddress,
                blockNumber: '0x1',
                transactionHash: `0x${'b'.repeat(64)}`,
              },
            ],
            eth_getCode: '0x4f1234',
          });
        }
        return new FakeProvider({ eth_blockNumber: '0x1', eth_getLogs: [], eth_getCode: '0x' });
      },
      { chains: ['base', 'ethereum'], fromBlock: 1n, batchSize: 2 },
    );

    expect(result.deployments).toHaveLength(1);
    expect(result.deployments[0]).toMatchObject({
      chainName: 'base',
      blockNumber: 1n,
      permissions: { enabled: ['beforeSwap'] },
    });
    expect(result.cursor).toEqual({ base: 3n, ethereum: 2n });
    expect(result.scannedBlocks).toBe(3);
  });

  it('filters malformed entries and exposes provider URLs', async () => {
    const logs = [
      { address: `0x${'z'.repeat(40)}`, blockNumber: '0x1', transactionHash: `0x${'d'.repeat(64)}` },
      { address: `0x${'f'.repeat(40)}`, blockNumber: '0x1', transactionHash: 'bad-hash' },
      { address: `0x${'0'.repeat(40)}`, blockNumber: '0x1', transactionHash: `0x${'d'.repeat(64)}` },
      { address: hookAddress, blockNumber: '0x1', transactionHash: `0x${'d'.repeat(64)}` },
    ];
    const result = await monitorHookDeployments(
      () =>
        new FakeProvider({
          eth_blockNumber: '0x1',
          eth_getLogs: logs,
          eth_getCode: '0xf47d1234',
        }),
      { chains: ['base'], fromBlock: 1n },
    );

    expect(result.deployments).toHaveLength(1);
    expect(defaultProviderUrl('base')).toBe('https://mainnet.base.org');
  });

  it('deduplicates deployment events by transaction', async () => {
    const log = { address: hookAddress, blockNumber: '0x1', transactionHash: `0x${'c'.repeat(64)}` };
    const result = await monitorHookDeployments(
      () =>
        new FakeProvider({
          eth_blockNumber: '0x1',
          eth_getLogs: [log, log],
          eth_getCode: '0x4f1234',
        }),
      { chains: ['base'], fromBlock: 1n },
    );

    expect(result.deployments).toHaveLength(1);
  });

  it('stops cleanly when aborted and rejects invalid options', async () => {
    const controller = new AbortController();
    controller.abort();
    const stopped = await monitorHookDeployments(() => new FakeProvider({}), {
      chains: ['base'],
      signal: controller.signal,
    });

    expect(stopped).toEqual({ scannedBlocks: 0, deployments: [], cursor: { base: 0n }, failures: [] });
    await expect(monitorHookDeployments(() => new FakeProvider({}), { chains: [] })).rejects.toThrow(RangeError);
    await expect(
      monitorHookDeployments(() => new FakeProvider({}), { chains: ['base'], batchSize: 0 }),
    ).rejects.toThrow(RangeError);
  });
});
