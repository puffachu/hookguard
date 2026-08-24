export interface OracleRecord {
  readonly score: number;
  readonly updatedAt: number;
}

export interface JsonRpcLike {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

const ABI = {
  encodeFunctionData: '0x9a8af3ad',
  getRisk: '0x7dc0d1cb',
} as const;

export function encodePublish(hook: `0x${string}`, score: number): string {
  if (score < 0 || score > 100 || !Number.isInteger(score)) throw new RangeError('score must be an integer 0..100');
  const addressWord = BigInt(hook).toString(16).padStart(64, '0');
  return `${ABI.encodeFunctionData}${addressWord}${score.toString(16).padStart(64, '0')}`;
}

function decodeUint256(result: unknown): bigint {
  if (typeof result !== 'string' || !/^0x[0-9a-f]{64}$/i.test(result)) throw new Error('Unexpected oracle response');
  return BigInt(result);
}

export async function fetchOracleRecord(
  client: JsonRpcLike,
  oracle: `0x${string}`,
  hook: `0x${string}`,
): Promise<OracleRecord> {
  const data = `${ABI.getRisk}${hook.slice(2).padStart(64, '0')}`;
  const result = await client.request({ method: 'eth_call', params: [{ to: oracle, data }, 'latest'] });
  const packed = decodeUint256(result);
  return { score: Number(packed >> 48n), updatedAt: Number(packed & ((1n << 48n) - 1n)) };
}
