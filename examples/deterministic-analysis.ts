import { analyzePool } from '../packages/core/src/orchestrator.js';

const report = await analyzePool('0x0000000000000000000000000000000000018000', 'base', {
  sequences: 100,
  seed: 1337,
});

console.log(JSON.stringify(report, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
