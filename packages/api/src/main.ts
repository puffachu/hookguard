#!/usr/bin/env node
import { createServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be an integer between 0 and 65535');
  process.exit(1);
}

const server = createServer().listen(port, () => {
  console.log(`HookGuard API listening on port ${port}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
