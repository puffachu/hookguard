import { describe, expect, it, vi } from 'vitest';
import { CHAINS } from '@hookguard/core/chains.js';
import { analyzePool, summarize } from '../../packages/core/src/orchestrator.js';
import { analyzeHookBytecode } from '../../packages/core/src/hook-analysis.js';
import { monitorHookDeployments } from '../../packages/core/src/deployment-monitor.js';
import { replayScenarios, replayTransaction, type HistoricalProvider } from '../../packages/core/src/replay.js';
import { riskScore } from '../../packages/invariants/src/index.js';

class ReplayProvider implements HistoricalProvider {
  request = vi.fn(async ({ method }: { method: string }) => (method === 'eth_chainId' ? '0x2105' : undefined));
  getTransactionReceipt = vi.fn(async () => ({
    status: '0x1',
    blockNumber: '0xa',
    gasUsed: '0x5208',
    effectiveGasPrice: '0xb2d05e00',
    logs: [],
  }));
}

describe('full HookGuard pipeline', () => {
  const address = `0x${((1n << 7n) | (1n << 6n)).toString(16).padStart(40, '0')}`;
  const bytecodeAddress = `0x${'1'.repeat(40)}`;

  it('analyzes the same hook consistently across all supported chains', async () => {
    const reports = await Promise.all(
      Object.values(CHAINS).map(async (chain) => analyzePool(address, chain.id, { sequences: 25, seed: 42 })),
    );
    const fingerprints = reports.map((report) => ({
      chainId: report.chainId,
      operations: report.operations.length,
      violations: report.violations.length,
      score: report.riskScore,
    }));
    const baseline = fingerprints[0]!;
    expect(fingerprints.every((item) => item.operations === 175 && item.violations === baseline.violations)).toBe(true);
    for (const report of reports) {
      expect(report.permissions).toEqual(['beforeSwap', 'afterSwap']);
      expect(summarize(report)).toContain(`HookGuard ${report.chainName}:${address}`);
      expect(report.riskScore).toBe(100);
      expect(report.staticAnalysis.missingSelectors.length).toBeGreaterThan(0);
    }
  });

  it('rejects malformed addresses and produces report metadata', async () => {
    await expect(analyzePool('bad', 1)).rejects.toThrow(TypeError);
    const report = await analyzePool(address, 8453, { sequences: 1 });
    expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(riskScore(report.violations).score).toBe(report.riskScore);
    expect(report.permissionSummary).toContain('beforeSwap');
    expect(report.staticAnalysis.enabledPermissions).toEqual(['beforeSwap', 'afterSwap']);
    expect(analyzeHookBytecode('0x63575e24b40063d1c1881900', address).missingSelectors).toEqual([]);
  });

  it('replays historical transactions against alternative scenarios', async () => {
    const report = await replayTransaction(
      new ReplayProvider(),
      {
        txHash: `0x${'a'.repeat(64)}`,
        chain: 'base',
      },
      replayScenarios([{ label: 'same-state' }]),
    );
    expect(report.chainName).toBe('base');
    expect(report.baseline.status).toBe('success');
    expect(report.scenarios[0]?.changed).toBe(true);
  });

  it('scans deployment ranges with an injectable RPC provider', async () => {
    const hook = `0x${((1n << 7n) | (1n << 6n)).toString(16).padStart(40, '0')}`;
    const responses = {
      eth_blockNumber: '0x2',
      eth_getLogs: [{ address: hook, blockNumber: '0x2', transactionHash: `0x${'c'.repeat(64)}` }],
      eth_getCode: '0x4f1234',
    };
    const result = await monitorHookDeployments(
      () => ({
        request: async ({ method }) => structuredClone(responses[method as keyof typeof responses]),
      }),
      { chains: ['base'], fromBlock: 1n, batchSize: 10 },
    );
    expect(result.deployments[0]).toMatchObject({
      chainName: 'base',
      permissions: { enabled: ['beforeSwap', 'afterSwap'] },
    });
  });
});
