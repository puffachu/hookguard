#!/usr/bin/env node
import { access } from 'node:fs/promises';

const session = process.argv[2] ?? 'bb-workers';
const intervalMs = Number(process.env.HOOKGUARD_MONITOR_INTERVAL_MS ?? 300000);

export function parseDeadWindows(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .filter((line) => line.endsWith('dead=1'))
    .map((line) => line.split(' ')[0]);
}

export async function markerExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function inspect() {
  const { stdout } = await import('node:child_process').then(
    ({ execFile }) =>
      new Promise((resolve, reject) =>
        execFile('tmux', ['list-windows', '-t', session, '-F', '#{window_name} dead=#{pane_dead}'], (error, result) =>
          error ? reject(error) : resolve({ stdout: result }),
        ),
      ),
  );
  return Promise.all(
    parseDeadWindows(stdout).map(async (name) => ({ name, done: await markerExists(`logs/${name}-done.txt`) })),
  );
}

if (process.argv[1] && process.argv[1].endsWith('monitor-workers.mjs')) {
  for (;;) {
    const crashed = await inspect();
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), session, crashed }, null, 2));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
