import { decodeHookPermissions, type HookPermission } from './hooks.js';

export interface StaticFinding {
  readonly severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  readonly pattern: string;
  readonly message: string;
}

export interface HookStaticAnalysis {
  readonly address?: `0x${string}`;
  readonly bytecodeSize: number;
  readonly enabledPermissions: readonly HookPermission[];
  readonly presentSelectors: readonly string[];
  readonly missingSelectors: readonly string[];
  readonly findings: readonly StaticFinding[];
  readonly hasPoolManagerGuard: boolean;
}

const CALLBACK_SELECTORS = {
  beforeInitialize: 'dc98354e',
  afterInitialize: '6fe7e6eb',
  beforeAddLiquidity: '259982e5',
  afterAddLiquidity: '8299928f',
  beforeRemoveLiquidity: '21d0ee70',
  afterRemoveLiquidity: '88a2d15e',
  beforeSwap: '575e24b4',
  afterSwap: 'd1c18819',
  beforeDonate: 'b6a8b0fa',
  afterDonate: 'e1b4af69',
} as const satisfies Partial<Record<HookPermission, string>>;

interface Instruction {
  readonly opcode: number;
  readonly immediate?: Uint8Array;
}

function decodeInstructions(bytecode: Uint8Array): readonly Instruction[] {
  const instructions: Instruction[] = [];
  for (let offset = 0; offset < bytecode.length; ) {
    const opcode = bytecode[offset]!;
    offset += 1;
    if (opcode >= 0x60 && opcode <= 0x7f) {
      const length = opcode - 0x5f;
      if (offset + length > bytecode.length) {
        instructions.push({ opcode, immediate: bytecode.subarray(offset) });
        break;
      }
      instructions.push({ opcode, immediate: bytecode.subarray(offset, offset + length) });
      offset += length;
    } else {
      instructions.push({ opcode });
    }
  }
  return instructions;
}
function parseBytecode(bytecode: string): Uint8Array {
  const normalized = bytecode.toLowerCase();
  if (!/^0x[0-9a-f]*$/.test(normalized)) throw new TypeError('bytecode must be hex');
  if (normalized.length % 2 !== 0) throw new TypeError('hex bytecode must contain an even number of digits');
  return Uint8Array.from(Buffer.from(normalized.slice(2), 'hex'));
}

function containsSelector(instructions: readonly Instruction[], selector: string): boolean {
  return instructions.some((instruction) => {
    const immediate = instruction.immediate;
    return (
      instruction.opcode === 0x63 && immediate?.length === 4 && Buffer.from(immediate).toString('hex') === selector
    );
  });
}

export function analyzeHookBytecode(
  bytecode: string,
  hookOrPermissions?: string | ReturnType<typeof decodeHookPermissions>,
): HookStaticAnalysis {
  const parsed = parseBytecode(bytecode);
  const instructions = decodeInstructions(parsed);
  const hook = typeof hookOrPermissions === 'string' ? decodeHookPermissions(hookOrPermissions) : hookOrPermissions;
  const enabledPermissions = hook?.enabled ?? [];
  const presentSelectors: string[] = [];
  const missingSelectors: string[] = [];
  for (const [permission, selector] of Object.entries(CALLBACK_SELECTORS) as readonly [HookPermission, string][]) {
    if (!enabledPermissions.includes(permission)) continue;
    if (containsSelector(instructions, selector)) presentSelectors.push(permission);
    else missingSelectors.push(permission);
  }

  const executedOpcodes = new Set(instructions.map((instruction) => instruction.opcode));
  const findings: StaticFinding[] = [];
  const managerConstantFound = instructions.some((instruction) => {
    if (instruction.opcode !== 0x61 || instruction.immediate?.length !== 2) return false;
    return Buffer.from(instruction.immediate).readUInt16BE(0) === 4;
  });
  const hasPoolManagerGuard = managerConstantFound && executedOpcodes.has(0x33);
  if (executedOpcodes.has(0xff))
    findings.push({
      severity: 'critical',
      pattern: 'selfdestruct',
      message: 'Runtime bytecode contains executable SELFDESTRUCT',
    });
  if (executedOpcodes.has(0xf4))
    findings.push({
      severity: 'high',
      pattern: 'delegatecall',
      message: 'Runtime bytecode executes DELEGATECALL; verify immutable proxy boundaries',
    });
  if (executedOpcodes.has(0xf0) || executedOpcodes.has(0xf5))
    findings.push({
      severity: 'high',
      pattern: 'contract-creation',
      message: 'Runtime bytecode creates child contracts during hook execution',
    });
  for (const permission of missingSelectors)
    findings.push({
      severity: 'high',
      pattern: 'missing-callback-selector',
      message: `${permission} permission is advertised but its IHooks selector was not found`,
    });

  return {
    ...(hook ? { address: hook.address } : {}),
    bytecodeSize: parsed.length,
    enabledPermissions,
    presentSelectors,
    missingSelectors,
    findings,
    hasPoolManagerGuard,
  };
}
