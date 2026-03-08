# Concerns

**Analysis Date:** 2026-03-08

## Tech Debt

### Hardcoded Mainnet Endpoints (Duplicated)
- **Files:** `src/sdk/client.ts:5-8`, `src/cli/monitor.ts` (duplicated `MAINNET_CONFIG`)
- **Issue:** No environment-level config; switching RPC or endpoints requires editing two files
- **Risk:** Medium — operational friction, likely drift between the two copies

### `baseSize` Stored as `number` Instead of `Decimal`
- **File:** `src/bots/mm/position.ts`
- **Issue:** Fill quantities from the SDK should be `Decimal` to avoid float arithmetic drift; stored as `number` and converted only when needed
- **Risk:** Medium — cumulative float error on many fills could misrepresent position size

### `docker-compose.yml` Service Named `mm-btc` but Runs ETH
- **File:** `docker-compose.yml`
- **Issue:** Service name implies BTC, but the default command passes `ETH`; README also references this inconsistency
- **Risk:** Low — cosmetic/documentation issue, confusing for operators

### `config.ts` Indentation Inconsistency
- **File:** `src/bots/mm/config.ts`
- **Issue:** Uses 2-space indentation while the rest of the codebase uses Biome-enforced tabs
- **Risk:** Low — Biome `format --write` will fix it

## Known Bugs / Fragile Patterns

### Silent Parse Error Swallowing in BinancePriceFeed
- **File:** `src/pricing/binance.ts`
- **Issue:** `JSON.parse` errors in the WebSocket message handler are caught and silently ignored; malformed messages cause no visible feedback
- **Risk:** Medium — a format change in Binance API would be invisible until price feed goes stale

### `extractPlacedOrders` Positional Index Matching
- **File:** `src/sdk/orders.ts`
- **Issue:** Matches returned order IDs by array index against originally requested quotes; breaks on partial atomic failures where not all placements succeed
- **Risk:** High — on partial failure, active order cache gets corrupted, potentially leading to duplicate orders on next update

### `void this.reconnect()` Discards Reconnect Errors
- **Files:** `src/sdk/orderbook.ts`, `src/sdk/account.ts`
- **Issue:** Reconnect is fired-and-forgotten with `void`; any error inside `reconnect()` is silently lost
- **Risk:** Medium — if reconnect itself throws, the stream silently stops without any log output

### `cancelOrdersAsync` Clears `activeOrders` Even on Failure
- **File:** `src/bots/mm/index.ts`
- **Issue:** On fill-triggered emergency cancellation, `activeOrders = []` is set optimistically in the `.then()` branch but the `.catch()` branch does not restore them; if cancellation fails, the bot thinks it has no active orders and will try to place duplicates on next update
- **Risk:** High — could cause runaway duplicate orders during adverse market conditions

### `FairPriceCalculator` Iterates Circular Buffer Out of Insertion Order
- **File:** `src/pricing/fair-price.ts`
- **Issue:** The circular buffer's valid-sample extraction doesn't account for ring wrap-around; oldest samples may appear at the end of the array
- **Risk:** Low — affects `getValidSamples` result ordering, but since the result is sorted for median calculation, the final value is still correct

### `AtomicResult` Typed Against SDK Internals
- **File:** `src/sdk/orders.ts`
- **Issue:** `AtomicResult` is manually typed to mirror undocumented SDK internals; could break on SDK updates without TypeScript catching it
- **Risk:** Medium — silent breakage on `@n1xyz/nord-ts` version bumps

## Security

### Private Key Passed as Plain String, No Validation
- **File:** `src/sdk/client.ts:29`
- **Issue:** `PRIVATE_KEY` is read from env and passed directly to SDK; no format validation, no protection against logging. Full public key is logged at startup (`log.info(\`Wallet: ${pubkey}\`)`)
- **Risk:** Medium — key logged in plaintext in any log aggregation system; no validation means silent failure on malformed keys

### No Input Sanitization on Symbol Argument
- **File:** `src/cli/bot.ts`
- **Issue:** CLI symbol argument is passed directly to SDK market resolution; invalid symbols throw at runtime with no user-friendly error
- **Risk:** Low — internal tool, not a public API

## Performance

### `getValidSamples()` Allocates and Sorts on Every Price Tick
- **File:** `src/pricing/fair-price.ts`
- **Issue:** Called on every Binance tick (potentially many per second); creates a new filtered array and sorts it each time
- **Risk:** Low — small arrays (few hundred samples max), GC pressure minor

### `Array.shift()` O(n) Loop in Monitor
- **File:** `src/cli/monitor.ts`
- **Issue:** Recent trades list uses `array.push() + array.shift()` pattern for a fixed-size queue — O(n) per update
- **Risk:** Low — bounded list, not hot path

### `getLevels()` Copies Entire Map on Every Delta
- **File:** `src/sdk/orderbook.ts`
- **Issue:** Returns a new sorted array copy of all orderbook levels on every delta application; called frequently
- **Risk:** Low — bounded at 100 levels, but worth noting for high-frequency environments

## Missing Features / Safety Gaps

| Gap | Impact |
|-----|--------|
| Zero test coverage | No regression protection; bugs found only in production |
| No circuit breaker on reconnects | Infinite reconnect loops possible; no backoff cap |
| No exposure/loss limits | No max position size enforcement; no daily loss cut-off |
| No Docker healthcheck | Container reports healthy even when bot is hung/stale |
| No rate limit handling | Binance/01 API rate limit errors are logged but not backed off |
| No alerting/monitoring | No external metrics, no PagerDuty/Telegram alert on errors |
| `FairPriceProvider` interface unused | Only one implementation; abstraction not exercised by tests or alternative implementations |

---

*Concerns analysis: 2026-03-08*
