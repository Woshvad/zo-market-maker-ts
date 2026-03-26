// MarketMaker configuration

export interface MarketMakerConfig {
  readonly symbol: string // e.g., "BTC" or "ETH"
  readonly spreadBps: number // Spread from fair price (bps)
  readonly takeProfitBps: number // Spread in close mode (bps)
  readonly orderSizeUsd: number // Order size in USD
  readonly closeThresholdUsd: number // Trigger close mode when position >= this
  readonly warmupSeconds: number // Seconds to warm up before quoting
  readonly updateThrottleMs: number // Min interval between quote updates
  readonly orderSyncIntervalMs: number // Interval for syncing orders from API
  readonly statusIntervalMs: number // Interval for status display
  readonly fairPriceWindowMs: number // Window for fair price calculation
  readonly positionSyncIntervalMs: number // Interval for position sync
  readonly staleThresholdMs: number // Max ms without Binance message before STALE
  readonly recoveryPriceCount: number // Consecutive prices needed for STALE -> QUOTING
  readonly stalePriceEnabled: boolean // Enable/disable stale price protection
  readonly haltStaleCount: number // Stale events before HALTED
  readonly haltWindowMs: number // Sliding window for counting stale events (ms)
  readonly volatilityEnabled: boolean // Enable volatility-based spread widening
  readonly volatilityWindowMs: number // Rolling window for volatility calc
  readonly volatilitySampleIntervalMs: number // Min interval between vol samples
  readonly volatilityMultiplier: number // Multiplier for vol -> spread
  readonly inventorySkewEnabled: boolean // Enable inventory skew
  readonly maxPositionUsd: number // Max position for skew scaling
  readonly pnlTrackingEnabled: boolean // Enable PnL tracking and circuit breaker
  readonly maxDailyLossUsd: number // Loss threshold (positive number, e.g., 20)
  readonly stopLossUsd: number // Per-position stop-loss in USD (force close if unrealized loss exceeds this)
  readonly positionTimeoutMs: number // Max time a position can be open before forced close (ms)

  // Adverse selection detection
  readonly adverseSelectionEnabled: boolean // Enable fill imbalance detection
  readonly adverseSelectionWindowSize: number // Rolling fill window size (default 30)
  readonly adverseSelectionThreshold: number // Imbalance ratio to trigger widening (default 0.65)
  readonly adverseSelectionMultiplier: number // Spread multiplier when imbalanced (default 1.5)

  // Drawdown cooldown
  readonly drawdownCooldownEnabled: boolean // Enable order size reduction after losses
  readonly drawdownConsecutiveLossLimit: number // Losing cycles before cooldown (default 5)
  readonly drawdownCooldownSizeMultiplier: number // Order size multiplier in cooldown (default 0.5)
}

// Default configuration values (symbol must be provided)
export const DEFAULT_CONFIG: Omit<MarketMakerConfig, 'symbol'> = {
  spreadBps: 8,
  takeProfitBps: 0.1,
  orderSizeUsd: 3000,
  closeThresholdUsd: 10,
  warmupSeconds: 10,
  updateThrottleMs: 100,
  orderSyncIntervalMs: 3000,
  statusIntervalMs: 1000,
  fairPriceWindowMs: 5 * 60 * 1000, // 5 minutes
  positionSyncIntervalMs: 5000,
  staleThresholdMs: 2000,
  recoveryPriceCount: 5,
  stalePriceEnabled: true,
  haltStaleCount: 5,
  haltWindowMs: 600_000,
  volatilityEnabled: true,
  volatilityWindowMs: 600_000,
  volatilitySampleIntervalMs: 60_000,
  volatilityMultiplier: 1.5,
  inventorySkewEnabled: true,
  maxPositionUsd: 10,
  pnlTrackingEnabled: true,
  maxDailyLossUsd: 15,
  stopLossUsd: 1,
  positionTimeoutMs: 60_000,

  // Adverse selection detection
  adverseSelectionEnabled: true,
  adverseSelectionWindowSize: 30,
  adverseSelectionThreshold: 0.65,
  adverseSelectionMultiplier: 1.5,

  // Drawdown cooldown
  drawdownCooldownEnabled: true,
  drawdownConsecutiveLossLimit: 5,
  drawdownCooldownSizeMultiplier: 0.5,
}
