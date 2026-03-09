import { describe, it, expect } from 'vitest';
import { PnlTracker } from './pnl-tracker.js';

describe('PnlTracker', () => {
  describe('initial state', () => {
    it('starts with zero position, zero realized PnL, zero avg cost', () => {
      const tracker = new PnlTracker();
      expect(tracker.getPositionSize()).toBe(0);
      expect(tracker.getRealizedPnl()).toBe(0);
      expect(tracker.getAvgCostPrice()).toBe(0);
    });

    it('getUnrealizedPnl returns 0 when flat', () => {
      const tracker = new PnlTracker();
      expect(tracker.getUnrealizedPnl(100)).toBe(0);
    });

    it('getTotalPnl returns 0 when flat with no history', () => {
      const tracker = new PnlTracker();
      expect(tracker.getTotalPnl(100)).toBe(0);
    });

    it('getSnapshot returns all-zero snapshot when flat', () => {
      const tracker = new PnlTracker();
      const snap = tracker.getSnapshot(100);
      expect(snap).toEqual({
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        positionSize: 0,
        avgCostPrice: 0,
      });
    });
  });

  describe('opening positions', () => {
    it('opens long position on bid fill', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50);
      expect(tracker.getPositionSize()).toBe(10);
      expect(tracker.getAvgCostPrice()).toBe(50);
      expect(tracker.getRealizedPnl()).toBe(0);
    });

    it('opens short position on ask fill', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('ask', 5, 100);
      expect(tracker.getPositionSize()).toBe(-5);
      expect(tracker.getAvgCostPrice()).toBe(100);
      expect(tracker.getRealizedPnl()).toBe(0);
    });
  });

  describe('increasing positions', () => {
    it('increases long position with weighted average cost', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50); // buy 10 @ 50
      tracker.applyFill('bid', 10, 60); // buy 10 @ 60
      expect(tracker.getPositionSize()).toBe(20);
      // avg cost = (10*50 + 10*60) / 20 = 1100/20 = 55
      expect(tracker.getAvgCostPrice()).toBe(55);
      expect(tracker.getRealizedPnl()).toBe(0);
    });

    it('increases short position with weighted average cost', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('ask', 10, 100); // sell 10 @ 100
      tracker.applyFill('ask', 10, 80);  // sell 10 @ 80
      expect(tracker.getPositionSize()).toBe(-20);
      // avg cost = (10*100 + 10*80) / 20 = 1800/20 = 90
      expect(tracker.getAvgCostPrice()).toBe(90);
      expect(tracker.getRealizedPnl()).toBe(0);
    });
  });

  describe('reducing positions', () => {
    it('reduces long position and realizes PnL', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50); // buy 10 @ 50
      tracker.applyFill('ask', 4, 60);  // sell 4 @ 60 (reduce)
      expect(tracker.getPositionSize()).toBe(6);
      expect(tracker.getAvgCostPrice()).toBe(50); // unchanged
      // realized = (60 - 50) * 4 = 40
      expect(tracker.getRealizedPnl()).toBe(40);
    });

    it('reduces short position and realizes PnL', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('ask', 10, 100); // sell 10 @ 100
      tracker.applyFill('bid', 4, 80);   // buy 4 @ 80 (reduce)
      expect(tracker.getPositionSize()).toBe(-6);
      expect(tracker.getAvgCostPrice()).toBe(100); // unchanged
      // realized = (100 - 80) * 4 = 80
      expect(tracker.getRealizedPnl()).toBe(80);
    });

    it('reduces long at a loss', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50); // buy 10 @ 50
      tracker.applyFill('ask', 4, 40);  // sell 4 @ 40 (loss)
      expect(tracker.getPositionSize()).toBe(6);
      // realized = (40 - 50) * 4 = -40
      expect(tracker.getRealizedPnl()).toBe(-40);
    });

    it('reduces short at a loss', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('ask', 10, 100); // sell 10 @ 100
      tracker.applyFill('bid', 4, 120);  // buy 4 @ 120 (loss)
      expect(tracker.getPositionSize()).toBe(-6);
      // realized = (100 - 120) * 4 = -80
      expect(tracker.getRealizedPnl()).toBe(-80);
    });
  });

  describe('closing positions fully', () => {
    it('closes long position fully', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50);
      tracker.applyFill('ask', 10, 60);
      expect(tracker.getPositionSize()).toBe(0);
      expect(tracker.getAvgCostPrice()).toBe(0);
      // realized = (60 - 50) * 10 = 100
      expect(tracker.getRealizedPnl()).toBe(100);
    });

    it('closes short position fully', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('ask', 10, 100);
      tracker.applyFill('bid', 10, 80);
      expect(tracker.getPositionSize()).toBe(0);
      expect(tracker.getAvgCostPrice()).toBe(0);
      // realized = (100 - 80) * 10 = 200
      expect(tracker.getRealizedPnl()).toBe(200);
    });
  });

  describe('position flip', () => {
    it('flips long to short in one fill', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50);  // long 10 @ 50
      tracker.applyFill('ask', 15, 60);  // sell 15 @ 60 -> close 10, open short 5
      expect(tracker.getPositionSize()).toBe(-5);
      expect(tracker.getAvgCostPrice()).toBe(60); // new position at fill price
      // realized from closing long: (60 - 50) * 10 = 100
      expect(tracker.getRealizedPnl()).toBe(100);
    });

    it('flips short to long in one fill', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('ask', 10, 100); // short 10 @ 100
      tracker.applyFill('bid', 15, 80);  // buy 15 @ 80 -> close 10, open long 5
      expect(tracker.getPositionSize()).toBe(5);
      expect(tracker.getAvgCostPrice()).toBe(80); // new position at fill price
      // realized from closing short: (100 - 80) * 10 = 200
      expect(tracker.getRealizedPnl()).toBe(200);
    });
  });

  describe('unrealized PnL', () => {
    it('computes unrealized PnL for long position', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50);
      // unrealized = (60 - 50) * 10 = 100
      expect(tracker.getUnrealizedPnl(60)).toBe(100);
    });

    it('computes unrealized PnL for short position', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('ask', 10, 100);
      // unrealized = (100 - 80) * 10 = 200
      expect(tracker.getUnrealizedPnl(80)).toBe(200);
    });

    it('computes negative unrealized PnL for losing long', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50);
      // unrealized = (40 - 50) * 10 = -100
      expect(tracker.getUnrealizedPnl(40)).toBe(-100);
    });

    it('computes negative unrealized PnL for losing short', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('ask', 10, 100);
      // unrealized = (100 - 120) * 10 = -200
      expect(tracker.getUnrealizedPnl(120)).toBe(-200);
    });

    it('returns 0 unrealized PnL when flat', () => {
      const tracker = new PnlTracker();
      expect(tracker.getUnrealizedPnl(999)).toBe(0);
    });
  });

  describe('total PnL', () => {
    it('getTotalPnl equals realized + unrealized', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50);  // buy 10 @ 50
      tracker.applyFill('ask', 5, 60);   // sell 5 @ 60, realize 50
      // remaining: 5 @ avgCost 50
      // at price 70: unrealized = (70-50)*5 = 100
      // total = 50 + 100 = 150
      expect(tracker.getTotalPnl(70)).toBe(150);
    });
  });

  describe('getSnapshot', () => {
    it('returns correct snapshot with active position', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('bid', 10, 50);
      tracker.applyFill('ask', 4, 60);
      // position = 6, avgCost = 50, realized = 40
      // at price 55: unrealized = (55-50)*6 = 30, total = 70
      const snap = tracker.getSnapshot(55);
      expect(snap.positionSize).toBe(6);
      expect(snap.avgCostPrice).toBe(50);
      expect(snap.realizedPnl).toBe(40);
      expect(snap.unrealizedPnl).toBe(30);
      expect(snap.totalPnl).toBe(70);
    });
  });

  describe('accumulated realized PnL across multiple trades', () => {
    it('accumulates realized PnL over multiple round trips', () => {
      const tracker = new PnlTracker();
      // Round trip 1: buy 10 @ 50, sell 10 @ 60 -> profit 100
      tracker.applyFill('bid', 10, 50);
      tracker.applyFill('ask', 10, 60);
      expect(tracker.getRealizedPnl()).toBe(100);

      // Round trip 2: sell 5 @ 100, buy 5 @ 90 -> profit 50
      tracker.applyFill('ask', 5, 100);
      tracker.applyFill('bid', 5, 90);
      expect(tracker.getRealizedPnl()).toBe(150);

      expect(tracker.getPositionSize()).toBe(0);
      expect(tracker.getAvgCostPrice()).toBe(0);
    });
  });

  describe('-0 normalization', () => {
    it('does not produce -0 for position size after closing', () => {
      const tracker = new PnlTracker();
      tracker.applyFill('ask', 10, 100);
      tracker.applyFill('bid', 10, 100);
      const size = tracker.getPositionSize();
      expect(Object.is(size, -0)).toBe(false);
      expect(size).toBe(0);
    });

    it('does not produce -0 for unrealized PnL when flat', () => {
      const tracker = new PnlTracker();
      const pnl = tracker.getUnrealizedPnl(100);
      expect(Object.is(pnl, -0)).toBe(false);
    });
  });
});
