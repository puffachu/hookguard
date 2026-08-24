import { simulateSequences } from '@hookguard/simulator/index.js';

const count = Number(process.argv[2] ?? 50000);
if (!Number.isInteger(count) || count <= 0) throw new Error('count must be a positive integer');
const report = await simulateSequences({ seed: 1, count, lengthPerSequence: 7 });
console.log(
  JSON.stringify({
    count,
    operations: report.operations.length,
    elapsedMs: report.elapsedMs.toFixed(2),
    operationsPerSecond: Math.round(report.operations.length / (report.elapsedMs / 1000)),
    rssMb: (process.memoryUsage.rss() / 1024 ** 2).toFixed(2),
  }),
);
