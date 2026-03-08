# Technology Stack

**Analysis Date:** 2026-03-08

## Languages

**Primary:**
- TypeScript 5.7 - All source code in `src/`

**Secondary:**
- None (pure TypeScript project)

## Runtime

**Environment:**
- Node.js v25+ (required - enforced in `package.json` `engines` field)
- Minimum v25 required for `Uint8Array.prototype.toHex()` used by `@n1xyz/nord-ts` SDK

**Package Manager:**
- npm (no version constraint specified)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- None (plain Node.js application - no web framework)

**Testing:**
- Not detected - no test framework configured

**Build/Dev:**
- `tsc` (TypeScript compiler) - compile to `dist/` via `npm run build`
- `tsx` ^4.19.0 - direct TypeScript execution without compile step (`node --import tsx src/...`)

## Key Dependencies

**Critical:**
- `@n1xyz/nord-ts` ^0.3.5 - Official 01 Exchange (Zo Protocol) SDK. Provides `Nord`, `NordUser`, WebSocket subscriptions (`subscribeOrderbook`, `subscribeAccount`, `subscribeTrades`), and order operations (`atomic`, `FillMode`, `Side`). Entry point: `src/sdk/client.ts`
- `@solana/web3.js` ^1.98.0 - Solana blockchain connection (`Connection` class). Used to initialize SDK connection in `src/sdk/client.ts` and `src/cli/monitor.ts`
- `ws` ^8.18.0 - WebSocket client for Binance Futures price feed in `src/pricing/binance.ts`
- `decimal.js` - Arbitrary-precision decimal arithmetic for order price/size calculations in `src/sdk/orders.ts` and `src/types.ts`. Pulled in as transitive dependency of `@n1xyz/nord-ts`

**Infrastructure:**
- `dotenv` ^16.4.7 - Loads `.env` file for `PRIVATE_KEY`, `RPC_URL`, `LOG_LEVEL`. Initialized via `import "dotenv/config"` at CLI entry points `src/cli/bot.ts` and `src/cli/monitor.ts`
- `blessed` ^0.1.81 - Terminal UI (TUI) framework for the market monitor dashboard in `src/cli/monitor.ts`
- `bs58` ^6.0.0 - Base58 encoding/decoding (for Solana private key handling)
- `lodash-es` ^4.17.23 - ES module lodash utilities (imported but usage is minimal/indirect)

## Configuration

**Environment:**
- Configured via `.env` file (copy from `.env.example`)
- `PRIVATE_KEY` - Base58 Solana private key (required for bot, not monitor)
- `RPC_URL` - Solana RPC endpoint (optional, defaults to `https://api.mainnet-beta.solana.com`)
- `LOG_LEVEL` - Logging verbosity: `debug`, `info`, `warn`, `error` (optional, defaults to `info`)

**Build:**
- `tsconfig.json` - Target ES2022, module ES2022, `moduleResolution: Bundler`, strict mode, outputs to `dist/`
- `biome.json` - Biome v2.3.13 for linting + formatting (tabs, double quotes, recommended rules, auto import organization)

**Bot behavior:**
- `src/bots/mm/config.ts` - `DEFAULT_CONFIG` with spread, order size, position thresholds, timing intervals

## Platform Requirements

**Development:**
- Node.js v25+
- npm

**Production:**
- Docker via `Dockerfile` (multi-stage build on `node:25-slim`)
- `docker-compose.yml` - Single service `mm-btc` running ETH market by default, `restart: unless-stopped`, json-file logging with 3MB max size
- Deployed as long-running process; no web server or port exposure

---

*Stack analysis: 2026-03-08*
