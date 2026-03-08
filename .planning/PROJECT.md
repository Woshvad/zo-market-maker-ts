# Zo Market Maker — Risk Improvements

## What This Is

A TypeScript market maker bot for 01 Exchange (Solana perps DEX) that quotes two-sided orders around a fair price derived from Binance WebSocket feeds, using the @n1xyz/nord-ts SDK. This milestone adds five risk-reduction features: stale price protection, volatility-aware spreads, daily loss circuit breaker, continuous inventory skew, and multi-feed price validation.

## Core Value

The bot must never quote on stale or unreliable price data — all risk features exist to prevent the bot from taking unintended losses due to bad pricing, runaway inventory, or feed failures.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Two-sided quoting around fair price with configurable spread — existing
- ✓ Binance WebSocket price feed with reconnection — existing
- ✓ Fair price calculation via median offset (Binance + 01 Exchange) — existing
- ✓ Position tracking with optimistic local state + server reconciliation — existing
- ✓ Atomic batched order placement (cancel+place, max 4 per batch) — existing
- ✓ Binary close mode when position exceeds threshold — existing
- ✓ Stale connection detection and WebSocket reconnection — existing
- ✓ TUI market monitor dashboard — existing
- ✓ Docker deployment with docker-compose — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Stale price protection — cancel all orders and pause quoting when Binance WS silent >2s; auto-resume on recovery
- [ ] Volatility-aware spreads — rolling 1-min return volatility over 10 mins; effective spread = max(configured, vol * 1.5); display in status
- [ ] Daily loss circuit breaker — track realized + unrealized PnL from bot start; halt and cancel all if loss exceeds configurable maxDailyLossUsd (default $20); resettable
- [ ] Continuous inventory skew — replace binary normal/close with continuous quote shifting based on position size; hard cap pauses one side if skew exceeds 2x spread
- [ ] Weighted mid-price — volume-weighted mid using top-of-book sizes from Binance
- [ ] Optional Coinbase second feed — wss://advanced-trade-api.coinbase.com/ws; pause and warn if feeds diverge >15bps

### Out of Scope

- Mobile or web UI — bot is CLI/Docker only
- Multi-market simultaneous quoting — one instance per market
- Backtesting framework — live trading only for now
- Advanced order types (TWAP, iceberg) — simple limit quoting only
- Automated parameter optimization — manual config tuning

## Context

- Existing codebase is clean, well-structured TypeScript with clear layer separation (CLI → Strategy → Pricing → SDK)
- All pricing flows through `FairPriceCalculator` which derives fair price from Binance + 01 Exchange offset median
- Position management is in `PositionTracker` with binary normal/close modes
- Quote calculation is in `Quoter` which computes bid/ask from fair price + spread
- WebSocket feeds already have reconnection logic; stale check exists at 60s threshold
- Config is centralized in `src/bots/mm/config.ts` as `MarketMakerConfig` interface with `DEFAULT_CONFIG`

## Constraints

- **Config**: All new features toggleable via config flags with sensible defaults — nothing breaks if disabled
- **Backwards compatibility**: Preserve existing `config.ts` structure — only add fields, never remove
- **Type safety**: No TypeScript `any` types
- **Scope boundary**: Don't touch CLI interface (`src/cli/`) or Docker setup
- **Documentation**: Each new module gets a comment block explaining what it does and why
- **SDK**: Continue using `@n1xyz/nord-ts` for all exchange interactions
- **Runtime**: Node.js v25+, TypeScript strict mode

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Volatility multiplier 1.5x | Balances tighter spreads in calm markets with protection during vol spikes | — Pending |
| Stale threshold 2s | Fast enough to protect against gaps, tolerant enough to avoid false triggers on normal jitter | — Pending |
| Feed divergence threshold 15bps | Catches meaningful disagreements without triggering on normal cross-exchange noise | — Pending |
| Continuous skew replaces binary close mode | Smoother inventory management, avoids cliff-edge behavior at threshold | — Pending |
| Default max daily loss $20 | Conservative default for a bot that should be low-risk | — Pending |

---
*Last updated: 2026-03-08 after initialization*
