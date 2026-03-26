/**
 * AdverseSelectionTracker - Detects fill imbalance over a rolling window.
 *
 * Tracks bid vs ask fills in a circular buffer. When one side consistently
 * dominates (exceeds the imbalance threshold), it signals the bot to widen
 * spreads by a configurable multiplier to reduce toxic flow exposure.
 *
 * Pure class with injectable clock for deterministic testing.
 */

export interface AdverseSelectionConfig {
  /** Number of fills in the rolling window (default 30) */
  readonly windowSize: number;
  /** Fraction of fills on one side to trigger widening (default 0.65) */
  readonly imbalanceThreshold: number;
  /** Spread multiplier when imbalance is detected (default 1.5) */
  readonly spreadMultiplier: number;
}

export interface AdverseSelectionState {
  readonly bidFills: number;
  readonly askFills: number;
  readonly totalFills: number;
  readonly bidRatio: number;
  readonly askRatio: number;
  readonly isImbalanced: boolean;
  readonly dominantSide: "bid" | "ask" | null;
  readonly spreadMultiplier: number;
}

export class AdverseSelectionTracker {
  private readonly fills: Array<"bid" | "ask"> = [];
  private head = 0;
  private count = 0;

  constructor(private readonly config: AdverseSelectionConfig) {
    this.fills = new Array(config.windowSize);
  }

  /** Record a fill. */
  recordFill(side: "bid" | "ask"): void {
    this.fills[this.head] = side;
    this.head = (this.head + 1) % this.config.windowSize;
    if (this.count < this.config.windowSize) {
      this.count++;
    }
  }

  /** Get current fill imbalance state. */
  getState(): AdverseSelectionState {
    if (this.count === 0) {
      return {
        bidFills: 0,
        askFills: 0,
        totalFills: 0,
        bidRatio: 0,
        askRatio: 0,
        isImbalanced: false,
        dominantSide: null,
        spreadMultiplier: 1,
      };
    }

    let bidFills = 0;
    let askFills = 0;

    // Read the last `count` entries from the circular buffer
    const start =
      this.count < this.config.windowSize
        ? 0
        : this.head; // head points to oldest when full
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.config.windowSize;
      if (this.fills[idx] === "bid") {
        bidFills++;
      } else {
        askFills++;
      }
    }

    const bidRatio = bidFills / this.count;
    const askRatio = askFills / this.count;
    const isImbalanced =
      bidRatio >= this.config.imbalanceThreshold ||
      askRatio >= this.config.imbalanceThreshold;
    const dominantSide = isImbalanced
      ? bidRatio >= this.config.imbalanceThreshold
        ? "bid"
        : "ask"
      : null;

    return {
      bidFills,
      askFills,
      totalFills: this.count,
      bidRatio,
      askRatio,
      isImbalanced,
      dominantSide,
      spreadMultiplier: isImbalanced ? this.config.spreadMultiplier : 1,
    };
  }

  /** Returns the multiplier to apply to spread (1.0 when balanced). */
  getSpreadMultiplier(): number {
    return this.getState().spreadMultiplier;
  }
}
