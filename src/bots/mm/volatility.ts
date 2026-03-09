/**
 * VolatilityTracker - Rolling realized volatility from mid-price samples.
 *
 * Computes the population standard deviation of log-returns over a configurable
 * rolling window. Used to dynamically widen spreads during volatile periods.
 *
 * Key behaviors:
 * - Samples mid-price at sampleIntervalMs intervals (ignores more frequent calls)
 * - Returns null during warmup (< 2 samples)
 * - Drops samples outside windowMs on each volatility query
 * - getEffectiveSpreadBps returns max(configured, vol * multiplier)
 */

export interface VolatilityConfig {
  readonly windowMs: number;           // 600_000 (10 min default)
  readonly sampleIntervalMs: number;   // 60_000 (1 min default)
  readonly volatilityMultiplier: number; // 1.5 default
}

interface PriceSample {
  price: number;
  time: number;
}

export class VolatilityTracker {
  private samples: PriceSample[] = [];
  private lastSampleTime = -Infinity;
  private readonly config: VolatilityConfig;
  private readonly now: () => number;

  constructor(config: VolatilityConfig, now?: () => number) {
    this.config = config;
    this.now = now ?? Date.now;
  }

  /**
   * Record a mid-price observation. Only captures a snapshot if at least
   * sampleIntervalMs has elapsed since the last snapshot.
   * Guards against mid <= 0 (would produce NaN log-returns).
   */
  onPrice(mid: number): void {
    if (mid <= 0) return;

    const t = this.now();
    if (t - this.lastSampleTime < this.config.sampleIntervalMs) return;

    this.samples.push({ price: mid, time: t });
    this.lastSampleTime = t;
  }

  /**
   * Compute rolling realized volatility as population stddev of log-returns, in bps.
   * Returns null if fewer than 2 samples remain after pruning the window.
   */
  getVolatilityBps(): number | null {
    const windowStart = this.now() - this.config.windowMs;
    const inWindow = this.samples.filter((s) => s.time >= windowStart);
    // Replace with pruned set
    this.samples = inWindow;

    if (inWindow.length < 2) return null;

    // Compute log-returns between consecutive samples
    const logReturns: number[] = [];
    for (let i = 1; i < inWindow.length; i++) {
      const prev = inWindow[i - 1].price;
      const curr = inWindow[i].price;
      if (prev <= 0 || curr <= 0) continue;
      logReturns.push(Math.log(curr / prev));
    }

    if (logReturns.length === 0) return null;

    // Population stddev
    const n = logReturns.length;
    const mean = logReturns.reduce((sum, r) => sum + r, 0) / n;
    const variance =
      logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);

    return stddev * 10_000; // convert to bps
  }

  /**
   * Returns the effective spread in bps: max(configuredSpreadBps, vol * multiplier).
   * During warmup (vol is null), returns configuredSpreadBps per SPRD-05.
   */
  getEffectiveSpreadBps(configuredSpreadBps: number): number {
    const vol = this.getVolatilityBps();
    if (vol === null) return configuredSpreadBps;
    return Math.max(configuredSpreadBps, vol * this.config.volatilityMultiplier);
  }
}
