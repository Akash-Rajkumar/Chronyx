import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserClockShim } from '../clockShim.js';
import type { FaultType } from '@chronyx/contracts';

describe('Browser Clock & Fault Injection Shim', () => {
  let shim: BrowserClockShim;

  beforeEach(() => {
    shim = new BrowserClockShim();
  });

  it('reports normal local time without faults', () => {
    const wallNow = Date.now();
    const nodeNow = shim.nodeNow();
    expect(Math.abs(nodeNow - wallNow)).toBeLessThan(50);
    expect(shim.getFaultOffsetMs()).toBe(0);
  });

  it('applies clock_step fault offset accurately', () => {
    const applied = shim.applyFault({
      fault_id: 'step-1',
      type: 'clock_step',
      params: { offset_ms: 500 },
    });

    expect(applied).toBe(true);
    expect(shim.getFaultOffsetMs()).toBe(500);

    const trueNow = shim.trueWallNow();
    expect(shim.nodeNow()).toBe(trueNow + 500);
  });

  it('applies clock_ramp fault using rate and acceleration formula', () => {
    const startTime = Date.now();
    const applied = shim.applyFault({
      fault_id: 'ramp-1',
      type: 'clock_ramp',
      params: {
        rate_ms_per_min: 60, // 1 ms/sec = 60 ms/min
        accel_ms_per_min2: 12,
      },
      started_at_ms: startTime,
    });

    expect(applied).toBe(true);

    // After 2 minutes (120,000 ms)
    const atTwoMin = startTime + 120_000;
    // ramp formula: rate * m + 0.5 * accel * m^2 = 60 * 2 + 0.5 * 12 * (4) = 120 + 24 = 144 ms
    const offset = shim.getFaultOffsetMs(atTwoMin);
    expect(offset).toBeCloseTo(144, 2);
  });

  it('rejects unsupported faults such as gnss_spoof or camera_delay', () => {
    const resGnss = shim.applyFault({
      fault_id: 'gnss-1',
      type: 'gnss_spoof' as unknown as FaultType,
    });
    const resCamera = shim.applyFault({
      fault_id: 'cam-1',
      type: 'camera_delay' as unknown as FaultType,
    });

    expect(resGnss).toBe(false);
    expect(resCamera).toBe(false);
    expect(shim.getActiveFaults().length).toBe(0);
  });

  it('adds noise on pingSendTimestamp and pingReceiveTimestamp when noise_burst is active', () => {
    shim.applyFault({
      fault_id: 'noise-1',
      type: 'noise_burst',
      params: { sigma_ms: 50 },
    });

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push(shim.sampleNoise());
    }

    // With sigma 50, at least some non-zero noise samples must be produced
    const nonZero = samples.filter((s) => s !== 0);
    expect(nonZero.length).toBeGreaterThan(15);
  });

  it('clears active fault and restores un-faulted offset', () => {
    shim.applyFault({
      fault_id: 'step-2',
      type: 'clock_step',
      params: { offset_ms: 250 },
    });
    expect(shim.getFaultOffsetMs()).toBe(250);

    const cleared = shim.clearFault('step-2');
    expect(cleared).toBe(true);
    expect(shim.getFaultOffsetMs()).toBe(0);
  });

  it('tracks oscillator residual discrepancy when clock fault departs from monotonic time', () => {
    shim.applyFault({
      fault_id: 'step-3',
      type: 'clock_step',
      params: { offset_ms: 100 },
    });

    const residual = shim.getOscResidualMs();
    // Residual = (nodeNow - initialWallNow) - monotonicElapsedMs ≈ 100 ms
    expect(residual).toBeGreaterThanOrEqual(95);
    expect(residual).toBeLessThanOrEqual(105);
  });
});
