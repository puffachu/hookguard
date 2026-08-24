#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

export const DEPLOYMENT_ABI = [
  { type: 'constructor', inputs: [{ name: 'initialPublisher', type: 'address' }] },
  {
    name: 'publishRisk',
    type: 'function',
    inputs: [
      { name: 'hook', type: 'address' },
      { name: 'score', type: 'uint48' },
    ],
  },
  { name: 'getRisk', type: 'function', outputs: [{ type: 'uint256' }] },
];

export function deploymentCommand(publisher, options = {}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(publisher)) throw new TypeError('publisher must be a 20-byte hex address');
  const command = ['forge', 'create', 'src/HookGuardOracle.sol:HookGuardOracle', '--constructor-args', publisher];
  if (options.rpcUrl !== undefined) command.push('--rpc-url', options.rpcUrl);
  if (options.privateKey !== undefined) command.push('--private-key', options.privateKey);
  return command;
}

if (process.argv[1] && process.argv[1].endsWith('src/deploy.js')) {
  const publisher = process.argv[2];
  if (!publisher) {
    console.error('Usage: node src/deploy.js <initial-publisher>');
    process.exit(1);
  }

  try {
    let options = {};
    for (let index = 3; index < process.argv.length; index += 2) {
      if (process.argv[index] === '--rpc-url' || process.argv[index] === '--private-key') {
        options[process.argv[index].slice(2).replaceAll('-', '_')] = process.argv[index + 1];
        index += 1;
      }
    }
    const command = deploymentCommand(publisher, options);
    const result = spawnSync(command[0], command.slice(1), {
      stdio: 'inherit',
      cwd: new URL('..', import.meta.url).pathname,
    });
    process.exit(result.status ?? 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
