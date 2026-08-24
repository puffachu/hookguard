import { getChain, type ChainName } from './chains.js';
import { getCode, rpcUrlForChain } from './live-validation.js';
import { analyzeHookBytecode, type HookStaticAnalysis } from './hook-analysis.js';
import { ChainAwareRpcClient } from './rpc-client.js';
import { decodeHookPermissions, describePermissions } from './hooks.js';
import { simulateSequences, SimulationReport } from '@hookguard/simulator/index.js';
import { riskScore, type Violation } from '@hookguard/invariants/index.js';

export interface RiskReport extends SimulationReport {
  readonly hook: `0x${string}`;
  readonly hookFlags: string;
  readonly chainId: number;
  readonly chainName: ChainName;
  readonly permissions: readonly string[];
  readonly permissionSummary: string;
  readonly staticAnalysis: HookStaticAnalysis;
  readonly bytecodeResolution: BytecodeResolution;
}

export interface AnalyzePoolOptions {
  readonly sequences?: number;
  readonly seed?: number;
  readonly hookBytecode?: string;
  readonly fetchLiveBytecode?: boolean;
  readonly rpcUrl?: string;
}

export interface BytecodeResolution {
  readonly status: 'provided' | 'live' | 'missing' | 'disabled' | 'unavailable';
  readonly reason?: string;
}

export async function analyzePool(
  poolOrHookAddress: string,
  chainInput: number | ChainName,
  options?: AnalyzePoolOptions,
): Promise<RiskReport> {
  const address = poolOrHookAddress.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new TypeError('pool or hook address must be a 20-byte hex string');
  const chain = getChain(chainInput);
  const hook = decodeHookPermissions(address);
  const report = await simulateSequences({
    seed: options?.seed ?? 1337,
    count: options?.sequences ?? 100,
    permissions: hook,
  });
  let bytecode = options?.hookBytecode ?? '0x';
  const resolution: BytecodeResolution =
    options?.hookBytecode !== undefined
      ? { status: 'provided' }
      : !options?.fetchLiveBytecode
        ? { status: 'disabled', reason: 'live bytecode fetching not enabled' }
        : await (async () => {
            const url = options?.rpcUrl ?? rpcUrlForChain(chain);
            if (!url) return { status: 'unavailable', reason: `No RPC URL configured for ${chain.name}` };
            const client = new ChainAwareRpcClient(chain.id, { url });
            const result = await getCode(client, hook.address);
            if (result.status === 'ok' && result.value !== undefined) {
              bytecode = result.value;
              return { status: 'live' } as const;
            }
            return result.status === 'ok'
              ? { status: 'live' }
              : {
                  status: result.status,
                  ...(result.reason === undefined ? {} : { reason: result.reason }),
                };
          })();
  const staticAnalysis = analyzeHookBytecode(bytecode, address);
  const combinedViolations: readonly Violation[] = [
    ...report.violations,
    ...staticAnalysis.findings.map((finding) => ({
      invariant: `static-${finding.pattern}`,
      severity: finding.severity,
      message: finding.message,
    })),
  ];
  const assessment = riskScore(combinedViolations);
  return Object.freeze({
    ...report,
    violations: combinedViolations,
    riskScore: assessment.score,
    riskSeverity: assessment.severity,
    hook: hook.address,
    hookFlags: hook.flags.toString(),
    chainId: chain.id,
    chainName: chain.name,
    permissions: hook.enabled,
    permissionSummary: describePermissions(hook),
    staticAnalysis,
    bytecodeResolution: resolution,
  });
}

export function summarize(report: RiskReport): string {
  return [
    `HookGuard ${report.chainName}:${report.hook}`,
    report.permissionSummary,
    `Sequences executed=${(report.operations.length / 7).toFixed(0)}`,
    `Risk=${report.riskScore}/100 (${report.riskSeverity})`,
    `Static findings=${report.staticAnalysis.findings.length}`,
    `Violations=${report.violations.length}`,
  ].join('\n');
}
