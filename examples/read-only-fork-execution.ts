import { decodeHookPermissions } from '../packages/core/src/hooks.js';
import type { Hex } from '../packages/core/src/rpc-client.js';
import { createJsonRpcTransport, executeV4PlanOnFork } from '../packages/core/src/v4-fork-executor.js';

const rpcUrl = process.env.BASE_RPC_URL;
if (!rpcUrl) throw new Error('Set BASE_RPC_URL for read-only fork execution');

const hook = decodeHookPermissions('0x0000000000000000000000000000000000018000');
const report = await executeV4PlanOnFork(
  {
    poolKey: {
      hooks: hook.address,
      currency0: '0x0000000000000000000000000000000000000000' as Hex,
      currency1: '0x4200000000000000000000000000000000000006' as Hex,
      fee: 3000,
      tickSpacing: 60,
    },
    poolManager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
  },
  { seed: 1337, count: 10, transport: createJsonRpcTransport({ chain: 'base', url: rpcUrl }) },
);

console.log(JSON.stringify(report, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
