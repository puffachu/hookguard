import type { ChainName } from './chains.js';
import type { Hex, JsonRpcLike } from './rpc-client.js';

const TX_HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/;

export interface TxResolverProvider extends JsonRpcLike {
  getTransactionByHash(txHash: string): Promise<unknown>;
  getTransactionReceipt(txHash: string): Promise<unknown>;
}

export interface ResolvedHook {
  readonly hookAddress: Hex;
  readonly poolId: Hex | undefined;
  readonly currency0: Hex | undefined;
  readonly currency1: Hex | undefined;
  readonly fee: number | undefined;
  readonly tickSpacing: number | undefined;
  readonly method: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  if (/^0x[0-9a-f]*$/.test(lower)) return lower as Hex;
  return undefined;
}

export function extractAddressFromWord(word: string): Hex | undefined {
  if (!/^0x[0-9a-f]{64}$/i.test(word)) return undefined;
  const address = '0x' + word.slice(26);
  return ADDRESS.test(address) ? (address as Hex) : undefined;
}

export function extractFromInitializeCalldata(data: string): Partial<ResolvedHook> | undefined {
  if (typeof data !== 'string' || !data.startsWith('0x')) return undefined;
  const selector = data.slice(0, 10);
  // initialize(PoolKey) selector = keccak("initialize((address,address,uint24,int24,address))")[0:4]
  // Computed via viem: 0xc7c43d98
  if (selector !== '0xc7c43d98') return undefined;
  const body = data.slice(10);
  if (body.length < 320) return undefined;
  const currency0 = extractAddressFromWord('0x' + body.slice(0, 64));
  const currency1 = extractAddressFromWord('0x' + body.slice(64, 128));
  if (!currency0 || !currency1) return undefined;
  const fee = Number(BigInt('0x' + body.slice(128, 192)));
  const tickSpacingRaw = BigInt('0x' + body.slice(192, 256));
  const tickSpacing = Number(BigInt.asIntN(24, tickSpacingRaw));
  const hookAddress = extractAddressFromWord('0x' + body.slice(256, 320));
  if (!hookAddress) return undefined;
  return { hookAddress, currency0, currency1, fee, tickSpacing };
}

export function resolveFromLogs(logs: readonly unknown[]): Partial<ResolvedHook> | undefined {
  for (const log of logs) {
    if (!isRecord(log)) continue;
    const topics = log.topics;
    const data = toHex(log.data);
    if (!Array.isArray(topics) || !data) continue;

    // Initialize event: topic[1]=poolId, topic[2]=currency0, topic[3]=currency1
    // data: [fee uint24][tickSpacing int24][hooks address] each in 32-byte words
    if (topics.length >= 4 && typeof topics[0] === 'string') {
      const currency0 = extractAddressFromWord(topics[2]);
      const currency1 = extractAddressFromWord(topics[3]);
      const poolId =
        typeof topics[1] === 'string' && /^0x[0-9a-f]{64}$/.test(topics[1])
          ? (topics[1].toLowerCase() as Hex)
          : undefined;
      if (currency0 && currency1 && data.length >= 194) {
        // Parse data: 32-byte words for fee, tickSpacing, hooks
        const hooksWord = '0x' + data.slice(130, 194);
        const hookAddress = extractAddressFromWord(hooksWord);
        const fee = Number(BigInt('0x' + data.slice(2, 66)));
        const tickSpacingRaw = BigInt('0x' + data.slice(66, 130));
        const tickSpacing = Number(BigInt.asIntN(24, tickSpacingRaw));
        if (hookAddress) {
          return { hookAddress, poolId, currency0, currency1, fee, tickSpacing, method: 'initialize-event' };
        }
      }
    }

    // Fallback: scan all topics and data for any address-like value that has deployed bytecode
    // This is a heuristic fallback when we can't identify the specific event
    for (const topic of topics) {
      if (typeof topic !== 'string') continue;
      const candidate = extractAddressFromWord(topic);
      if (candidate && candidate !== '0x0000000000000000000000000000000000000000') {
        return { hookAddress: candidate, method: 'topic-scan' };
      }
    }
    if (data.length >= 66) {
      for (let offset = 2; offset + 64 <= data.length; offset += 64) {
        const word = '0x' + data.slice(offset, offset + 64);
        const candidate = extractAddressFromWord(word);
        if (candidate && candidate !== '0x0000000000000000000000000000000000000000') {
          return { hookAddress: candidate, method: 'data-scan', poolId: undefined };
        }
      }
    }
  }
  return undefined;
}

export async function resolveHookFromTx(
  provider: TxResolverProvider,
  txHash: string,
  chain?: number | ChainName,
): Promise<ResolvedHook> {
  if (!TX_HASH.test(txHash)) throw new TypeError('txHash must be a valid 32-byte hex hash');
  void chain; // Reserved for future chain validation

  const [tx, receipt] = await Promise.all([
    provider.getTransactionByHash(txHash),
    provider.getTransactionReceipt(txHash),
  ]);

  if (tx === null || tx === undefined) throw new Error(`Transaction not found: ${txHash}`);

  // Strategy 1: Decode initialize() calldata directly
  if (isRecord(tx) && typeof tx.input === 'string') {
    const fromCalldata = extractFromInitializeCalldata(tx.input);
    if (fromCalldata?.hookAddress) {
      return {
        method: 'initialize-call',
        ...fromCalldata,
        poolId: fromCalldata.poolId,
      } as ResolvedHook;
    }
  }

  // Strategy 2: Extract from transaction receipt logs
  if (isRecord(receipt) && Array.isArray(receipt.logs)) {
    const fromLogs = resolveFromLogs(receipt.logs);
    if (fromLogs?.hookAddress) {
      return {
        method: fromLogs.method ?? 'pool-event',
        hookAddress: fromLogs.hookAddress,
        poolId: fromLogs.poolId,
        currency0: fromLogs.currency0,
        currency1: fromLogs.currency1,
        fee: fromLogs.fee,
        tickSpacing: fromLogs.tickSpacing,
      } as ResolvedHook;
    }
  }

  throw new Error(`Could not resolve hook address from transaction ${txHash}. Not a V4 pool initialization or swap?`);
}

export { TX_HASH };
