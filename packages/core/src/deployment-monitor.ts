import { CHAINS, getChain, rpcUrlFor, type ChainName } from './chains.js';
import { decodeHookPermissions, type HookPermissions } from './hooks.js';
export type { JsonRpcLike } from './replay.js';
import type { JsonRpcLike } from './replay.js';

export interface DeploymentMonitorOptions {
  readonly chains?: readonly ChainName[];
  readonly fromBlock?: bigint;
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
}

export interface ProviderFactory {
  (chainName: ChainName): JsonRpcLike | Promise<JsonRpcLike>;
}

export interface HookDeployment {
  readonly address: `0x${string}`;
  readonly chainId: number;
  readonly chainName: ChainName;
  readonly blockNumber: bigint;
  readonly transactionHash: string;
  readonly permissions: HookPermissions;
}

export interface ChainScanFailure {
  readonly chainName: ChainName;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly error: string;
}

export interface MonitorResult {
  readonly scannedBlocks: number;
  readonly deployments: readonly HookDeployment[];
  readonly cursor: Readonly<Record<string, bigint>>;
  readonly failures: readonly ChainScanFailure[];
}

const CREATE_CODE = ['0xf47d', '0x4f', '0x58'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function quantity(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error(`Unexpected ${field}`);
  return BigInt(value);
}

async function latestBlock(provider: JsonRpcLike): Promise<bigint> {
  return quantity(await provider.request({ method: 'eth_blockNumber', params: [] }), 'block number');
}

async function scanRange(
  provider: JsonRpcLike,
  chainName: ChainName,
  from: bigint,
  to: bigint,
  seenTransactions: Set<string>,
): Promise<HookDeployment[]> {
  const response = await provider.request({
    method: 'eth_getLogs',
    params: [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
  });
  if (!Array.isArray(response)) throw new Error('Unexpected logs');
  const deployments: HookDeployment[] = [];
  for (const entry of response) {
    if (!isRecord(entry)) throw new Error('Unexpected log');
    const address = typeof entry.address === 'string' ? entry.address.toLowerCase() : undefined;
    if (typeof entry.blockNumber !== 'string') throw new Error('Unexpected log block number');
    const blockNumber = quantity(entry.blockNumber, 'log block number');
    const transactionHash = typeof entry.transactionHash === 'string' ? entry.transactionHash : undefined;
    if (
      address === undefined ||
      !/^0x[0-9a-f]{40}$/.test(address) ||
      transactionHash === undefined ||
      !/^0x[0-9a-f]{64}$/i.test(transactionHash)
    ) {
      continue;
    }
    if ((BigInt(address) & 0xfffffffffffffn) === 0n || seenTransactions.has(transactionHash.toLowerCase())) continue;
    const code = await provider.request({ method: 'eth_getCode', params: [address, `0x${blockNumber.toString(16)}`] });
    if (typeof code !== 'string' || !CREATE_CODE.some((prefix) => code.toLowerCase().startsWith(prefix))) continue;
    seenTransactions.add(transactionHash.toLowerCase());
    const chain = getChain(chainName);
    deployments.push({
      address: address as `0x${string}`,
      chainId: chain.id,
      chainName: chain.name,
      blockNumber,
      transactionHash,
      permissions: decodeHookPermissions(address),
    });
  }
  return deployments;
}

export async function monitorHookDeployments(
  createProvider: ProviderFactory,
  options: DeploymentMonitorOptions = {},
): Promise<MonitorResult> {
  const names = options.chains ?? (Object.keys(CHAINS) as ChainName[]);
  if (!names.length) throw new RangeError('at least one chain is required');
  const batchSize = options.batchSize ?? 2_000;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100_000) {
    throw new RangeError('batchSize must be between 1 and 100000');
  }
  const start = options.fromBlock ?? 0n;
  if (start < 0n) throw new RangeError('fromBlock must not be negative');
  const pollIntervalMs = options.pollIntervalMs ?? 0;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0)
    throw new RangeError('pollIntervalMs must not be negative');
  const cursors = new Map(names.map((name) => [name, start]));
  const deployments: HookDeployment[] = [];
  let scannedBlocks = 0;
  const failures: ChainScanFailure[] = [];
  const failedRanges = new Set<string>();
  const seenTransactions = new Set<string>();

  while (!options.signal?.aborted) {
    const targets = new Map<number, { name: ChainName; from: bigint; to: bigint }>();
    for (const name of names) {
      const current = cursors.get(name)!;
      let head: bigint;
      try {
        head = await latestBlock(await createProvider(name));
      } catch (error) {
        failures.push({ chainName: name, fromBlock: current, toBlock: current, error: message(error) });
        continue;
      }
      if (head < current) continue;
      const to = head < current + BigInt(batchSize - 1) ? head : current + BigInt(batchSize - 1);
      if (failedRanges.has(`${name}:${current}:${to}`)) continue;
      targets.set(chainIndex(name, names), { name, from: current, to });
    }
    if (!targets.size) break;
    await Promise.all(
      [...targets.values()].map(async ({ name, from, to }) => {
        try {
          deployments.push(...(await scanRange(await createProvider(name), name, from, to, seenTransactions)));
          cursors.set(name, to + 1n);
          scannedBlocks += Number(to - from + 1n);
        } catch (error) {
          const errorText = message(error);
          failures.push({ chainName: name, fromBlock: from, toBlock: to, error: errorText });
          failedRanges.add(`${name}:${from}:${to}`);
        }
      }),
    );
    if (pollIntervalMs) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    scannedBlocks,
    deployments: deployments.sort(compareDeployments),
    cursor: Object.fromEntries(cursors),
    failures,
  };
}

function chainIndex(name: ChainName, names: readonly ChainName[]): number {
  return names.indexOf(name);
}

function compareDeployments(left: HookDeployment, right: HookDeployment): number {
  return left.chainId - right.chainId || Number(left.blockNumber - right.blockNumber);
}

export function defaultProviderUrl(chainName: ChainName): string {
  return rpcUrlFor(getChain(chainName));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
