import { encodeFunctionData } from 'viem';
import { normalizePoolKey, type PoolKey } from './pool-key.js';
import type { Hex } from './rpc-client.js';

export type V4OperationKind = 'swap' | 'add' | 'remove' | 'donate';

export interface V4OperationRequest {
  readonly kind: V4OperationKind;
  readonly amount: bigint;
  readonly zeroForOne?: boolean;
  readonly tickLower?: number;
  readonly tickUpper?: number;
  readonly hookData?: Hex;
}

const HOOK_DATA = '0x' as const;

function requireHookData(hookData?: Hex): Hex {
  return hookData ?? HOOK_DATA;
}

export function encodeV4Operation(poolKeyInput: PoolKey, request: V4OperationRequest): Hex {
  const key = normalizePoolKey(poolKeyInput);
  if (key.hooks === '0x0000000000000000000000000000000000000000')
    throw new TypeError('PoolKey hooks cannot be the zero address');

  if (request.kind === 'swap' && request.amount === 0n) throw new RangeError('swap amountSpecified cannot be zero');

  if (request.kind === 'swap') {
    return encodeFunctionData({
      abi: [
        {
          name: 'swap',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            {
              name: 'key',
              type: 'tuple',
              components: [
                { name: 'currency0', type: 'address' },
                { name: 'currency1', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'tickSpacing', type: 'int24' },
                { name: 'hooks', type: 'address' },
              ],
            },
            {
              name: 'params',
              type: 'tuple',
              components: [
                { name: 'zeroForOne', type: 'bool' },
                { name: 'amountSpecified', type: 'int256' },
                { name: 'sqrtPriceLimitX96', type: 'uint160' },
              ],
            },
            { name: 'hookData', type: 'bytes' },
          ],
          outputs: [],
        },
      ] as const,
      functionName: 'swap',
      args: [
        {
          currency0: key.currency0,
          currency1: key.currency1,
          fee: key.fee,
          tickSpacing: key.tickSpacing,
          hooks: key.hooks,
        },
        {
          zeroForOne: request.zeroForOne ?? true,
          amountSpecified: request.amount,
          sqrtPriceLimitX96: 0n,
        },
        requireHookData(request.hookData),
      ],
    }) as Hex;
  }

  if (request.kind === 'add' || request.kind === 'remove') {
    return encodeFunctionData({
      abi: [
        {
          name: 'modifyLiquidity',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            {
              name: 'key',
              type: 'tuple',
              components: [
                { name: 'currency0', type: 'address' },
                { name: 'currency1', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'tickSpacing', type: 'int24' },
                { name: 'hooks', type: 'address' },
              ],
            },
            {
              name: 'params',
              type: 'tuple',
              components: [
                { name: 'tickLower', type: 'int24' },
                { name: 'tickUpper', type: 'int24' },
                { name: 'liquidityDelta', type: 'int256' },
                { name: 'salt', type: 'bytes32' },
              ],
            },
            { name: 'hookData', type: 'bytes' },
          ],
          outputs: [],
        },
      ] as const,
      functionName: 'modifyLiquidity',
      args: [
        {
          currency0: key.currency0,
          currency1: key.currency1,
          fee: key.fee,
          tickSpacing: key.tickSpacing,
          hooks: key.hooks,
        },
        {
          tickLower: request.tickLower ?? -60,
          tickUpper: request.tickUpper ?? 60,
          liquidityDelta: request.kind === 'add' ? request.amount : -request.amount,
          salt: `0x${'00'.repeat(32)}` as `0x${string}`,
        },
        requireHookData(request.hookData),
      ],
    }) as Hex;
  }

  return encodeFunctionData({
    abi: [
      {
        name: 'donate',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          {
            name: 'key',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'amount0', type: 'uint256' },
          { name: 'amount1', type: 'uint256' },
          { name: 'hookData', type: 'bytes' },
        ],
        outputs: [],
      },
    ] as const,
    functionName: 'donate',
    args: [
      {
        currency0: key.currency0,
        currency1: key.currency1,
        fee: key.fee,
        tickSpacing: key.tickSpacing,
        hooks: key.hooks,
      },
      request.zeroForOne === false ? 0n : request.amount,
      request.zeroForOne === false ? request.amount : 0n,
      requireHookData(request.hookData),
    ],
  }) as Hex;
}
