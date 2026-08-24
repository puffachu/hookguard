import { generateSequence, type Operation } from './generator.js';
import { decodeHookPermissions, type HookPermissions } from './hooks.js';
import { normalizePoolKey, type PoolKey } from './pool-key.js';
import type { Hex } from './rpc-client.js';
import { encodeV4Operation } from './v4-encoding.js';

export interface ExecutionPlanItem {
  readonly operation: Operation;
  readonly poolKey: PoolKey;
  readonly to: Hex;
  readonly data: Hex;
  readonly operationLabel: 'swap' | 'modifyLiquidity' | 'donate';
  readonly selectorIntent: string;
}

export const V4_OPERATION_SELECTORS = {
  swap: '0xf3cd914c',
  modifyLiquidity: '0x5a6bcfda',
  donate: '0x234266d7',
} as const;

export interface V4ExecutionContext {
  readonly poolKey: PoolKey;
  readonly poolManager: Hex;
}

export interface ExecutionOutcome {
  readonly status: 'success' | 'reverted' | 'skipped';
  readonly error?: string;
}

export interface V4ExecutorRequest {
  readonly poolManager: Hex;
  readonly item: ExecutionPlanItem;
}

export type V4Executor<T extends ExecutionOutcome = ExecutionOutcome> = (request: V4ExecutorRequest) => Promise<T>;

const ADDRESS = /^0x[0-9a-f]{40}$/;

function address(value: string, field: string): Hex {
  const normalized = value.toLowerCase() as Hex;
  if (!ADDRESS.test(normalized)) throw new TypeError(`${field} must be a 20-byte hex address`);
  return normalized;
}

export function createV4ExecutionPlans(
  contextInput: V4ExecutionContext,
  permissions: HookPermissions,
): {
  readonly context: Required<V4ExecutionContext>;
  readonly plan: (seed: number, count: number) => readonly ExecutionPlanItem[];
} {
  const poolKey = normalizePoolKey(contextInput.poolKey);
  const poolManager = address(contextInput.poolManager, 'poolManager');
  if (poolKey.hooks === poolManager) throw new TypeError('PoolKey hooks and PoolManager must differ');
  const decodedPoolHook = decodeHookPermissions(poolKey.hooks);
  if (decodedPoolHook.address !== permissions.address)
    throw new TypeError('PoolKey hook does not match decoded permission context');

  return {
    context: { poolKey, poolManager },
    plan: (seed, count) =>
      generateSequence(seed, permissions, count).flatMap((operation): ExecutionPlanItem[] => {
        if (operation.kind === 'flash') return [];
        return [
          {
            operation,
            poolKey,
            to: poolManager,
            data: encodeV4Operation(poolKey, {
              kind: operation.kind === 'swap-back' ? 'swap' : operation.kind,
              amount: (() => {
                const signedLimit = 2n ** 255n - 1n;
                const raw =
                  (operation.kind === 'swap' || operation.kind === 'swap-back') && operation.amount === 0n
                    ? 1n
                    : operation.kind === 'remove'
                      ? operation.amount || 1n
                      : operation.amount;
                return raw > signedLimit ? signedLimit : raw;
              })(),
              zeroForOne: operation.zeroForOne,
              ...(operation.tickLower === undefined ? {} : { tickLower: operation.tickLower }),
              ...(operation.tickUpper === undefined ? {} : { tickUpper: operation.tickUpper }),
              hookData: '0x',
            }),
            operationLabel:
              operation.kind === 'swap-back'
                ? 'swap'
                : operation.kind === 'add' || operation.kind === 'remove'
                  ? 'modifyLiquidity'
                  : operation.kind,
            selectorIntent: (() => {
              if (operation.kind === 'add') return 'increase liquidity';
              if (operation.kind === 'remove') return 'decrease liquidity';
              if (operation.kind === 'donate') return 'donate currency';
              return `exact-input ${operation.zeroForOne ? 'currency0 for currency1' : 'currency1 for currency0'}`;
            })(),
          },
        ];
      }),
  };
}

export async function executeV4Plan(
  items: readonly ExecutionPlanItem[],
  executor: V4Executor,
): Promise<readonly ExecutionOutcome[]> {
  const outcomes: ExecutionOutcome[] = [];
  for (const item of items) outcomes.push(await executor({ poolManager: item.to, item }));
  return outcomes;
}
