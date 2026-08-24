import { getChain, rpcUrlFor, type ChainName } from './chains.js';

export type Hex = `0x${string}`;
export type ChainInput = number | ChainName;
export type { JsonRpcLike } from './replay.js';

export interface JsonRpcRequestOptions {
  readonly method: string;
  readonly params?: readonly unknown[];
}

export interface JsonRpcClientOptions {
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly retryDelayMs?: number;
  readonly fetch?: typeof fetch;
}

export class JsonRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.toLowerCase().replace(/^0x/, '').replace(/0+$/, '') || '0';
}

export async function requestWithRetries(
  client: ChainAwareRpcClient,
  options: JsonRpcRequestOptions,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= client.retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), client.timeoutMs);
    try {
      const response = await client.fetchImpl(client.url, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: attempt + 1, ...options }),
        signal: controller.signal,
      });
      if (response.status === 429 || response.status >= 500) {
        const retryable = new Error(`RPC HTTP ${response.status}`);
        (retryable as Error & { retryable?: boolean }).retryable = true;
        throw retryable;
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || body.id !== attempt + 1) throw new Error('Malformed JSON-RPC response envelope');
      if (body.error !== undefined) {
        const rpcErrorBody = isRecord(body.error) ? body.error : {};
        throw new JsonRpcError(
          typeof rpcErrorBody.message === 'string' ? rpcErrorBody.message : 'JSON-RPC error',
          typeof rpcErrorBody.code === 'number' ? rpcErrorBody.code : -32603,
          rpcErrorBody.data,
        );
      }
      return body.result;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !('retryable' in error)) throw error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < client.retries) await new Promise((resolve) => setTimeout(resolve, client.retryDelayMs));
  }
  throw lastError instanceof Error ? lastError : new Error('JSON-RPC request failed');
}

export class ChainAwareRpcClient {
  fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly retryDelayMs: number;
  private readonly expectedChainId: string;

  constructor(
    readonly chainId: number,
    options: JsonRpcClientOptions = {},
  ) {
    getChain(chainId);
    const configured = options.url ?? rpcUrlFor(getChain(chainId));
    if (!configured) throw new Error(`No RPC URL configured for chain ${chainId}`);
    this.url = configured;
    this.expectedChainId = chainId.toString(16).toLowerCase();
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  readonly url: string;

  async request(options: JsonRpcRequestOptions): Promise<unknown> {
    return requestWithRetries(this, options);
  }

  async verifyChain(): Promise<number> {
    const result = await this.request({ method: 'eth_chainId' });
    if (normalizeHex(result) !== this.expectedChainId)
      throw new Error(`Unexpected chain ${String(result)}; expected ${this.chainId}`);
    return this.chainId;
  }
}
