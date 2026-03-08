# Coding Conventions

**Analysis Date:** 2026-03-08

## Naming Patterns

**Files:**
- kebab-case for multi-word filenames: `fair-price.ts`, `market-maker` (directory)
- Single-word filenames are lowercase: `client.ts`, `logger.ts`, `position.ts`, `quoter.ts`
- Entry points named after role: `bot.ts`, `monitor.ts`

**Classes:**
- PascalCase: `MarketMaker`, `BinancePriceFeed`, `FairPriceCalculator`, `PositionTracker`, `ZoOrderbookStream`, `OrderbookSide`, `Quoter`, `AccountStream`, `MarketMonitor`

**Functions:**
- camelCase for all functions and methods: `deriveBinanceSymbol`, `mapApiOrdersToCached`, `executeAtomic`, `buildPlaceAction`, `orderMatchesQuote`, `getUpdatesPerSecond`

**Variables:**
- camelCase: `baseSize`, `marketId`, `latestPrice`, `isClosing`, `throttledUpdate`
- UPPER_SNAKE_CASE for module-level constants: `BINANCE_FUTURES_WS`, `PING_INTERVAL_MS`, `PONG_TIMEOUT_MS`, `STALE_THRESHOLD_MS`, `MAX_ATOMIC_ACTIONS`, `RECONNECT_DELAY_MS`, `MAX_LEVELS`
- Numeric constants use `_` as a thousands separator: `60_000`, `10_000`

**Interfaces and Types:**
- PascalCase for interfaces: `MarketMakerConfig`, `ZoClient`, `CachedOrder`, `PositionState`, `QuotingContext`, `FairPriceProvider`, `FillEvent`, `BBO`
- PascalCase for type aliases: `PriceCallback`, `LogLevel`, `LogOutput`, `FillCallback`
- Interface fields use camelCase

**Exports:**
- Re-export types via `export type { ... } from "./file.js"` pattern
- The `type` keyword is used on imports when importing only types: `import type { NordUser } from "@n1xyz/nord-ts"`

## Code Style

**Formatter:**
- Biome 2.x (`biome.json`)
- Indent style: **tabs** (not spaces)
- Quote style: **double quotes** for JavaScript/TypeScript strings

**Linting:**
- Biome recommended rules enabled
- VCS integration: respects `.gitignore`
- Import organization is auto-managed (`organizeImports: on`)

**TypeScript:**
- `strict: true` in `tsconfig.json` — all strict checks enabled
- Target: ES2022, module: ES2022
- `moduleResolution: "Bundler"` — import paths must include `.js` extension for relative imports (e.g., `"../../utils/logger.js"`)
- `readonly` used extensively on config interfaces and class fields that should not change
- `as const` and `readonly` on arrays: `readonly ("bid" | "ask")[]`
- Prefer `interface` over `type` for object shapes; `type` for callbacks, aliases, and unions

## Import Organization

**Order (auto-managed by Biome):**
1. External packages: `import WebSocket from "ws"`, `import Decimal from "decimal.js"`
2. Internal absolute-style imports: not used (no path aliases configured)
3. Relative imports: `import { log } from "../utils/logger.js"`

**Path Aliases:**
- None configured. All relative imports use `../` paths with `.js` extensions.

**Side-effect imports:**
- `import "dotenv/config"` at the top of CLI entry points (`src/cli/bot.ts`, `src/cli/monitor.ts`)

## Error Handling

**Patterns:**
- `try/catch` blocks in async methods where external I/O occurs (API calls, WebSocket messages)
- Errors caught at leaves are logged with `log.error("context message:", err)` and execution continues where safe
- Fatal startup errors throw and are caught at the CLI entry point with `process.exit(1)`
- Errors in fire-and-forget async operations use `.catch((err) => { log.error(...) })` pattern
- The `void` keyword is used explicitly when intentionally discarding a Promise: `void this.reconnect()`
- Guard clauses with early return rather than deep nesting: `if (!this.client) return`
- Null-checking via optional chaining extensively: `this.client?.user`, `this.positionTracker?.isCloseMode()`

**Error in shutdown:**
```typescript
try {
    if (this.activeOrders.length > 0 && this.client) {
        await cancelOrders(this.client.user, this.activeOrders);
    }
} catch (err) {
    log.error("Shutdown error:", err);
}
```

**Async fire-and-forget:**
```typescript
cancelOrders(this.client.user, orders)
    .then(() => { this.activeOrders = []; })
    .catch((err) => { log.error("Failed to cancel orders:", err); });
```

## Logging

**Framework:** Custom logger at `src/utils/logger.ts`

**Interface:** `log` object with methods: `log.info()`, `log.warn()`, `log.error()`, `log.debug()`

**Format:** `ISO_TIMESTAMP [LEVEL] message args`

**Level control:** `LOG_LEVEL` environment variable (default: `info`)

**Domain-specific log methods on the `log` object:**
- `log.quote(bid, ask, fair, spreadBps, mode)` — structured quote log
- `log.position(sizeBase, sizeUsd, isLong, isCloseMode)` — position log
- `log.fill(side, price, size)` — fill event log
- `log.config(cfg)` — config display at startup
- `log.banner()` — ASCII art startup banner
- `log.shutdown()` — shutdown message

**Log output is injectable:** `log.setOutput(fn)` allows redirecting to the TUI in `src/cli/monitor.ts`

**When to log:**
- `log.info` — connection events, key state changes, startup/shutdown
- `log.warn` — unexpected but recoverable: disconnections, position drift, stale feeds
- `log.error` — caught exceptions with context prefix
- `log.debug` — fine-grained internal state (order JSON, position updates)

## Comments

**File-level comments:**
- Each file begins with a one-line `// description` comment: `// Atomic order operations with immediate order ID tracking`

**Inline comments:**
- Used to explain non-obvious logic: sequence handling in orderbook, circular buffer mechanics
- Parameter meaning in interfaces documented with trailing `// e.g., "BTC" or "ETH"` comments
- Constants annotated: `const PING_INTERVAL_MS = 30_000; // Send ping every 30s`

**JSDoc/TSDoc:**
- Interface methods in `FairPriceProvider` use `/** ... */` JSDoc blocks
- Not used consistently across the codebase; most code uses `//` inline comments

## Function Design

**Size:** Functions are kept small and single-purpose. Private helpers extract named sub-operations (e.g., `buildPlaceAction`, `buildCancelAction`, `extractPlacedOrders`, `alignPrice`, `alignSize`).

**Parameters:** Constructors use `private readonly` shorthand for injected dependencies. Config objects are passed as single typed interfaces rather than positional args.

**Return Values:** Async operations return `Promise<void>` or `Promise<T>`. Pure calculations return `T | null` when the result may not be available.

## Module Design

**Exports:**
- Named exports only — no default exports
- Classes, interfaces, types, and factory functions are all named exports
- Re-exports used to expose types up the module hierarchy: `export type { MarketMakerConfig } from "./config.js"`

**Barrel Files:**
- Not used. Consumers import directly from the source file.

**Class design:**
- Classes use `private` for all internal state
- Public surface is minimal: only what callers need
- Callbacks are public nullable properties set after construction: `onPrice: PriceCallback | null = null`
- Lifecycle pattern: `connect()` / `close()` for WebSocket streams; `startSync()` / `stopSync()` for loops

**Dependency injection:**
- Config objects injected via constructor
- External dependencies (SDK clients) created externally and passed in or created inside via factory functions (`createZoClient`)
- Interfaces defined for testability: `FairPriceProvider` interface in `src/pricing/fair-price.ts`

---

*Convention analysis: 2026-03-08*
