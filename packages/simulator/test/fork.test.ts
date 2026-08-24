import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getChain } from '@hookguard/core/chains.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { startFork } from '../src/index.js';

let mockAnvil: string;
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mock-anvil-'));
  mockAnvil = join(directory, 'anvil');
  await writeFile(mockAnvil, '#!/bin/sh\nwhile kill -0 "$PPID" 2>/dev/null; do sleep 0.05; done\n', { mode: 0o755 });
  await chmod(mockAnvil, 0o755);
});

describe('Anvil fork manager', () => {
  it('spawns, cleans up, and rejects missing RPC configuration', async () => {
    const session = await startFork({ chain: getChain('base'), anvilPath: mockAnvil, blockNumber: 123n });
    expect(session.dataDir).toMatch(/hookguard-anvil-/);
    const { defaultRpcUrl: _defaultRpcUrl, ...polygonBase } = getChain('polygon');
    const noRpc = { ...polygonBase, rpcUrlEnv: 'HOOKGUARD_MISSING_RPC_URL' };
    await expect(startFork({ chain: noRpc, anvilPath: mockAnvil })).rejects.toThrow(
      'No RPC URL configured for polygon',
    );
    const dataDir = session.dataDir;
    await session.stop();
    await expect(import('node:fs/promises').then(({ stat }) => stat(dataDir))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 5000);

  it('surfaces executable failures', async () => {
    await expect(startFork({ chain: getChain('base'), anvilPath: '/bin/false' })).rejects.toThrow();
  });
});
