import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
const tsx = resolve(root, 'node_modules/.bin/tsx');
const cli = resolve(root, 'packages/cli/src/index.ts');
const hook = '0x0000000000000000000000000000000000018000';

function run(args: readonly string[]) {
  return spawnSync(tsx, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ETHEREUM_RPC_URL: 'https://example.invalid' },
    timeout: 15000,
  });
}

describe('production readiness workflows', () => {
  const documentation = {
    readme: readFileSync(resolve(root, 'README.md'), 'utf8'),
    api: readFileSync(resolve(root, 'docs/API.md'), 'utf8'),
    architecture: readFileSync(resolve(root, 'docs/ARCHITECTURE.md'), 'utf8'),
    deterministicExample: readFileSync(resolve(root, 'examples/deterministic-analysis.ts'), 'utf8'),
    bytecodeExample: readFileSync(resolve(root, 'examples/explicit-live-bytecode.ts'), 'utf8'),
    executionExample: readFileSync(resolve(root, 'examples/read-only-fork-execution.ts'), 'utf8'),
  };

  let help: ReturnType<typeof run>;
  beforeAll(() => {
    help = run(['--help']);
  });

  it('documents deterministic analysis and explicit bytecode resolution', () => {
    expect(documentation.readme).toContain('--seed 1337');
    expect(documentation.readme).toContain('--fetch-live-bytecode');
    expect(documentation.readme).toContain('bytecodeResolution.status');
    expect(documentation.api).toContain('Bytecode Resolution');
    expect(documentation.deterministicExample).toContain('seed: 1337');
    expect(documentation.bytecodeExample).toContain('fetchLiveBytecode: true');
  });

  it('requires a complete PoolKey and explains read-only execution', () => {
    expect(documentation.readme).toContain('--execute');
    expect(documentation.executionExample).toContain('currency0:');
    expect(documentation.architecture).toContain('Addresses do not define a pool.');
    expect(documentation.architecture).toContain('All calls are read-only.');
    expect(help.stdout).toContain('actual read-only eth_call execution');
    expect(help.stdout).toContain('Analysis without --execute is deterministic planning only');
  });

  it('keeps offline analysis separate from explicit execution', () => {
    const result = run(['--address', hook, '--chain', 'base', '--sequences', '1', '--seed', '1337']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.bytecodeResolution).toEqual({ status: 'disabled', reason: 'live bytecode fetching not enabled' });
    expect(report.forkExecution).toBeUndefined();
  }, 15000);

  it('rejects --execute without a complete caller-supplied PoolKey', () => {
    const result = run(['--address', hook, '--chain', 'base', '--execute']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--pool-manager is required when --execute requests eth_call execution');
  }, 15000);

  it('forwards the live-bytecode opt-in to analysis', async () => {
    const { analyzePool } = await import('../packages/core/src/orchestrator.js');
    const report = await analyzePool(hook, 'base', {
      fetchLiveBytecode: true,
      sequences: 1,
      rpcUrl: 'https://example.invalid',
    });
    expect(report.bytecodeResolution).toMatchObject({ status: 'unavailable' });
  });
});
