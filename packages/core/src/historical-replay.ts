import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { getChain, rpcUrlFor, type ChainName } from './chains.js';

export interface HistoricalTransactionProvider {
  readonly request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
}

export interface HistoricalSimulationRequest {
  readonly txHash: string;
  readonly chain?: number | ChainName;
  readonly scenarios?: readonly HistoricalScenario[];
}

export interface HistoricalScenario {
  readonly label: string;
  readonly blockNumber?: bigint;
  readonly overrides?: Readonly<Partial<Record<'gas' | 'gasPrice' | 'value' | 'data', string>>>;
}

export interface HistoricalSimulationOutcome {
  readonly scenario: string;
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint;
  readonly gasUsed?: bigint;
  readonly logCount?: number;
  readonly error?: string;
}

export interface HistoricalSimulationReport {
  readonly transactionHash: string;
  readonly chainId: number;
  readonly chainName: ChainName;
  readonly parentBlockNumber: bigint;
  readonly baseline: HistoricalSimulationOutcome;
  readonly scenarios: readonly HistoricalSimulationOutcome[];
}

export interface ExecutionRequest {
  readonly transaction: Record<string, unknown>;
  readonly parentBlockNumber: bigint;
  readonly scenario: HistoricalScenario | undefined;
}

export type HistoricalExecutor = (
  request: ExecutionRequest,
) => Promise<Omit<HistoricalSimulationOutcome, 'scenario' | 'blockNumber'>>;

export const MAX_SIMULATION_SCENARIOS = 20;

const TX_HASH = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x[0-9a-f]+$/i;

export async function prepareHistoricalSimulation(
  provider: HistoricalTransactionProvider,
  request: HistoricalSimulationRequest,
): Promise<{
  transactionHash: string;
  chainId: number;
  chainName: ChainName;
  transaction: Record<string, unknown>;
  parentBlockNumber: bigint;
  scenarios: readonly HistoricalScenario[];
}> {
  if (!TX_HASH.test(request.txHash)) throw new TypeError('txHash must be a 32-byte hex string');
  const chain = getChain(request.chain ?? 1);
  const chainId = decodeQuantity(await provider.request({ method: 'eth_chainId', params: [] }), 'chain id');
  if (chainId !== BigInt(chain.id)) throw new Error(`Expected ${chain.name} (${chain.id}), received ${chainId}`);
  const transaction = await provider.request({ method: 'eth_getTransactionByHash', params: [request.txHash] });
  if (!isRecord(transaction)) throw new Error('Transaction not found');
  const blockNumber = decodeQuantity(transaction.blockNumber, 'transaction block number');
  if (blockNumber === 0n) throw new Error('Genesis transactions cannot be fork-replayed');
  return {
    transactionHash: request.txHash,
    chainId: chain.id,
    chainName: chain.name,
    transaction,
    parentBlockNumber: blockNumber - 1n,
    scenarios: request.scenarios ?? [],
  };
}

export async function simulateWithExecutor(
  prepared: Awaited<ReturnType<typeof prepareHistoricalSimulation>>,
  execute: HistoricalExecutor,
): Promise<HistoricalSimulationReport> {
  const outcomes = await Promise.all([
    execute({
      transaction: prepared.transaction,
      parentBlockNumber: prepared.parentBlockNumber,
      scenario: undefined,
    }),
    ...prepared.scenarios.map((scenario) =>
      execute({
        transaction: prepared.transaction,
        parentBlockNumber: prepared.parentBlockNumber,
        scenario,
      }),
    ),
  ]);
  const toOutcome = (
    scenario: string,
    blockNumber: bigint,
    outcome: Awaited<ReturnType<HistoricalExecutor>>,
  ): HistoricalSimulationOutcome => ({
    scenario,
    blockNumber,
    ...outcome,
  });
  return Object.freeze({
    transactionHash: prepared.transactionHash,
    chainId: prepared.chainId,
    chainName: prepared.chainName,
    parentBlockNumber: prepared.parentBlockNumber,
    baseline: toOutcome('baseline', prepared.parentBlockNumber, outcomes[0]!),
    scenarios: prepared.scenarios.map((scenario, index) =>
      toOutcome(scenario.label, scenario.blockNumber ?? prepared.parentBlockNumber, outcomes[index + 1]!),
    ),
  });
}

function rpcCall(endpoint: string, method: string, params: readonly unknown[]): Promise<Record<string, unknown>> {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  }).then(async (response) => {
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok || payload.error)
      throw new Error(
        String((payload.error as { message?: string } | undefined)?.message ?? `RPC HTTP ${response.status}`),
      );
    return payload;
  });
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No free port'))));
    });
  });
}

export async function simulateHistoricalTransaction(
  provider: HistoricalTransactionProvider,
  request: HistoricalSimulationRequest,
  options: { forkUrl?: string; anvilPath?: string } = {},
): Promise<HistoricalSimulationReport> {
  if (request.scenarios && request.scenarios.length > MAX_SIMULATION_SCENARIOS)
    throw new RangeError(`At most ${MAX_SIMULATION_SCENARIOS} simulation scenarios are allowed`);
  const prepared = await prepareHistoricalSimulation(provider, request);
  const forkUrl = options.forkUrl ?? rpcUrlFor(getChain(prepared.chainId));
  if (!forkUrl) throw new Error(`No RPC URL configured for ${prepared.chainName}`);

  const targets = [
    prepared.parentBlockNumber,
    ...prepared.scenarios.map((scenario) => scenario.blockNumber ?? prepared.parentBlockNumber),
  ];
  const uniqueTargets = [...new Set(targets)];
  const forks = new Map(
    await Promise.all(
      uniqueTargets.map(
        async (blockNumber): Promise<[bigint, SimulationFork]> => [
          blockNumber,
          await startSimulationFork(forkUrl, blockNumber, options.anvilPath ?? process.env.ANVIL_PATH ?? 'anvil'),
        ],
      ),
    ),
  );

  try {
    return await simulateWithExecutor(prepared, async ({ parentBlockNumber, scenario }) => {
      const target = scenario?.blockNumber ?? parentBlockNumber;
      const fork = forks.get(target);
      if (!fork) throw new Error(`No simulation fork for block ${target}`);
      const simulated = { ...prepared.transaction };
      if (scenario?.overrides) Object.assign(simulated, scenario.overrides);
      const payload = await rpcCall(fork.endpoint, 'debug_traceCall', [
        simulated,
        quantity(target),
        { tracer: 'callTracer' },
      ]);
      return interpretTrace(payload.result);
    });
  } finally {
    await Promise.all([...forks.values()].map((fork) => fork.stop()));
  }
}

interface SimulationFork {
  readonly endpoint: string;
  readonly stop: () => Promise<void>;
}

async function startSimulationFork(forkUrl: string, blockNumber: bigint, anvilPath: string): Promise<SimulationFork> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'hookguard-historical-'));
  const port = await freePort();
  const child = spawn(
    anvilPath,
    [
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      '--no-cors',
      '--silent',
      '--fork-url',
      forkUrl,
      '--fork-block-number',
      String(blockNumber),
    ],
    { stdio: 'ignore', detached: true },
  );

  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Anvil exited with code ${code}`)));
      child.once('spawn', () => setTimeout(resolve, 100));
    });

    const endpoint = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
      try {
        await rpcCall(endpoint, 'eth_chainId', []);
        ready = true;
      } catch {
        ready = false;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!ready) throw new Error('Anvil did not become ready');

    return {
      endpoint,
      stop: async () => {
        child.kill('SIGTERM');
        await rm(dataDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill('SIGTERM');
    await rm(dataDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function interpretTrace(value: unknown): Omit<HistoricalSimulationOutcome, 'scenario' | 'blockNumber'> {
  if (!isRecord(value) || typeof value.gasUsed !== 'string' || !QUANTITY.test(value.gasUsed))
    throw new Error('Unexpected trace');
  const error = typeof value.error === 'string' ? value.error : undefined;
  return {
    status: error ? 'reverted' : 'success',
    ...(error ? { error } : {}),
    gasUsed: BigInt(value.gasUsed),
    logCount: countLogs(value.logs),
  };
}

function countLogs(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, entry) => total + 1 + countLogs(isRecord(entry) ? entry.calls : undefined), 0);
}

function quantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
function decodeQuantity(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !QUANTITY.test(value)) throw new Error(`Unexpected ${field}`);
  return BigInt(value);
}
