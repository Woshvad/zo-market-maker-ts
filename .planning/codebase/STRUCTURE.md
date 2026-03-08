# Directory Structure

**Analysis Date:** 2026-03-08

## Top-Level Layout

```
zo-market-maker-ts/
├── src/                    # All source code
│   ├── bots/mm/            # Market maker strategy
│   ├── cli/                # Entry points (bot, monitor)
│   ├── pricing/            # Fair price calculation
│   ├── sdk/                # 01 Exchange SDK wrappers
│   ├── utils/              # Shared utilities
│   └── types.ts            # Shared type definitions
├── docs/                   # GIFs/images for README
├── .env.example            # Environment variable template
├── biome.json              # Linter/formatter config
├── docker-compose.yml      # Docker deployment
├── Dockerfile              # Container definition
├── package.json            # npm scripts and dependencies
└── tsconfig.json           # TypeScript config
```

## Source Tree Detail

```
src/
├── types.ts                       # Shared: MidPrice, Quote, PriceCallback
├── bots/
│   └── mm/
│       ├── index.ts               # MarketMaker class (main orchestrator)
│       ├── config.ts              # MarketMakerConfig interface + DEFAULT_CONFIG
│       ├── position.ts            # PositionTracker, QuotingContext, PositionState
│       └── quoter.ts              # Quoter: computes bid/ask quotes
├── cli/
│   ├── bot.ts                     # Entry: loads env, runs MarketMaker
│   └── monitor.ts                 # Entry: read-only TUI dashboard (blessed)
├── pricing/
│   ├── binance.ts                 # BinancePriceFeed WebSocket client
│   └── fair-price.ts              # FairPriceCalculator + FairPriceProvider interface
├── sdk/
│   ├── client.ts                  # createZoClient factory, ZoClient interface
│   ├── account.ts                 # AccountStream WebSocket wrapper + fill callbacks
│   ├── orderbook.ts               # ZoOrderbookStream (snapshot+delta merge)
│   └── orders.ts                  # updateQuotes, cancelOrders, CachedOrder
└── utils/
    └── logger.ts                  # Singleton log object, pluggable output
```

## Key File Locations

| What | Where |
|------|-------|
| Main bot entry | `src/cli/bot.ts` |
| Monitor entry | `src/cli/monitor.ts` |
| Strategy logic | `src/bots/mm/index.ts` |
| Config schema | `src/bots/mm/config.ts` |
| Position tracking | `src/bots/mm/position.ts` |
| Quote calculation | `src/bots/mm/quoter.ts` |
| Shared types | `src/types.ts` |
| Fair price algo | `src/pricing/fair-price.ts` |
| Binance WS feed | `src/pricing/binance.ts` |
| 01 Exchange client | `src/sdk/client.ts` |
| Order operations | `src/sdk/orders.ts` |
| Orderbook stream | `src/sdk/orderbook.ts` |
| Account stream | `src/sdk/account.ts` |
| Logger | `src/utils/logger.ts` |

## Naming Conventions

**Files:** kebab-case for multi-word (`fair-price.ts`), single-word lowercase (`client.ts`, `quoter.ts`).

**Directories:** lowercase, singular for grouping (`bots/mm/`, `pricing/`, `sdk/`, `utils/`).

**No barrel files** — consumers import directly from source files.

## Where to Add New Code

| New feature type | Location |
|-----------------|----------|
| New strategy / bot | `src/bots/<name>/` |
| New pricing source | `src/pricing/<source>.ts` |
| New SDK wrapper | `src/sdk/<feature>.ts` |
| Shared types | `src/types.ts` |
| New CLI command | `src/cli/<command>.ts` |
| Shared utility | `src/utils/<util>.ts` |

## Configuration

**Environment variables** (see `.env.example`):
- `PRIVATE_KEY` — Solana private key (required for bot)
- `LOG_LEVEL` — debug/info/warn/error (default: `info`)

**Runtime config** via CLI args: `npm run bot -- ETH`

**Strategy config** hardcoded in `DEFAULT_CONFIG` in `src/bots/mm/config.ts`.

## npm Scripts

```json
"bot"     → tsx src/cli/bot.ts
"monitor" → tsx src/cli/monitor.ts
"lint"    → biome check
"format"  → biome format --write
"build"   → tsc (outputs to dist/)
```

---

*Structure analysis: 2026-03-08*
