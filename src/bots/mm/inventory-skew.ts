export interface SkewResult {
  readonly skewBps: number;          // Signed: negative = shift down, positive = shift up
  readonly pauseIncreasing: boolean; // True when |skew| > 2x effective spread
}

/**
 * Pure function that computes bid/ask shift from position fraction.
 *
 * Formula:
 *   fraction = positionUsd / maxPositionUsd
 *   skewBps  = -fraction * effectiveSpreadBps
 *   pauseIncreasing = |skewBps| > 2 * effectiveSpreadBps
 *
 * - Long (positive positionUsd) -> negative skewBps -> quotes shift DOWN -> favors selling
 * - Short (negative positionUsd) -> positive skewBps -> quotes shift UP -> favors buying
 */
export function calculateInventorySkew(
  positionUsd: number,
  maxPositionUsd: number,
  effectiveSpreadBps: number,
): SkewResult {
  if (maxPositionUsd <= 0) {
    return { skewBps: 0, pauseIncreasing: false };
  }

  const fraction = positionUsd / maxPositionUsd;
  const skewBps = -fraction * effectiveSpreadBps || 0; // Normalize -0 to 0
  const pauseIncreasing = Math.abs(skewBps) > 2 * effectiveSpreadBps;

  return { skewBps, pauseIncreasing };
}
