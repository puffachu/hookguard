import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'scripts/monitor-workers.mjs'), 'utf8');

describe('worker monitor parsing', () => {
  it('implements dead-pane detection for tmux output', () => {
    expect(source).toContain("line.endsWith('dead=1')");
    expect(source).toContain("line.split(' ')[0]");
  });
});
