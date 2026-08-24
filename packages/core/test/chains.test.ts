import { describe, expect, it } from 'vitest';
import { CHAINS } from '../src/chains.js';

describe('supported chain deployments', () => {
  it('uses verified Uniswap V4 PoolManager addresses', () => {
    expect(Object.fromEntries(Object.entries(CHAINS).map(([name, chain]) => [name, chain.v4PoolManager]))).toEqual({
      ethereum: '0x000000000004444c5dc75cb358380d2e3de08a90',
      base: '0x498581ff718922c3f8e6a244956af099b2652b2b',
      arbitrum: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
      optimism: '0x9a13f98cb987694c9f086b1f5eb990eea8264ec3',
      unichain: '0x1f98400000000000000000000000000000000004',
      polygon: '0x67366782805870060151383f4bbff9dab53e5cd6',
    });
  });
});
