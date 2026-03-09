import { describe, it, expect } from "vitest";
import { calculateInventorySkew } from "./inventory-skew.js";

describe("calculateInventorySkew", () => {
  const effectiveSpreadBps = 10;
  const maxPositionUsd = 100;

  it("returns zero skew and no pause for zero position", () => {
    const result = calculateInventorySkew(0, maxPositionUsd, effectiveSpreadBps);
    expect(result.skewBps).toBe(0);
    expect(result.pauseIncreasing).toBe(false);
  });

  it("returns negative skewBps for long position (shift quotes down)", () => {
    const result = calculateInventorySkew(50, maxPositionUsd, effectiveSpreadBps);
    expect(result.skewBps).toBeLessThan(0);
  });

  it("returns positive skewBps for short position (shift quotes up)", () => {
    const result = calculateInventorySkew(-50, maxPositionUsd, effectiveSpreadBps);
    expect(result.skewBps).toBeGreaterThan(0);
  });

  it("scales linearly with position fraction (50% position = 50% of effectiveSpread)", () => {
    const result = calculateInventorySkew(50, maxPositionUsd, effectiveSpreadBps);
    // fraction = 50/100 = 0.5, skewBps = -0.5 * 10 = -5
    expect(result.skewBps).toBe(-5);
  });

  it("at 100% of maxPositionUsd, skewBps equals effectiveSpreadBps in magnitude", () => {
    const result = calculateInventorySkew(100, maxPositionUsd, effectiveSpreadBps);
    expect(Math.abs(result.skewBps)).toBe(effectiveSpreadBps);
    expect(result.skewBps).toBe(-effectiveSpreadBps); // long -> negative
  });

  it("allows fraction > 1 when position exceeds maxPositionUsd", () => {
    const result = calculateInventorySkew(150, maxPositionUsd, effectiveSpreadBps);
    // fraction = 1.5, skewBps = -1.5 * 10 = -15
    expect(result.skewBps).toBe(-15);
    expect(Math.abs(result.skewBps)).toBeGreaterThan(effectiveSpreadBps);
  });

  it("sets pauseIncreasing=true when abs(skewBps) > 2x effectiveSpreadBps", () => {
    // Need fraction > 2 -> positionUsd > 200
    const result = calculateInventorySkew(250, maxPositionUsd, effectiveSpreadBps);
    // skewBps = -2.5 * 10 = -25, |25| > 2*10=20 -> true
    expect(result.pauseIncreasing).toBe(true);
  });

  it("sets pauseIncreasing=false when abs(skewBps) <= 2x effectiveSpreadBps", () => {
    const result = calculateInventorySkew(50, maxPositionUsd, effectiveSpreadBps);
    // skewBps = -5, |5| <= 20 -> false
    expect(result.pauseIncreasing).toBe(false);
  });

  it("sets pauseIncreasing=false at exactly 2x threshold (uses > not >=)", () => {
    // Need fraction = 2 exactly -> positionUsd = 200
    const result = calculateInventorySkew(200, maxPositionUsd, effectiveSpreadBps);
    // skewBps = -2 * 10 = -20, |20| > 20 -> false (not strictly greater)
    expect(result.pauseIncreasing).toBe(false);
  });

  it("returns zero skew when maxPositionUsd <= 0 (guard)", () => {
    const result = calculateInventorySkew(50, 0, effectiveSpreadBps);
    expect(result.skewBps).toBe(0);
    expect(result.pauseIncreasing).toBe(false);

    const result2 = calculateInventorySkew(50, -10, effectiveSpreadBps);
    expect(result2.skewBps).toBe(0);
    expect(result2.pauseIncreasing).toBe(false);
  });
});
