import { describe, expect, it } from 'vitest';
import { getChain, type ChainConfig } from '@hookguard/core/chains.js';
import { createForkPlan } from '../src/index.js';

describe('chain registry and fork adapter', () => {
  it('resolves all supported ids and names uniquely', () => {
    expect(getChain(1).name).toBe('ethereum');
    expect(getChain('unichain').id).toBe(130);
    expect(() => getChain(999)).toThrow(/Unsupported chain id/);
  });

  it('preserves fork request metadata', async () => {
    const chain = getChain(8453);
    const plan = createForkPlan(`0x${'1'.repeat(40)}`, chain, { anvilPath: '/bin/anvil', blockNumber: 100n });
    expect(plan).toMatchObject({ rpcUrl: 'https://mainnet.base.org', anvilPath: '/bin/anvil', blockNumber: 100n });
    const { defaultRpcUrl: _defaultRpcUrl, ...polygonBase } = getChain('polygon');
    const noRpc: ChainConfig = { ...polygonBase, rpcUrlEnv: 'HOOKGUARD_MISSING_RPC_URL' };
    expect(() => createForkPlan(`0x${'1'.repeat(40)}`, noRpc)).toThrow('No RPC URL configured for polygon');
  });
});
