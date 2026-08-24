import { describe, expect, it } from 'vitest';
import { decodeHookPermissions } from '../../packages/core/src/hooks.js';
import { createLiveHookValidation } from '../../packages/core/src/live-validation.js';

const LIVE_HOOK_FIXTURES = [
  { label: 'ethereum-angstrom', chainId: 1, address: '0x0000000aa232009084bd71a5797d089aa4edfad4' },
  { label: 'base-zora-hook', chainId: 8453, address: '0x0469a4bd3724dc86c9542f4694c976da13c450c0' },
  { label: 'arbitrum-arrakis-private-hook', chainId: 42161, address: '0x192499a79cadb2e9ba221a252a3e3b7adc714880' },
  { label: 'optimism-volume-dynamic-fee-hook', chainId: 10, address: '0x2c3254da64956f495356a482d51e7311347f5044' },
  { label: 'unichain-renzo-hook', chainId: 130, address: '0x09dea99d714a3a19378e3d80d1ad22ca46085080' },
  { label: 'polygon-atxmv4-global-hook', chainId: 137, address: '0x079fd05102b6569dedde57551311bffe83f19f00' },
] as const;

describe('live deployed hook fixtures', () => {
  const RUN_LIVE = Boolean(process.env.HOOKGUARD_LIVE_TESTS);
  it.runIf(RUN_LIVE)('validates fixtures against real RPC endpoints', async () => {
    for (const fixture of LIVE_HOOK_FIXTURES) {
      const hook = decodeHookPermissions(fixture.address);
      expect(hook.enabled.length).toBeGreaterThan(0);
      const validation = createLiveHookValidation(fixture.chainId, fixture.address, {
        timeoutMs: Number(process.env.HOOKGUARD_RPC_TIMEOUT_MS ?? 10000),
        retries: Number(process.env.HOOKGUARD_RPC_RETRIES ?? 2),
      });
      const result = await validation.validate();
      expect(result.chainIdVerified).toBe(true);
      expect(result.hookExists).toBe(true);
      expect(result.poolManagerExists).toBe(true);
    }
  });

  it('records real addresses and decodes expected permissions deterministically', () => {
    for (const fixture of LIVE_HOOK_FIXTURES) {
      const hook = decodeHookPermissions(fixture.address);
      expect(hook.enabled.length).toBeGreaterThan(0);
      expect(fixture.chainId).toBeGreaterThan(0);
    }
  });
});
