import { getChain } from '@hookguard/core/chains.js';
import { ChainAwareRpcClient } from '@hookguard/core/rpc-client.js';
import { getCode, rpcUrlForChain } from '@hookguard/core/live-validation.js';
import { decodeHookPermissions, describePermissions } from '@hookguard/core/hooks.js';
import { runExploitTemplates } from '@hookguard/core/exploit-templates/index.js';

const hookAddress = process.argv[2] ?? '0x0469a4bd3724dc86c9542f4694c976da13c450c0';
const chainName = (process.argv[3] ?? 'base') as keyof typeof import('@hookguard/core/chains.js').CHAINS;

const chain = getChain(chainName);
const client = new ChainAwareRpcClient(chain.id, { url: rpcUrlForChain(chain)! });
const code = await getCode(client, hookAddress as `0x${string}`);
const bytecode = code.value ?? '0x';
const permissions = decodeHookPermissions(hookAddress);

const report = runExploitTemplates({
  hookAddress,
  permissions,
  bytecodeSize: bytecode === '0x' ? 0 : (bytecode.length - 2) / 2,
  hasStaticAnalysisFindings: false,
});

console.log(`HookGuard Scan Report`);
console.log(`=====================`);
console.log(`Hook: ${hookAddress}`);
console.log(`Chain: ${chain.name} (${chain.id})`);
console.log(`Deployed: ${bytecode !== '0x'} (${bytecode === '0x' ? 0 : (bytecode.length - 2) / 2} bytes)`);
console.log(`Permissions: ${describePermissions(permissions)}`);
console.log(`\nExploit Analysis:`);
console.log(`Templates run: ${report.templatesRun}`);
console.log(`Applicable: ${report.templatesApplicable}`);
console.log(`Vulnerabilities: ${report.vulnerabilitiesFound} (${report.maxSeverity})`);

for (const result of report.results) {
  if (!result.applicable) continue;
  const icon = result.vulnerable ? '⚠️' : '✓';
  console.log(`\n${icon} ${result.name}`);
  console.log(`  Severity: ${result.severity}`);
  if (result.vulnerable && result.findings.length > 0) {
    for (const finding of result.findings) {
      console.log(`  Finding: ${finding.message}`);
    }
  }
}
