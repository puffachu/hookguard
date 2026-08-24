import { getChain, type ChainConfig } from './chains.js';
import { ChainAwareRpcClient, normalizeHex, type Hex, type JsonRpcClientOptions } from './rpc-client.js';

export interface RpcValidationResult<TValue> {
  readonly status: 'ok' | 'missing' | 'unavailable';
  readonly value?: TValue;
  readonly reason?: string;
}

export interface LiveValidationResult {
  readonly status: 'ok' | 'missing' | 'unavailable';
  readonly chainId: number;
  readonly chainName: string;
  readonly rpcUrlConfigured: boolean;
  readonly chainIdVerified: boolean;
  readonly hookExists?: boolean;
  readonly poolManagerExists?: boolean;
  readonly hookBytecode?: string;
  readonly poolManagerBytecode?: string;
  readonly reason?: string;
}

export interface LiveHookValidation {
  readonly chain: ChainConfig;
  readonly client: ChainAwareRpcClient;
  readonly validate: () => Promise<LiveValidationResult>;
}

export function rpcUrlForChain(chainOrId: ChainConfig | number): string | undefined {
  const chain = typeof chainOrId === 'number' ? getChain(chainOrId) : chainOrId;
  return process.env[chain.rpcUrlEnv] ?? chain.defaultRpcUrl;
}

export async function getCode(client: ChainAwareRpcClient, address: Hex): Promise<RpcValidationResult<string>> {
  try {
    const result = await client.request({ method: 'eth_getCode', params: [address, 'latest'] });
    if (typeof result !== 'string' || !/^0x[0-9a-f]*$/i.test(result)) throw new Error('invalid bytecode');
    if (result === '0x') return { status: 'missing', reason: 'address has no runtime bytecode' };
    return { status: 'ok', value: result };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function findPoolManager(client: ChainAwareRpcClient): Promise<RpcValidationResult<Hex>> {
  const chain = getChain(client.chainId);
  const address = chain.v4PoolManager;
  const code = await getCode(client, address);
  if (code.status === 'ok') return { status: 'ok', value: address };
  return (
    code.status === 'missing' ? { status: 'missing', reason: `PoolManager ${address} has no bytecode` } : code
  ) as RpcValidationResult<Hex>;
}

export function createLiveHookValidation(
  chainOrId: number | ChainConfig,
  hookAddress: Hex,
  options: JsonRpcClientOptions = {},
): LiveHookValidation {
  const chain = typeof chainOrId === 'number' ? getChain(chainOrId) : chainOrId;
  const client = new ChainAwareRpcClient(chain.id, options);
  return {
    chain,
    client,
    validate: async () => {
      try {
        await client.verifyChain();
      } catch (error) {
        return unavailable(chain, error);
      }
      const managerAddress = chain.v4PoolManager as Hex;
      const [hookCode, managerCode] = await Promise.all([
        getCode(client, hookAddress),
        getCode(client, managerAddress),
      ]);
      if (hookCode.status === 'unavailable' || managerCode.status === 'unavailable')
        return unavailable(chain, new Error(hookCode.reason ?? managerCode.reason));
      return {
        status:
          hookCode.status === 'ok' && managerCode.status === 'ok'
            ? 'ok'
            : hookCode.status === 'missing' || managerCode.status === 'missing'
              ? 'missing'
              : 'unavailable',
        chainId: chain.id,
        chainName: chain.name,
        rpcUrlConfigured: true,
        chainIdVerified: true,
        hookExists: hookCode.status === 'ok',
        poolManagerExists: managerCode.status === 'ok',
        ...(hookCode.value === undefined ? {} : { hookBytecode: hookCode.value }),
        ...(managerCode.value === undefined ? {} : { poolManagerBytecode: managerCode.value }),
      };
    },
  };
}

export function offlineValidationFallback(chainOrId: number | ChainConfig): LiveValidationResult {
  const chain = typeof chainOrId === 'number' ? getChain(chainOrId) : chainOrId;
  return {
    status: 'unavailable',
    chainId: chain.id,
    chainName: chain.name,
    rpcUrlConfigured: Boolean(rpcUrlForChain(chain)),
    chainIdVerified: false,
    reason: 'live validation skipped without credentials',
  };
}

function unavailable(chain: ChainConfig, error: unknown): LiveValidationResult {
  return {
    status: 'unavailable',
    chainId: chain.id,
    chainName: chain.name,
    rpcUrlConfigured: true,
    chainIdVerified: false,
    reason: error instanceof Error ? error.message : String(error),
  };
}

export { normalizeHex };
