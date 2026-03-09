import { describe, it, expect } from 'vitest';
import { computeWeightedMid } from './binance.js';

describe('computeWeightedMid', () => {
  it('computes VWAP mid = (bid*askQty + ask*bidQty) / (bidQty + askQty)', () => {
    // bid=100, ask=102, bidQty=10, askQty=5
    // VWAP = (100*5 + 102*10) / (10+5) = (500 + 1020) / 15 = 1520/15 = 101.333...
    const mid = computeWeightedMid(100, 102, 10, 5);
    expect(mid).toBeCloseTo(101.3333, 3);
  });

  it('falls back to simple mid when bidQty is 0', () => {
    const mid = computeWeightedMid(100, 102, 0, 5);
    expect(mid).toBe(101); // (100 + 102) / 2
  });

  it('falls back to simple mid when askQty is 0', () => {
    const mid = computeWeightedMid(100, 102, 10, 0);
    expect(mid).toBe(101); // (100 + 102) / 2
  });

  it('falls back to simple mid when both quantities are 0', () => {
    const mid = computeWeightedMid(100, 102, 0, 0);
    expect(mid).toBe(101);
  });

  it('shifts mid toward the deeper side with asymmetric quantities', () => {
    // Large askQty means more weight on bid side -> mid shifts toward bid
    const mid = computeWeightedMid(100, 102, 1, 100);
    // VWAP = (100*100 + 102*1) / (1+100) = (10000 + 102) / 101 = 10102/101 ≈ 100.0198
    expect(mid).toBeCloseTo(100.0198, 3);
    expect(mid).toBeLessThan(101); // shifted toward bid
  });

  it('returns exact simple mid when quantities are equal', () => {
    const mid = computeWeightedMid(100, 102, 50, 50);
    // VWAP = (100*50 + 102*50) / (50+50) = (5000 + 5100) / 100 = 101
    expect(mid).toBe(101);
  });
});
