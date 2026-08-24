export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export interface Violation {
  readonly invariant: string;
  readonly severity: Severity;
  readonly message: string;
  readonly operation?: string;
}

export interface SimulationStep {
  readonly operation: string;
  readonly poolDelta: bigint;
  readonly hookDelta: bigint;
  readonly callerDelta: bigint;
  readonly reverted: boolean;
  readonly reentrant?: boolean;
}

const NEGATIVE = /^-[0-9]+$/;

function signed(value: bigint): number {
  return value === 0n ? 0 : value < 0n ? -1 : 1;
}

export function tokenConservation(steps: readonly SimulationStep[]): readonly Violation[] {
  const sum = steps
    .filter((step) => !step.reverted)
    .reduce((total, step) => total + step.poolDelta + step.hookDelta + step.callerDelta, 0n);
  return sum === 0n
    ? []
    : [
        {
          invariant: 'token-conservation',
          severity: 'critical',
          message: `Round-trip accounting leaked ${sum.toString()} wei`,
        },
      ];
}

function extraction(step: SimulationStep): bigint {
  const value = step.hookDelta.toString();
  return NEGATIVE.test(value) && signed(step.hookDelta) < 0 ? -step.hookDelta : 0n;
}

export function noUnauthorizedTransfers(
  steps: readonly SimulationStep[],
  authorized: readonly string[] | ReadonlySet<string> = [],
): readonly Violation[] {
  const allowed = authorized instanceof Set ? authorized : new Set(authorized);
  return steps.flatMap((step) => {
    const extracted = !step.reverted ? extraction(step) : 0n;
    if (extracted === 0n || allowed.has(step.operation.split(':')[0])) return [];
    return [
      {
        invariant: 'no-unauthorized-transfers',
        severity: 'critical',
        message: `Hook extracted ${extracted.toString()} wei`,
        operation: step.operation,
      },
    ];
  });
}

export function lpIntegrity(steps: readonly SimulationStep[]): readonly Violation[] {
  return steps
    .filter((step) => /add|remove/.test(step.operation))
    .flatMap((step) =>
      !step.reverted && extraction(step) > 0n
        ? [
            {
              invariant: 'lp-position-integrity',
              severity: 'high',
              message: `Liquidity event allowed unexplained hook extraction of ${extraction(step).toString()} wei`,
              operation: step.operation,
            },
          ]
        : [],
    );
}

export function donationIntegrity(steps: readonly SimulationStep[]): readonly Violation[] {
  return steps.flatMap((step) => {
    if (!step.operation.startsWith('donate') || step.reverted) return [];
    const extracted = extraction(step);
    if (extracted === 0n) return [];
    return [
      {
        invariant: 'donation-integrity',
        severity: 'high',
        message: `Donation allowed hook extraction of ${extracted.toString()} wei`,
        operation: step.operation,
      },
    ];
  });
}

export function feeAccounting(steps: readonly SimulationStep[]): readonly Violation[] {
  const failures = steps.filter(
    (step) =>
      step.operation.startsWith('swap') && !step.reverted && step.poolDelta + step.callerDelta + step.hookDelta !== 0n,
  );
  return failures.length
    ? [
        {
          invariant: 'fee-accounting',
          severity: 'medium',
          message: `${failures.length} swap(s) failed expected accounting`,
        },
      ]
    : [];
}

export function reentrancySafety(steps: readonly SimulationStep[]): readonly Violation[] {
  const unsafe = steps.filter((step) => step.reentrant === true && !step.reverted && step.hookDelta < 0n);
  return unsafe.map((step) => ({
    invariant: 'reentrancy-safety',
    severity: 'critical',
    message: 'Reentrant callback extracted value before completion',
    operation: step.operation,
  }));
}

export function revertConsistency(steps: readonly SimulationStep[]): readonly Violation[] {
  return steps.some(
    (step) => step.reverted && (step.poolDelta !== 0n || step.callerDelta !== 0n || step.hookDelta !== 0n),
  )
    ? [
        {
          invariant: 'revert-consistency',
          severity: 'high',
          message: 'Reverted operation left state or balance change',
        },
      ]
    : [];
}

export function evaluateInvariants(
  steps: readonly SimulationStep[],
  authorizedOperations: readonly string[] = [],
): readonly Violation[] {
  return [
    ...tokenConservation(steps),
    ...noUnauthorizedTransfers(steps, authorizedOperations),
    ...lpIntegrity(steps),
    ...donationIntegrity(steps),
    ...feeAccounting(steps),
    ...reentrancySafety(steps),
    ...revertConsistency(steps),
  ];
}

const SEVERITY_WEIGHT = { critical: 100, high: 60, medium: 30, low: 10, informational: 0 } as const;

export interface RiskAssessment {
  readonly score: number;
  readonly severity: Severity;
}

export function riskScore(violations: readonly Violation[]): RiskAssessment {
  if (!violations.length) return { score: 0, severity: 'informational' };
  const score = Math.min(100, Math.max(...violations.map((violation) => SEVERITY_WEIGHT[violation.severity])));
  const severity = violations.reduce<Severity>(
    (best, violation) => (SEVERITY_WEIGHT[violation.severity] > SEVERITY_WEIGHT[best] ? violation.severity : best),
    'informational',
  );
  return { score, severity };
}
