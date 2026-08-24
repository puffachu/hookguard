import { keccak_256 } from '@noble/hashes/sha3.js';
import type { Hex } from './rpc-client.js';

export interface PoolKey {
  readonly currency0: Hex;
  readonly currency1: Hex;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: Hex;
}

const ADDRESS = /^0x[0-9a-f]{40}$/;

function address(value: string, field: string): Hex {
  const normalized = value.toLowerCase() as Hex;
  if (!ADDRESS.test(normalized)) throw new TypeError(`${field} must be a 20-byte hex address`);
  return normalized;
}

export function normalizePoolKey(input: PoolKey): PoolKey {
  if (!Number.isInteger(input.fee) || input.fee < 0 || input.fee > 0xffffff)
    throw new RangeError('fee must fit uint24');
  const TICK_SPACING_LIMIT = 2 ** 23;
  if (
    !Number.isInteger(input.tickSpacing) ||
    input.tickSpacing <= -TICK_SPACING_LIMIT ||
    input.tickSpacing >= TICK_SPACING_LIMIT
  )
    throw new RangeError('tickSpacing must fit int24');
  const currency0 = address(input.currency0, 'currency0');
  const currency1 = address(input.currency1, 'currency1');
  const hooks = address(input.hooks, 'hooks');
  if (currency0 >= currency1) throw new TypeError('currencies must be numerically sorted');
  return { currency0, currency1, fee: input.fee, tickSpacing: input.tickSpacing, hooks };
}

function encodePoolKey(poolKey: PoolKey): Uint8Array {
  const encoded = Buffer.alloc(160);
  encoded.write(poolKey.currency0.slice(2).padStart(64, '0'), 0, 'hex');
  encoded.write(poolKey.currency1.slice(2).padStart(64, '0'), 32, 'hex');
  encoded.write(BigInt(poolKey.fee).toString(16).padStart(64, '0'), 64, 'hex');
  const tickSpacing = BigInt.asUintN(256, BigInt(poolKey.tickSpacing)).toString(16).padStart(64, '0');
  encoded.write(tickSpacing, 96, 'hex');
  encoded.write(poolKey.hooks.slice(2).padStart(64, '0'), 128, 'hex');
  return new Uint8Array(encoded);
}

export function poolId(poolKeyInput: PoolKey): Hex {
  const poolKey = normalizePoolKey(poolKeyInput);
  return `0x${Buffer.from(keccak_256(encodePoolKey(poolKey))).toString('hex')}` as Hex;
}
