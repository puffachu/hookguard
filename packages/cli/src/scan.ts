#!/usr/bin/env node
import { getChain, rpcUrlFor } from '@hookguard/core/chains.js';
import { ChainAwareRpcClient, type Hex } from '@hookguard/core/rpc-client.js';
import { getCode } from '@hookguard/core/live-validation.js';
import { decodeHookPermissions, describePermissions } from '@hookguard/core/hooks.js';
import { analyzeHookBytecode } from '@hookguard/core/hook-analysis.js';
import { resolveHookFromTx, type TxResolverProvider } from '@hookguard/core/tx-resolver.js';
import { runExploitTemplates, type ExploitReport } from '@hookguard/core/exploit-templates/index.js';

interface ScanArgs {
  address?: string;
  txHash?: string;
  chain?: string;
  rpcUrl?: string;
  help?: boolean;
}

function parse(argv: readonly string[]): ScanArgs {
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--help') {
      args.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const value = argv[i + 1];
      args[key] = value && !value.startsWith('--') ? value : true;
    }
  }
  return args as ScanArgs;
}

async function createProvider(
  chainNameOrId: number | string,
): Promise<{ provider: TxResolverProvider; client: ChainAwareRpcClient }> {
  const chain =
    typeof chainNameOrId === 'number' || /^\d+$/.test(chainNameOrId)
      ? getChain(Number(chainNameOrId))
      : getChain(chainNameOrId as never);
  const url = rpcUrlFor(chain);
  if (!url) throw new Error(`No RPC URL configured for ${chain.name}`);
  let seq = 0;
  const call = async <T>(method: string, params?: readonly unknown[]): Promise<T> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, ...(params === undefined ? {} : { params }) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`RPC ${response.status}`);
    const payload = (await response.json()) as { result?: T };
    return payload.result as T;
  };
  const provider: TxResolverProvider = {
    request: (args) => call(args.method, args.params),
    getTransactionByHash: (hash) => call('eth_getTransactionByHash', [hash]),
    getTransactionReceipt: (hash) => call('eth_getTransactionReceipt', [hash]),
  };
  const client = new ChainAwareRpcClient(chain.id, { url });
  return { provider, client };
}

function printReport(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}

async function scan(args: ScanArgs): Promise<void> {
  if (!args.chain) throw new TypeError('--chain is required');
  const chain = /^\d+$/.test(args.chain) ? Number(args.chain) : (args.chain as never);
  const { provider, client } = await createProvider(args.chain);
  const chainConfig = getChain(chain);

  let hookAddress: Hex;
  let resolvedFrom: string;

  if (args.txHash) {
    console.error(`Resolving hook from transaction ${args.txHash} on ${chainConfig.name}...`);
    const resolved = await resolveHookFromTx(provider, args.txHash);
    hookAddress = resolved.hookAddress;
    resolvedFrom = `tx:${args.txHash}`;
    console.error(`Resolved hook: ${hookAddress}`);
  } else if (args.address) {
    hookAddress = args.address.toLowerCase() as Hex;
    resolvedFrom = `address`;
  } else {
    throw new TypeError('--address or --tx-hash is required');
  }

  const permissions = decodeHookPermissions(hookAddress);

  // Fetch bytecode
  const codeResult = await getCode(client, hookAddress);
  const bytecode = codeResult.value ?? '0x';

  // Static analysis
  let staticAnalysis;
  try {
    staticAnalysis = analyzeHookBytecode(bytecode, permissions);
  } catch {
    staticAnalysis = undefined;
  }

  // Exploit templates
  const exploitReport: ExploitReport = runExploitTemplates({
    hookAddress,
    permissions,
    bytecodeSize: bytecode === '0x' ? 0 : (bytecode.length - 2) / 2,
    hasStaticAnalysisFindings: staticAnalysis ? staticAnalysis.findings.length > 0 : false,
    hasOnlyPoolManagerGuard: staticAnalysis?.hasPoolManagerGuard === true
      ? true
      : undefined,
  });

  printReport({
    tool: 'HookGuard v0.1.0',
    chain: { id: chainConfig.id, name: chainConfig.name },
    hook: {
      address: hookAddress,
      resolvedFrom,
      deployed: bytecode !== '0x',
      bytecodeSize: (bytecode.length - 2) / 2,
      permissions: {
        flags: `0x${permissions.flags.toString(16).padStart(10, '0')}`,
        enabled: permissions.enabled,
        summary: describePermissions(permissions),
      },
    },
    staticAnalysis: staticAnalysis
      ? {
          presentSelectors: staticAnalysis.presentSelectors,
          missingSelectors: staticAnalysis.missingSelectors,
          findings: staticAnalysis.findings,
        }
      : 'unavailable',
    exploitAnalysis: exploitReport,
  });
}

const args = parse(process.argv.slice(2));
if (args.help) {
  console.log(
    [
      'Usage:',
      '  hookguard-scan --address <hook> --chain <name|id>',
      '  hookguard-scan --tx-hash <hash> --chain <name|id>',
      '',
      'Options:',
      '  --address     Hook contract address to scan',
      '  --tx-hash     Transaction hash to resolve hook address from',
      '  --chain       Chain name or ID (ethereum, base, unichain, etc.)',
      '  --rpc-url     Custom RPC endpoint URL',
      '  --help        Show this help',
    ].join('\n'),
  );
} else {
  await scan(args).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
