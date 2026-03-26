/**
 * FeedStateManager - Price feed staleness detection state machine.
 *
 * Tracks the health of the price feed and prevents the market maker from
 * quoting when data is stale or unreliable. Implements a state machine with
 * four states: WARMING_UP, QUOTING, STALE, and HALTED.
 *
 * State transitions:
 *   WARMING_UP -> QUOTING  (via promoteToQuoting after warmup period)
 *   WARMING_UP -> STALE    (if feed dies during warmup after first price)
 *   QUOTING    -> STALE    (when no price received for > staleThresholdMs)
 *   STALE      -> QUOTING  (after recoveryPriceCount consecutive fresh prices)
 *   STALE      -> HALTED   (after haltStaleCount stale events within haltWindowMs)
 *   any        -> HALTED   (via external halt() call)
 *   HALTED is terminal -- no transitions out.
 *
 * This is the core safety mechanism that protects the bot from placing orders
 * based on outdated price information, which could result in significant losses.
 */

export type FeedState = 'WARMING_UP' | 'QUOTING' | 'STALE' | 'HALTED';
export type HaltReason = 'repeated_stale' | 'circuit_breaker' | 'force_close_failed' | 'order_divergence';

export interface FeedStateConfig {
  readonly staleThresholdMs: number;
  readonly recoveryPriceCount: number;
  readonly stalePriceEnabled: boolean;
  readonly haltStaleCount: number;
  readonly haltWindowMs: number;
  readonly divergenceHaltCount: number;
  readonly divergenceHaltWindowMs: number;
}

export interface FeedStateCallbacks {
  readonly onStale: () => void;
  readonly onRecovery: () => void;
  readonly onHalted: (reason: HaltReason) => void;
  readonly onDivergenceWarning?: () => void;
}

/** Grace period (ms) after entering QUOTING before divergence can trigger halt */
const DIVERGENCE_GRACE_PERIOD_MS = 30_000;

export class FeedStateManager {
  private state: FeedState = 'WARMING_UP';
  private lastPriceTime = 0;
  private recoveryCount = 0;
  private staleEvents: number[] = [];
  private divergenceEvents: number[] = [];
  private quotingStartTime = 0;
  private readonly config: FeedStateConfig;
  private readonly callbacks: FeedStateCallbacks;
  private readonly now: () => number;

  constructor(
    config: FeedStateConfig,
    callbacks: FeedStateCallbacks,
    now?: () => number,
  ) {
    this.config = config;
    this.callbacks = callbacks;
    this.now = now ?? Date.now;
  }

  onPrice(): void {
    this.lastPriceTime = this.now();

    if (this.state === 'HALTED') return;

    if (this.state === 'STALE') {
      this.recoveryCount++;
      if (this.recoveryCount >= this.config.recoveryPriceCount) {
        this.recoveryCount = 0;
        this.state = 'QUOTING';
        this.quotingStartTime = this.now();
        this.callbacks.onRecovery();
      }
    }
  }

  checkStale(): void {
    if (!this.config.stalePriceEnabled) return;
    if (this.state === 'HALTED') return;
    if (this.lastPriceTime === 0) return;

    const elapsed = this.now() - this.lastPriceTime;
    if (elapsed <= this.config.staleThresholdMs) return;

    // Price is stale -- reset recovery counter
    this.recoveryCount = 0;

    // Record stale event
    this.staleEvents.push(this.now());

    // Check if we should halt (filter to window)
    const windowStart = this.now() - this.config.haltWindowMs;
    const eventsInWindow = this.staleEvents.filter((t) => t > windowStart);
    this.staleEvents = eventsInWindow;

    if (eventsInWindow.length >= this.config.haltStaleCount) {
      this.state = 'HALTED';
      this.callbacks.onHalted('repeated_stale');
      return;
    }

    // Transition to STALE
    if (this.state !== 'STALE') {
      this.state = 'STALE';
      this.callbacks.onStale();
    }
  }

  promoteToQuoting(): void {
    if (this.state === 'WARMING_UP') {
      this.state = 'QUOTING';
      this.quotingStartTime = this.now();
    }
  }

  /** Record an order divergence event. During grace period, only warns. */
  onDivergence(): void {
    if (this.state === 'HALTED') return;

    // Grace period: warn-only during first 30s of QUOTING
    const elapsed = this.now() - this.quotingStartTime;
    if (this.quotingStartTime > 0 && elapsed < DIVERGENCE_GRACE_PERIOD_MS) {
      this.callbacks.onDivergenceWarning?.();
      return;
    }

    this.divergenceEvents.push(this.now());

    // Sliding window check
    const windowStart = this.now() - this.config.divergenceHaltWindowMs;
    const eventsInWindow = this.divergenceEvents.filter((t) => t > windowStart);
    this.divergenceEvents = eventsInWindow;

    if (eventsInWindow.length >= this.config.divergenceHaltCount) {
      this.state = 'HALTED';
      this.callbacks.onHalted('order_divergence');
    }
  }

  getDivergenceInfo(): { count: number; max: number; windowMs: number } {
    const windowStart = this.now() - this.config.divergenceHaltWindowMs;
    const eventsInWindow = this.divergenceEvents.filter((t) => t > windowStart);
    return {
      count: eventsInWindow.length,
      max: this.config.divergenceHaltCount,
      windowMs: this.config.divergenceHaltWindowMs,
    };
  }

  halt(reason: HaltReason): void {
    if (this.state === 'HALTED') return;
    this.state = 'HALTED';
    this.callbacks.onHalted(reason);
  }

  canQuote(): boolean {
    return this.state === 'QUOTING';
  }

  getState(): FeedState {
    return this.state;
  }

  getStaleInfo(): { count: number; max: number; windowMs: number } {
    const windowStart = this.now() - this.config.haltWindowMs;
    const eventsInWindow = this.staleEvents.filter((t) => t > windowStart);
    return {
      count: eventsInWindow.length,
      max: this.config.haltStaleCount,
      windowMs: this.config.haltWindowMs,
    };
  }
}
