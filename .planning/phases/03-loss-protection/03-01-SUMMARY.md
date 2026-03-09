---
phase: 03-loss-protection
plan: 01
subsystem: trading
tags: [pnl, cost-basis, mark-to-market, tdd]

requires:
  - phase: 02-quote-intelligence
    provides: "PositionTracker applyFill signature pattern"
provides:
  - "PnlTracker class with average cost basis and unrealized PnL"
  - "PnlSnapshot interface for session PnL reporting"
affects: [03-02, loss-circuit-breaker, session-reporting]

tech-stack:
  added: []
  patterns: [average-cost-basis, position-flip-split]

key-files:
  created:
    - src/bots/mm/pnl-tracker.ts
    - src/bots/mm/pnl-tracker.test.ts
  modified: []

key-decisions:
  - "Average cost basis (not FIFO/LIFO) for simplicity and market-maker suitability"
  - "Position flip splits fill into close-portion and open-portion at fill price"
  - "Pure numbers (no Decimal.js) matching existing PositionTracker pattern"

patterns-established:
  - "Position flip handling: close old at avg cost, open remainder at fill price"
  - "Unrealized PnL formula uses signed position for longs, abs for shorts"

requirements-completed: [LOSS-01, LOSS-02]

duration: 2min
completed: 2026-03-09
---

# Phase 3 Plan 1: PnlTracker Summary

**Average cost basis PnL tracker with fill-level realized/unrealized accounting and position flip handling**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-09T01:30:42Z
- **Completed:** 2026-03-09T01:32:31Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- TDD implementation of PnlTracker covering all position lifecycle states
- 26 tests covering open, increase, reduce, close, flip, unrealized, snapshot, and -0 normalization
- Full test suite (100 tests across 7 files) passing clean

## Task Commits

Each task was committed atomically:

1. **RED: Failing tests for PnlTracker** - `731282d` (test)
2. **GREEN: PnlTracker implementation** - `e182ed8` (feat)

_TDD plan: RED wrote 26 failing tests, GREEN made all pass. No refactor needed._

## Files Created/Modified
- `src/bots/mm/pnl-tracker.ts` - PnlTracker class with applyFill, unrealized/realized/total PnL, and snapshot API (130 lines)
- `src/bots/mm/pnl-tracker.test.ts` - Full test suite with 26 tests covering all edge cases (257 lines)

## Decisions Made
- Average cost basis method chosen over FIFO/LIFO for market-maker simplicity
- Position flip handled by splitting fill into close and open portions (research Pitfall 1)
- Plain numbers match PositionTracker pattern; -0 normalized with `|| 0`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PnlTracker ready for integration into loss circuit breaker (03-02)
- applyFill signature matches PositionTracker for consistent fill handling
- PnlSnapshot provides all fields needed for session reporting and drawdown checks

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 03-loss-protection*
*Completed: 2026-03-09*
