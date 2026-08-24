import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentCommand } from '../src/deploy.js';

test('builds deterministic forge command', () => {
  const publisher = `0x${'a'.repeat(40)}`;
  assert.deepEqual(deploymentCommand(publisher), [
    'forge',
    'create',
    'src/HookGuardOracle.sol:HookGuardOracle',
    '--constructor-args',
    publisher,
  ]);
});

test('rejects invalid publishers', () => {
  assert.throws(() => deploymentCommand('0x123'), TypeError);
});

test('adds optional rpc url and private key', () => {
  const publisher = `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
  assert.deepEqual(deploymentCommand(publisher, { rpcUrl: 'https://example.invalid', privateKey: '0x1234' }), [
    'forge',
    'create',
    'src/HookGuardOracle.sol:HookGuardOracle',
    '--constructor-args',
    publisher,
    '--rpc-url',
    'https://example.invalid',
    '--private-key',
    '0x1234',
  ]);
});
