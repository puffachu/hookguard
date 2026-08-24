import { analyzePool } from '../packages/core/src/orchestrator.js';

const rpcUrl = process.env.BASE_RPC_URL;
if (!rpcUrl) throw new Error('Set BASE_RPC_URL to enable explicit live bytecode fetching');

const report = await analyzePool('0x0000000000000000000000000000000000018000', 'base', {
  sequences: 100,
  seed: 1337,
  fetchLiveBytecode: true,
  rpcUrl,
});

console.log(
  JSON.stringify(
    { bytecodeResolution: report.bytecodeResolution },
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  ),
);
