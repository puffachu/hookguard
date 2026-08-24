import express from 'express';
import type { Express } from 'express';
import { z } from 'zod';
import { CHAINS, getChain, rpcUrlFor } from '@hookguard/core/chains.js';
import { createLiveHookValidation, offlineValidationFallback } from '@hookguard/core/live-validation.js';
import { analyzePool } from '@hookguard/core/orchestrator.js';
import { createV4ExecutionPlans } from '@hookguard/core/v4-execution.js';
import { createJsonRpcTransport, executeV4PlanOnFork } from '@hookguard/core/v4-fork-executor.js';
import { decodeHookPermissions } from '@hookguard/core/hooks.js';
import {
  simulateHistoricalTransaction,
  type HistoricalSimulationReport,
  type HistoricalTransactionProvider,
} from '@hookguard/core/historical-replay.js';
import {
  createHistoricalProvider,
  replayScenarios,
  replayTransaction,
  type HistoricalProvider,
} from '@hookguard/core/replay.js';
const AnalyzeBody = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chain: z.union([z.number().int(), z.enum(['ethereum', 'base', 'arbitrum', 'optimism', 'unichain', 'polygon'])]),
  sequences: z.number().int().min(1).max(50000).default(100),
  seed: z.number().int().min(0).optional(),
  hookBytecode: z
    .string()
    .regex(/^0x[0-9a-fA-F]*$/)
    .optional(),
  fetchLiveBytecode: z.boolean().default(false),
  rpcUrl: z.string().url().max(2048).optional(),
  execution: z
    .object({
      poolManager: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      currency0: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      currency1: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      fee: z.number().int().min(0).max(0xffffff),
      tickSpacing: z.number().int(),
      count: z.number().int().min(1).max(100).default(10),
      seed: z.number().int().min(0).optional(),
      execute: z.boolean().default(false),
      blockNumber: z.number().int().min(1).optional(),
    })
    .optional(),
});
const ValidateBody = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chain: z.union([z.number().int(), z.enum(['ethereum', 'base', 'arbitrum', 'optimism', 'unichain', 'polygon'])]),
  timeoutMs: z.number().int().min(1).max(60000).default(10000),
  retries: z.number().int().min(0).max(3).default(2),
});
const ReplayBody = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  chain: z
    .union([z.number().int(), z.enum(['ethereum', 'base', 'arbitrum', 'optimism', 'unichain', 'polygon'])])
    .default(1),
  blockNumber: z.number().int().min(0).optional(),
  scenarios: z
    .array(
      z.object({
        label: z.string().min(1),
        blockNumber: z.number().int().min(0).optional(),
        overrides: z.record(z.unknown()).optional(),
      }),
    )
    .max(100)
    .optional(),
});
const HistoricalSimulationBody = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  chain: z
    .union([z.number().int(), z.enum(['ethereum', 'base', 'arbitrum', 'optimism', 'unichain', 'polygon'])])
    .default(1),
  scenarios: z
    .array(
      z.object({
        label: z.string().min(1),
        blockNumber: z.number().int().min(1).optional(),
        overrides: z.record(z.string()).optional(),
      }),
    )
    .max(20)
    .default([]),
});

export interface ServerOptions {
  readonly historicalSimulationFactory?: (
    chainName: string,
  ) => (
    provider: HistoricalTransactionProvider,
    request: { txHash: string; chain: number; scenarios?: unknown[] },
  ) => Promise<HistoricalSimulationReport>;
  readonly replayProviderFactory?: (chainName: string) => HistoricalProvider;
}

export function createServer(options: ServerOptions = {}): Express {
  const app = express();
  app.use(express.json());
  app.get('/health', (_request, response) =>
    response.json({ ok: true, chains: Object.values(CHAINS).map(({ id, name }) => ({ id, name })) }),
  );
  app.post('/v1/analyze', async (request, response) => {
    const parsed = AnalyzeBody.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });
    try {
      const analysisOptions: {
        sequences?: number;
        seed?: number;
        hookBytecode?: string;
        fetchLiveBytecode?: boolean;
        rpcUrl?: string;
      } = {
        sequences: parsed.data.sequences,
        ...(parsed.data.seed === undefined ? {} : { seed: parsed.data.seed }),
        ...(parsed.data.hookBytecode === undefined ? {} : { hookBytecode: parsed.data.hookBytecode }),
        fetchLiveBytecode: parsed.data.fetchLiveBytecode,
        ...(parsed.data.rpcUrl === undefined ? {} : { rpcUrl: parsed.data.rpcUrl }),
      };
      const report = await analyzePool(parsed.data.address, parsed.data.chain, analysisOptions);
      let executionPlan;
      if (parsed.data.execution) {
        const hook = decodeHookPermissions(parsed.data.address.toLowerCase());
        const plans = createV4ExecutionPlans(
          {
            poolKey: {
              hooks: hook.address,
              currency0: parsed.data.execution.currency0.toLowerCase() as `0x${string}`,
              currency1: parsed.data.execution.currency1.toLowerCase() as `0x${string}`,
              fee: parsed.data.execution.fee,
              tickSpacing: parsed.data.execution.tickSpacing,
            },
            poolManager: parsed.data.execution.poolManager.toLowerCase() as `0x${string}`,
          },
          hook,
        );
        const items = plans.plan(
          parsed.data.execution.seed ?? analysisOptions.seed ?? 1337,
          parsed.data.execution.count,
        );
        executionPlan = {
          poolIdContext: plans.context,
          requestedCount: parsed.data.execution.count,
          executableCount: items.length,
          items,
        };
        if (parsed.data.execution.execute) {
          executionPlan = {
            ...executionPlan,
            ...(await executeV4PlanOnFork(plans.context, {
              seed: parsed.data.execution.seed ?? analysisOptions.seed ?? 1337,
              count: parsed.data.execution.count,
              ...(parsed.data.execution.blockNumber === undefined
                ? {}
                : { blockNumber: BigInt(parsed.data.execution.blockNumber) }),
              transport: createJsonRpcTransport({
                chain: parsed.data.chain,
                ...(parsed.data.rpcUrl === undefined ? {} : { url: parsed.data.rpcUrl }),
              }),
            })),
          };
        }
      }
      const payload = executionPlan === undefined ? report : { ...report, executionPlan };
      return response
        .type('application/json')
        .send(JSON.stringify(payload, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)));
    } catch (error) {
      return response.status(422).json({ error: error instanceof Error ? error.message : 'analysis failed' });
    }
  });
  app.post('/v1/live-validate', async (request, response) => {
    const parsed = ValidateBody.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });
    try {
      const chainInput = getChain(parsed.data.chain);
      const validation = createLiveHookValidation(chainInput, parsed.data.address as `0x${string}`, {
        timeoutMs: parsed.data.timeoutMs,
        retries: parsed.data.retries,
      });
      return response.json(await validation.validate());
    } catch (error) {
      if (error instanceof Error && /No RPC URL configured/.test(error.message))
        return response.json(offlineValidationFallback(getChain(parsed.data.chain)));
      return response.status(502).json({ error: error instanceof Error ? error.message : 'RPC failed' });
    }
  });
  app.post('/v1/replay', async (request, response) => {
    const parsed = ReplayBody.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });
    let chain: ReturnType<typeof getChain>;
    try {
      chain = getChain(parsed.data.chain);
    } catch (error) {
      return response.status(422).json({ error: error instanceof Error ? error.message : 'unsupported chain' });
    }
    const provider = options.replayProviderFactory?.(chain.name) ?? createHistoricalProvider({ url: rpcUrlFor(chain) });
    try {
      const report = await replayTransaction(
        provider,
        {
          txHash: parsed.data.txHash,
          chain: chain.id,
          ...(parsed.data.blockNumber === undefined ? {} : { blockNumber: BigInt(parsed.data.blockNumber) }),
        },
        replayScenarios(
          parsed.data.scenarios?.map(({ label, blockNumber, overrides }) => ({
            label,
            ...(blockNumber === undefined ? {} : { blockNumber: BigInt(blockNumber) }),
            ...(overrides === undefined ? {} : { parameters: overrides }),
          })) ?? [],
        ),
      );
      return response
        .type('application/json')
        .send(JSON.stringify(report, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)));
    } catch (error) {
      return response.status(422).json({ error: error instanceof Error ? error.message : 'replay failed' });
    }
  });
  app.post('/v1/replay/simulate', async (request, response) => {
    const parsed = HistoricalSimulationBody.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });
    try {
      const simulationChain = getChain(parsed.data.chain);
      const report = await (
        options.historicalSimulationFactory?.(simulationChain.name) ?? simulateHistoricalTransaction
      )(
        { request: (args) => createHistoricalProvider({ url: rpcUrlFor(simulationChain) }).request(args) },
        {
          txHash: parsed.data.txHash,
          chain: simulationChain.id,
          scenarios: parsed.data.scenarios.map(({ label, blockNumber, overrides }) => ({
            label,
            ...(blockNumber === undefined ? {} : { blockNumber: BigInt(blockNumber) }),
            ...(overrides === undefined ? {} : { overrides }),
          })),
        },
      );
      return response
        .type('application/json')
        .send(JSON.stringify(report, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)));
    } catch (error) {
      return response
        .status(422)
        .json({ error: error instanceof Error ? error.message : 'historical simulation failed' });
    }
  });
  app.use((_request, response) => response.status(404).json({ error: 'not found' }));
  return app;
}
//# sourceMappingURL=server.js.map
