import { describe, it, expect } from "vitest";
import { DrawdownCooldown } from "./drawdown-cooldown.js";

const defaultConfig = {
  consecutiveLossLimit: 5,
  cooldownSizeMultiplier: 0.5,
};

describe("DrawdownCooldown", () => {
  describe("initial state", () => {
    it("starts with no cooldown", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      const state = dd.getState();
      expect(state.consecutiveLosses).toBe(0);
      expect(state.inCooldown).toBe(false);
      expect(state.sizeMultiplier).toBe(1);
      expect(state.totalCycles).toBe(0);
      expect(state.totalLosses).toBe(0);
    });

    it("getSizeMultiplier returns 1 initially", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      expect(dd.getSizeMultiplier()).toBe(1);
    });

    it("isInCooldown returns false initially", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      expect(dd.isInCooldown()).toBe(false);
    });
  });

  describe("losing streak tracking", () => {
    it("counts consecutive losses", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      dd.onCycleComplete(-0.50);
      dd.onCycleComplete(-0.30);
      dd.onCycleComplete(-0.10);
      const state = dd.getState();
      expect(state.consecutiveLosses).toBe(3);
      expect(state.inCooldown).toBe(false);
      expect(state.totalCycles).toBe(3);
      expect(state.totalLosses).toBe(3);
    });

    it("enters cooldown at exactly the limit", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      for (let i = 0; i < 5; i++) dd.onCycleComplete(-0.10);
      expect(dd.isInCooldown()).toBe(true);
      expect(dd.getSizeMultiplier()).toBe(0.5);
    });

    it("stays in cooldown beyond the limit", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      for (let i = 0; i < 8; i++) dd.onCycleComplete(-0.10);
      expect(dd.isInCooldown()).toBe(true);
      expect(dd.getState().consecutiveLosses).toBe(8);
    });
  });

  describe("recovery", () => {
    it("resets consecutive losses on winning cycle", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      // Build up 4 losses
      for (let i = 0; i < 4; i++) dd.onCycleComplete(-0.10);
      expect(dd.getState().consecutiveLosses).toBe(4);

      // Win resets
      dd.onCycleComplete(0.20);
      expect(dd.getState().consecutiveLosses).toBe(0);
      expect(dd.isInCooldown()).toBe(false);
      expect(dd.getSizeMultiplier()).toBe(1);
    });

    it("resets on break-even cycle (pnl = 0)", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      for (let i = 0; i < 5; i++) dd.onCycleComplete(-0.10);
      expect(dd.isInCooldown()).toBe(true);

      dd.onCycleComplete(0);
      expect(dd.isInCooldown()).toBe(false);
      expect(dd.getState().consecutiveLosses).toBe(0);
    });

    it("exits cooldown immediately on first win", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      for (let i = 0; i < 7; i++) dd.onCycleComplete(-0.10);
      expect(dd.isInCooldown()).toBe(true);

      dd.onCycleComplete(0.01);
      expect(dd.isInCooldown()).toBe(false);
      expect(dd.getSizeMultiplier()).toBe(1);
    });
  });

  describe("total counters", () => {
    it("tracks total cycles and losses independently of streak", () => {
      const dd = new DrawdownCooldown(defaultConfig);
      dd.onCycleComplete(-0.10);
      dd.onCycleComplete(-0.10);
      dd.onCycleComplete(0.50);  // win resets streak but not totals
      dd.onCycleComplete(-0.10);
      const state = dd.getState();
      expect(state.totalCycles).toBe(4);
      expect(state.totalLosses).toBe(3);
      expect(state.consecutiveLosses).toBe(1);
    });
  });

  describe("configurable limits", () => {
    it("respects custom consecutiveLossLimit", () => {
      const dd = new DrawdownCooldown({
        consecutiveLossLimit: 3,
        cooldownSizeMultiplier: 0.25,
      });
      dd.onCycleComplete(-0.10);
      dd.onCycleComplete(-0.10);
      expect(dd.isInCooldown()).toBe(false);

      dd.onCycleComplete(-0.10);
      expect(dd.isInCooldown()).toBe(true);
      expect(dd.getSizeMultiplier()).toBe(0.25);
    });

    it("respects custom cooldownSizeMultiplier", () => {
      const dd = new DrawdownCooldown({
        consecutiveLossLimit: 2,
        cooldownSizeMultiplier: 0.75,
      });
      dd.onCycleComplete(-0.10);
      dd.onCycleComplete(-0.10);
      expect(dd.getSizeMultiplier()).toBe(0.75);
    });
  });
});
