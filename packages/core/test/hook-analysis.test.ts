import { describe, expect, it } from 'vitest';
import { analyzeHookBytecode } from '../src/hook-analysis.js';

const push4 = (selector: string): string => `63${selector}00`;

describe('static hook bytecode analysis', () => {
  it('decodes executable opcodes while skipping PUSH immediates', () => {
    const analysis = analyzeHookBytecode('0x600100', '0x0000000000000000000000000000000000000001');
    expect(analysis.bytecodeSize).toBe(3);
    expect(analysis.findings).toEqual([]);
  });

  it('flags SELFDESTRUCT only when executed and validates malformed bytecode', () => {
    expect(analyzeHookBytecode('0x6000ff').findings).toMatchObject([{ severity: 'critical', pattern: 'selfdestruct' }]);
    expect(analyzeHookBytecode('0x64ffffffff00').findings).toEqual([]);
    expect(() => analyzeHookBytecode('0xzz')).toThrow(TypeError);
    expect(() => analyzeHookBytecode('0x123')).toThrow(TypeError);
    expect(analyzeHookBytecode('0x6100043360005260006000f3', '0x0000000000000000000000000000000000000080').hasPoolManagerGuard).toBe(true);
  });

  it('detects delegatecall and contract creation patterns', () => {
    const analysis = analyzeHookBytecode('0x3300f4f5ff');
    const patterns = analysis.findings.map((finding) => finding.pattern);
    expect(patterns).toContain('delegatecall');
    expect(patterns).toContain('contract-creation');
  });

  it('requires selectors for every enabled permission and ignores disabled callbacks', () => {
    const hook = '0x00000000000000000000000000000000000000c0';
    const complete = analyzeHookBytecode(`0x${push4('575e24b4')}${push4('d1c18819')}`, hook);
    expect(complete.enabledPermissions).toEqual(['beforeSwap', 'afterSwap']);
    expect(complete.presentSelectors).toEqual(['beforeSwap', 'afterSwap']);
    expect(complete.missingSelectors).toEqual([]);
    expect(complete.findings).toEqual([]);

    const missing = analyzeHookBytecode(`0x${push4('575e24b4')}`, hook);
    expect(missing.missingSelectors).toEqual(['afterSwap']);
    expect(missing.findings).toMatchObject([{ severity: 'high', pattern: 'missing-callback-selector' }]);

    const unrelated = analyzeHookBytecode(`0x${push4('575e24b4')}`, '0x0000000000000000000000000000000000000000');
    expect(unrelated.missingSelectors).toEqual([]);
    expect(unrelated.findings).toEqual([]);
  });
});
