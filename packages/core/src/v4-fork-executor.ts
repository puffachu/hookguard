import { createV4ExecutionPlans, type V4ExecutorRequest, type V4ExecutionContext } from './v4-execution.js';
import { getChain, type ChainName } from './chains.js';
import { decodeHookPermissions } from './hooks.js';
import { poolId } from './pool-key.js';
import { riskScore, type Violation } from '@hookguard/invariants/index.js';
import { ChainAwareRpcClient, type Hex } from './rpc-client.js';

export type CallStatus = 'success' | 'reverted';

export type RpcTransport = (method: string, params: readonly unknown[]) => Promise<unknown>;

export interface JsonRpcTransportOptions {
  readonly chain: number | ChainName;
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly fetchImpl?: typeof fetch;
}

export function createJsonRpcTransport({
  chain,
  url,
  timeoutMs,
  retries,
  fetchImpl,
}: JsonRpcTransportOptions): RpcTransport {
  const resolvedChain = getChain(chain);
  const client = new ChainAwareRpcClient(resolvedChain.id, {
    ...(url === undefined ? {} : { url }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(retries === undefined ? {} : { retries }),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
  return (method, params) => client.request({ method, params });
}

export interface ForkExecutorOptions {
  readonly transport: RpcTransport;
  readonly blockNumber?: bigint;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

export interface RpcCallEvidence {
  readonly status: CallStatus;
  readonly targetPoolManager: Hex;
  readonly selector: Hex;
  readonly selectorIntent: string;
  readonly operationLabel: string;
  readonly poolId: Hex;
  readonly rpcError?: string;
  readonly revertReason?: string;
  readonly gasUsed?: bigint;
  readonly blockNumber: bigint | null;
  readonly timestamp: string;
}

function quantity(blockNumber?: bigint): string | 'latest' {
  return blockNumber === undefined ? 'latest' : `0x${blockNumber.toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rpcErrorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function requestBlockNumber(transport: RpcTransport): Promise<bigint> {
  const value = await transport('eth_blockNumber', []);
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new TypeError('eth_blockNumber returned malformed quantity');
  }
  return BigInt(value);
}

async function requestGasUsed(
  transport: RpcTransport,
  call: { readonly to: Hex; readonly data: Hex },
  blockQuantity: string,
): Promise<bigint | undefined> {
  try {
    const value = await transport('eth_estimateGas', [call, blockQuantity]);
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'string' || !/^0x(?:[1-9a-f][0-9a-f]*|0)$/i.test(value)) return undefined;
    return BigInt(value);
  } catch {
    return undefined;
  }
}

export function createForkExecutor({ transport, blockNumber, now }: ForkExecutorOptions) {
  const timestamp = now?.().toISOString() ?? new Date().toISOString();
  return async ({ item }: V4ExecutorRequest): Promise<RpcCallEvidence> => {
    const call = { to: item.to, data: item.data };
    let gasUsed: bigint | undefined;
    const blockQuantity = quantity(blockNumber);
    let resolvedBlockNumber: bigint | null = null;
    if (blockNumber !== undefined) resolvedBlockNumber = blockNumber;
    try {
      if (blockNumber === undefined) resolvedBlockNumber = await requestBlockNumber(transport);
      gasUsed = await requestGasUsed(transport, call, blockQuantity);
      await transport('eth_call', [call, blockQuantity]);
      return {
        status: 'success',
        targetPoolManager: item.to,
        selector: item.data.slice(0, 10) as Hex,
        selectorIntent: item.selectorIntent,
        operationLabel: item.operationLabel,
        poolId: poolId(item.poolKey),
        ...(gasUsed === undefined ? {} : { gasUsed }),
        blockNumber: resolvedBlockNumber,
        timestamp,
      };
    } catch (error) {
      const message = rpcErrorMessage(error);
      return {
        status: 'reverted',
        targetPoolManager: item.to,
        selector: item.data.slice(0, 10) as Hex,
        selectorIntent: item.selectorIntent,
        operationLabel: item.operationLabel,
        poolId: poolId(item.poolKey),
        rpcError: message,
        ...(/revert/i.test(message) ? { revertReason: message } : {}),
        ...(gasUsed === undefined ? {} : { gasUsed }),
        blockNumber: resolvedBlockNumber,
        timestamp,
      };
    }
  };
}

export interface ForkExecutionReport {
  readonly requestedCount: number;
  readonly executedCount: number;
  readonly outcomes: readonly RpcCallEvidence[];
  readonly violations: readonly Violation[];
  readonly riskScore: number;
  readonly executionMode: 'read-only-simulation';
}

export function mapOutcomesToViolations(outcomes: readonly RpcCallEvidence[]): readonly Violation[] {
  const reverted = outcomes.filter((outcome) => outcome.status === 'reverted');
  return [
    ...reverted.map((outcome) => ({
      invariant: 'fork-call-reverted',
      severity: 'medium' as const,
      message: `${outcome.selector} ${outcome.selectorIntent}: ` + (outcome.rpcError ?? 'fork call reverted'),
    })),
  ];
}

export function assessForkExecution(outcomes: readonly RpcCallEvidence[]) {
  const violations = mapOutcomesToViolations(outcomes);
  return {
    outcomes,
    violations,
    ...riskScore(violations),
  };
}

export async function executeV4PlanOnFork(
  contextInput: V4ExecutionContext,
  options: ForkExecutorOptions & { readonly seed: number; readonly count: number },
): Promise<ForkExecutionReport> {
  const permissions = decodeHookPermissions(contextInput.poolKey.hooks);
  const { plan } = createV4ExecutionPlans(contextInput, permissions);
  const items = plan(options.seed, options.count);
  const executor = createForkExecutor(options);
  const outcomes: RpcCallEvidence[] = [];
  for (const item of items) outcomes.push(await executor({ poolManager: item.to, item }));
  const assessment = assessForkExecution(outcomes);
  return {
    requestedCount: options.count,
    executedCount: outcomes.length,
    outcomes,
    violations: assessment.violations,
    riskScore: assessment.score,
    executionMode: 'read-only-simulation',
  };
}
