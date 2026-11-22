import type { Ellipse, ScienceReplayRes, ScienceStation } from '@chronyx/contracts';
import { SCIENCE_DEFAULTS } from '@chronyx/contracts';

/** 20 km/s is 20 m of along-track position for each millisecond of timing error. */
const METERS_PER_MS = SCIENCE_DEFAULTS.shadow_speed_kms;
const FIT_ITERATIONS = 30;

export interface ScienceReplayOptions {
  fault_ms: number;
  faulty_station: number;
  dropFaulty: boolean;
  trials: number;
  seed: number;
}

interface TrialResult {
  stations: ScienceStation[];
  fitted: Ellipse;
  sizeErrorPct: number;
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

function unitGaussian(next: () => number): number {
  const u1 = Math.max(next(), 1e-12);
  const u2 = next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function trialSeed(seed: number, trial: number): number {
  return (Math.imul(seed ^ trial, 0x9e3779b1) + trial) >>> 0;
}

function halfChordM(yM: number): number {
  const { a, b } = SCIENCE_DEFAULTS.body;
  const ratio = yM / b;
  return a * Math.sqrt(Math.max(0, 1 - ratio * ratio));
}

function solve4(matrix: number[][], rhs: number[]): number[] | null {
  const width = 4;
  const rows = matrix.map((row, index) => [...row, rhs[index] ?? 0]);
  for (let col = 0; col < width; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < width; row += 1) {
      if (Math.abs(rows[row]?.[col] ?? 0) > Math.abs(rows[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = rows[pivot];
    const current = rows[col];
    if (!pivotRow || !current) return null;
    rows[col] = pivotRow;
    rows[pivot] = current;
    const scale = rows[col]?.[col] ?? 0;
    if (Math.abs(scale) < 1e-12) return null;
    for (let colIndex = col; colIndex <= width; colIndex += 1) {
      const row = rows[col];
      if (!row) return null;
      row[colIndex] = (row[colIndex] ?? 0) / scale;
    }
    for (let rowIndex = 0; rowIndex < width; rowIndex += 1) {
      if (rowIndex === col) continue;
      const factor = rows[rowIndex]?.[col] ?? 0;
      for (let colIndex = col; colIndex <= width; colIndex += 1) {
        const row = rows[rowIndex];
        const source = rows[col];
        if (!row || !source) return null;
        row[colIndex] = (row[colIndex] ?? 0) - factor * (source[colIndex] ?? 0);
      }
    }
  }
  return [0, 1, 2, 3].map((index) => rows[index]?.[width] ?? 0);
}

/** Axis-aligned ellipse ((x-x0)/a)^2 + ((y-y0)/b)^2 = 1, fit to limb points. */
export function fitAxisAlignedEllipse(points: ReadonlyArray<readonly [number, number]>): Ellipse {
  if (points.length < 4) throw new Error('Ellipse fit needs at least four limb points');
  let x0 = 0;
  let y0 = 0;
  let a = SCIENCE_DEFAULTS.body.a;
  let b = SCIENCE_DEFAULTS.body.b;
  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration += 1) {
    const normal = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const right = [0, 0, 0, 0];
    for (const [x, y] of points) {
      const dx = x - x0;
      const dy = y - y0;
      const residual = (dx / a) ** 2 + (dy / b) ** 2 - 1;
      const jacobian = [
        (-2 * dx) / (a * a),
        (-2 * dy) / (b * b),
        (-2 * dx * dx) / a ** 3,
        (-2 * dy * dy) / b ** 3,
      ];
      for (let row = 0; row < 4; row += 1) {
        right[row] = (right[row] ?? 0) + (jacobian[row] ?? 0) * residual;
        const normalRow = normal[row];
        if (!normalRow) continue;
        for (let col = 0; col < 4; col += 1) {
          normalRow[col] = (normalRow[col] ?? 0) + (jacobian[row] ?? 0) * (jacobian[col] ?? 0);
        }
      }
    }
    const step = solve4(normal, right);
    if (!step) break;
    x0 -= step[0] ?? 0;
    y0 -= step[1] ?? 0;
    a = Math.max(1, a - (step[2] ?? 0));
    b = Math.max(1, b - (step[3] ?? 0));
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error('Ellipse fit failed');
  }
  return { x0, y0, a, b };
}

function sizeErrorPct(fitted: Ellipse): number {
  return (Math.abs(fitted.a - SCIENCE_DEFAULTS.body.a) / SCIENCE_DEFAULTS.body.a) * 100;
}

export function scienceTrial(options: ScienceReplayOptions, trial: number): TrialResult {
  const stationsY = SCIENCE_DEFAULTS.stations_y;
  if (options.faulty_station < 0 || options.faulty_station >= stationsY.length) {
    throw new Error(`faulty_station must be 0..${stationsY.length - 1}`);
  }
  const next = mulberry32(trialSeed(options.seed, trial));
  const shiftM =
    options.dropFaulty ? 0 : options.fault_ms * METERS_PER_MS;
  const points: Array<[number, number]> = [];
  const stations: ScienceStation[] = stationsY.map((yM, index) => {
    const half = halfChordM(yM);
    const ingressNoise = unitGaussian(next) * SCIENCE_DEFAULTS.sigma_t_ms * METERS_PER_MS;
    const egressNoise = unitGaussian(next) * SCIENCE_DEFAULTS.sigma_t_ms * METERS_PER_MS;
    const faulty = index === options.faulty_station;
    const dropped = faulty && options.dropFaulty;
    if (dropped) {
      return { idx: index, y_m: yM, chord_x_m: null, faulty, dropped: true };
    }
    const bias = faulty ? shiftM : 0;
    const chord: [number, number] = [-half + bias + ingressNoise, half + bias + egressNoise];
    points.push([chord[0], yM], [chord[1], yM]);
    return { idx: index, y_m: yM, chord_x_m: chord, faulty, dropped: false };
  });
  const fitted = fitAxisAlignedEllipse(points);
  return { stations, fitted, sizeErrorPct: sizeErrorPct(fitted) };
}

/**
 * Occultation replay. A station clock error shifts both chord ends by
 * fault_ms * shadow speed. Quarantine removes that station before the fit.
 * Size error is the relative error of the fitted along-track semi-axis.
 */
export function replayScience(options: ScienceReplayOptions): ScienceReplayRes {
  if (!Number.isInteger(options.trials) || options.trials < 1) {
    throw new Error('trials must be a positive integer');
  }
  let total = 0;
  let first: TrialResult | null = null;
  for (let trial = 0; trial < options.trials; trial += 1) {
    const result = scienceTrial(options, trial);
    if (!first) first = result;
    total += result.sizeErrorPct;
  }
  if (!first) throw new Error('Science replay produced no trials');
  return {
    truth: { x0: 0, y0: 0, a: SCIENCE_DEFAULTS.body.a, b: SCIENCE_DEFAULTS.body.b },
    stations: first.stations,
    fitted: first.fitted,
    size_error_pct: first.sizeErrorPct,
    mean_size_error_pct: total / options.trials,
    trials: options.trials,
    params: {
      shadow_speed_kms: SCIENCE_DEFAULTS.shadow_speed_kms,
      sigma_t_ms: SCIENCE_DEFAULTS.sigma_t_ms,
      body_a_m: SCIENCE_DEFAULTS.body.a,
      body_b_m: SCIENCE_DEFAULTS.body.b,
    },
  };
}
