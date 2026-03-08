# External Integrations

**Analysis Date:** 2026-03-08

## APIs & External Services

**01 Exchange (Zo Protocol) - Primary Exchange:**
- Service: 01 Exchange perpetual futures exchange
- SDK/Client: `@n1xyz/nord-ts` package
- Implementation: `src/sdk/client.ts` (connection init), `src/sdk/orderbook.ts` (orderbook stream), `src/sdk/account.ts` (account stream), `src/sdk/orders.ts` (order placement/cancellation)
- Web server URL: `https://zo-mainnet.n1.xyz` (hardcoded in `src/sdk/client.ts` and `src/cli/monitor.ts`)
- App ID: `zoau54n5U24GHNKqyoziVaVxgsiQYnPMx33fKmLLCT5` (hardcoded)
- Auth: Solana private key via `PRIVATE_KEY` env var (Base58 format)
- Capabilities used:
  - REST: `nord.getOrderbook()` for snapshot, `user.fetchInfo()` for account state
  - WebSocket: `nord.subscribeOrderbook()`, `nord.subscribeAccount()`, `nord.subscribeTrades()`
  - Order ops: `user.atomic()` with `place` and `cancel` subactions; PostOnly fill mode only

**Binance Futures - Reference Price Feed:**
- Service: Binance USD-M Futures WebSocket (public, no auth required)
- Implementation: `src/pricing/binance.ts`
- WebSocket URL: `wss://fstream.binance.com/ws/{symbol}@bookTicker`
- Data consumed: Best bid (`b`) and best ask (`a`) from book ticker stream
- No API key required - public market data feed only
- Reconnection: 3s delay, ping/pong heartbeat every 30s, stale detection after 60s

## Data Storage

**Databases:**
- None - stateless application with no persistent storage

**File Storage:**
- Local filesystem only - no cloud storage

**Caching:**
- In-memory only:
  - `src/pricing/binance.ts` - `latestPrice: MidPrice | null`
  - `src/sdk/orderbook.ts` - Local orderbook state (bids/asks Maps), buffered deltas
  - `src/sdk/account.ts` - `orders: Map<string, TrackedOrder>`
  - `src/sdk/orders.ts` - `CachedOrder[]` (active quote orders)
  - `src/pricing/fair-price.ts` - Rolling window samples for fair price calculation

## Authentication & Identity

**Auth Provider:**
- Solana wallet (self-custody)
- Implementation: Solana private key (Base58) passed via `PRIVATE_KEY` env var
- SDK converts key internally: `NordUser.fromPrivateKey(nord, privateKey)` in `src/sdk/client.ts`
- Session management: `user.refreshSession()` called on startup; account ID retrieved via `user.updateAccountId()`
- No OAuth, no third-party auth provider

## Monitoring & Observability

**Error Tracking:**
- None - no external error tracking service (Sentry, etc.)

**Logs:**
- Custom logger in `src/utils/logger.ts`
- Outputs to `console.log` / `console.error` by default
- In monitor TUI mode: output redirected to `blessed` log panel via `log.setOutput()`
- Docker: json-file driver, max 3MB per file, max 3 files (configured in `docker-compose.yml`)
- Log levels: `debug`, `info`, `warn`, `error` (controlled by `LOG_LEVEL` env var)
- Structured log categories: `QUOTE`, `POS`, `FILL`, `ATOMIC`, `CONFIG`

## CI/CD & Deployment

**Hosting:**
- Docker container (self-hosted)
- `Dockerfile` - multi-stage build: builder stage compiles TypeScript, runtime stage uses compiled `dist/`
- Entry point: `node dist/cli/bot.js` with market symbol as CLI argument (e.g., `ETH`, `BTC`)

**CI Pipeline:**
- None detected - no GitHub Actions, no CI config files

## Environment Configuration

**Required env vars:**
- `PRIVATE_KEY` - Base58 Solana private key (bot only; monitor does not require it)

**Optional env vars:**
- `RPC_URL` - Solana RPC endpoint; defaults to `https://api.mainnet-beta.solana.com`
- `LOG_LEVEL` - One of `debug`, `info`, `warn`, `error`; defaults to `info`

**Secrets location:**
- `.env` file at project root (gitignored)
- Template provided at `.env.example`
- In Docker: passed via `env_file: .env` in `docker-compose.yml`

## Webhooks & Callbacks

**Incoming:**
- None - no HTTP server, no incoming webhooks

**Outgoing:**
- None - all communication is outbound WebSocket connections and REST calls initiated by the bot

## Network Connections Summary

| Destination | Protocol | Purpose | Auth |
|-------------|----------|---------|------|
| `wss://fstream.binance.com` | WebSocket | Binance book ticker price feed | None (public) |
| `https://zo-mainnet.n1.xyz` | HTTPS + WSS | 01 Exchange REST + WebSocket API | Solana private key |
| Solana RPC (configurable) | HTTPS | Blockchain connection for SDK | None (public RPC) |

---

*Integration audit: 2026-03-08*
