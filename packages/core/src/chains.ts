import { UnsupportedChainError } from './errors.js';

export type ChainName = 'ethereum' | 'base' | 'arbitrum' | 'optimism' | 'unichain' | 'polygon';

export interface ChainConfig {
  readonly id: number;
  readonly name: ChainName;
  readonly rpcUrlEnv: string;
  readonly defaultRpcUrl?: string;
  readonly v4PoolManager: `0x${string}`;
}

export const CHAINS: Readonly<Record<ChainName, ChainConfig>> = {
  ethereum: {
    id: 1,
    name: 'ethereum',
    rpcUrlEnv: 'ETHEREUM_RPC_URL',
    defaultRpcUrl: 'https://ethereum-rpc.publicnode.com',
    v4PoolManager: '0x000000000004444c5dc75cb358380d2e3de08a90',
  },
  base: {
    id: 8453,
    name: 'base',
    rpcUrlEnv: 'BASE_RPC_URL',
    defaultRpcUrl: 'https://mainnet.base.org',
    v4PoolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
  },
  arbitrum: {
    id: 42161,
    name: 'arbitrum',
    rpcUrlEnv: 'ARBITRUM_RPC_URL',
    defaultRpcUrl: 'https://arb1.arbitrum.io/rpc',
    v4PoolManager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
  },
  optimism: {
    id: 10,
    name: 'optimism',
    rpcUrlEnv: 'OPTIMISM_RPC_URL',
    defaultRpcUrl: 'https://mainnet.optimism.io',
    v4PoolManager: '0x9a13f98cb987694c9f086b1f5eb990eea8264ec3',
  },
  unichain: {
    id: 130,
    name: 'unichain',
    rpcUrlEnv: 'UNICHAIN_RPC_URL',
    defaultRpcUrl: 'https://mainnet.unichain.org',
    v4PoolManager: '0x1f98400000000000000000000000000000000004',
  },
  polygon: {
    id: 137,
    name: 'polygon',
    rpcUrlEnv: 'POLYGON_RPC_URL',
    defaultRpcUrl: 'https://polygon.drpc.org',
    v4PoolManager: '0x67366782805870060151383f4bbff9dab53e5cd6',
  },
};

export function getChain(input: number | ChainName): ChainConfig {
  const chain = typeof input === 'number' ? Object.values(CHAINS).find((item) => item.id === input) : CHAINS[input];
  if (!chain) throw new UnsupportedChainError(typeof input === 'number' ? input : -1);
  return chain;
}

export function rpcUrlFor(chain: ChainConfig): string {
  return process.env[chain.rpcUrlEnv] ?? chain.defaultRpcUrl ?? '';
}
