import { describe, expect, it } from 'vitest';
import { getChain } from '../src/chains.js';
import type { Hex } from '../src/rpc-client.js';
import {
  createLiveHookValidation,
  normalizeHex,
  rpcUrlForChain,
  findPoolManager,
  getCode,
  offlineValidationFallback,
} from '../src/live-validation.js';

const HOOK = `0x${'2'.repeat(40)}` as Hex;
const MANAGER = getChain('base').v4PoolManager;

function createClient(results: Record<string, unknown>, chain: number = 8453) {
  return createLiveHookValidation(chain, HOOK, {
    timeoutMs: 20,
    retries: 0,
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      const result = results[request.method];
      return Response.json({ jsonrpc: '2.0', id: 1, result });
    },
  });
}

function createRawClient(responses: readonly unknown[]) {
  let request = 0;
  return createLiveHookValidation(8453, HOOK, {
    timeoutMs: 20,
    retries: 0,
    fetch: async () => Response.json({ jsonrpc: '2.0', id: ++request, result: responses[request - 1] }),
  });
}

describe('live hook validation helpers', () => {
  it('classifies present and missing bytecode', async () => {
    const validation = createClient({
      eth_chainId: '0x2105',
      eth_getCode: MANAGER,
    });
    await expect(validation.client.verifyChain()).resolves.toBe(8453);
    await expect(getCode(validation.client, HOOK)).resolves.toEqual({ status: 'ok', value: MANAGER });
    const missing = createLiveHookValidation(getChain('base'), HOOK, {
      fetch: async () => Response.json({ id: 1, result: '0x' }),
    }).client;
    await expect(findPoolManager(missing)).resolves.toMatchObject({ status: 'missing', reason: /PoolManager/ });
  });

  it('covers unavailable RPC paths and helper utilities', async () => {
    expect(normalizeHex('0X845300')).toBe('8453');
    expect(rpcUrlForChain(getChain('base'))).toBe('https://mainnet.base.org');
    const badBytecode = createClient({ eth_chainId: '0x2105', eth_getCode: 7 });
    await expect(getCode(badBytecode.client, HOOK)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid bytecode',
    });
    const failed = createRawClient(['0x999']);
    await expect(failed.validate()).resolves.toMatchObject({ status: 'unavailable', reason: /Unexpected chain/ });
    const managerMissing = createClient({ eth_chainId: '0x2105', eth_getCode: '0x' });
    await expect(managerMissing.validate()).resolves.toMatchObject({
      status: 'missing',
      hookExists: false,
      poolManagerExists: false,
    });
  });

  it('validates hook and PoolManager together', async () => {
    const validation = createClient({ eth_chainId: '0x2105', eth_getCode: '0xdeadbeef' });
    await expect(validation.validate()).resolves.toMatchObject({
      chainId: 8453,
      chainName: 'base',
      chainIdVerified: true,
      hookExists: true,
      poolManagerExists: true,
    });
  });

  it('returns deterministic offline fallbacks', () => {
    expect(offlineValidationFallback(getChain('ethereum'))).toMatchObject({
      chainId: 1,
      chainName: 'ethereum',
      rpcUrlConfigured: true,
      chainIdVerified: false,
      reason: 'live validation skipped without credentials',
    });
  });
});
