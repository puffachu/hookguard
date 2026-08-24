import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { analyzePool } from '../src/orchestrator.js';

const address = `0x${((1n << 7n) | (1n << 6n)).toString(16).padStart(40, '0')}`;

describe('live bytecode resolution', () => {
  it('remains disabled by default and accepts explicit bytecode', async () => {
    const disabled = await analyzePool(address, 'base', { sequences: 1 });
    expect(disabled.bytecodeResolution).toEqual({
      status: 'disabled',
      reason: 'live bytecode fetching not enabled',
    });
    const provided = await analyzePool(address, 'base', {
      sequences: 1,
      hookBytecode: '0x63575e24b40063d1c1881900',
    });
    expect(provided.bytecodeResolution.status).toBe('provided');
    expect(provided.staticAnalysis.missingSelectors).toEqual([]);
  });

  it('resolves live bytecode through an injected RPC endpoint', async () => {
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        const payload = JSON.parse(body);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: '0x63575e24b40063d1c1881900' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const report = await analyzePool(address, 'base', {
        sequences: 1,
        fetchLiveBytecode: true,
        rpcUrl: url,
      });
      expect(report.bytecodeResolution.status).toBe('live');
      expect(report.staticAnalysis.missingSelectors).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
