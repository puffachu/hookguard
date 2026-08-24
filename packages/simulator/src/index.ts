import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rpcUrlFor, type ChainConfig } from '@hookguard/core/chains.js';
import { generateSequence, type Operation } from '@hookguard/core/generator.js';
import type { HookPermissions } from '@hookguard/core/hooks.js';
import { evaluateInvariants, type Severity, type SimulationStep, type Violation } from '@hookguard/invariants/index.js';

export interface ForkOptions {
  readonly chain: ChainConfig;
  readonly blockNumber?: bigint;
  readonly anvilPath?: string;
}

export interface ForkSession {
  readonly dataDir: string;
  stop(): Promise<void>;
}

export async function startFork({
  chain,
  blockNumber,
  anvilPath = process.env.ANVIL_PATH ?? 'anvil',
}: ForkOptions): Promise<ForkSession> {
  const rpcUrl = rpcUrlFor(chain);
  if (!rpcUrl) throw new Error(`No RPC URL configured for ${chain.name}`);
  const dataDir = await mkdtemp(join(tmpdir(), 'hookguard-anvil-'));
  const args = ['--fork-url', rpcUrl, '--silent'];
  if (blockNumber !== undefined) args.push('--fork-block-number', blockNumber.toString());
  const child = spawn(anvilPath, args, { stdio: 'ignore', detached: true });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    child.once('spawn', () => {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 20);
    });
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Anvil exited immediately with code ${code}`)));
  });

  return {
    dataDir,
    stop: async () => {
      child.kill('SIGTERM');
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export interface SimulatedOperation extends Operation {
  readonly result: 'success' | 'reverted';
}

function simulateOperation(operation: Operation): SimulationStep {
  const digest = [...operation.label].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
  const magnitude = operation.amount === 2n ** 256n - 1n ? 2n ** 64n : BigInt(Math.max(1, digest % 10000));
  const reverted = operation.amount === 0n && digest % 5 === 0;
  const sign = BigInt(operation.zeroForOne ? 1 : -1);
  const poolDelta = reverted
    ? 0n
    : magnitude * (operation.kind === 'swap' || operation.kind === 'swap-back' ? sign : 1n);
  const unauthorized = operation.reentrant === true && digest % 3 === 0 && !reverted;
  const hookDelta = reverted ? 0n : unauthorized ? -magnitude : 0n;
  const callerDelta = reverted
    ? 0n
    : operation.kind === 'swap' || operation.kind === 'swap-back'
      ? magnitude * sign * -1n
      : -magnitude;
  return {
    operation: operation.label,
    poolDelta,
    hookDelta,
    callerDelta,
    ...(operation.reentrant === undefined ? {} : { reentrant: operation.reentrant }),
    reverted,
  };
}

export interface SimulationReport {
  readonly operations: readonly SimulatedOperation[];
  readonly violations: readonly Violation[];
  readonly riskScore: number;
  readonly riskSeverity: Severity;
  readonly elapsedMs: number;
}

function normalize(report: Omit<SimulationReport, 'elapsedMs'> & { elapsedMs: number }): SimulationReport {
  return { ...report, elapsedMs: Math.max(0.01, Number(report.elapsedMs.toFixed(3))) };
}

export async function simulateSequences(input: {
  readonly seed: number;
  readonly count: number;
  readonly lengthPerSequence?: number;
  readonly permissions?: HookPermissions;
  readonly authorizedOperations?: readonly string[];
}): Promise<SimulationReport> {
  if (!Number.isSafeInteger(input.seed)) throw new RangeError('seed must be a safe integer');
  if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 50_000)
    throw new RangeError('count must be between 1 and 50000');
  const started = process.hrtime.bigint();
  const operations: SimulatedOperation[] = [];
  const steps: SimulationStep[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const sequence = generateSequence(input.seed + index, input.permissions, input.lengthPerSequence ?? 7);
    for (const operation of sequence) {
      const step = simulateOperation(operation);
      steps.push(step);
      operations.push({ ...operation, result: step.reverted ? 'reverted' : 'success' });
    }
  }
  const violations = evaluateInvariants(steps, input.authorizedOperations ?? []);
  const weights = { critical: 100, high: 60, medium: 30, low: 10, informational: 0 } as const;
  const worst = violations.reduce<number>(
    (score, violation) => (weights[violation.severity] > score ? weights[violation.severity] : score),
    0,
  );
  return normalize({
    operations,
    violations,
    riskScore: violations.length ? worst : 0,
    riskSeverity: violations.find((item) => item.severity === 'critical')
      ? 'critical'
      : violations.find((item) => item.severity === 'high')
        ? 'high'
        : violations.length
          ? 'medium'
          : 'informational',
    elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
  });
}

export function createForkPlan(
  poolAddress: string,
  chain: ChainConfig,
  options?: { readonly blockNumber?: bigint; readonly anvilPath?: string },
): { rpcUrl: string; anvilPath: string; poolAddress: string; blockNumber?: bigint } {
  const rpcUrl = rpcUrlFor(chain);
  if (!rpcUrl) throw new Error(`No RPC URL configured for ${chain.name}`);
  return {
    rpcUrl,
    anvilPath: options?.anvilPath ?? process.env.ANVIL_PATH ?? 'anvil',
    poolAddress,
    ...(options?.blockNumber === undefined ? {} : { blockNumber: options.blockNumber }),
  };
}
