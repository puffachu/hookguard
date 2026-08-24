export class HookGuardError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'HookGuardError';
  }
}

export class UnsupportedChainError extends HookGuardError {
  constructor(chainId: number) {
    super(`Unsupported chain id ${chainId}`, 'UNSUPPORTED_CHAIN');
  }
}
