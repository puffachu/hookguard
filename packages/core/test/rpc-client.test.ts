import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainAwareRpcClient } from '../src/rpc-client.js';

function rpcResponse(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('chain-aware JSON-RPC client', () => {
  it('uses default endpoints and validates chain responses', async () => {
    const defaultClient = new ChainAwareRpcClient(1, { fetch: async () => rpcResponse('0x1') });
    expect(defaultClient.url).toBe('https://ethereum-rpc.publicnode.com');
    await expect(defaultClient.verifyChain()).resolves.toBe(1);
    vi.stubEnv('ETHEREUM_RPC_URL', 'https://example.test');
    const client = new ChainAwareRpcClient(1, { fetch: async () => rpcResponse('0x1') });
    await expect(client.verifyChain()).resolves.toBe(1);
    client.fetchImpl = async (): Promise<Response> => rpcResponse('0x8453');
    await expect(client.verifyChain()).rejects.toThrow(/Unexpected chain/);
  });

  it('retries transient failures and rejects RPC errors', async () => {
    vi.stubEnv('ETHEREUM_RPC_URL', 'https://example.test');
    let requests = 0;
    const client = new ChainAwareRpcClient(1, { retries: 2, retryDelayMs: 0 });
    client.fetchImpl = async (_url: unknown, init?: RequestInit) => {
      requests += 1;
      if (requests < 3) return new Response('upstream unavailable', { status: 503 });
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: body.id }), {
        headers: { 'content-type': 'application/json' },
      });
    };
    await expect(client.request({ method: 'eth_chainId' })).resolves.toBe(3);
    expect(requests).toBe(3);
    client.fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } }));
    await expect(client.request({ method: 'eth_chainId' })).rejects.toMatchObject({ code: -32000 });
  });

  it('normalizes malformed RPC error envelopes', async () => {
    vi.stubEnv('ETHEREUM_RPC_URL', 'https://example.test');
    const client = new ChainAwareRpcClient(1, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {},
          }),
        ),
    });
    await expect(client.request({ method: 'eth_chainId' })).rejects.toMatchObject({
      code: -32603,
      message: 'JSON-RPC error',
    });
    client.fetchImpl = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 2 }));
    await expect(client.request({ method: 'eth_chainId' })).rejects.toThrow('Malformed JSON-RPC response envelope');
  });

  it('aborts requests after the configured timeout', async () => {
    vi.stubEnv('ETHEREUM_RPC_URL', 'https://example.test');
    const client = new ChainAwareRpcClient(1, { timeoutMs: 10, retries: 0 });
    client.fetchImpl = (_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
      });
    await expect(client.request({ method: 'eth_chainId' })).rejects.toThrow();
  }, 100);
});
