# Roadmap: Zo Market Maker — Risk Improvements

## Overview

This milestone adds risk management to an existing market maker bot. The work flows from safety gates (stop quoting on bad data) through quote intelligence (smarter spreads and inventory management) to loss protection (circuit breaker on PnL threshold). Each phase delivers an independent, verifiable risk capability. The bot's core value — never quote on stale or unreliable data — drives phase ordering: protect first, optimize second, account third.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Feed Safety** - Stale price protection with state machine, config foundation, and backwards compatibility guarantees (completed 2026-03-09)
- [x] **Phase 2: Quote Intelligence** - Volatility-aware spreads, continuous inventory skew, and weighted mid-price (completed 2026-03-09)
- [ ] **Phase 3: Loss Protection** - PnL tracking from fills and daily loss circuit breaker

## Phase Details

### Phase 1: Feed Safety
**Goal**: Bot stops quoting immediately when price data is stale and only resumes after verified recovery
**Depends on**: Nothing (first phase)
**Requirements**: FEED-01, FEED-02, FEED-03, FEED-05, CONF-01, CONF-02, CONF-03, CONF-04
**Success Criteria** (what must be TRUE):
  1. Bot cancels all open orders within one update cycle when Binance feed is silent for >2 seconds
  2. Bot resumes quoting only after receiving multiple fresh prices, not on first recovery message
  3. Bot transitions through explicit states (WARMING_UP, QUOTING, STALE, HALTED) and never places orders outside QUOTING state
  4. All new config fields have sensible defaults and the bot behaves identically to current behavior when all new features are disabled
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — TDD FeedStateManager: test infrastructure + state machine with full test coverage
- [x] 01-02-PLAN.md — Config, logger, and MarketMaker integration of FeedStateManager

### Phase 2: Quote Intelligence
**Goal**: Bot quotes with spreads and position management that adapt to market conditions instead of using fixed parameters
**Depends on**: Phase 1
**Requirements**: FEED-04, SPRD-01, SPRD-02, SPRD-03, SPRD-04, SPRD-05, INVT-01, INVT-02, INVT-03, INVT-04, INVT-05
**Success Criteria** (what must be TRUE):
  1. Bot widens spreads automatically when rolling volatility exceeds the configured base spread, and uses configured spread as floor during warmup
  2. Bot shifts quotes proportionally toward reducing inventory based on position as fraction of max, and pauses the inventory-increasing side when skew exceeds 2x effective spread
  3. Continuous skew mode replaces binary close mode while preserving the hard position cap safety guarantee; disabling skew restores binary close behavior
  4. Current volatility and effective spread are visible in bot status output
  5. Mid-price uses volume-weighted calculation from Binance bookTicker bid/ask sizes
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — VWAP mid-price in BinancePriceFeed and VolatilityTracker module (TDD)
- [ ] 02-02-PLAN.md — InventorySkewCalculator pure function (TDD)
- [ ] 02-03-PLAN.md — Config, Quoter, PositionTracker refactor and MarketMaker integration

### Phase 3: Loss Protection
**Goal**: Bot tracks session PnL and halts automatically when losses exceed a configurable threshold
**Depends on**: Phase 2
**Requirements**: LOSS-01, LOSS-02, LOSS-03, LOSS-04, LOSS-05, LOSS-06
**Success Criteria** (what must be TRUE):
  1. Bot tracks realized PnL from fill events using average cost basis and computes unrealized PnL by marking position to fair price
  2. Bot cancels all orders and halts quoting when total PnL (realized + unrealized) drops below the configured loss threshold
  3. Circuit breaker halt produces a clear log alert with trigger reason, PnL breakdown, and position state
  4. Circuit breaker is resettable and PnL tracking is toggleable via config
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md — TDD PnlTracker: average cost basis and unrealized PnL with full test coverage
- [ ] 03-02-PLAN.md — Config, logger, and MarketMaker integration with circuit breaker

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Feed Safety | 2/2 | Complete   | 2026-03-09 |
| 2. Quote Intelligence | 3/3 | Complete   | 2026-03-09 |
| 3. Loss Protection | 0/2 | Not started | - |
