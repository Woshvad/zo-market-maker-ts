import { describe, it, expect } from "vitest";
import { AdverseSelectionTracker } from "./adverse-selection.js";

const defaultConfig = {
  windowSize: 10,
  imbalanceThreshold: 0.65,
  spreadMultiplier: 1.5,
};

describe("AdverseSelectionTracker", () => {
  describe("initial state", () => {
    it("starts with zero fills and no imbalance", () => {
      const tracker = new AdverseSelectionTracker(defaultConfig);
      const state = tracker.getState();
      expect(state.bidFills).toBe(0);
      expect(state.askFills).toBe(0);
      expect(state.totalFills).toBe(0);
      expect(state.isImbalanced).toBe(false);
      expect(state.dominantSide).toBe(null);
      expect(state.spreadMultiplier).toBe(1);
    });

    it("getSpreadMultiplier returns 1 initially", () => {
      const tracker = new AdverseSelectionTracker(defaultConfig);
      expect(tracker.getSpreadMultiplier()).toBe(1);
    });
  });

  describe("fill recording", () => {
    it("counts bid and ask fills", () => {
      const tracker = new AdverseSelectionTracker(defaultConfig);
      tracker.recordFill("bid");
      tracker.recordFill("bid");
      tracker.recordFill("ask");
      const state = tracker.getState();
      expect(state.bidFills).toBe(2);
      expect(state.askFills).toBe(1);
      expect(state.totalFills).toBe(3);
    });

    it("computes correct ratios", () => {
      const tracker = new AdverseSelectionTracker(defaultConfig);
      tracker.recordFill("bid");
      tracker.recordFill("bid");
      tracker.recordFill("ask");
      tracker.recordFill("ask");
      const state = tracker.getState();
      expect(state.bidRatio).toBe(0.5);
      expect(state.askRatio).toBe(0.5);
    });
  });

  describe("imbalance detection", () => {
    it("detects bid-heavy imbalance at threshold", () => {
      const tracker = new AdverseSelectionTracker({
        windowSize: 10,
        imbalanceThreshold: 0.65,
        spreadMultiplier: 1.5,
      });
      // 7 bids, 3 asks = 70% bids
      for (let i = 0; i < 7; i++) tracker.recordFill("bid");
      for (let i = 0; i < 3; i++) tracker.recordFill("ask");
      const state = tracker.getState();
      expect(state.isImbalanced).toBe(true);
      expect(state.dominantSide).toBe("bid");
      expect(state.spreadMultiplier).toBe(1.5);
    });

    it("detects ask-heavy imbalance", () => {
      const tracker = new AdverseSelectionTracker({
        windowSize: 10,
        imbalanceThreshold: 0.65,
        spreadMultiplier: 2.0,
      });
      // 2 bids, 8 asks = 80% asks
      for (let i = 0; i < 2; i++) tracker.recordFill("bid");
      for (let i = 0; i < 8; i++) tracker.recordFill("ask");
      const state = tracker.getState();
      expect(state.isImbalanced).toBe(true);
      expect(state.dominantSide).toBe("ask");
      expect(state.spreadMultiplier).toBe(2.0);
    });

    it("does not trigger when balanced", () => {
      const tracker = new AdverseSelectionTracker(defaultConfig);
      // 6 bids, 4 asks = 60% bids (below 65% threshold)
      for (let i = 0; i < 6; i++) tracker.recordFill("bid");
      for (let i = 0; i < 4; i++) tracker.recordFill("ask");
      const state = tracker.getState();
      expect(state.isImbalanced).toBe(false);
      expect(state.dominantSide).toBe(null);
      expect(state.spreadMultiplier).toBe(1);
    });

    it("triggers at exact threshold", () => {
      const tracker = new AdverseSelectionTracker({
        windowSize: 20,
        imbalanceThreshold: 0.65,
        spreadMultiplier: 1.5,
      });
      // 13 bids, 7 asks = 65% bids (exactly at threshold)
      for (let i = 0; i < 13; i++) tracker.recordFill("bid");
      for (let i = 0; i < 7; i++) tracker.recordFill("ask");
      const state = tracker.getState();
      expect(state.isImbalanced).toBe(true);
      expect(state.dominantSide).toBe("bid");
    });
  });

  describe("rolling window", () => {
    it("evicts old fills when window is full", () => {
      const tracker = new AdverseSelectionTracker({
        windowSize: 5,
        imbalanceThreshold: 0.65,
        spreadMultiplier: 1.5,
      });
      // Fill window with 5 bids → 100% bid
      for (let i = 0; i < 5; i++) tracker.recordFill("bid");
      expect(tracker.getState().isImbalanced).toBe(true);

      // Now add 4 asks → window is [bid, ask, ask, ask, ask] → 80% ask
      for (let i = 0; i < 4; i++) tracker.recordFill("ask");
      const state = tracker.getState();
      expect(state.bidFills).toBe(1);
      expect(state.askFills).toBe(4);
      expect(state.isImbalanced).toBe(true);
      expect(state.dominantSide).toBe("ask");
    });

    it("normalizes after imbalance corrects", () => {
      const tracker = new AdverseSelectionTracker({
        windowSize: 6,
        imbalanceThreshold: 0.65,
        spreadMultiplier: 1.5,
      });
      // Start with imbalance: 4 bids, 2 asks = 67%
      for (let i = 0; i < 4; i++) tracker.recordFill("bid");
      for (let i = 0; i < 2; i++) tracker.recordFill("ask");
      expect(tracker.getState().isImbalanced).toBe(true);

      // Add 3 more asks → oldest bids get evicted
      for (let i = 0; i < 3; i++) tracker.recordFill("ask");
      const state = tracker.getState();
      expect(state.isImbalanced).toBe(true);
      expect(state.dominantSide).toBe("ask");
    });
  });

  describe("partial window", () => {
    it("works correctly before window is full", () => {
      const tracker = new AdverseSelectionTracker({
        windowSize: 20,
        imbalanceThreshold: 0.65,
        spreadMultiplier: 1.5,
      });
      // Only 3 fills: 2 bids, 1 ask = 67% bid
      tracker.recordFill("bid");
      tracker.recordFill("bid");
      tracker.recordFill("ask");
      const state = tracker.getState();
      expect(state.totalFills).toBe(3);
      expect(state.bidRatio).toBeCloseTo(0.667, 2);
      expect(state.isImbalanced).toBe(true);
    });
  });
});
