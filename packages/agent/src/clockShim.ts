import type { FaultType } from '@chronyx/contracts';

export interface ActiveFault {
  fault_id: string;
  type: FaultType;
  params: {
    offset_ms?: number;
    rate_ms_per_min?: number;
    accel_ms_per_min2?: number;
    sigma_ms?: number;
    noise_sigma_ms?: number;
    [key: string]: unknown;
  };
  started_at_ms: number;
}

/**
 * Box-Muller standard normal transform.
 */
function sampleGaussian(sigma: number): number {
  if (sigma <= 0) return 0;
  let u1 = 0;
  let u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * sigma;
}

/**
 * Isolated browser clock and fault injection shim.
 * Does not mutate system wall clock.
 */
export class BrowserClockShim {
  private initialPerfNow: number;
  private initialWallNow: number;
  private activeFaults: Map<string, ActiveFault> = new Map();

  constructor() {
    this.initialPerfNow = typeof performance !== 'undefined' ? performance.now() : 0;
    this.initialWallNow = Date.now();
  }

  /**
   * Applies an incoming fault specification from the Gateway.
   * Only clock_step, clock_ramp, and noise_burst are accepted.
   */
  public applyFault(fault: {
    fault_id: string;
    type: FaultType;
    params?: Record<string, unknown>;
    started_at_ms?: number;
  }): boolean {
    if (
      fault.type !== 'clock_step' &&
      fault.type !== 'clock_ramp' &&
      fault.type !== 'noise_burst'
    ) {
      // Unsupported browser fault (e.g. gnss_spoof, camera_delay)
      return false;
    }

    this.activeFaults.set(fault.fault_id, {
      fault_id: fault.fault_id,
      type: fault.type,
      params: (fault.params as ActiveFault['params']) || {},
      started_at_ms: fault.started_at_ms ?? this.trueWallNow(),
    });

    return true;
  }

  /**
   * Clears a fault by id.
   */
  public clearFault(fault_id: string): boolean {
    return this.activeFaults.delete(fault_id);
  }

  /**
   * Clears all active faults.
   */
  public clearAllFaults(): void {
    this.activeFaults.clear();
  }

  /**
   * Returns list of currently active faults.
   */
  public getActiveFaults(): ActiveFault[] {
    return Array.from(this.activeFaults.values());
  }

  /**
   * True un-faulted browser wall clock time in milliseconds.
   */
  public trueWallNow(): number {
    return Date.now();
  }

  /**
   * True monotonic time delta in milliseconds since shim creation.
   */
  public monotonicElapsedMs(): number {
    const currentPerf = typeof performance !== 'undefined' ? performance.now() : 0;
    return currentPerf - this.initialPerfNow;
  }

  /**
   * Computes clock fault offset (step + ramp) at the given time.
   */
  public getFaultOffsetMs(atWallTimeMs: number = this.trueWallNow()): number {
    let offset = 0;

    for (const fault of this.activeFaults.values()) {
      if (fault.type === 'clock_step') {
        offset += fault.params.offset_ms ?? 0;
      } else if (fault.type === 'clock_ramp') {
        const elapsedMinutes = Math.max(0, atWallTimeMs - fault.started_at_ms) / 60000;
        const rate = fault.params.rate_ms_per_min ?? 0;
        const accel = fault.params.accel_ms_per_min2 ?? 0;
        const rampOffset = rate * elapsedMinutes + 0.5 * accel * elapsedMinutes * elapsedMinutes;
        offset += rampOffset;
      }
    }

    return offset;
  }

  /**
   * Returns local node clock in milliseconds, reflecting any active clock_step or clock_ramp.
   */
  public nodeNow(): number {
    const trueNow = this.trueWallNow();
    return trueNow + this.getFaultOffsetMs(trueNow);
  }

  /**
   * Returns noise sample in milliseconds if noise_burst is active, otherwise 0.
   */
  public sampleNoise(): number {
    let noise = 0;
    for (const fault of this.activeFaults.values()) {
      if (fault.type === 'noise_burst') {
        const sigma = fault.params.sigma_ms ?? fault.params.noise_sigma_ms ?? 0;
        noise += sampleGaussian(sigma);
      }
    }
    return noise;
  }

  /**
   * Timestamp for exchange send (t1), applying noise if active.
   */
  public pingSendTimestamp(): number {
    return this.nodeNow() + this.sampleNoise();
  }

  /**
   * Timestamp for exchange receive (t4), applying noise if active.
   */
  public pingReceiveTimestamp(): number {
    return this.nodeNow() + this.sampleNoise();
  }

  /**
   * Cumulative (nodeNow delta) minus (performance.now delta) since agent start.
   */
  public getOscResidualMs(): number {
    const nodeDelta = this.nodeNow() - this.initialWallNow;
    const perfDelta = this.monotonicElapsedMs();
    return nodeDelta - perfDelta;
  }
}
