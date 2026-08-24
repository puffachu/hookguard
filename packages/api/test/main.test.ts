import { spawn, spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { afterAll, describe, expect, it } from 'vitest';

const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
const main = resolve(process.cwd(), 'packages/api/src/main.ts');
type HealthResponse = { status: number | undefined; body: string };

function get(port: number): Promise<HealthResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request({ host: '127.0.0.1', port, path: '/health' }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolvePromise({ status: response.statusCode, body }));
    });
    req.once('error', rejectPromise);
    req.end();
  });
}

describe('API executable listener', () => {
  let child: ReturnType<typeof spawn> | undefined;
  let server: Server | undefined;
  const port = 31113;

  afterAll(async () => {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    if (server?.listening) await once(server, 'close');
  });

  it('starts and serves health checks', async () => {
    child = spawn(tsx, [main], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    let response: HealthResponse = { status: undefined, body: '' };
    let attempts = 0;
    do {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      response = await get(port).catch(() => ({ status: undefined, body: '' }));
      attempts += 1;
    } while (!response.status && attempts < 50);
    expect(response.status, stderr).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: true });
  }, 10000);

  it('rejects invalid ports immediately', () => {
    expect(spawnSync(tsx, [main], { env: { ...process.env, PORT: '-1' }, encoding: 'utf8' }).status).not.toBe(0);
  });
});
