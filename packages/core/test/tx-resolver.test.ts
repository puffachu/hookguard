import { describe, expect, it } from 'vitest';
import { extractFromInitializeCalldata, resolveHookFromTx } from '../src/tx-resolver.js';

describe('tx-resolver', () => {
  describe('extractFromInitializeCalldata', () => {
    it('extracts pool key from initialize calldata', () => {
      // initialize(PoolKey) with currency0=0x0000...01, currency1=0x0000...02
      const data =
        '0xc7c43d98' +
        '0000000000000000000000000000000000000001'.padStart(64, '0') +
        '0000000000000000000000000000000000000002'.padStart(64, '0') +
        BigInt(3000).toString(16).padStart(64, '0') +
        BigInt(60).toString(16).padStart(64, '0') +
        '6337fca822066240064daff387e61653aeec90c8'.padStart(64, '0');

      const result = extractFromInitializeCalldata(data);
      expect(result?.hookAddress).toBe('0x6337fca822066240064daff387e61653aeec90c8');
      expect(result?.currency0).toBe('0x0000000000000000000000000000000000000001');
      expect(result?.currency1).toBe('0x0000000000000000000000000000000000000002');
      expect(result?.fee).toBe(3000);
      expect(result?.tickSpacing).toBe(60);
    });

    it('rejects non-initialize selectors', () => {
      expect(extractFromInitializeCalldata('0xdeadbeef' + '0'.repeat(320))).toBeUndefined();
    });

    it('rejects short calldata', () => {
      expect(extractFromInitializeCalldata('0xc7c43d98')).toBeUndefined();
    });
  });

  describe('resolveHookFromTx', () => {
    it('resolves from initialize call', async () => {
      const initData =
        '0xc7c43d98' +
        '0000000000000000000000000000000000000001'.padStart(64, '0') +
        '0000000000000000000000000000000000000002'.padStart(64, '0') +
        BigInt(500).toString(16).padStart(64, '0') +
        BigInt(10).toString(16).padStart(64, '0') +
        '6337fca822066240064daff387e61653aeec90c8'.padStart(64, '0');

      const provider = {
        request: async () => {
          throw new Error('not used');
        },
        getTransactionByHash: async () => ({ input: initData }),
        getTransactionReceipt: async () => null,
      };
      const result = await resolveHookFromTx(provider as never, '0x' + 'ab'.repeat(32));
      expect(result.hookAddress).toBe('0x6337fca822066240064daff387e61653aeec90c8');
      expect(result.method).toBe('initialize-call');
    });

    it('throws for invalid tx hash', async () => {
      const provider = {
        request: async () => {
          throw new Error('not used');
        },
        getTransactionByHash: async () => null,
        getTransactionReceipt: async () => null,
      };
      await expect(resolveHookFromTx(provider as never, 'not-a-hash')).rejects.toThrow(TypeError);
    });

    it('throws when tx not found', async () => {
      const provider = {
        request: async () => {
          throw new Error('not used');
        },
        getTransactionByHash: async () => null,
        getTransactionReceipt: async () => null,
      };
      await expect(resolveHookFromTx(provider as never, '0x' + 'ab'.repeat(32))).rejects.toThrow(
        'Transaction not found',
      );
    });
  });
});
