import { describe, it, expect } from 'vitest';
import { VolatilityTracker, type VolatilityConfig } from './volatility.js';

function makeConfig(overrides: Partial<VolatilityConfig> = {}): VolatilityConfig {
  return {
    windowMs: 600_000,       // 10 min
    sampleIntervalMs: 60_000, // 1 min
    volatilityMultiplier: 1.5,
    ...overrides,
  };
}

describe('VolatilityTracker', () => {
  describe('warmup behavior', () => {
    it('getVolatilityBps() returns null with zero samples', () => {
      let t = 0;
      const tracker = new VolatilityTracker(makeConfig(), () => t);
      expect(tracker.getVolatilityBps()).toBeNull();
    });

    it('getVolatilityBps() returns null with only one sample', () => {
      let t = 0;
      const tracker = new VolatilityTracker(makeConfig(), () => t);
      tracker.onPrice(100);
      expect(tracker.getVolatilityBps()).toBeNull();
    });

    it('getEffectiveSpreadBps returns configuredSpread during warmup (SPRD-05)', () => {
      let t = 0;
      const tracker = new VolatilityTracker(makeConfig(), () => t);
      expect(tracker.getEffectiveSpreadBps(50)).toBe(50);
    });
  });

  describe('sampling', () => {
    it('ignores onPrice calls within sampleIntervalMs', () => {
      let t = 0;
      const tracker = new VolatilityTracker(makeConfig({ sampleIntervalMs: 60_000 }), () => t);

      tracker.onPrice(100);
      t = 30_000; // only 30s later
      tracker.onPrice(101);
      t = 59_999; // still under 60s
      tracker.onPrice(102);

      // Only 1 sample should have been captured, so vol is still null
      expect(tracker.getVolatilityBps()).toBeNull();
    });

    it('captures sample when sampleIntervalMs has passed', () => {
      let t = 0;
      const tracker = new VolatilityTracker(makeConfig({ sampleIntervalMs: 60_000 }), () => t);

      tracker.onPrice(100);
      t = 60_000;
      tracker.onPrice(101);

      // 2 samples -> should compute volatility
      expect(tracker.getVolatilityBps()).not.toBeNull();
    });
  });

  describe('volatility calculation', () => {
    it('computes correct stddev of log-returns in bps after 2 samples', () => {
      let t = 0;
      const tracker = new VolatilityTracker(makeConfig({ sampleIntervalMs: 1000 }), () => t);

      tracker.onPrice(100);
      t = 1000;
      tracker.onPrice(101);

      // log-return = ln(101/100) ≈ 0.00995
      // With 1 log-return, stddev of population = 0 (single value)
      // Actually stddev of single value is 0
      const vol = tracker.getVolatilityBps()!;
      expect(vol).toBe(0);
    });

    it('computes non-zero stddev with 3+ samples having different returns', () => {
      let t = 0;
      const tracker = new VolatilityTracker(makeConfig({ sampleIntervalMs: 1000 }), () => t);

      // Prices: 100, 102, 101
      tracker.onPrice(100);
      t = 1000;
      tracker.onPrice(102);
      t = 2000;
      tracker.onPrice(101);

      // log-returns: ln(102/100) ≈ 0.01980, ln(101/102) ≈ -0.00990
      // mean = (0.01980 + (-0.00990)) / 2 ≈ 0.00495
      // variance = ((0.01980-0.00495)^2 + (-0.00990-0.00495)^2) / 2
      //          = (0.01485^2 + (-0.01485)^2) / 2
      //          = (0.00022052 + 0.00022052) / 2
      //          = 0.00022052
      // stddev = sqrt(0.00022052) ≈ 0.01485
      // bps = 0.01485 * 10000 ≈ 148.5
      const vol = tracker.getVolatilityBps()!;
      expect(vol).toBeCloseTo(148.5, 0);
    });
  });

  describe('window pruning', () => {
    it('drops samples older than windowMs from calculation', () => {
      let t = 0;
      const tracker = new VolatilityTracker(
        makeConfig({ sampleIntervalMs: 1000, windowMs: 5000 }),
        () => t,
      );

      tracker.onPrice(100);
      t = 1000;
      tracker.onPrice(200); // huge move
      t = 2000;
      tracker.onPrice(201);

      // At t=2000 all 3 samples are in window -> vol reflects the big move
      const volBefore = tracker.getVolatilityBps()!;

      // Advance time so the first two samples fall outside window
      t = 8000;
      tracker.onPrice(202);
      // Now window is [3000, 8000], only samples at t=2000 (201) and t=8000 (202) remain
      // (t=0 and t=1000 are outside window)
      const volAfter = tracker.getVolatilityBps()!;

      // The big 100->200 jump should be gone
      expect(volAfter).toBeLessThan(volBefore);
    });
  });

  describe('getEffectiveSpreadBps', () => {
    it('returns max(configured, volBps * multiplier) when vol is available', () => {
      let t = 0;
      const tracker = new VolatilityTracker(
        makeConfig({ sampleIntervalMs: 1000, volatilityMultiplier: 2.0 }),
        () => t,
      );

      // Create enough samples for non-zero vol
      tracker.onPrice(100);
      t = 1000;
      tracker.onPrice(102);
      t = 2000;
      tracker.onPrice(101);

      const vol = tracker.getVolatilityBps()!;
      expect(vol).toBeGreaterThan(0);

      // vol * 2.0 should be > configured 10 bps
      const spread = tracker.getEffectiveSpreadBps(10);
      expect(spread).toBe(vol * 2.0);
      expect(spread).toBeGreaterThan(10);
    });

    it('returns configured spread when vol * multiplier is less than configured', () => {
      let t = 0;
      const tracker = new VolatilityTracker(
        makeConfig({ sampleIntervalMs: 1000, volatilityMultiplier: 0.001 }),
        () => t,
      );

      tracker.onPrice(100);
      t = 1000;
      tracker.onPrice(100.01);
      t = 2000;
      tracker.onPrice(100.02);

      // Very small vol * tiny multiplier should be < configured 500 bps
      const spread = tracker.getEffectiveSpreadBps(500);
      expect(spread).toBe(500);
    });
  });

  describe('edge cases', () => {
    it('skips zero price in onPrice (guards against NaN)', () => {
      let t = 0;
      const tracker = new VolatilityTracker(makeConfig({ sampleIntervalMs: 1000 }), () => t);

      tracker.onPrice(0);
      t = 1000;
      tracker.onPrice(100);
      t = 2000;
      tracker.onPrice(101);

      // 0-price should be skipped, so only 2 valid samples (100, 101)
      const vol = tracker.getVolatilityBps();
      expect(vol).not.toBeNull();
      // Should not be NaN
      expect(Number.isNaN(vol)).toBe(false);
    });

    it('skips negative price in onPrice', () => {
      let t = 0;
      const tracker = new VolatilityTracker(makeConfig({ sampleIntervalMs: 1000 }), () => t);

      tracker.onPrice(-5);
      expect(tracker.getVolatilityBps()).toBeNull();
    });
  });
});
