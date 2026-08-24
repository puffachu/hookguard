export type HookPermission =
  | 'beforeInitialize'
  | 'afterInitialize'
  | 'beforeAddLiquidity'
  | 'afterAddLiquidity'
  | 'beforeRemoveLiquidity'
  | 'afterRemoveLiquidity'
  | 'beforeSwap'
  | 'afterSwap'
  | 'beforeDonate'
  | 'afterDonate'
  | 'beforeSwapReturnDelta'
  | 'afterSwapReturnDelta'
  | 'afterAddLiquidityReturnDelta'
  | 'afterRemoveLiquidityReturnDelta';

const PERMISSION_BITS: ReadonlyArray<readonly [HookPermission, number]> = [
  ['beforeInitialize', 13],
  ['afterInitialize', 12],
  ['beforeAddLiquidity', 11],
  ['afterAddLiquidity', 10],
  ['beforeRemoveLiquidity', 9],
  ['afterRemoveLiquidity', 8],
  ['beforeSwap', 7],
  ['afterSwap', 6],
  ['beforeDonate', 5],
  ['afterDonate', 4],
  ['beforeSwapReturnDelta', 3],
  ['afterSwapReturnDelta', 2],
  ['afterAddLiquidityReturnDelta', 1],
  ['afterRemoveLiquidityReturnDelta', 0],
];

export interface HookPermissions {
  readonly address: `0x${string}`;
  readonly flags: bigint;
  readonly enabled: readonly HookPermission[];
  has(permission: HookPermission): boolean;
}

export function decodeHookPermissions(address: string): HookPermissions {
  const normalized = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) throw new TypeError('address must be a 20-byte hex string');
  const typed = normalized as `0x${string}`;
  const flags = BigInt(typed) & 0xfffffffffffffn;
  const enabled = PERMISSION_BITS.filter(([, bit]) => (flags >> BigInt(bit)) & 1n).map(([permission]) => permission);
  return {
    address: typed,
    flags,
    enabled,
    has: (permission) => enabled.includes(permission),
  };
}

export function describePermissions(hook: HookPermissions): string {
  if (!hook.enabled.length) return 'No hook callbacks';
  return `${hook.enabled.length} callback(s): ${hook.enabled.join(', ')}`;
}
