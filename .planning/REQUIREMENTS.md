# Requirements: Zo Market Maker — Risk Improvements

**Defined:** 2026-03-08
**Core Value:** The bot must never quote on stale or unreliable price data

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Feed Safety

- [x] **FEED-01**: Bot cancels all open orders within 1 update cycle when Binance WS has not sent a message in >2 seconds
- [x] **FEED-02**: Bot automatically resumes quoting when Binance feed recovers, only after receiving N fresh prices (not on first single message)
- [x] **FEED-03**: Bot uses a state machine (WARMING_UP | QUOTING | STALE | HALTED) to prevent TOCTOU races between stale detection and order placement
- [x] **FEED-04**: Bot computes volume-weighted mid-price from Binance bookTicker bid/ask sizes instead of simple arithmetic mid
- [x] **FEED-05**: Stale price protection is toggleable via config flag `stalePriceEnabled` (default: true)

### Spread Management

- [x] **SPRD-01**: Bot calculates rolling realized volatility from 1-minute log-returns over a configurable window (default 10 minutes)
- [x] **SPRD-02**: Effective spread = max(configuredSpreadBps, volatility * volatilityMultiplier) where default multiplier is 1.5
- [x] **SPRD-03**: Bot displays current volatility and effective spread in status output
- [x] **SPRD-04**: Volatility-aware spreads are toggleable via config flag `volatilityEnabled` (default: true)
- [x] **SPRD-05**: When volatility data is insufficient (warmup period), bot uses configured spread as floor

### Inventory Management

- [x] **INVT-01**: Bot shifts both bid and ask quotes proportionally to current position size, favoring inventory reduction
- [x] **INVT-02**: Skew is proportional to position as fraction of maxPositionUsd, not raw position USD value
- [x] **INVT-03**: Bot pauses the inventory-increasing side when skew exceeds 2x the effective spread
- [x] **INVT-04**: Continuous skew replaces binary close mode without losing the hard position cap safety guarantee
- [x] **INVT-05**: Inventory skew is toggleable via config flag `inventorySkewEnabled` (default: true); when disabled, existing binary close mode behavior is preserved

### Loss Protection

- [ ] **LOSS-01**: Bot tracks realized PnL from fill events using average cost basis
- [ ] **LOSS-02**: Bot computes unrealized PnL by marking current position to fair price
- [ ] **LOSS-03**: Bot cancels all orders and halts quoting when total PnL (realized + unrealized) drops below -maxDailyLossUsd (default $20)
- [ ] **LOSS-04**: Circuit breaker halt is logged with clear alert including trigger reason, current PnL, and position state
- [ ] **LOSS-05**: Circuit breaker is resettable via config flag
- [ ] **LOSS-06**: PnL tracking and circuit breaker are toggleable via config flag `pnlTrackingEnabled` (default: true)

### Config & Integration

- [x] **CONF-01**: All new config fields are added to MarketMakerConfig interface with sensible defaults; no existing fields are removed
- [x] **CONF-02**: Bot behavior is identical to current behavior when all new features are disabled
- [x] **CONF-03**: Each new module file has a comment block explaining what it does and why
- [x] **CONF-04**: No TypeScript `any` types in new code

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Feed Redundancy

- **FRED-01**: Bot connects to Coinbase WebSocket as optional second price feed
- **FRED-02**: Bot pauses and warns when Binance and Coinbase feeds diverge by >15bps (sustained, not single-sample)
- **FRED-03**: Coinbase feed failure never halts quoting — strictly optional cross-validation

### Enhanced Loss Protection

- **ELSS-01**: PnL state persists to disk for crash recovery
- **ELSS-02**: Circuit breaker reset requires mandatory cooldown period
- **ELSS-03**: Maximum number of circuit breaker resets per session (e.g., 3)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-feed consensus (median of 3+ feeds) | Anti-feature for single-pair bot; adds complexity and failure modes |
| Dynamic position sizing based on volatility | Conflates with spread management; multiplicative effects hard to calibrate |
| Automated parameter optimization | Creates feedback loops; requires backtesting infrastructure |
| Multiple order levels (laddered quotes) | 01 Exchange batch limit (4 ops) makes this impractical |
| Stop-loss orders | Circuit breaker achieves same goal more reliably than on-chain stops |
| Push notifications (Telegram/Discord) | Belongs in monitoring layer, not the bot itself |
| CLI interface changes | Explicitly excluded per project constraints |
| Docker setup changes | Explicitly excluded per project constraints |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FEED-01 | Phase 1 | Complete |
| FEED-02 | Phase 1 | Complete |
| FEED-03 | Phase 1 | Complete |
| FEED-04 | Phase 2 | Complete |
| FEED-05 | Phase 1 | Complete |
| SPRD-01 | Phase 2 | Complete |
| SPRD-02 | Phase 2 | Complete |
| SPRD-03 | Phase 2 | Complete |
| SPRD-04 | Phase 2 | Complete |
| SPRD-05 | Phase 2 | Complete |
| INVT-01 | Phase 2 | Complete |
| INVT-02 | Phase 2 | Complete |
| INVT-03 | Phase 2 | Complete |
| INVT-04 | Phase 2 | Complete |
| INVT-05 | Phase 2 | Complete |
| LOSS-01 | Phase 3 | Pending |
| LOSS-02 | Phase 3 | Pending |
| LOSS-03 | Phase 3 | Pending |
| LOSS-04 | Phase 3 | Pending |
| LOSS-05 | Phase 3 | Pending |
| LOSS-06 | Phase 3 | Pending |
| CONF-01 | Phase 1 | Complete |
| CONF-02 | Phase 1 | Complete |
| CONF-03 | Phase 1 | Complete |
| CONF-04 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-03-08*
*Last updated: 2026-03-08 after roadmap creation*
