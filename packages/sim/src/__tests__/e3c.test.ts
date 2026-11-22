// TEST-FIXTURE
import { describe, expect, it } from 'vitest';
import type { Fault } from '@chronyx/contracts';
import {
  cameraDelayMs,
  createFaultRng,
  faultContributionMs,
  gnssClockFollowMs,
  gnssSpoofHealthDelta,
  gnssSpoofOffsetMs,
  noiseBurstStreamsMs,
} from '../faults.js';

const START = 1_000_000;
const RATE = 0.5;
const ACCEL = 0.1;

function fault(fields: Pick<Fault, 'type' | 'params'> & Partial<Fault>): Fault {
  return {
    id: '10000000-0000-4000-8000-0000000000bb',
    node_id: '11111111-1111-4111-8111-111111111111',
    started_at_ms: START,
    ends_at_ms: null,
    status: 'active',
    applies_to: 'sim',
    detected_at_ms: null,
    error_at_detect_ms: null,
    detection_latency_s: null,
    ...fields,
  };
}

function rampMs(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const minutes = elapsedMs / 60_000;
  return RATE * minutes + 0.5 * ACCEL * minutes * minutes;
}

function spoof(): Fault {
  return fault({
    type: 'gnss_spoof',
    params: { rate_ms_per_min: RATE, accel_ms_per_min2: ACCEL },
  });
}

describe('gnss spoof', () => {
  it('follows the ramp and lags the node clock by 30 seconds', () => {
    const faultSpec = spoof();
    const before = START - 1;
    const early = START + 20_000;
    const lagged = START + 90_000;

    expect(gnssSpoofOffsetMs(faultSpec, before)).toBe(0);
    expect(gnssClockFollowMs(faultSpec, before)).toBe(0);
    expect(faultContributionMs(faultSpec, before)).toBe(0);

    expect(gnssSpoofOffsetMs(faultSpec, early)).toBeCloseTo(rampMs(20_000), 12);
    expect(gnssClockFollowMs(faultSpec, early)).toBe(0);
    expect(faultContributionMs(faultSpec, early)).toBe(0);

    expect(gnssSpoofOffsetMs(faultSpec, lagged)).toBeCloseTo(rampMs(90_000), 12);
    expect(gnssClockFollowMs(faultSpec, lagged)).toBeCloseTo(rampMs(60_000), 12);
    expect(faultContributionMs(faultSpec, lagged)).toBeCloseTo(rampMs(60_000), 12);
    expect(faultSpec.status).toBe('active');
  });

  it('keeps the GNSS residual free of the spoof while the peer clock drifts', () => {
    const faultSpec = spoof();
    const at = START + 120_000;
    const peerDrift = faultContributionMs(faultSpec, at);
    const spoofOffset = gnssSpoofOffsetMs(faultSpec, at);
    expect(peerDrift).toBeCloseTo(rampMs(90_000), 12);
    expect(spoofOffset).toBeGreaterThan(peerDrift);
    expect(peerDrift - gnssClockFollowMs(faultSpec, at)).toBe(0);
  });

  it('raises C/N0 by 4 dB-Hz and lowers AGC by 2 dB only while active', () => {
    const faultSpec = spoof();
    const cutoff = START + 10_000;
    faultSpec.ends_at_ms = cutoff;
    expect(gnssSpoofHealthDelta(faultSpec, START - 1)).toEqual({ cn0Dbhz: 0, agcDb: 0 });
    expect(gnssSpoofHealthDelta(faultSpec, START + 1_000)).toEqual({ cn0Dbhz: 4, agcDb: -2 });
    expect(gnssSpoofHealthDelta(faultSpec, cutoff)).toEqual({ cn0Dbhz: 0, agcDb: 0 });
    expect(gnssSpoofOffsetMs(faultSpec, cutoff)).toBe(0);
  });

  it('ignores an agent_shim spoof', () => {
    const faultSpec = spoof();
    faultSpec.applies_to = 'agent_shim';
    const at = START + 120_000;
    expect(gnssSpoofOffsetMs(faultSpec, at)).toBe(0);
    expect(faultContributionMs(faultSpec, at)).toBe(0);
    expect(gnssSpoofHealthDelta(faultSpec, at)).toEqual({ cn0Dbhz: 0, agcDb: 0 });
  });
});

describe('camera delay', () => {
  it('adds offset_ms only to the camera residual', () => {
    const delay = fault({ type: 'camera_delay', params: { offset_ms: 12 } });
    expect(cameraDelayMs(delay, START - 1)).toBe(0);
    expect(cameraDelayMs(delay, START + 1_000)).toBe(12);
    expect(faultContributionMs(delay, START + 1_000)).toBe(0);
    expect(gnssSpoofHealthDelta(delay, START + 1_000)).toEqual({ cn0Dbhz: 0, agcDb: 0 });
    delay.ends_at_ms = START + 5_000;
    expect(cameraDelayMs(delay, START + 5_000)).toBe(0);
    expect(delay.status).toBe('active');
  });
});

describe('noise burst', () => {
  const sigma = 0.8;

  function burst(extra: Partial<Fault> = {}): Fault {
    return fault({
      type: 'noise_burst',
      params: { noise_sigma_ms: sigma, duration_s: 5 },
      ...extra,
    });
  }

  it('repeats for the same seed and diverges for another seed', () => {
    const spec = burst();
    const at = START + 1_000;
    const first = [0, 1, 2].map(() => noiseBurstStreamsMs(spec, at, createFaultRng(11)));
    const second = [0, 1, 2].map(() => noiseBurstStreamsMs(spec, at, createFaultRng(11)));
    expect(second).toEqual(first);
    const other = noiseBurstStreamsMs(spec, at, createFaultRng(12));
    expect(other).not.toEqual(first[0]);
  });

  it('adds a draw to each timing stream and stops at the cutoff without consuming entropy', () => {
    const spec = burst();
    const at = START + 1_000;
    const streams = noiseBurstStreamsMs(spec, at, createFaultRng(3));
    expect(streams.peer).not.toBe(0);
    expect(streams.oscillator).not.toBe(0);
    expect(streams.gnss).not.toBe(0);
    expect(streams.camera).not.toBe(0);

    const cutoff = START + 5_000;
    const quiet = createFaultRng(21);
    const control = createFaultRng(21);
    expect(noiseBurstStreamsMs(spec, cutoff, quiet)).toEqual({
      peer: 0,
      oscillator: 0,
      gnss: 0,
      camera: 0,
    });
    expect(noiseBurstStreamsMs(spec, at, quiet)).toEqual(noiseBurstStreamsMs(spec, at, control));
    expect(faultContributionMs(spec, at)).toBe(0);
  });

  it('matches noise_sigma_ms across a large deterministic sample', () => {
    const spec = burst();
    const at = START + 1_000;
    const next = createFaultRng(99);
    const columns = { peer: [] as number[], oscillator: [] as number[], gnss: [] as number[], camera: [] as number[] };
    for (let i = 0; i < 4_000; i += 1) {
      const sample = noiseBurstStreamsMs(spec, at, next);
      columns.peer.push(sample.peer);
      columns.oscillator.push(sample.oscillator);
      columns.gnss.push(sample.gnss);
      columns.camera.push(sample.camera);
    }
    for (const values of Object.values(columns)) {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      expect(Math.abs(mean)).toBeLessThan(0.05);
      expect(Math.sqrt(variance)).toBeCloseTo(sigma, 1);
    }
  });
});
