# HookGuard

Universal Uniswap V4 hook safety protocol. HookGuard decodes hook permissions from V4 address bits, generates bounded adversarial operation sequences, checks economic and state invariants, produces deterministic risk reports, exposes a REST API/CLI, and ships an immutable on-chain risk oracle.

## Status

Production-oriented foundation with deterministic analysis, six-chain adapters, immutable oracle contract, REST API, CLI, CI, and documentation.

## Install

```bash
npm install
```

## Use

```bash
npm run cli -- --address 0x0000000000000000000000000000000000018000 --chain base --sequences 100
npm start
```

### Deterministic Analysis

The same address, chain, sequence count, and seed produce the same offline plan and risk report. Use an explicit seed when a result must be reproducible in review, incident response, or CI:

```bash
npm run cli -- --address 0x0000000000000000000000000000000000018000 --chain base --sequences 100 --seed 1337
```

Static planning does not fetch bytecode unless explicitly requested.

### Explicit Live Bytecode

To analyze deployed runtime code instead of an empty local placeholder, provide bytecode directly or opt into one RPC `eth_getCode` request:

```bash
npm run cli -- \
  --address 0x0000000000000000000000000000000000018000 \
  --chain base \
  --fetch-live-bytecode \
  --rpc-url "$BASE_RPC_URL" \
  --seed 1337
```

A `bytecodeResolution.status` of `provided` or `live` means static checks used supplied/deployed code. `missing`, `disabled`, and `unavailable` are distinct outcomes; do not interpret a report without deployed-code evidence as proof that executable callback behavior is safe.

### Read-Only Pool Execution

Bare pool/hook addresses are not enough to construct Uniswap V4 execution context. Supply every canonical PoolKey field and a PoolManager. The hook identity in that key must decode to exactly the analyzed permission context:

```bash
npm run cli -- \
  --address 0x0000000000000000000000000000000000018000 \
  --chain base \
  --execute \
  --pool-manager 0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32 \
  --currency0 0x0000000000000000000000000000000000000000 \
  --currency1 0x4200000000000000000000000000000000000006 \
  --fee 3000 \
  --tick-spacing 60 \
  --execution-count 10 \
  --rpc-url "$BASE_RPC_URL"
```

Every operation uses read-only `eth_call`; HookGuard signs and broadcasts nothing to production. Reverting calls are evidence, not by themselves proof of a vulnerability.

The API server script is intentionally not enabled by default; use `tsx packages/api/src/server.ts` after adding a listener in your deployment wrapper.

Counterfactual receipt comparison is available at `POST /v1/replay`; real parent-block execution is available at `POST /v1/replay/simulate` when Anvil is installed. Embed `@hookguard/core/deployment-monitor.js` for continuous hook-discovery scans with injectable providers.

## Test

```bash
npm run lint
npm test
npm run test:coverage
npm run build
npm run benchmark -- 50000
```

Static bytecode assurance verifies advertised V4 callback selectors and detects executable selfdestruct, delegatecall, and contract-creation opcodes. Canonical PoolKey normalization and PoolID derivation prepare safe explicit-context fork execution. Analysis can optionally resolve live hook bytecode through chain RPC while remaining deterministic offline by default.

Explicit execution requires a complete normalized PoolKey whose hooks address exactly matches analyzed permissions; bare addresses are never expanded into inferred pools. It remains opt-in in both API (`execution.execute`) and CLI (`--execute`). Execution uses read-only `eth_call` only—never production transactions—and emits typed per-call evidence: target PoolManager, selector/intent, operation label, PoolID, status, available RPC/revert errors, optional `eth_estimateGas` result, resolved/pinned block number, and timestamp. See [docs/API.md](docs/API.md) for field semantics and limitations.

Permission-aware generation filters swap, liquidity, and donation operation classes independently while always retaining flash coverage. Invariants include token conservation, unauthorized extraction, LP/donation integrity, fee accounting, exploitative reentrancy, and post-revert state consistency. Coverage enforces at least 90% statements/functions/lines and 85% branches. The simulator suite executes 50,000 sequences (350,000 operations) under a memory ceiling. Anvil lifecycle tests use a mock executable; set chain-specific RPC variables and install Foundry for live fork/oracle validation.

## Supported Chains

Ethereum, Base, Arbitrum, Optimism, Unichain, and Polygon. Configure `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL`, `OPTIMISM_RPC_URL`, `UNICHAIN_RPC_URL`, or `POLYGON_RPC_URL`.

## Oracle

Deploy from `packages/oracle` with `node src/deploy.js <initial-publisher>`. Configure Forge's standard `--rpc-url`/`ETH_RPC_URL` and `PRIVATE_KEY` for your target network. Scores are 0–100, updates are publisher-only, the contract has no upgrade path, and packed reads expose score plus timestamp in one SLOAD.

## Security

HookGuard is analysis infrastructure, not an exploit framework. It performs local simulations and read-only network calls; it never submits production transactions.

## Scan (New)

Scan any hook address or resolve from a transaction hash, then run static analysis + exploit pattern matching:

```bash
# Direct address scan with live bytecode + exploit analysis
npx tsx packages/cli/src/scan.ts \
  --address 0x0469a4bd3724dc86c9542f4694c976da13c450c0 \
  --chain base

# Resolve hook from transaction hash
npx tsx packages/cli/src/scan.ts \
  --tx-hash 0xdbcf08e57659c16e6d6d23b208341a54d2ea7197219772b39903b8e2845e9ff7 \
  --chain unichain

# Custom RPC endpoint
npx tsx packages/cli/src/scan.ts \
  --address <hook> --chain base --rpc-url "$BASE_RPC_URL"
```

The scan command resolves hook addresses from `initialize()` calldata or `Initialize` event logs, fetches deployed bytecode, decodes permissions from address bits, runs static bytecode analysis, and executes four exploit templates:

| Template           | Class                                        | Severity |
| ------------------ | -------------------------------------------- | -------- |
| `bunni-rounding`   | Flash-loan amplified rounding exploitation   | High     |
| `cork-auth-bypass` | Missing onlyPoolManager authorization        | Critical |
| `boost-spot-price` | Spot price manipulation for downstream logic | Medium   |
| `reentrancy-drain` | External call reentrancy during callbacks    | Low      |
| `unsettled-hook-debt` | Hook-owned residual blocks V4 unlock settlement | High |

Each template produces actionable findings, attack step descriptions, and estimated profit ranges when applicable.
