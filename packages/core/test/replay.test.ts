import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHistoricalProvider,
  replayScenarios,
  replayTransaction,
  type HistoricalProvider,
} from '../src/replay.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const hash = `0x${'a'.repeat(64)}`;
const receipt = {
  status: '0x1',
  blockNumber: '0xa',
  gasUsed: '0x5208',
  effectiveGasPrice: '0xb2d05e00',
  logs: [{}, {}],
};

function provider(chainId = '0x1'): HistoricalProvider {
  return {
    request: vi.fn(async ({ method }: { method: string }) => (method === 'eth_chainId' ? chainId : undefined)),
    getTransactionReceipt: vi.fn(async () => receipt),
  };
}

describe('counterfactual replay', () => {
  it('requests receipts with the correct JSON-RPC method', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: receipt }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = createHistoricalProvider({ url: 'https://replay.example' });
    await expect(provider.getTransactionReceipt(hash)).resolves.toEqual(receipt);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://replay.example',
      expect.objectContaining({
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
      }),
    );
    expect(() => provider.getTransactionReceipt('0x1234')).toThrow(TypeError);
  });

  it('builds a baseline and explicit counterfactual scenarios', async () => {
    const client = provider();
    const report = await replayTransaction(client, { txHash: hash, chain: 'ethereum' }, [
      ...replayScenarios([
        { label: 'same-block' },
        { label: 'later', blockNumber: 11n, parameters: { status: 'reverted' } },
      ]),
    ]);
    expect(report.baseline).toMatchObject({ status: 'success', blockNumber: 10n, logs: 2, changed: false });
    expect(report.scenarios).toHaveLength(2);
    expect(report.scenarios[1]).toMatchObject({ status: 'reverted', blockNumber: 11n, changed: true });
  });

  it('retries HTTP failures and preserves RPC errors', async () => {
    let requests = 0;
    const fetchMock = vi.fn(async () => {
      requests += 1;
      if (requests < 3) return new Response('upstream unavailable', { status: 503 });
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          error: { code: -32000, message: 'receipt unavailable' },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = createHistoricalProvider({ url: 'https://retry.example' });
    await expect(provider.getTransactionReceipt(hash)).rejects.toThrow('receipt unavailable');
    expect(requests).toBe(4);
  });

  it('validates chain identity and malformed requests', async () => {
    await expect(replayTransaction(provider('0x2'), { txHash: hash })).rejects.toThrow('Expected ethereum');
    await expect(replayTransaction(provider(), { txHash: hash, chain: 999 })).rejects.toThrow();
    await expect(replayTransaction(provider(), { txHash: '0x1234' })).rejects.toThrow(TypeError);
  });

  it('rejects missing receipts and invalid overrides', async () => {
    const missing = provider();
    missing.getTransactionReceipt = async () => null;
    await expect(replayTransaction(missing, { txHash: hash })).rejects.toThrow('not found');
    await expect(
      replayTransaction(
        provider(),
        { txHash: hash },
        replayScenarios([{ label: 'bad status', parameters: { status: 'failed' } }]),
      ),
    ).rejects.toThrow(TypeError);
  });
});
