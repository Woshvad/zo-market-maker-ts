# Architecture

**Analysis Date:** 2026-03-08

## Pattern Overview

**Overall:** Event-driven, single-process trading bot with layered abstraction

**Key Characteristics:**
- Central `MarketMaker` class orchestrates all components; no dependency injection container
- WebSocket-first data flow: price feeds and account events are pushed, not polled
- Optimistic local state with periodic server reconciliation (position tracking, order sync)
- Throttled update cycle: incoming price ticks fan-in to a debounced quote update function
- All order placement uses atomic batched operations (cancel+place in one SDK call, max 4 actions per batch)

## Layers

**CLI / Entry Points:**
- Purpose: Parse CLI args, load env vars, instantiate and run top-level classes
- Location: `src/cli/`
- Contains: `bot.ts` (market maker entry), `monitor.ts` (read-only TUI dashboard)
- Depends on: `src/bots/mm/`, `src/pricing/`, `src/sdk/`
- Used by: npm scripts (`npm run bot`, `npm run monitor`)

**Bot Strategy Layer:**
- Purpose: Market-making strategy logic - position tracking, quote calculation, update orchestration
- Location: `src/bots/mm/`
- Contains: `index.ts` (MarketMaker orchestrator), `config.ts` (MarketMakerConfig interface + defaults), `position.ts` (PositionTracker), `quoter.ts` (Quoter)
- Depends on: `src/pricing/`, `src/sdk/`, `src/utils/`
- Used by: `src/cli/bot.ts`

**Pricing Layer:**
- Purpose: Derive a fair price from two price sources (Binance reference + local 01 Exchange)
- Location: `src/pricing/`
- Contains: `binance.ts` (BinancePriceFeed WebSocket client), `fair-price.ts` (FairPriceCalculator + FairPriceProvider interface)
- Depends on: `src/types.ts`, `src/utils/logger.ts`
- Used by: `src/bots/mm/index.ts`, `src/cli/monitor.ts`

**SDK Wrapper Layer:**
- Purpose: Thin wrappers around `@n1xyz/nord-ts` SDK for client setup, streaming, and atomic order operations
- Location: `src/sdk/`
- Contains: `client.ts` (ZoClient factory), `account.ts` (AccountStream WebSocket wrapper), `orderbook.ts` (ZoOrderbookStream with delta+snapshot merge), `orders.ts` (updateQuotes/cancelOrders atomic helpers)
- Depends on: `@n1xyz/nord-ts`, `src/types.ts`, `src/utils/`
- Used by: `src/bots/mm/`, `src/cli/monitor.ts`

**Utilities:**
- Purpose: Shared cross-cutting helpers
- Location: `src/utils/`
- Contains: `logger.ts` (singleton `log` object, pluggable output for TUI redirection)
- Depends on: nothing internal
- Used by: all layers

## Data Flow

**Market Maker Quote Update Cycle:**

1. `BinancePriceFeed` receives a bookTicker WebSocket message from Binance Futures and calls `onPrice` callback with `MidPrice`
2. `MarketMaker.handleBinancePrice()` checks if a recent `ZoOrderbookStream` price is available (within 1s); if so, calls `FairPriceCalculator.addSample(zoMid, binanceMid)`
3. `FairPriceCalculator.getFairPrice()` returns `binanceMid + median(zo - binance offsets)` once warmup samples are met; returns `null` during warmup
4. `MarketMaker` calls the lodash-throttled `executeUpdate(fairPrice)` (min interval: `config.updateThrottleMs`)
5. `executeUpdate` calls `PositionTracker.getQuotingContext(fairPrice)` to get current position state and allowed sides (both sides in normal mode; only reducing side in close mode)
6. `Quoter.getQuotes(ctx, bbo)` computes bid/ask prices aligned to tick/lot size, clamped to not cross the BBO
7. `updateQuotes()` diffs new quotes against `activeOrders`, builds cancel+place actions, and calls `user.atomic()` in batches of 4

**Fill → Position Update Flow:**

1. `AccountStream` receives a WebSocket account update from `@n1xyz/nord-ts`
2. Fill events are dispatched to `MarketMaker` via the `onFill` callback
3. `PositionTracker.applyFill()` updates `baseSize` optimistically (local state)
4. If position crosses `closeThresholdUsd`, all active orders are cancelled immediately
5. `PositionTracker.syncLoop()` runs independently on a timer and reconciles `baseSize` against server state via `user.fetchInfo()`

**Orderbook Snapshot + Delta Merge:**

1. `ZoOrderbookStream.connect()` subscribes to WebSocket first (buffering messages in `deltaBuffer`)
2. REST snapshot is fetched via `nord.getOrderbook()` to get a known `updateId`
3. Buffered deltas with `update_id > snapshotUpdateId` are applied; stale ones are discarded
4. Subsequent deltas are applied in sequence; stale reconnection triggers a full re-fetch

**State Management:**
- `MarketMaker` holds `activeOrders: CachedOrder[]` in memory (updated after each atomic call, overwritten on order sync interval)
- `PositionTracker` holds `baseSize: number` (updated optimistically on fills, reconciled periodically)
- `ZoOrderbookStream` holds in-memory `OrderbookSide` objects (Map of price → size, capped at 100 levels)
- `BinancePriceFeed` holds `latestPrice: MidPrice | null` (last received tick)

## Key Abstractions

**FairPriceProvider (interface):**
- Purpose: Decouples the bot from the fair price algorithm; allows alternative implementations
- Location: `src/pricing/fair-price.ts`
- Implementation: `FairPriceCalculator` uses a circular buffer of per-second offset samples and returns `binanceMid + median(offsets)` over a configurable time window (default 5 min)

**ZoClient (interface + factory):**
- Purpose: Bundles the authenticated `Nord` instance, `NordUser`, and resolved `accountId` into one object
- Location: `src/sdk/client.ts`
- Factory: `createZoClient(privateKey: string): Promise<ZoClient>`

**CachedOrder:**
- Purpose: Local mirror of an active order with `orderId`, `side`, `price` (Decimal), `size` (Decimal)
- Location: `src/sdk/orders.ts`
- Pattern: Compared against new `Quote` objects by exact price+size match to avoid unnecessary cancel/replace round-trips

**QuotingContext:**
- Purpose: Snapshot of all inputs needed for quote calculation at a point in time
- Location: `src/bots/mm/position.ts`
- Contains: `fairPrice`, `positionState` (size, direction, close mode flag), `allowedSides`

**MidPrice:**
- Purpose: Unified price snapshot shared across pricing and SDK layers
- Location: `src/types.ts`
- Shape: `{ mid, bid, ask, timestamp }`

**Quote:**
- Purpose: A desired order to be placed, with `side`, `price` (Decimal), `size` (Decimal)
- Location: `src/types.ts`

## Entry Points

**`src/cli/bot.ts`:**
- Location: `src/cli/bot.ts`
- Triggers: `npm run bot -- <SYMBOL>` (runs via `tsx` for direct TypeScript execution)
- Responsibilities: Reads `PRIVATE_KEY` from env, constructs `MarketMaker` with `DEFAULT_CONFIG` merged with CLI symbol, calls `bot.run()` which never returns

**`src/cli/monitor.ts`:**
- Location: `src/cli/monitor.ts`
- Triggers: `npm run monitor -- <SYMBOL>`
- Responsibilities: No private key required; constructs read-only `MarketMonitor` that renders a `blessed` TUI dashboard showing live orderbook, Binance/01 prices, fair price, and recent trades

## Error Handling

**Strategy:** Catch-and-log at boundary points; streams self-reconnect on disconnect

**Patterns:**
- WebSocket streams (`BinancePriceFeed`, `ZoOrderbookStream`, `AccountStream`) catch `error` events, log them, and schedule reconnect on `close` via `setTimeout`
- `executeUpdate` wraps the full order update cycle in try/catch; on error resets `activeOrders = []`
- `syncOrders` and `positionTracker.syncFromServer` catch fetch errors and log without crashing
- Stale connection detection: `BinancePriceFeed` and `ZoOrderbookStream` run a `setInterval` stale check (60s threshold) and force-terminate the socket if no messages arrive
- Shutdown handler calls `cancelOrders` in a try/catch and always calls `process.exit(0)`

## Cross-Cutting Concerns

**Logging:** Singleton `log` object at `src/utils/logger.ts`. Default output is `console.log`. `log.setOutput(fn)` redirects all output — used by `monitor.ts` to pipe into the `blessed` TUI log box. Log level controlled by `LOG_LEVEL` env var (default: `info`).

**Validation:** Minimal — market symbol resolution throws if not found; missing `PRIVATE_KEY` exits at startup; no runtime schema validation of SDK payloads (defensive casts with `unknown` → typed)

**Authentication:** Solana private key passed as a string to `NordUser.fromPrivateKey()`; session refreshed once at startup via `user.refreshSession()`

---

*Architecture analysis: 2026-03-08*
