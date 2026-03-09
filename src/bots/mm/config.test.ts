// Tests for MarketMakerConfig defaults
// Verifies all stale protection fields exist with correct default values
// and that existing config fields remain unchanged.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config.js';

describe('DEFAULT_CONFIG', () => {
  // Stale protection fields
  it('includes staleThresholdMs with value 2000', () => {
    expect(DEFAULT_CONFIG.staleThresholdMs).toBe(2000);
  });

  it('includes recoveryPriceCount with value 5', () => {
    expect(DEFAULT_CONFIG.recoveryPriceCount).toBe(5);
  });

  it('includes stalePriceEnabled with value true', () => {
    expect(DEFAULT_CONFIG.stalePriceEnabled).toBe(true);
  });

  it('includes haltStaleCount with value 5', () => {
    expect(DEFAULT_CONFIG.haltStaleCount).toBe(5);
  });

  it('includes haltWindowMs with value 600000', () => {
    expect(DEFAULT_CONFIG.haltWindowMs).toBe(600_000);
  });

  // Existing fields preserved
  it('preserves existing default values', () => {
    expect(DEFAULT_CONFIG.spreadBps).toBe(8);
    expect(DEFAULT_CONFIG.takeProfitBps).toBe(0.1);
    expect(DEFAULT_CONFIG.orderSizeUsd).toBe(3000);
    expect(DEFAULT_CONFIG.closeThresholdUsd).toBe(10);
    expect(DEFAULT_CONFIG.warmupSeconds).toBe(10);
    expect(DEFAULT_CONFIG.updateThrottleMs).toBe(100);
    expect(DEFAULT_CONFIG.orderSyncIntervalMs).toBe(3000);
    expect(DEFAULT_CONFIG.statusIntervalMs).toBe(1000);
    expect(DEFAULT_CONFIG.fairPriceWindowMs).toBe(5 * 60 * 1000);
    expect(DEFAULT_CONFIG.positionSyncIntervalMs).toBe(5000);
  });
});
