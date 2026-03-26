/**
 * DrawdownCooldown - Reduces order size after consecutive losing round-trips.
 *
 * A "cycle" is a position round-trip: flat → position → flat. If the realized
 * PnL delta over that cycle is negative, it counts as a losing cycle. After N
 * consecutive losing cycles (configurable), order size is reduced by a
 * configurable factor until a winning cycle occurs (recovery).
 *
 * Plugs into the existing PnlTracker — call onCycleComplete() each time the
 * position returns to flat, passing the realized PnL delta for that cycle.
 *
 * Pure class with no external dependencies.
 */

export interface DrawdownCooldownConfig {
  /** Consecutive losing cycles before reducing size (default 5) */
  readonly consecutiveLossLimit: number;
  /** Order size multiplier when in cooldown (default 0.5) */
  readonly cooldownSizeMultiplier: number;
}

export interface DrawdownCooldownState {
  readonly consecutiveLosses: number;
  readonly inCooldown: boolean;
  readonly sizeMultiplier: number;
  readonly totalCycles: number;
  readonly totalLosses: number;
}

export class DrawdownCooldown {
  private consecutiveLosses = 0;
  private totalCycles = 0;
  private totalLosses = 0;

  constructor(private readonly config: DrawdownCooldownConfig) {}

  /**
   * Call when a position round-trip completes (position returns to flat).
   * @param cyclePnl The realized PnL delta for this cycle (negative = loss)
   */
  onCycleComplete(cyclePnl: number): void {
    this.totalCycles++;

    if (cyclePnl < 0) {
      this.consecutiveLosses++;
      this.totalLosses++;
    } else {
      // Winning or break-even cycle resets the streak
      this.consecutiveLosses = 0;
    }
  }

  /** Whether we are in cooldown (consecutive losses >= limit). */
  isInCooldown(): boolean {
    return this.consecutiveLosses >= this.config.consecutiveLossLimit;
  }

  /** Returns the multiplier to apply to order size (1.0 when normal). */
  getSizeMultiplier(): number {
    return this.isInCooldown() ? this.config.cooldownSizeMultiplier : 1;
  }

  /** Full state snapshot for logging/monitoring. */
  getState(): DrawdownCooldownState {
    const inCooldown = this.isInCooldown();
    return {
      consecutiveLosses: this.consecutiveLosses,
      inCooldown,
      sizeMultiplier: inCooldown ? this.config.cooldownSizeMultiplier : 1,
      totalCycles: this.totalCycles,
      totalLosses: this.totalLosses,
    };
  }
}
