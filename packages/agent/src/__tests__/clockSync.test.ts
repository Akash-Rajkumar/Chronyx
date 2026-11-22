import { describe, it, expect, beforeEach } from 'vitest';
import {
  ClockEstimator,
  validateExchangeForEstimation,
} from '../clockSync.js';
import type { Exchange } from '@chronyx/contracts';

describe('P3-T8 Clock Estimator & RTT Filtering (Requirements 1-12)', () => {
  let estimator: ClockEstimator;

  beforeEach(() => {
    estimator = new ClockEstimator();
  });

  // Req 1: Positive offset
  // node clock ahead by 50ms: t1=1050, t2=1010, t3=1015, t4=1075 -> RTT=20ms, offset=+50ms
  it('Req 1: computes positive offset accurately and corrects browser timestamp', () => {
    const ex: Exchange = { t1: 1050, t2: 1010, t3: 1015, t4: 1075 };
    const res = validateExchangeForEstimation(ex);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.rtt).toBe(20);
      expect(res.offset).toBe(50);
    }

    // Add 3 samples to achieve calibration
    estimator.addExchange(ex);
    estimator.addExchange({ t1: 2050, t2: 2010, t3: 2015, t4: 2075 });
    estimator.addExchange({ t1: 3050, t2: 3010, t3: 3015, t4: 3075 });

    expect(estimator.isCalibrated()).toBe(true);
    expect(estimator.getEstimatedOffsetMs()).toBe(50);

    // t_gateway = t_browser - peer_offset = 5000 - 50 = 4950
    const corrected = estimator.correctTimestamp(5000);
    expect(corrected).toBe(4950);
  });

  // Req 2: Negative offset
  // node clock behind by 800ms: t1=1200, t2=2010, t3=2015, t4=1225 -> RTT=20ms, offset=-800ms
  it('Req 2: computes negative offset accurately and moves timestamp forward', () => {
    const ex: Exchange = { t1: 1200, t2: 2010, t3: 2015, t4: 1225 };
    const res = validateExchangeForEstimation(ex);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.rtt).toBe(20);
      expect(res.offset).toBe(-800);
    }

    estimator.addExchange(ex);
    estimator.addExchange({ t1: 2200, t2: 3010, t3: 3015, t4: 2225 });
    estimator.addExchange({ t1: 3200, t2: 4010, t3: 4015, t4: 3225 });

    expect(estimator.isCalibrated()).toBe(true);
    expect(estimator.getEstimatedOffsetMs()).toBe(-800);

    // t_gateway = t_browser - (-800) = t_browser + 800
    const corrected = estimator.correctTimestamp(5000);
    expect(corrected).toBe(5800);
  });

  // Req 3: Zero offset
  // clocks aligned: t1=1000, t2=1010, t3=1015, t4=1025 -> RTT=20ms, offset=0ms
  it('Req 3: preserves timestamp when peer offset is zero', () => {
    const ex: Exchange = { t1: 1000, t2: 1010, t3: 1015, t4: 1025 };
    const res = validateExchangeForEstimation(ex);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.rtt).toBe(20);
      expect(res.offset).toBe(0);
    }

    estimator.addExchange(ex);
    estimator.addExchange({ t1: 2000, t2: 2010, t3: 2015, t4: 2025 });
    estimator.addExchange({ t1: 3000, t2: 3010, t3: 3015, t4: 3025 });

    expect(estimator.isCalibrated()).toBe(true);
    expect(estimator.getEstimatedOffsetMs()).toBe(0);

    const corrected = estimator.correctTimestamp(7000);
    expect(corrected).toBe(7000);
  });

  // Req 4: RTT exactly 0 ms
  it('Req 4: accepts exchange with RTT exactly 0 ms (boundary minimum)', () => {
    // t4 - t1 = 5, t3 - t2 = 5 -> RTT = 0 ms
    const ex: Exchange = { t1: 1000, t2: 2000, t3: 2005, t4: 1005 };
    const res = validateExchangeForEstimation(ex);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.rtt).toBe(0);
      expect(res.offset).toBe(-1000);
    }
  });

  // Req 5: RTT exactly 200 ms
  it('Req 5: accepts exchange with RTT exactly 200.0 ms (boundary maximum)', () => {
    // (t4 - t1) - (t3 - t2) = (1205 - 1000) - (1105 - 1100) = 205 - 5 = 200 ms
    const ex: Exchange = { t1: 1000, t2: 1100, t3: 1105, t4: 1205 };
    const res = validateExchangeForEstimation(ex);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.rtt).toBe(200);
    }
  });

  // Req 6: RTT greater than 200 ms
  it('Req 6: rejects exchanges with RTT exceeding 200 ms', () => {
    // 200.1 ms
    const exBoundary: Exchange = { t1: 1000, t2: 1100, t3: 1105, t4: 1205.1 };
    const res1 = validateExchangeForEstimation(exBoundary);
    expect(res1.valid).toBe(false);
    if (!res1.valid) {
      expect(res1.reason).toBe('RTT_EXCEEDS_THRESHOLD');
    }

    // 417.2 ms (S2 spike)
    const exSpike: Exchange = { t1: 1000, t2: 1100, t3: 1105, t4: 1422.2 };
    const res2 = validateExchangeForEstimation(exSpike);
    expect(res2.valid).toBe(false);
    if (!res2.valid) {
      expect(res2.reason).toBe('RTT_EXCEEDS_THRESHOLD');
    }
  });

  // Req 7: Negative RTT
  it('Req 7: rejects exchange with negative RTT (backward clock step during exchange)', () => {
    // t4 - t1 = 2ms, t3 - t2 = 10ms -> RTT = -8ms
    const exNegative: Exchange = { t1: 1000, t2: 1100, t3: 1110, t4: 1002 };
    const res = validateExchangeForEstimation(exNegative);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe('NEGATIVE_RTT');
    }
  });

  // Req 8: Invalid or non-finite values
  it('Req 8: rejects NaN, Infinity, and non-numeric exchange values', () => {
    const exNan: Exchange = { t1: NaN, t2: 1000, t3: 1005, t4: 1010 };
    expect(validateExchangeForEstimation(exNan).valid).toBe(false);

    const exInf: Exchange = { t1: 1000, t2: Infinity, t3: 1005, t4: 1010 };
    expect(validateExchangeForEstimation(exInf).valid).toBe(false);

    const exNull = { t1: 1000, t2: null, t3: 1005, t4: 1010 } as unknown as Exchange;
    expect(validateExchangeForEstimation(exNull).valid).toBe(false);
  });

  // Req 9: Fewer than 3 valid samples
  it('Req 9: marks estimator uncalibrated when fewer than 3 valid samples exist', () => {
    estimator.addExchange({ t1: 1000, t2: 1010, t3: 1015, t4: 1025 }); // valid 1 (rtt 20)
    expect(estimator.isCalibrated()).toBe(false);
    expect(estimator.getEstimatedOffsetMs()).toBeNull();
    expect(estimator.correctTimestamp(5000)).toBeNull();

    estimator.addExchange({ t1: 2000, t2: 2010, t3: 2015, t4: 2025 }); // valid 2 (rtt 20)
    expect(estimator.isCalibrated()).toBe(false);
    expect(estimator.getEstimatedOffsetMs()).toBeNull();

    // Adding an invalid sample (RTT = 300 ms) does not advance valid count
    estimator.addExchange({ t1: 3000, t2: 3005, t3: 3010, t4: 3305 });
    expect(estimator.getState().validSamplesInWindow).toBe(2);
    expect(estimator.isCalibrated()).toBe(false);
  });

  // Req 10: Exactly 3 valid samples
  it('Req 10: transitions to calibrated upon receiving exactly 3 valid samples', () => {
    estimator.addExchange({ t1: 1000, t2: 1010, t3: 1015, t4: 1025 }); // valid 1
    estimator.addExchange({ t1: 2000, t2: 2010, t3: 2015, t4: 2025 }); // valid 2
    expect(estimator.isCalibrated()).toBe(false);

    estimator.addExchange({ t1: 3000, t2: 3010, t3: 3015, t4: 3025 }); // valid 3
    expect(estimator.isCalibrated()).toBe(true);
    expect(estimator.getEstimatedOffsetMs()).toBe(0);
    expect(estimator.getMinRttMs()).toBe(20);
    expect(estimator.correctTimestamp(6000)).toBe(6000);
  });

  // Req 11: Minimum-RTT selection across eight exchanges
  it('Req 11: selects the sample with minimum RTT among valid exchanges in window', () => {
    // 8 exchanges with varying RTTs and offsets:
    estimator.addExchange({ t1: 100, t2: 110, t3: 115, t4: 145 }); // RTT = 45-5 = 40, offset = -5
    estimator.addExchange({ t1: 200, t2: 210, t3: 215, t4: 235 }); // RTT = 35-5 = 30, offset = -5
    estimator.addExchange({ t1: 300, t2: 310, t3: 315, t4: 325 }); // RTT = 25-5 = 20, offset = -5
    estimator.addExchange({ t1: 400, t2: 410, t3: 415, t4: 423 }); // RTT = 23-5 = 18, offset = -6
    estimator.addExchange({ t1: 500, t2: 510, t3: 515, t4: 521 }); // RTT = 21-5 = 16, offset = -7
    estimator.addExchange({ t1: 600, t2: 610, t3: 615, t4: 617 }); // RTT = 17-5 = 12, offset = ((600-610)+(617-615))/2 = (-10+2)/2 = -4 (MIN RTT!)
    estimator.addExchange({ t1: 700, t2: 710, t3: 715, t4: 730 }); // RTT = 30-5 = 25, offset = -5
    estimator.addExchange({ t1: 800, t2: 810, t3: 815, t4: 855 }); // RTT = 55-5 = 50, offset = -5

    expect(estimator.getState().totalSamplesInWindow).toBe(8);
    expect(estimator.getState().validSamplesInWindow).toBe(8);
    expect(estimator.getMinRttMs()).toBe(12);
    expect(estimator.getEstimatedOffsetMs()).toBe(-4);
  });

  // Req 12: Rolling-window updates and loss of calibration
  it('Req 12: rolling window drops old samples and transitions back to uncalibrated when valid count drops below 3', () => {
    // Fill window with 3 valid samples
    estimator.addExchange({ t1: 100, t2: 110, t3: 115, t4: 135 }); // valid 1
    estimator.addExchange({ t1: 200, t2: 210, t3: 215, t4: 235 }); // valid 2
    estimator.addExchange({ t1: 300, t2: 310, t3: 315, t4: 335 }); // valid 3
    expect(estimator.isCalibrated()).toBe(true);

    // Push 6 invalid samples (RTT > 200 ms) into the window
    for (let i = 0; i < 6; i++) {
      estimator.addExchange({ t1: 1000 + i * 100, t2: 1005 + i * 100, t3: 1010 + i * 100, t4: 1350 + i * 100 });
    }

    // Window capacity is 8: the first 2 valid samples were evicted!
    // Remaining in window: 1 valid sample + 6 invalid samples = 7 total, 1 valid.
    expect(estimator.getState().totalSamplesInWindow).toBe(8);
    expect(estimator.getState().validSamplesInWindow).toBe(2); // exactly 2 valid left
    expect(estimator.isCalibrated()).toBe(false); // < 3 valid -> uncalibrated!

    // Push 1 more invalid sample: evicts the 3rd valid sample completely
    estimator.addExchange({ t1: 2000, t2: 2005, t3: 2010, t4: 2350 });
    expect(estimator.getState().validSamplesInWindow).toBe(1);
    expect(estimator.isCalibrated()).toBe(false);
    expect(estimator.getEstimatedOffsetMs()).toBeNull();
  });
});
