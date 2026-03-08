# Testing

**Analysis Date:** 2026-03-08

## Summary

**No tests exist.** Zero test files are present in the codebase. There is no test framework, test runner, or test configuration.

## Current State

- **Test files:** 0
- **Test framework:** None installed
- **Coverage:** 0%
- **CI test step:** None (no CI pipeline)

## What Would Need to Be Tested

The codebase has several well-isolated units that would lend themselves to unit testing:

| Unit | Testable Behavior |
|------|------------------|
| `FairPriceCalculator` (`src/pricing/fair-price.ts`) | Circular buffer, median offset, warmup gating, time-window expiry |
| `Quoter` (`src/bots/mm/quoter.ts`) | Price alignment, BBO clamping, close-mode quote generation |
| `PositionTracker` (`src/bots/mm/position.ts`) | Fill application, close-mode threshold, allowed sides |
| `updateQuotes` (`src/sdk/orders.ts`) | Diff logic (cancel/place batching, 4-action limit, exact match detection) |
| `OrderbookSide` (`src/sdk/orderbook.ts`) | Delta application, level cap, BBO calculation |

Integration testing would require mocking `@n1xyz/nord-ts` and the Binance WebSocket.

## Testability Assessment

**Good:**
- `FairPriceProvider` interface decouples pricing from the bot — easy to inject a mock
- Pure calculation functions (`alignPrice`, `alignSize`, `getValidSamples`) have no side effects
- Config is a plain interface — easily constructed in tests

**Difficult:**
- `MarketMaker` orchestrator is tightly coupled to all subsystems simultaneously
- WebSocket streams (`BinancePriceFeed`, `ZoOrderbookStream`, `AccountStream`) wrap real WS connections — require significant mocking
- `user.atomic()` calls the live `@n1xyz/nord-ts` SDK with no injectable seam in the current code

## Recommended Framework (if added)

**Vitest** is a natural fit given the ESM + TypeScript setup:
- Native ESM support (no extra config needed)
- TypeScript out of the box
- Compatible with the existing `biome.json` toolchain
- Mock functions, timers, and module mocking built in

```bash
npm install -D vitest
```

Add to `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

---

*Testing analysis: 2026-03-08*
