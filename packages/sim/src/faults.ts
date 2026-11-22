import type { Fault } from '@chronyx/contracts';

/**
 * Ramp offset in milliseconds.
 * m is minutes since started_at_ms.
 * offset(m) = rate_ms_per_min * m + 0.5 * accel_ms_per_min2 * m^2
 */
function clockRampOffsetMs(elapsedMs: number, rateMsPerMin: number, accelMsPerMin2: number): number {
  if (elapsedMs <= 0) return 0;
  const minutes = elapsedMs / 60_000;
  return rateMsPerMin * minutes + 0.5 * accelMsPerMin2 * minutes * minutes;
}

/** Authoritative cutoff. ends_at_ms wins; otherwise a finite duration_s; otherwise none. */
export function faultCutoffMs(fault: Fault): number | null {
  if (fault.ends_at_ms != null) return fault.ends_at_ms;
  const durationS = fault.params.duration_s;
  if (typeof durationS === 'number' && Number.isFinite(durationS)) {
    return fault.started_at_ms + durationS * 1000;
  }
  return null;
}

function faultIsActive(fault: Fault, nowMs: number): boolean {
  if (fault.applies_to !== 'sim') return false;
  if (fault.status !== 'active') return false;
  if (nowMs < fault.started_at_ms) return false;
  const cutoff = faultCutoffMs(fault);
  if (cutoff != null && nowMs >= cutoff) return false;
  return true;
}

/** Node clock follows a GNSS spoof this long after the spoofed ramp. */
export const GNSS_SPOOF_LAG_MS = 30_000;
export const GNSS_SPOOF_CN0_DELTA_DBHZ = 4;
export const GNSS_SPOOF_AGC_DELTA_DB = -2;

export interface GnssSpoofHealthDelta {
  cn0Dbhz: number;
  agcDb: number;
}

export interface NoiseBurstStreamsMs {
  peer: number;
  oscillator: number;
  gnss: number;
  camera: number;
}

function rampOffsetMs(fault: Fault, elapsedMs: number): number {
  return clockRampOffsetMs(
    elapsedMs,
    fault.params.rate_ms_per_min ?? 0,
    fault.params.accel_ms_per_min2 ?? 0,
  );
}

/** Spoofed GNSS time offset. Uses the clock-ramp formula. Inactive faults return 0. */
export function gnssSpoofOffsetMs(fault: Fault, nowMs: number): number {
  if (fault.type !== 'gnss_spoof' || !faultIsActive(fault, nowMs)) return 0;
  return rampOffsetMs(fault, nowMs - fault.started_at_ms);
}

/**
 * Clock error induced by a GNSS spoof: the spoof ramp delayed by 30 seconds.
 * This is the peer-visible drift. It does not include the current spoof offset.
 */
export function gnssClockFollowMs(fault: Fault, nowMs: number): number {
  if (fault.type !== 'gnss_spoof' || !faultIsActive(fault, nowMs)) return 0;
  return rampOffsetMs(fault, nowMs - fault.started_at_ms - GNSS_SPOOF_LAG_MS);
}

/** C/N0 and AGC shift while a GNSS spoof is active. Both are zero otherwise. */
export function gnssSpoofHealthDelta(fault: Fault, nowMs: number): GnssSpoofHealthDelta {
  if (fault.type !== 'gnss_spoof' || !faultIsActive(fault, nowMs)) {
    return { cn0Dbhz: 0, agcDb: 0 };
  }
  return { cn0Dbhz: GNSS_SPOOF_CN0_DELTA_DBHZ, agcDb: GNSS_SPOOF_AGC_DELTA_DB };
}

/** Camera-trigger delay. Does not contribute to the node clock. */
export function cameraDelayMs(fault: Fault, nowMs: number): number {
  if (fault.type !== 'camera_delay' || !faultIsActive(fault, nowMs)) return 0;
  return fault.params.offset_ms ?? 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller. Always consumes two uniform draws. */
function unitGaussian(next: () => number): number {
  const u1 = Math.max(next(), 1e-12);
  const u2 = next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Deterministic uniform source for a noise burst. Same seed, same sequence. */
export function createFaultRng(seed: number): () => number {
  return mulberry32(seed);
}

/**
 * One N(0, noise_sigma_ms) draw while the burst is active.
 * Inactive faults return 0 and do not consume the generator.
 */
export function noiseBurstDrawMs(fault: Fault, nowMs: number, next: () => number): number {
  if (fault.type !== 'noise_burst' || !faultIsActive(fault, nowMs)) return 0;
  return unitGaussian(next) * (fault.params.noise_sigma_ms ?? 0);
}

/** Peer, oscillator, GNSS, then camera. Draws only while the burst is active. */
export function noiseBurstStreamsMs(fault: Fault, nowMs: number, next: () => number): NoiseBurstStreamsMs {
  return {
    peer: noiseBurstDrawMs(fault, nowMs, next),
    oscillator: noiseBurstDrawMs(fault, nowMs, next),
    gnss: noiseBurstDrawMs(fault, nowMs, next),
    camera: noiseBurstDrawMs(fault, nowMs, next),
  };
}

/** Injected clock offset for one fault. Inactive faults contribute 0. Does not mutate the fault. */
export function faultContributionMs(fault: Fault, nowMs: number): number {
  if (!faultIsActive(fault, nowMs)) return 0;
  const elapsedMs = nowMs - fault.started_at_ms;
  if (fault.type === 'clock_step') {
    return fault.params.offset_ms ?? 0;
  }
  if (fault.type === 'clock_ramp') {
    return rampOffsetMs(fault, elapsedMs);
  }
  if (fault.type === 'gnss_spoof') {
    return gnssClockFollowMs(fault, nowMs);
  }
  return 0;
}
