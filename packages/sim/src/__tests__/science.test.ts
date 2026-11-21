// TEST-FIXTURE
import { describe, expect, it } from 'vitest';
import { SCIENCE_DEFAULTS } from '@chronyx/contracts';
import { replayScience, scienceTrial } from '../science.js';
import type { ScienceReplayOptions } from '../science.js';

const BASE: ScienceReplayOptions = {
  fault_ms: 10,
  faulty_station: 5,
  dropFaulty: false,
  trials: 200,
  seed: 42,
};

describe('science replay', () => {
  it('repeats exactly when the seed is the same', () => {
    const first = replayScience(BASE);
    const second = replayScience(BASE);
    expect(second).toEqual(first);
  });

  it('runs 200 trials and injects a 10 ms chord shift', () => {
    const result = replayScience({ ...BASE, trials: 1, dropFaulty: false });
    expect(result.trials).toBe(1);
    const full = replayScience(BASE);
    expect(full.trials).toBe(200);
    const station = result.stations[5];
    expect(station?.faulty).toBe(true);
    expect(station?.dropped).toBe(false);
    const chord = station?.chord_x_m;
    expect(chord).not.toBeNull();
    if (!chord) return;
    const midpoint = (chord[0] + chord[1]) / 2;
    const shiftM = 10 * SCIENCE_DEFAULTS.shadow_speed_kms;
    expect(Math.abs(midpoint - shiftM)).toBeLessThan(30);
  });

  it('drops the faulty station only when quarantine is enabled', () => {
    const kept = scienceTrial({ ...BASE, dropFaulty: false }, 0);
    const dropped = scienceTrial({ ...BASE, dropFaulty: true }, 0);
    expect(kept.stations[5]?.chord_x_m).not.toBeNull();
    expect(dropped.stations[5]?.dropped).toBe(true);
    expect(dropped.stations[5]?.chord_x_m).toBeNull();
    expect(dropped.stations[0]?.chord_x_m).toEqual(kept.stations[0]?.chord_x_m);
  });

  it('computes mean size error as the average of the trial errors', () => {
    const options = { ...BASE, trials: 5 };
    const result = replayScience(options);
    let total = 0;
    for (let trial = 0; trial < options.trials; trial += 1) {
      const one = scienceTrial(options, trial);
      total += (Math.abs(one.fitted.a - result.truth.a) / result.truth.a) * 100;
    }
    expect(result.size_error_pct).toBeCloseTo(scienceTrial(options, 0).sizeErrorPct, 9);
    expect(result.mean_size_error_pct).toBeCloseTo(total / options.trials, 9);
    expect(result.params).toEqual({
      shadow_speed_kms: 20,
      sigma_t_ms: 0.2,
      body_a_m: 250,
      body_b_m: 150,
    });
  });

  it('keeps baseline mean size error above 10% and quarantined mean size error below 3%', () => {
    const baseline = replayScience({ ...BASE, dropFaulty: false });
    const chronyx = replayScience({ ...BASE, dropFaulty: true });
    expect(baseline.mean_size_error_pct).toBeGreaterThan(10);
    expect(chronyx.mean_size_error_pct).toBeLessThan(3);
  });
});
