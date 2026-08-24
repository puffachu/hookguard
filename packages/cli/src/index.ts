#!/usr/bin/env node
import { simulateHistoricalTransaction } from '@hookguard/core/historical-replay.js';
import { createHistoricalProvider, replayScenarios, replayTransaction } from '@hookguard/core/replay.js';
import { getChain, rpcUrlFor } from '@hookguard/core/chains.js';
import { analyzePool } from '@hookguard/core/orchestrator.js';
import { createJsonRpcTransport, executeV4PlanOnFork } from '@hookguard/core/v4-fork-executor.js';
import { decodeHookPermissions } from '@hookguard/core/hooks.js';

interface Args {
  address?: string;
  hookBytecode?: string;
  fetchLiveBytecode?: boolean | string;
  rpcUrl?: string;
  execute?: boolean | string;
  blockNumber?: string;
  poolManager?: string;
  currency0?: string;
  currency1?: string;
  fee?: string;
  tickSpacing?: string;
  executionCount?: string;
  simulate?: boolean;
  txHash?: string;
  scenarios?: string;
  chain?: string;
  sequences?: string;
  seed?: string;
  help?: boolean;
}

function parse(argv: readonly string[]): Args {
  const args: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help') {
      args.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_text, character: string) => character.toUpperCase());
      const value = argv[index + 1];
      args[key] = value && !value.startsWith('--') ? value : true;
    }
  }
  return args as Args;
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  if (args.help || !args.chain) {
    console.log(
      [
        'Usage:',
        '  hookguard --address <hook-or-pool> --chain <name|id> [--sequences 100] [--seed 1337]',
        '    [--hook-bytecode 0x...] [--fetch-live-bytecode] [--rpc-url <url>]',
        '  hookguard --address <hook-or-pool> --chain <name|id> --execute --pool-manager <address>',
        '    --currency0 <address> --currency1 <address> --fee <uint24> --tick-spacing <int24>',
        '    [--execution-count 10] [--block-number <n>] # actual read-only eth_call execution',
        '  hookguard --tx-hash <hash> --chain <name|id> [--scenarios <json>]',
        '  hookguard --tx-hash <hash> --chain <name|id> --simulate [--scenarios <json>]',
        '',
        'Analysis without --execute is deterministic planning only; it performs no V4 calls.',
      ].join('\n'),
    );
    process.exitCode = args.help ? 0 : 1;
    return;
  }
  const chain = /^\d+$/.test(args.chain) ? Number(args.chain) : (args.chain as never);
  if (args.txHash) {
    const provider = createHistoricalProvider({ url: rpcUrlFor(getChain(chain)) });
    const scenarios = parseScenarios(args.scenarios);
    const report = args.simulate
      ? await simulateHistoricalTransaction(provider, { txHash: args.txHash, chain, scenarios }, {})
      : await replayTransaction(
          provider,
          { txHash: args.txHash, chain },
          replayScenarios(
            scenarios.map(({ label, blockNumber, overrides }) => ({
              label,
              ...(blockNumber === undefined ? {} : { blockNumber }),
              ...(overrides === undefined ? {} : { parameters: overrides }),
            })),
          ),
        );
    print(report);
    return;
  }
  if (!args.address) throw new TypeError('--address is required for analysis');
  const options: {
    sequences?: number;
    seed?: number;
    hookBytecode?: string;
    fetchLiveBytecode?: boolean;
    rpcUrl?: string;
  } = {};
  if (typeof args.rpcUrl === 'string') options.rpcUrl = args.rpcUrl;
  if (args.fetchLiveBytecode) options.fetchLiveBytecode = true;
  if (args.sequences) options.sequences = Number(args.sequences);
  if (args.seed) options.seed = Number(args.seed);
  if (typeof args.hookBytecode === 'string') options.hookBytecode = args.hookBytecode;
  const report = await analyzePool(args.address, chain, options);
  if (args.execute) {
    const requiredExecutionArguments = ['poolManager', 'currency0', 'currency1', 'fee', 'tickSpacing'] as const;
    const requiredLabels = ['pool-manager', 'currency0', 'currency1', 'fee', 'tick-spacing'] as const;
    for (const [argumentIndex, argument] of requiredExecutionArguments.entries()) {
      if (typeof args[argument] !== 'string') {
        throw new TypeError(
          `--${requiredLabels[argumentIndex]} is required when --execute requests eth_call execution`,
        );
      }
    }
    const hook = decodeHookPermissions(args.address.toLowerCase());
    const forkReport = await executeV4PlanOnFork(
      {
        poolKey: {
          hooks: hook.address,
          currency0: args.currency0!.toLowerCase() as `0x${string}`,
          currency1: args.currency1!.toLowerCase() as `0x${string}`,
          fee: Number(args.fee),
          tickSpacing: Number(args.tickSpacing),
        },
        poolManager: args.poolManager!.toLowerCase() as `0x${string}`,
      },
      {
        seed: options.seed ?? 1337,
        count: Number(args.executionCount ?? 10),
        ...(args.blockNumber === undefined ? {} : { blockNumber: BigInt(args.blockNumber) }),
        transport: createJsonRpcTransport({
          chain,
          ...(options.rpcUrl === undefined ? {} : { url: options.rpcUrl }),
        }),
      },
    );
    print({ ...report, forkExecution: forkReport });
    return;
  }
  print(report);
}

function parseScenarios(
  value?: string,
): Array<{ label: string; blockNumber?: bigint; overrides?: Record<string, string> }> {
  if (!value) return [];
  return JSON.parse(value).map(
    (scenario: { label: string; blockNumber?: number; overrides?: Record<string, string> }) => ({
      label: scenario.label,
      ...(scenario.blockNumber === undefined ? {} : { blockNumber: BigInt(scenario.blockNumber) }),
      ...(scenario.overrides === undefined ? {} : { overrides: scenario.overrides }),
    }),
  );
}

function print(report: unknown): void {
  console.log(JSON.stringify(report, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
