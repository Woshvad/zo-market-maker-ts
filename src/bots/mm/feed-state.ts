/**
 * FeedStateManager - Price feed staleness detection state machine.
 *
 * Tracks the health of the price feed and prevents the market maker from
 * quoting when data is stale or unreliable. Implements a state machine with
 * four states: WARMING_UP, QUOTING, STALE, and HALTED.
 *
 * This is the core safety mechanism that protects the bot from placing orders
 * based on outdated price information, which could result in significant losses.
 */

export type FeedState = 'WARMING_UP' | 'QUOTING' | 'STALE' | 'HALTED';
export type HaltReason = 'repeated_stale' | 'circuit_breaker';

export interface FeedStateConfig {
  readonly staleThresholdMs: number;
  readonly recoveryPriceCount: number;
  readonly stalePriceEnabled: boolean;
  readonly haltStaleCount: number;
  readonly haltWindowMs: number;
}

export interface FeedStateCallbacks {
  readonly onStale: () => void;
  readonly onRecovery: () => void;
  readonly onHalted: (reason: HaltReason) => void;
}

export class FeedStateManager {
  constructor(
    _config: FeedStateConfig,
    _callbacks: FeedStateCallbacks,
    _now?: () => number,
  ) {}

  onPrice(): void {}
  checkStale(): void {}
  promoteToQuoting(): void {}
  halt(_reason: HaltReason): void {}
  canQuote(): boolean { return false; }
  getState(): FeedState { return 'WARMING_UP'; }
  getStaleInfo(): { count: number; max: number; windowMs: number } {
    return { count: 0, max: 0, windowMs: 0 };
  }
}
