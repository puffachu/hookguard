#!/usr/bin/env node
const [phase, tests, milestone, blocker = 'None'] = process.argv.slice(2);
if (!phase || !tests || !milestone) {
  console.error('Usage: node scripts/discord-update.mjs <phase> <tests> <milestone> [blocker]');
  process.exit(1);
}
const webhook = process.env.DISCORD_WEBHOOK_URL;
if (!webhook) throw new Error('DISCORD_WEBHOOK_URL required');
const response = await fetch(webhook, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    embeds: [
      {
        title: 'HookGuard progress',
        fields: [
          { name: 'Phase', value: phase },
          { name: 'Tests', value: tests },
          { name: 'Milestone', value: milestone },
          { name: 'Blockers', value: blocker },
        ],
      },
    ],
  }),
});
if (!response.ok) throw new Error(`Discord webhook failed: ${response.status}`);
