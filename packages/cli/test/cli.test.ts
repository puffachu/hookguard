import { describe, expect, it } from 'vitest';
import { analyzePool } from '../../../packages/core/src/orchestrator.js';

describe('CLI analysis helper', () => {
  it('accepts numeric chains and returns JSON-safe data', async () => {
    const report = await analyzePool('0x00000000000000000000000000000000000008c0', 10, { sequences: 2 });
    expect(JSON.parse(JSON.stringify({ chainName: report.chainName }))).toMatchObject({ chainName: 'optimism' });
  });
});
