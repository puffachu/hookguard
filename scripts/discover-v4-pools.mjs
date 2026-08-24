#!/usr/bin/env node

import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const INITIALIZE_TOPIC = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';

const ROLLING_BLOCKS = Number(process.env.V4_ROLLING_BLOCKS ?? '5000');

const CHAIN_CONFIGS = {
  ethereum: {
    rpc: process.env.ETHEREUM_RPC_URL ?? 'https://rpc-eth.blockmachine.io',
    manager: '0x000000000004444c5dc75cb358380d2e3de08a90',
    startBlock: 21_562_000,
    maxRange: 10_000,
  },
  base: {
    rpc: process.env.BASE_RPC_URL ?? 'https://rpc-base.blockmachine.io',
    manager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
    startBlock: 25_100_000,
    maxRange: 10_000,
  },
  arbitrum: {
    rpc: process.env.ARBITRUM_RPC_URL ?? 'https://rpc-arbitrum.blockmachine.io',
    manager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
    startBlock: 288_000_000,
    maxRange: 10_000,
  },
  optimism: {
    rpc: process.env.OPTIMISM_RPC_URL ?? 'https://rpc-optimism.blockmachine.io',
    manager: '0x9a13f98cb987694c9f086b1f5eb990eea8264ec3',
    startBlock: 125_000_000,
    maxRange: 10_000,
  },
  unichain: {
    rpc: process.env.UNICHAIN_RPC_URL ?? 'https://mainnet.unichain.org',
    manager: '0x1f98400000000000000000000000000000000004',
    startBlock: 0,
    maxRange: 20_000,
  },
  polygon: {
    rpc: process.env.POLYGON_RPC_URL ?? 'https://polygon.drpc.org',
    manager: '0x67366782805870060151383f4bbff9dab53e5cd6',
    startBlock: 65_000_000,
    maxRange: 4_000,
  },
};

const outputDir = '/tmp/v4-discovery';
mkdirSync(outputDir, { recursive: true });

function parseArgs() {
  const selected = [];
  let workers = 2;
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === '--chain') selected.push(process.argv[++index]);
    if (process.argv[index] === '--workers') workers = Number(process.argv[++index]);
  }
  return { chains: selected.length ? selected : Object.keys(CHAIN_CONFIGS), workers };
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message ?? 'RPC error');
  return body.result;
}

async function retryRpc(url, method, params) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await rpc(url, method, params);
    } catch (error) {
      if (attempt >= 7) throw error;
      await sleep(Math.min(60_000, 750 * 2 ** attempt));
    }
  }
}

function saveJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

async function discoverChain(chainName, config) {
  const statePath = `${outputDir}/${chainName}-state.json`;
  const poolsPath = `${outputDir}/${chainName}-pools.json`;
  const latest = Number(await retryRpc(config.rpc, 'eth_blockNumber'));
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { nextBlock: Math.max(0, config.startBlock), scannedTo: null };
  if (process.env.V4_ROLLING === '1') state.nextBlock = Math.max(0, latest - ROLLING_BLOCKS + 1);
  const pools = existsSync(poolsPath) ? JSON.parse(readFileSync(poolsPath, 'utf8')) : {};
  console.log(`[${chainName}] latest=${latest} resume=${state.nextBlock} known=${Object.keys(pools).length}`);

  while (state.nextBlock <= latest) {
    const fromBlock = state.nextBlock;
    const toBlock = Math.min(latest, fromBlock + config.maxRange - 1);
    try {
      const logs = await retryRpc(config.rpc, 'eth_getLogs', [{
        address: config.manager,
        topics: [INITIALIZE_TOPIC],
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      }]);
      for (const log of logs) {
        if (log.topics.length !== 4) continue;
        pools[log.topics[1].toLowerCase()] = {
          poolId: log.topics[1].toLowerCase(),
          currency0: `0x${log.topics[2].slice(26)}`.toLowerCase(),
          currency1: `0x${log.topics[3].slice(26)}`.toLowerCase(),
          blockNumber: Number(log.blockNumber),
          hook: `0x${BigInt('0x' + log.data.slice(2 + 64 * 2, 2 + 64 * 3)).toString(16).padStart(40, '0')}`.toLowerCase(),
          txHash: log.transactionHash,
        };
      }
      state.nextBlock = toBlock + 1;
      state.scannedTo = toBlock;
      saveJsonAtomic(statePath, state);
      saveJsonAtomic(poolsPath, pools);
      if ((toBlock + 1) % 100_000 < config.maxRange || toBlock === latest) {
        console.log(`[${chainName}] ${toBlock + 1}/${latest + 1} pools=${Object.keys(pools).length}`);
      }
    } catch (error) {
      if (/rate|limit|429|timeout/i.test(String(error))) await sleep(15_000);
      else if (config.maxRange > 250) {
        config.maxRange = Math.max(250, Math.floor(config.maxRange / 2));
        console.warn(`[${chainName}] reduced range to ${config.maxRange}: ${error.message}`);
      } else throw error;
    }
  }
  return Object.values(pools);
}

const { chains, workers } = parseArgs();
if (!chains.every((chain) => CHAIN_CONFIGS[chain])) throw new Error('Unknown chain');
if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('Workers must be 1-4');

const queue = [...chains];
const results = new Map();
await Promise.all(Array.from({ length: workers }, async () => {
  while (queue.length) {
    const chainName = queue.shift();
    try {
      results.set(chainName, await discoverChain(chainName, structuredClone(CHAIN_CONFIGS[chainName])));
    } catch (error) {
      console.error(`[${chainName}] failed at checkpoint: ${error.message}`);
    }
  }
}));

saveJsonAtomic(`${outputDir}/summary.json`, Object.fromEntries(results));
console.log(`discovery complete: ${[...results.values()].reduce((sum, pools) => sum + pools.length, 0)} pools`);
