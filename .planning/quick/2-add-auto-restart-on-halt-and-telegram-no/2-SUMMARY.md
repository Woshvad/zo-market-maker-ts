---
phase: quick
plan: 2
subsystem: operations
tags: [telegram, pm2, auto-restart, notifications]
key-files:
  created:
    - src/utils/telegram.ts
    - ecosystem.config.cjs
  modified:
    - src/bots/mm/index.ts
    - .env.example
    - package.json
decisions:
  - Telegram enablement derived from env vars (no config.ts changes needed)
  - pm2 exponential backoff starts at 5s with max 50 restarts
  - Removed 30s halted warning loop in favor of notify-then-exit pattern
metrics:
  duration: 207s
  completed: "2026-03-10"
  tasks: 2/2
  tests: 102 passing (unchanged)
---

# Quick Task 2: Add Auto-Restart on Halt and Telegram Notifications

Telegram notifications on halt/startup/shutdown with pm2 auto-restart via exponential backoff.

## One-liner

TelegramNotifier utility with env-based factory, wired into MarketMaker halt->notify->exit(1) flow, plus pm2 ecosystem config with exponential backoff restart.

## What Was Done

### Task 1: TelegramNotifier and MarketMaker wiring (782d80c)

- Created `src/utils/telegram.ts` with `TelegramNotifier` class (POST to Telegram Bot API with HTML parse mode) and `createTelegramNotifier` factory that reads `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` from env, returning null if missing
- Messages prefixed with `[marketSymbol]` for multi-bot identification
- Wired into `MarketMaker`:
  - `initialize()`: creates notifier after setting market symbol
  - `run()`: sends "Bot started" after registering shutdown handlers
  - `onHalted`: sends "HALTED: {reason}" after position close attempt, then `process.exit(1)`
  - `shutdown()`: sends "Bot shutting down (manual stop)" before `process.exit(0)`
- Removed the 30-second `haltedWarningInterval` loop (field + setup + cleanup)
- Updated `.env.example` with optional Telegram env vars

### Task 2: pm2 ecosystem config (6dd88da)

- Installed pm2 as dev dependency
- Created `ecosystem.config.cjs` with exponential backoff restart (5s base, min_uptime 10s, max 50 restarts)
- Added npm scripts: `start:pm2`, `stop:pm2`, `logs:pm2`

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- TypeScript compiles (`npx tsc --noEmit`) - PASS
- All 102 tests pass (`npm test`) - PASS
- No `haltedWarningInterval` remains in index.ts - PASS
- `process.exit(1)` present in onHalted callback - PASS
- Three `telegram?.sendMessage` calls in index.ts (startup, halt, shutdown) - PASS
- `ecosystem.config.cjs` is valid JS - PASS
- pm2 version 6.0.14 installed - PASS
