/** Median. Even counts use the mean of the two central values. Empty input is 0. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Median absolute deviation about the sample median. */
export function mad(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

const ERF_P = 0.3275911;
const ERF_A1 = 0.254829592;
const ERF_A2 = -0.284496736;
const ERF_A3 = 1.421413741;
const ERF_A4 = -1.453152027;
const ERF_A5 = 1.061405429;

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + ERF_P * ax);
  const poly = t * (ERF_A1 + t * (ERF_A2 + t * (ERF_A3 + t * (ERF_A4 + t * ERF_A5))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Standard normal CDF. */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
