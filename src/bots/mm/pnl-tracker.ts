/**
 * PnlTracker - Session PnL accounting with average cost basis.
 *
 * Tracks realized and unrealized PnL from fills using average cost basis
 * methodology. Handles all position transitions: open, increase, reduce,
 * close, and flip (long-to-short or short-to-long in a single fill).
 *
 * Realized PnL accumulates when reducing or closing a position. Unrealized
 * PnL marks the remaining position to a given current price. Pure class
 * with no external dependencies -- suitable for deterministic testing.
 */

export interface PnlSnapshot {
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly totalPnl: number;
  readonly positionSize: number;
  readonly avgCostPrice: number;
}

export class PnlTracker {
  private positionSize = 0;
  private avgCostPrice = 0;
  private realizedPnl = 0;

  /**
   * Apply a fill to update position and realized PnL.
   *
   * A 'bid' fill increases position (buying), an 'ask' fill decreases
   * position (selling). When a fill crosses zero (flip), the closing
   * portion is realized at avg cost and the remainder opens at fill price.
   */
  applyFill(side: 'bid' | 'ask', size: number, price: number): void {
    const signedSize = side === 'bid' ? size : -size;
    const newPosition = this.positionSize + signedSize;

    // Check if this fill crosses zero (position flip)
    const sameSide =
      this.positionSize === 0 ||
      (this.positionSize > 0 && signedSize > 0) ||
      (this.positionSize < 0 && signedSize < 0);

    if (sameSide) {
      // Increasing or opening: weighted average cost
      const totalCost =
        Math.abs(this.positionSize) * this.avgCostPrice +
        Math.abs(signedSize) * price;
      const totalSize = Math.abs(this.positionSize) + Math.abs(signedSize);
      this.avgCostPrice = totalCost / totalSize;
      this.positionSize = newPosition;
    } else {
      // Opposite side: reducing, closing, or flipping
      const absOld = Math.abs(this.positionSize);
      const absFill = Math.abs(signedSize);

      if (absFill <= absOld) {
        // Pure reduce or close
        this.realizeFromClose(absFill, price);
        this.positionSize = newPosition || 0; // normalize -0
        if (this.positionSize === 0) {
          this.avgCostPrice = 0;
        }
      } else {
        // Flip: close old position, then open remainder at fill price
        this.realizeFromClose(absOld, price);
        const remainder = absFill - absOld;
        this.positionSize = newPosition || 0; // normalize -0
        this.avgCostPrice = price;
      }
    }
  }

  /**
   * Realize PnL from closing `closeSize` units at `fillPrice`.
   */
  private realizeFromClose(closeSize: number, fillPrice: number): void {
    if (this.positionSize > 0) {
      // Closing long: profit when fill > avg
      this.realizedPnl += (fillPrice - this.avgCostPrice) * closeSize;
    } else {
      // Closing short: profit when avg > fill
      this.realizedPnl += (this.avgCostPrice - fillPrice) * closeSize;
    }
  }

  /**
   * Mark-to-market unrealized PnL for current position at given price.
   * Returns 0 when flat.
   */
  getUnrealizedPnl(currentPrice: number): number {
    if (this.positionSize === 0) return 0;

    if (this.positionSize > 0) {
      return (currentPrice - this.avgCostPrice) * this.positionSize || 0;
    }
    return (this.avgCostPrice - currentPrice) * Math.abs(this.positionSize) || 0;
  }

  /** Accumulated realized PnL from all closed fills. */
  getRealizedPnl(): number {
    return this.realizedPnl;
  }

  /** Total PnL = realized + unrealized at given price. */
  getTotalPnl(currentPrice: number): number {
    return this.realizedPnl + this.getUnrealizedPnl(currentPrice);
  }

  /** Full snapshot of PnL state at given mark price. */
  getSnapshot(currentPrice: number): PnlSnapshot {
    const unrealizedPnl = this.getUnrealizedPnl(currentPrice);
    return {
      realizedPnl: this.realizedPnl,
      unrealizedPnl,
      totalPnl: this.realizedPnl + unrealizedPnl,
      positionSize: this.positionSize,
      avgCostPrice: this.avgCostPrice,
    };
  }

  /** Signed position size (positive = long, negative = short). */
  getPositionSize(): number {
    return this.positionSize;
  }

  /** Current average cost price (0 when flat). */
  getAvgCostPrice(): number {
    return this.avgCostPrice;
  }
}
