import { describe, expect, it } from 'vitest';
import { simulateSequences } from '../src/index.js';

describe('deterministic simulator', () => {
  it('produces identical reports and exercises success/revert paths', async () => {
    const first = await simulateSequences({ seed: 99, count: 50 });
    const second = await simulateSequences({ seed: 99, count: 50 });
    const { elapsedMs: _firstTiming, ...firstResult } = first;
    const { elapsedMs: _secondTiming, ...secondResult } = second;
    expect(firstResult).toEqual(secondResult);
    expect(first.operations.some((op) => op.result === 'reverted')).toBe(true);
    expect(first.operations.some((op) => op.result === 'success')).toBe(true);
    expect(first.violations.length).toBeGreaterThan(0);
    expect(first.riskSeverity).toBe('critical');
  });

  it('runs 50000 sequences without OOM and reports performance', async () => {
    const before = process.memoryUsage.rss();
    const report = await simulateSequences({ seed: 1, count: 50000, lengthPerSequence: 7 });
    expect(report.operations).toHaveLength(350000);
    expect(report.elapsedMs).toBeLessThan(10000);
    expect(process.memoryUsage.rss() - before).toBeLessThan(1.5 * 1024 ** 3);
  }, 20000);

  it('validates count bounds and supports authorization', async () => {
    await expect(simulateSequences({ seed: 1, count: 0 })).rejects.toThrow(RangeError);
    await expect(simulateSequences({ seed: 1, count: 50001 })).rejects.toThrow(RangeError);
    const unauthorized = await simulateSequences({ seed: 1, count: 10 });
    const authorized = await simulateSequences({
      seed: 1,
      count: 10,
      authorizedOperations: ['flash', 'swap', 'add', 'remove', 'donate', 'swap-back'],
    });
    expect(authorized.violations.filter((v) => v.invariant === 'no-unauthorized-transfers').length).toBeLessThan(
      unauthorized.violations.filter((v) => v.invariant === 'no-unauthorized-transfers').length,
    );
    expect(authorized.violations.some((v) => v.invariant === 'no-unauthorized-transfers')).toBe(false);
  });
});
