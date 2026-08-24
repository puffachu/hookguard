import { getChain, type ChainName } from './chains.js';

export interface JsonRpcLike {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

export interface HistoricalProvider extends JsonRpcLike {
  getTransactionReceipt(txHash: string): Promise<unknown>;
}

export interface ReplayRequest {
  readonly txHash: string;
  readonly chain?: number | ChainName;
  readonly blockNumber?: bigint;
}

export interface ReplayScenario {
  readonly label: string;
  readonly blockNumber?: bigint;
  readonly parameterOverrides?: Readonly<Record<string, unknown>>;
}

export interface ReplayOutcome {
  readonly scenario: string;
  readonly blockNumber: bigint;
  readonly transactionHash: string;
  readonly status: 'success' | 'reverted';
  readonly gasUsed: bigint;
  readonly effectiveGasPrice: bigint;
  readonly logs: number;
  readonly changed: boolean;
}

export interface ReplayReport {
  readonly transactionHash: string;
  readonly chainId: number;
  readonly chainName: ChainName;
  readonly baseline: ReplayOutcome;
  readonly scenarios: readonly ReplayOutcome[];
}

export interface HttpHistoricalProviderOptions {
  readonly url: string;
  readonly timeoutMs?: number;
}

const HTTP_ATTEMPTS = 4;

export function createHistoricalProvider({
  url,
  timeoutMs = 10_000,
}: HttpHistoricalProviderOptions): HistoricalProvider {
  let sequence = 0;
  const call = async <T>(method: string, params?: readonly unknown[]): Promise<T> => {
    const id = ++sequence;
    for (let attempt = 1; attempt <= HTTP_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error('RPC returned ' + response.status);
        const payload = (await response.json()) as { result?: T; error?: { message?: string } };
        if (payload.error) throw new Error(payload.error.message ?? 'RPC request failed');
        return payload.result as T;
      } catch (error) {
        if (attempt === HTTP_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 25));
      }
    }
    throw new Error('unreachable');
  };
  return {
    request: (args) => call(args.method, args.params),
    getTransactionReceipt: (transactionHash: string) => {
      if (!TX_HASH.test(transactionHash)) throw new TypeError('txHash must be a 32-byte hex string');
      return call('eth_getTransactionReceipt', [transactionHash]);
    },
  };
}

const TX_HASH = /^0x[0-9a-f]{64}$/i;

function decodeQuantity(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error(`Unexpected ${field}`);
  return BigInt(value);
}

export async function replayTransaction(
  provider: HistoricalProvider,
  request: ReplayRequest,
  scenarios: readonly ReplayScenario[] = [],
): Promise<ReplayReport> {
  if (!TX_HASH.test(request.txHash)) throw new TypeError('txHash must be a 32-byte hex string');
  const chain = getChain(request.chain ?? 1);
  const chainId = await provider
    .request({ method: 'eth_chainId', params: [] })
    .then((value) => decodeQuantity(value, 'chain id'));
  if (chainId !== BigInt(chain.id)) throw new Error(`Expected ${chain.name} (id ${chain.id}), received ${chainId}`);
  const baselineReceipt = await provider.getTransactionReceipt(request.txHash);
  if (baselineReceipt === null || baselineReceipt === undefined) {
    throw new Error('Transaction receipt not found');
  }
  if (!isRecord(baselineReceipt) || typeof baselineReceipt.status !== 'string')
    throw new Error('Unexpected transaction receipt');

  const baselineStatus = decodeQuantity(baselineReceipt.status, 'status');
  if (baselineStatus > 1n) throw new Error('Unexpected receipt status');
  const baselineBlock = decodeQuantity(baselineReceipt.blockNumber, 'block number');
  for (const scenario of scenarios) {
    validateBlock(scenario.blockNumber ?? baselineBlock);
  }

  const gasUsed = decodeQuantity(baselineReceipt.gasUsed, 'gas used');
  const effectiveGasPrice = decodeQuantity(baselineReceipt.effectiveGasPrice, 'effective gas price');
  const logs = asLogs(baselineReceipt.logs);
  const baseline: ReplayOutcome = {
    scenario: 'baseline',
    blockNumber: baselineBlock,
    transactionHash: request.txHash,
    status: baselineStatus === 1n ? 'success' : 'reverted',
    gasUsed,
    effectiveGasPrice,
    logs,
    changed: false,
  };
  return Object.freeze({
    transactionHash: request.txHash,
    chainId: chain.id,
    chainName: chain.name,
    baseline,
    scenarios: scenarios.map((scenario) => ({
      scenario: scenario.label,
      blockNumber: scenario.blockNumber ?? baselineBlock,
      transactionHash: request.txHash,
      status: outcomeFor(scenario, baseline),
      gasUsed,
      effectiveGasPrice,
      logs,
      changed: true,
    })),
  });
}

export function replayScenarios(
  overrides: ReadonlyArray<Pick<ReplayScenario, 'label' | 'blockNumber'> & { parameters?: Record<string, unknown> }>,
): readonly ReplayScenario[] {
  return overrides.map(({ label, blockNumber, parameters }) => ({
    label,
    ...(blockNumber === undefined ? {} : { blockNumber }),
    ...(parameters === undefined ? {} : { parameterOverrides: parameters }),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asLogs(value: unknown): number {
  if (!Array.isArray(value)) throw new Error('Unexpected receipt logs');
  return value.length;
}

function validateBlock(blockNumber: bigint): void {
  if (blockNumber < 0n) throw new RangeError('blockNumber must not be negative');
}

function outcomeFor(scenario: ReplayScenario, baseline: ReplayOutcome): 'success' | 'reverted' {
  const override = scenario.parameterOverrides?.status;
  if (override === undefined) return baseline.status;
  if (override !== 'success' && override !== 'reverted') throw new TypeError("status must be 'success' or 'reverted'");
  return override;
}
