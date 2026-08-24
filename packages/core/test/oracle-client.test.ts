import { describe, expect, it } from 'vitest';
import { encodePublish, fetchOracleRecord } from '../src/oracle-client.js';

const hook = '0x1111111111111111111111111111111111111111';
const oracle = '0x2222222222222222222222222222222222222222';

describe('oracle ABI helpers', () => {
  it('encodes publisher calldata', () => {
    expect(encodePublish(hook, 42)).toBe(
      '0x9a8af3ad0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000002a',
    );
    expect(() => encodePublish(hook, 101)).toThrow(RangeError);
    expect(() => encodePublish(hook, 1.5)).toThrow(RangeError);
  });

  it('decodes packed score and timestamp', async () => {
    const packed = (42n << 48n) | 123n;
    const client = { request: async () => `0x${packed.toString(16).padStart(64, '0')}` };
    await expect(fetchOracleRecord(client, oracle, hook)).resolves.toEqual({ score: 42, updatedAt: 123 });
  });

  it('rejects malformed responses', async () => {
    await expect(fetchOracleRecord({ request: async () => '0x00' }, oracle, hook)).rejects.toThrow(
      'Unexpected oracle response',
    );
  });
});
