import type { Exchange } from '@chronyx/contracts';

export interface ValidExchangeSample {
  exchange: Exchange;
  rtt: number;
  offset: number;
}

export interface ClockEstimatorState {
  isCalibrated: boolean;
  estimatedOffsetMs: number | null;
  minRttMs: number | null;
  totalSamplesInWindow: number;
  validSamplesInWindow: number;
}

/**
 * Validates whether an exchange is valid for clock offset estimation.
 * Rules:
 * - All four timestamps (t1, t2, t3, t4) must be finite numbers.
 * - Computed RTT must be finite.
 * - RTT must be between 0 and 200 ms inclusive (0 <= RTT <= 200).
 * - Computed offset must be finite.
 */
export function validateExchangeForEstimation(
  ex: Exchange,
): { valid: true; rtt: number; offset: number } | { valid: false; reason: string } {
  if (
    typeof ex.t1 !== 'number' ||
    !Number.isFinite(ex.t1) ||
    typeof ex.t2 !== 'number' ||
    !Number.isFinite(ex.t2) ||
    typeof ex.t3 !== 'number' ||
    !Number.isFinite(ex.t3) ||
    typeof ex.t4 !== 'number' ||
    !Number.isFinite(ex.t4)
  ) {
    return { valid: false, reason: 'NON_FINITE_TIMESTAMPS' };
  }

  const rtt = (ex.t4 - ex.t1) - (ex.t3 - ex.t2);
  if (!Number.isFinite(rtt)) {
    return { valid: false, reason: 'NON_FINITE_RTT' };
  }

  if (rtt < 0) {
    return { valid: false, reason: 'NEGATIVE_RTT' };
  }

  if (rtt > 200) {
    return { valid: false, reason: 'RTT_EXCEEDS_THRESHOLD' };
  }

  const offset = ((ex.t1 - ex.t2) + (ex.t4 - ex.t3)) / 2;
  if (!Number.isFinite(offset)) {
    return { valid: false, reason: 'NON_FINITE_OFFSET' };
  }

  return { valid: true, rtt, offset };
}

/**
 * ClockEstimator implements local clock offset estimation using a rolling window
 * of the latest 8 raw two-way time ping exchanges.
 *
 * It filters exchanges for estimation purposes (0 <= RTT <= 200 ms), requires at least
 * 3 valid samples to achieve calibration, and selects the minimum-RTT sample's offset.
 *
 * Sign convention:
 *   peer_offset_ms = node clock - hub clock
 *
 * Gateway-aligned timestamp:
 *   t_gateway = t_browser - peer_offset_ms
 */
export class ClockEstimator {
  private readonly maxWindowSize = 8;
  private readonly minValidSamples = 3;
  private rawExchanges: Exchange[] = [];

  private isCalibratedState = false;
  private estimatedOffset: number | null = null;
  private minRtt: number | null = null;
  private validCount = 0;

  /**
   * Adds a new exchange to the rolling window of the latest 8 exchanges,
   * keeping original arrival order, and recalculates the clock estimate.
   */
  public addExchange(exchange: Exchange): void {
    this.rawExchanges = [...this.rawExchanges, exchange].slice(-this.maxWindowSize);
    this.recalculate();
  }

  /**
   * Recalculates the clock offset estimate across the current rolling window.
   */
  public recalculate(): void {
    const validSamples: ValidExchangeSample[] = [];

    for (const ex of this.rawExchanges) {
      const res = validateExchangeForEstimation(ex);
      if (res.valid) {
        validSamples.push({
          exchange: ex,
          rtt: res.rtt,
          offset: res.offset,
        });
      }
    }

    this.validCount = validSamples.length;

    if (validSamples.length < this.minValidSamples) {
      this.isCalibratedState = false;
      this.estimatedOffset = null;
      this.minRtt = null;
      return;
    }

    // Select valid sample with minimum RTT
    let best = validSamples[0]!;
    for (let i = 1; i < validSamples.length; i++) {
      const candidate = validSamples[i]!;
      if (candidate.rtt < best.rtt) {
        best = candidate;
      }
    }

    this.isCalibratedState = true;
    this.estimatedOffset = best.offset;
    this.minRtt = best.rtt;
  }

  /**
   * Whether the clock estimator is currently calibrated (>= 3 valid samples in window).
   */
  public isCalibrated(): boolean {
    return this.isCalibratedState;
  }

  /**
   * Current estimated clock offset (node minus hub clock), or null if uncalibrated.
   */
  public getEstimatedOffsetMs(): number | null {
    return this.estimatedOffset;
  }

  /**
   * Current minimum RTT among valid samples in the window, or null if uncalibrated.
   */
  public getMinRttMs(): number | null {
    return this.minRtt;
  }

  /**
   * Corrects a local browser timestamp to Gateway-aligned true time using the current calibrated offset:
   *   t_gateway = t_browser - peer_offset_ms
   *
   * Returns null if the clock is uncalibrated.
   */
  public correctTimestamp(browserTimestampMs: number): number | null {
    if (!this.isCalibratedState || this.estimatedOffset === null) {
      return null;
    }
    return browserTimestampMs - this.estimatedOffset;
  }

  /**
   * Returns all raw exchanges currently in the rolling window (up to 8), in original order.
   * This is used for heartbeat transport so raw exchanges are never filtered from protocol.
   */
  public getRawExchanges(): Exchange[] {
    return [...this.rawExchanges];
  }

  /**
   * Returns current internal state snapshot.
   */
  public getState(): ClockEstimatorState {
    return {
      isCalibrated: this.isCalibratedState,
      estimatedOffsetMs: this.estimatedOffset,
      minRttMs: this.minRtt,
      totalSamplesInWindow: this.rawExchanges.length,
      validSamplesInWindow: this.validCount,
    };
  }

  /**
   * Clears the rolling window and resets calibration state.
   */
  public reset(): void {
    this.rawExchanges = [];
    this.isCalibratedState = false;
    this.estimatedOffset = null;
    this.minRtt = null;
    this.validCount = 0;
  }
}
