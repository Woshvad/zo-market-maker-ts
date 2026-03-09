import { describe, it, expect } from 'vitest';
import {
  FeedStateManager,
  type FeedStateConfig,
  type FeedStateCallbacks,
  type FeedState,
  type HaltReason,
} from './feed-state.js';

function makeConfig(overrides: Partial<FeedStateConfig> = {}): FeedStateConfig {
  return {
    staleThresholdMs: 5000,
    recoveryPriceCount: 3,
    stalePriceEnabled: true,
    haltStaleCount: 5,
    haltWindowMs: 60_000,
    ...overrides,
  };
}

function makeCallbacks(overrides: Partial<FeedStateCallbacks> = {}): FeedStateCallbacks {
  return {
    onStale: () => {},
    onRecovery: () => {},
    onHalted: () => {},
    ...overrides,
  };
}

describe('FeedStateManager', () => {
  // --- Initialization ---
  describe('initialization', () => {
    it('starts in WARMING_UP state', () => {
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks());
      expect(fsm.getState()).toBe('WARMING_UP');
    });

    it('canQuote() returns false in WARMING_UP', () => {
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks());
      expect(fsm.canQuote()).toBe(false);
    });
  });

  // --- WARMING_UP -> QUOTING ---
  describe('WARMING_UP -> QUOTING transition', () => {
    it('promoteToQuoting() transitions to QUOTING', () => {
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks());
      fsm.promoteToQuoting();
      expect(fsm.getState()).toBe('QUOTING');
    });

    it('canQuote() returns true in QUOTING', () => {
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks());
      fsm.promoteToQuoting();
      expect(fsm.canQuote()).toBe(true);
    });
  });

  // --- Stale detection (QUOTING -> STALE) ---
  describe('stale detection (QUOTING -> STALE)', () => {
    it('checkStale() does nothing when last price is recent', () => {
      let time = 1000;
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks(), () => time);
      fsm.onPrice();
      fsm.promoteToQuoting();
      time = 1000 + 4999; // just under threshold
      fsm.checkStale();
      expect(fsm.getState()).toBe('QUOTING');
    });

    it('checkStale() transitions to STALE when last price is old', () => {
      let time = 1000;
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks(), () => time);
      fsm.onPrice();
      fsm.promoteToQuoting();
      time = 1000 + 5001; // over threshold
      fsm.checkStale();
      expect(fsm.getState()).toBe('STALE');
    });

    it('onStale callback fires on QUOTING -> STALE transition', () => {
      let time = 1000;
      let staleFired = false;
      const fsm = new FeedStateManager(
        makeConfig(),
        makeCallbacks({ onStale: () => { staleFired = true; } }),
        () => time,
      );
      fsm.onPrice();
      fsm.promoteToQuoting();
      time = 1000 + 5001;
      fsm.checkStale();
      expect(staleFired).toBe(true);
    });

    it('canQuote() returns false in STALE', () => {
      let time = 1000;
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks(), () => time);
      fsm.onPrice();
      fsm.promoteToQuoting();
      time = 1000 + 5001;
      fsm.checkStale();
      expect(fsm.canQuote()).toBe(false);
    });
  });

  // --- Recovery (STALE -> QUOTING) ---
  describe('recovery (STALE -> QUOTING)', () => {
    function makeStale(now: () => number): FeedStateManager {
      const fsm = new FeedStateManager(makeConfig({ recoveryPriceCount: 3 }), makeCallbacks(), now);
      fsm.onPrice();
      fsm.promoteToQuoting();
      return fsm;
    }

    it('single onPrice() in STALE does not transition to QUOTING', () => {
      let time = 1000;
      const fsm = makeStale(() => time);
      time = 6001;
      fsm.checkStale();
      expect(fsm.getState()).toBe('STALE');
      time = 6002;
      fsm.onPrice();
      expect(fsm.getState()).toBe('STALE');
    });

    it('recoveryPriceCount consecutive onPrice() calls transitions STALE -> QUOTING', () => {
      let time = 1000;
      const fsm = makeStale(() => time);
      time = 6001;
      fsm.checkStale();
      expect(fsm.getState()).toBe('STALE');
      for (let i = 0; i < 3; i++) {
        time += 100;
        fsm.onPrice();
      }
      expect(fsm.getState()).toBe('QUOTING');
    });

    it('onRecovery callback fires on STALE -> QUOTING transition', () => {
      let time = 1000;
      let recoveryFired = false;
      const fsm = new FeedStateManager(
        makeConfig({ recoveryPriceCount: 3 }),
        makeCallbacks({ onRecovery: () => { recoveryFired = true; } }),
        () => time,
      );
      fsm.onPrice();
      fsm.promoteToQuoting();
      time = 6001;
      fsm.checkStale();
      for (let i = 0; i < 3; i++) {
        time += 100;
        fsm.onPrice();
      }
      expect(recoveryFired).toBe(true);
    });

    it('recovery counter resets if checkStale() fires during recovery', () => {
      let time = 1000;
      const fsm = new FeedStateManager(
        makeConfig({ recoveryPriceCount: 3 }),
        makeCallbacks(),
        () => time,
      );
      fsm.onPrice();
      fsm.promoteToQuoting();
      // Go stale
      time = 6001;
      fsm.checkStale();
      expect(fsm.getState()).toBe('STALE');
      // Partial recovery: 2 prices
      time += 100;
      fsm.onPrice();
      time += 100;
      fsm.onPrice();
      // Another stale event (gap > threshold since last price)
      time += 6000;
      fsm.checkStale();
      expect(fsm.getState()).toBe('STALE');
      // Now need full 3 prices again
      time += 100;
      fsm.onPrice();
      expect(fsm.getState()).toBe('STALE');
      time += 100;
      fsm.onPrice();
      expect(fsm.getState()).toBe('STALE');
      time += 100;
      fsm.onPrice();
      expect(fsm.getState()).toBe('QUOTING');
    });
  });

  // --- HALTED (terminal) ---
  describe('HALTED (terminal)', () => {
    function makeHaltedFsm(
      callbacks: FeedStateCallbacks = makeCallbacks(),
    ): { fsm: FeedStateManager; setTime: (t: number) => void } {
      let time = 1000;
      const setTime = (t: number) => { time = t; };
      const fsm = new FeedStateManager(
        makeConfig({ haltStaleCount: 3, haltWindowMs: 60_000 }),
        callbacks,
        () => time,
      );
      fsm.onPrice();
      fsm.promoteToQuoting();
      // Trigger 3 stale events
      for (let i = 0; i < 3; i++) {
        time += 5001;
        fsm.checkStale();
        if (fsm.getState() !== 'HALTED') {
          // Recover quickly to allow another stale
          time += 100;
          fsm.onPrice();
          time += 100;
          fsm.onPrice();
          time += 100;
          fsm.onPrice();
        }
      }
      return { fsm, setTime };
    }

    it('haltStaleCount stale events within haltWindowMs triggers HALTED', () => {
      const { fsm } = makeHaltedFsm();
      expect(fsm.getState()).toBe('HALTED');
    });

    it('onHalted callback fires with reason repeated_stale', () => {
      let haltReason: HaltReason | null = null;
      const { fsm } = makeHaltedFsm(
        makeCallbacks({ onHalted: (reason: HaltReason) => { haltReason = reason; } }),
      );
      expect(haltReason).toBe('repeated_stale');
    });

    it('canQuote() returns false in HALTED', () => {
      const { fsm } = makeHaltedFsm();
      expect(fsm.canQuote()).toBe(false);
    });

    it('onPrice() in HALTED does not change state', () => {
      const { fsm } = makeHaltedFsm();
      fsm.onPrice();
      expect(fsm.getState()).toBe('HALTED');
    });

    it('checkStale() in HALTED does not change state', () => {
      const { fsm, setTime } = makeHaltedFsm();
      setTime(999_999);
      fsm.checkStale();
      expect(fsm.getState()).toBe('HALTED');
    });
  });

  // --- HALTED from external trigger ---
  describe('HALTED from external trigger', () => {
    it('halt(reason) transitions to HALTED from any non-HALTED state', () => {
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks());
      expect(fsm.getState()).toBe('WARMING_UP');
      fsm.halt('circuit_breaker');
      expect(fsm.getState()).toBe('HALTED');
    });

    it('halt(reason) is a no-op when already HALTED', () => {
      let haltedCount = 0;
      const fsm = new FeedStateManager(
        makeConfig(),
        makeCallbacks({ onHalted: () => { haltedCount++; } }),
      );
      fsm.halt('circuit_breaker');
      fsm.halt('circuit_breaker');
      expect(haltedCount).toBe(1);
    });
  });

  // --- Sliding window ---
  describe('sliding window', () => {
    it('stale events older than haltWindowMs do not count toward halt threshold', () => {
      let time = 1000;
      const fsm = new FeedStateManager(
        makeConfig({ haltStaleCount: 3, haltWindowMs: 10_000, recoveryPriceCount: 1 }),
        makeCallbacks(),
        () => time,
      );
      fsm.onPrice();
      fsm.promoteToQuoting();

      // 2 stale events early
      time += 5001;
      fsm.checkStale();
      time += 100;
      fsm.onPrice(); // recover (1 price needed)

      time += 5001;
      fsm.checkStale();
      time += 100;
      fsm.onPrice(); // recover

      // Wait so those 2 events fall outside window
      time += 15_000;
      fsm.onPrice(); // keep price fresh
      time += 5001;
      fsm.checkStale(); // 3rd stale event total, but only 1 in window
      expect(fsm.getState()).toBe('STALE'); // not HALTED
    });
  });

  // --- WARMING_UP -> STALE ---
  describe('WARMING_UP -> STALE', () => {
    it('checkStale() transitions WARMING_UP -> STALE if feed dies during warmup after receiving a price', () => {
      let time = 1000;
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks(), () => time);
      fsm.onPrice(); // sets lastPriceTime
      time = 1000 + 5001;
      fsm.checkStale();
      expect(fsm.getState()).toBe('STALE');
    });

    it('checkStale() does nothing in WARMING_UP if no price has been received', () => {
      let time = 1000;
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks(), () => time);
      time = 1000 + 50_000;
      fsm.checkStale();
      expect(fsm.getState()).toBe('WARMING_UP');
    });
  });

  // --- Disabled mode (stalePriceEnabled=false) ---
  describe('disabled mode (stalePriceEnabled=false)', () => {
    it('starts in WARMING_UP, promoteToQuoting() goes to QUOTING', () => {
      const fsm = new FeedStateManager(
        makeConfig({ stalePriceEnabled: false }),
        makeCallbacks(),
      );
      expect(fsm.getState()).toBe('WARMING_UP');
      fsm.promoteToQuoting();
      expect(fsm.getState()).toBe('QUOTING');
    });

    it('checkStale() never transitions to STALE', () => {
      let time = 1000;
      const fsm = new FeedStateManager(
        makeConfig({ stalePriceEnabled: false }),
        makeCallbacks(),
        () => time,
      );
      fsm.onPrice();
      fsm.promoteToQuoting();
      time = 1000 + 50_000;
      fsm.checkStale();
      expect(fsm.getState()).toBe('QUOTING');
    });

    it('canQuote() returns true after promoteToQuoting()', () => {
      const fsm = new FeedStateManager(
        makeConfig({ stalePriceEnabled: false }),
        makeCallbacks(),
      );
      fsm.promoteToQuoting();
      expect(fsm.canQuote()).toBe(true);
    });
  });

  // --- Status info ---
  describe('status info', () => {
    it('getStaleInfo() returns count/max/windowMs', () => {
      let time = 1000;
      const fsm = new FeedStateManager(
        makeConfig({ haltStaleCount: 5, haltWindowMs: 60_000, recoveryPriceCount: 1 }),
        makeCallbacks(),
        () => time,
      );
      fsm.onPrice();
      fsm.promoteToQuoting();
      // Trigger one stale event
      time += 5001;
      fsm.checkStale();
      const info = fsm.getStaleInfo();
      expect(info.count).toBe(1);
      expect(info.max).toBe(5);
      expect(info.windowMs).toBe(60_000);
    });

    it('getState() returns current state string', () => {
      const fsm = new FeedStateManager(makeConfig(), makeCallbacks());
      expect(fsm.getState()).toBe('WARMING_UP');
      fsm.promoteToQuoting();
      expect(fsm.getState()).toBe('QUOTING');
    });
  });
});
