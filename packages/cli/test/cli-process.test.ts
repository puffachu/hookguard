import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
const cli = resolve(process.cwd(), 'packages/cli/src/index.ts');
const hook = `0x${((1n << 17n) | (1n << 16n)).toString(16).padStart(40, '0')}`;

function run(args: readonly string[]) {
  return spawnSync(tsx, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ETHEREUM_RPC_URL: 'https://example.invalid' },
  });
}

describe('CLI executable', () => {
  it('prints help with all commands and exits zero', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('--address <hook-or-pool>');
    expect(result.stdout).toContain('--tx-hash <hash>');
    expect(result.stdout).toContain('--simulate');
  });

  it('requires an address for analysis', () => {
    const result = run(['--chain', 'base']);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('--address is required for analysis\n');
  });

  it('prints help and exits zero', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('--tx-hash');
  });

  it('analyzes a hook and emits valid JSON', () => {
    const result = run(['--address', hook, '--chain', 'base', '--sequences', '2']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.chainName).toBe('base');
    expect(parsed.operations).toHaveLength(14);
    expect(typeof parsed.hookFlags).toBe('string');
  }, 15000);

  it('fails without required arguments', () => {
    expect(run([]).status).toBe(1);
  });
});

describe('CLI scenario parsing', () => {
  it('rejects malformed scenario JSON before network calls', () => {
    const result = run([
      '--tx-hash',
      `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
      '--chain',
      'ethereum',
      '--scenarios',
      '{bad',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toBe('');
  });
});

describe('CLI replay command', () => {
  it('replays a transaction through a configured RPC endpoint', async () => {
    const hash = `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        const payload = JSON.parse(body);
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify(
            payload.method === 'eth_chainId'
              ? { jsonrpc: '2.0', id: payload.id, result: '0x1' }
              : {
                  jsonrpc: '2.0',
                  id: payload.id,
                  result: { status: '0x1', blockNumber: '0xa', gasUsed: '0x5208', effectiveGasPrice: '0x1', logs: [] },
                },
          ),
        );
      });
    });
    const endpoint = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    });
    const child = spawn(
      tsx,
      [cli, '--tx-hash', hash, '--chain', 'ethereum', '--scenarios', '[{"label":"same-state"}]'],
      {
        env: { ...process.env, ETHEREUM_RPC_URL: endpoint },
      },
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', resolve);
    });
    server.close();
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ chainName: 'ethereum', baseline: { gasUsed: '21000' } });
  }, 15000);

  it('treats a terminal simulate flag as boolean', () => {
    const result = spawnSync(
      tsx,
      [
        cli,
        '--tx-hash',
        `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
        '--chain',
        'ethereum',
        '--simulate',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, ETHEREUM_RPC_URL: 'https://example.invalid' },
        timeout: 5000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('--address is required');
  }, 10000);
});
