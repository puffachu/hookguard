import { HookPermissions } from './hooks.js';

export type OperationKind = 'swap' | 'add' | 'remove' | 'donate' | 'flash' | 'swap-back';

export interface Operation {
  readonly kind: OperationKind;
  readonly amount: bigint;
  readonly zeroForOne: boolean;
  readonly tickLower?: number;
  readonly tickUpper?: number;
  readonly reentrant?: boolean;
  readonly source: 'aave-flash' | 'balancer-flash' | 'internal';
  readonly label: string;
}

const EXTREMES = [0n, 1n, 2n, 997n, 1000n, 10n ** 12n, 2n ** 96n, 2n ** 128n - 1n, 2n ** 256n - 1n] as const;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: number): T {
  return items[Math.floor(random * items.length)] as T;
}

export function generateSequence(seed: number, permissions?: HookPermissions, length = 7): readonly Operation[] {
  if (!Number.isSafeInteger(seed)) throw new RangeError('seed must be a safe integer');
  if (!Number.isInteger(length) || length < 1 || length > 50_000)
    throw new RangeError('length must be between 1 and 50000');
  const random = mulberry32(seed);
  const operations: Operation[] = [];
  const allowedKinds: readonly OperationKind[] = permissions
    ? [
        ...(permissions.has('beforeSwap') || permissions.has('afterSwap') ? (['swap', 'swap-back'] as const) : []),
        ...(permissions.has('beforeAddLiquidity') || permissions.has('afterAddLiquidity') ? (['add'] as const) : []),
        ...(permissions.has('beforeRemoveLiquidity') || permissions.has('afterRemoveLiquidity')
          ? (['remove'] as const)
          : []),
        ...(permissions.has('beforeDonate') || permissions.has('afterDonate') ? (['donate'] as const) : []),
        'flash',
      ]
    : ['swap', 'swap', 'add', 'remove', 'donate', 'flash', 'swap-back'];
  for (let index = 0; index < length; index += 1) {
    const kind = allowedKinds.length === 0 ? 'flash' : pick<OperationKind>(allowedKinds, random());
    const amount = pick(EXTREMES, random());
    const source = kind === 'flash' ? pick(['aave-flash', 'balancer-flash'] as const, random()) : 'internal';
    const operation: Operation = {
      kind,
      amount,
      zeroForOne: random() >= 0.5,
      ...(kind === 'add' || kind === 'remove'
        ? {
            tickLower: [-887220, -60, -1, 0][Math.floor(random() * 4)] as number,
            tickUpper: [1, 60, 887220][Math.floor(random() * 3)] as number,
          }
        : {}),
      reentrant: random() >= 0.8,
      source,
      label: `${kind}:${index}`,
    };
    operations.push(operation);
  }
  return Object.freeze(operations);
}
