import { describe, expect, it } from 'vitest';
import {
  donationIntegrity,
  evaluateInvariants,
  feeAccounting,
  lpIntegrity,
  noUnauthorizedTransfers,
  reentrancySafety,
  revertConsistency,
  riskScore,
  tokenConservation,
  type SimulationStep,
} from '../src/index.js';

const safe: SimulationStep[] = [
  { operation: 'swap:0', poolDelta: 10n, hookDelta: 0n, callerDelta: -10n, reverted: false },
  { operation: 'swap-back:1', poolDelta: -10n, hookDelta: 0n, callerDelta: 10n, reverted: false },
];

const theft: SimulationStep[] = [
  ...safe,
  { operation: 'flash:2', poolDelta: 0n, hookDelta: -7n, callerDelta: 0n, reverted: false },
];

const reverted: SimulationStep[] = [
  { operation: 'swap:0', poolDelta: 1n, hookDelta: 0n, callerDelta: 5n, reverted: true },
];

describe('invariant library', () => {
  it('accepts balanced round trips', () => expect(tokenConservation(safe)).toEqual([]));

  it('detects conservation leaks as critical', () => {
    const violations = tokenConservation([
      ...safe,
      { operation: 'swap:2', poolDelta: 1n, hookDelta: 0n, callerDelta: 0n, reverted: false },
    ]);
    expect(violations).toMatchObject([{ severity: 'critical', invariant: 'token-conservation' }]);
  });

  it('detects unauthorized hook extraction and honors authorization', () => {
    expect(noUnauthorizedTransfers(theft, ['flash'])).toEqual([]);
    expect(noUnauthorizedTransfers(theft, [])).toMatchObject([
      { severity: 'critical', invariant: 'no-unauthorized-transfers' },
    ]);
  });

  it('detects per-operation LP integrity failures', () => {
    const badLp: SimulationStep[] = [
      { operation: 'add:0', poolDelta: 10n, hookDelta: -1n, callerDelta: -9n, reverted: false },
      { operation: 'remove:1', poolDelta: -8n, hookDelta: -2n, callerDelta: 10n, reverted: false },
    ];
    expect(lpIntegrity(badLp)).toHaveLength(2);
    expect(lpIntegrity(safe)).toEqual([]);
  });

  it('detects donation value extraction and accepts balanced donations', () => {
    const badDonation: SimulationStep = {
      operation: 'donate:0',
      poolDelta: 10n,
      hookDelta: -3n,
      callerDelta: -7n,
      reverted: false,
    };
    const goodDonation: SimulationStep = {
      operation: 'donate:1',
      poolDelta: 10n,
      hookDelta: 0n,
      callerDelta: -10n,
      reverted: false,
    };
    expect(donationIntegrity([badDonation])).toMatchObject([
      { severity: 'high', invariant: 'donation-integrity', operation: 'donate:0' },
    ]);
    expect(donationIntegrity([goodDonation])).toEqual([]);
    expect(evaluateInvariants([badDonation])).toSatisfy((violations: { invariant: string }[]) =>
      violations.some((violation) => violation.invariant === 'donation-integrity'),
    );
  });

  it('detects failed fee accounting', () => {
    expect(
      feeAccounting([{ operation: 'swap:0', poolDelta: 1n, hookDelta: 1n, callerDelta: -1n, reverted: false }]),
    ).toHaveLength(1);
    expect(feeAccounting(safe)).toEqual([]);
  });

  it('detects exploitative reentrancy and ignores safe reentrant calls', () => {
    const unsafe: SimulationStep = {
      operation: 'swap:0',
      poolDelta: 0n,
      hookDelta: -4n,
      callerDelta: 4n,
      reentrant: true,
      reverted: false,
    };
    const safeReentrant: SimulationStep = { ...unsafe, hookDelta: 0n };
    expect(reentrancySafety([unsafe])).toMatchObject([{ severity: 'critical', invariant: 'reentrancy-safety' }]);
    expect(reentrancySafety([safeReentrant])).toEqual([]);
  });

  it('detects balance and state leakage after reverts', () => {
    expect(revertConsistency(reverted)).toHaveLength(1);
    expect(evaluateInvariants(reverted)).toMatchObject([{ severity: 'high' }]);
  });

  it('evaluates all categories and scores worst severity', () => {
    const violations = evaluateInvariants([
      ...theft,
      ...reverted,
      {
        operation: 'add:9',
        poolDelta: 10n,
        hookDelta: -1n,
        callerDelta: -9n,
        reentrant: true,
        reverted: false,
      },
    ]);
    expect(violations.map((violation) => violation.invariant)).toEqual(
      expect.arrayContaining([
        'token-conservation',
        'no-unauthorized-transfers',
        'lp-position-integrity',
        'reentrancy-safety',
        'revert-consistency',
      ]),
    );
    expect(riskScore(violations)).toEqual({ score: 100, severity: 'critical' });
  });

  it('maps empty, medium, low, and informational severities', () => {
    expect(riskScore([])).toEqual({ score: 0, severity: 'informational' });
    expect(riskScore([{ invariant: 'x', severity: 'low', message: '' }])).toMatchObject({ score: 10 });
    expect(riskScore([{ invariant: 'x', severity: 'informational', message: '' }])).toMatchObject({ score: 0 });
  });
});
