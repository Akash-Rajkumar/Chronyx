/**
 * Route Globe 3D Math, World Landmass Dot Sampler, and Canvas Renderer.
 * Zero external 3D dependencies — pure spherical math + Canvas 2D.
 */

export type Vec3 = [number, number, number];

const DEG2RAD = Math.PI / 180;

/**
 * Converts geographic (lon, lat) in degrees to a unit 3D vector on the sphere.
 * lon = 0, lat = 0 points along +Z (toward the viewer when yaw = 0, tilt = 0).
 */
export function toVec(lon: number, lat: number): Vec3 {
  const phi = lat * DEG2RAD;
  const lam = lon * DEG2RAD;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.sin(lam), Math.sin(phi), cosPhi * Math.cos(lam)];
}

/**
 * Rotates a 3D unit vector by yaw (around Y axis) and tilt (around X axis).
 * Positive yaw rotates the camera eastward (brings eastern longitudes to center).
 * Positive tilt pitches the northern hemisphere toward the viewer.
 */
export function rotate(v: Vec3, yaw: number, tilt: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = v[0] * cy - v[2] * sy;
  const z1 = v[0] * sy + v[2] * cy;

  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const y2 = v[1] * ct - z1 * st;
  const z2 = v[1] * st + z1 * ct;

  return [x1, y2, z2];
}

/**
 * Spherical linear interpolation between two unit vectors.
 */
export function slerp(a: Vec3, b: Vec3, u: number): Vec3 {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-4) {
    const x = a[0] + (b[0] - a[0]) * u;
    const y = a[1] + (b[1] - a[1]) * u;
    const z = a[2] + (b[2] - a[2]) * u;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  }
  const sinO = Math.sin(omega);
  const s0 = Math.sin((1 - u) * omega) / sinO;
  const s1 = Math.sin(u * omega) / sinO;
  return [
    a[0] * s0 + b[0] * s1,
    a[1] * s0 + b[1] * s1,
    a[2] * s0 + b[2] * s1,
  ];
}

/**
 * Simplified continent & major island polygons ([lon, lat] pairs) for realistic dotted Earth rendering.
 */
const CONTINENT_POLYGONS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // North America
  [
    [-168, 66], [-162, 70], [-141, 70], [-128, 70], [-110, 68], [-94, 68],
    [-82, 63], [-78, 53], [-64, 60], [-55, 52], [-60, 46], [-67, 45],
    [-70, 41], [-76, 35], [-81, 30], [-80, 25], [-83, 29], [-90, 29],
    [-97, 26], [-97, 19], [-88, 21], [-84, 10], [-78, 8], [-82, 9],
    [-92, 15], [-105, 19], [-110, 24], [-115, 31], [-121, 35], [-124, 42],
    [-124, 49], [-132, 54], [-140, 60], [-152, 60], [-162, 55], [-166, 60],
  ],
  // Greenland
  [
    [-52, 60], [-42, 60], [-32, 68], [-20, 74], [-22, 81], [-40, 83],
    [-60, 81], [-72, 77], [-56, 70],
  ],
  // South America
  [
    [-78, 9], [-72, 12], [-62, 10], [-50, 2], [-35, -6], [-38, -14],
    [-41, -22], [-48, -26], [-53, -34], [-62, -40], [-66, -47], [-68, -54],
    [-73, -53], [-75, -46], [-72, -36], [-71, -22], [-77, -12], [-81, -5],
    [-79, 2],
  ],
  // Africa
  [
    [-17, 15], [-13, 28], [-6, 36], [10, 37], [12, 33], [25, 32],
    [33, 31], [38, 22], [43, 12], [51, 12], [48, 4], [41, -2],
    [40, -11], [35, -20], [33, -26], [28, -33], [18, -34], [15, -26],
    [12, -16], [12, -6], [9, 4], [2, 6], [-8, 5], [-16, 11],
  ],
  // Madagascar
  [
    [44, -25], [47, -25], [50, -15], [49, -12], [44, -18],
  ],
  // Europe (continental + Iberia + Italy + Balkans + Scandinavia)
  [
    [-9, 37], [-9, 43], [-2, 43], [-5, 48], [2, 51], [8, 54],
    [10, 57], [5, 60], [10, 64], [18, 69], [28, 71], [32, 68],
    [28, 60], [22, 60], [20, 55], [28, 55], [32, 47], [28, 41],
    [23, 38], [19, 40], [16, 38], [13, 41], [9, 44], [5, 43],
    [3, 42], [-2, 37], [-6, 36],
  ],
  // UK & Ireland
  [
    [-6, 50], [2, 51], [1, 55], [-3, 58], [-6, 57], [-5, 53],
  ],
  // Iceland
  [
    [-24, 64], [-14, 64], [-14, 66.5], [-24, 66.5],
  ],
  // Asia + Middle East + India + SE Asia
  [
    [28, 41], [36, 37], [35, 31], [40, 21], [44, 13], [54, 17],
    [60, 22], [56, 26], [49, 30], [56, 27], [66, 25], [70, 21],
    [73, 18], [77, 8], [80, 12], [86, 21], [91, 22], [95, 16],
    [98, 13], [100, 7], [104, 1], [104, 10], [109, 12], [108, 21],
    [116, 23], [122, 30], [120, 36], [126, 35], [129, 38], [132, 43],
    [140, 48], [142, 54], [156, 52], [162, 60], [176, 66], [168, 70],
    [140, 72], [115, 74], [90, 75], [70, 72], [58, 69], [44, 67],
    [32, 68], [28, 55], [32, 47], [40, 44], [38, 41],
  ],
  // Japan
  [
    [130, 31], [136, 34], [141, 38], [145, 44], [141, 45], [138, 39], [131, 34],
  ],
  // Sumatra + Java + Borneo + Sulawesi (Maritime SE Asia)
  [
    [95, 5], [105, -6], [115, -8], [114, -6], [104, -2], [98, 4],
  ],
  [
    [109, 1], [118, 5], [119, -3], [111, -3],
  ],
  // Philippines
  [
    [120, 18], [123, 16], [126, 7], [122, 6], [120, 14],
  ],
  // New Guinea
  [
    [131, -2], [141, -3], [150, -10], [146, -9], [136, -5],
  ],
  // Australia
  [
    [114, -22], [122, -17], [130, -12], [136, -12], [142, -11], [146, -18],
    [153, -27], [150, -37], [141, -38], [136, -34], [128, -32], [115, -34],
    [113, -26],
  ],
  // New Zealand
  [
    [167, -46], [172, -43], [178, -37], [174, -35], [171, -41], [166, -45],
  ],
  // Antarctica
  [
    [-180, -72], [-140, -74], [-90, -72], [-60, -64], [-40, -74], [0, -70],
    [50, -68], [100, -67], [150, -70], [180, -73], [180, -90], [-180, -90],
  ],
];

function pointInPoly(lon: number, lat: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0];
    const yi = poly[i]![1];
    const xj = poly[j]![0];
    const yj = poly[j]![1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isLand(lon: number, lat: number): boolean {
  for (const poly of CONTINENT_POLYGONS) {
    if (pointInPoly(lon, lat, poly)) return true;
  }
  return false;
}

const dotCache = new Map<number, Vec3[]>();

/**
 * Generates an evenly spaced Fibonacci sphere of dots filtered to world landmasses.
 * Cached by sample count for instant re-renders.
 */
export function landDots(count: number): Vec3[] {
  const cached = dotCache.get(count);
  if (cached) return cached;

  const result: Vec3[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;

    const lat = Math.asin(Math.max(-1, Math.min(1, y))) / DEG2RAD;
    const lon = Math.atan2(x, z) / DEG2RAD;

    if (isLand(lon, lat)) {
      result.push([x, y, z]);
    }
  }

  dotCache.set(count, result);
  return result;
}

export interface GlobeView {
  cx: number;
  cy: number;
  r: number;
  yaw: number;
  tilt: number;
}

/**
 * Renders the dark atmospheric sphere, subtle rim glow, and depth-shaded landmass dots.
 */
export function drawGlobe(
  ctx: CanvasRenderingContext2D,
  dots: readonly Vec3[],
  view: GlobeView,
  landColor: string,
  dotSize: number,
  glowColor: string,
): void {
  const { cx, cy, r, yaw, tilt } = view;

  // Outer atmospheric halo
  const halo = ctx.createRadialGradient(cx, cy, r * 0.78, cx, cy, r * 1.18);
  halo.addColorStop(0, 'rgba(0, 0, 0, 0)');
  halo.addColorStop(0.58, glowColor);
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2);
  ctx.fill();

  // Sphere body fill
  const sphereGrad = ctx.createRadialGradient(
    cx - r * 0.25,
    cy - r * 0.25,
    r * 0.1,
    cx,
    cy,
    r,
  );
  sphereGrad.addColorStop(0, '#0f172a');
  sphereGrad.addColorStop(0.65, '#090e1a');
  sphereGrad.addColorStop(1, '#05070e');
  ctx.fillStyle = sphereGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Subtle limb ring
  ctx.strokeStyle = 'rgba(159, 180, 214, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Landmass dots with depth shading
  const cyaw = Math.cos(yaw);
  const syaw = Math.sin(yaw);
  const ctilt = Math.cos(tilt);
  const stilt = Math.sin(tilt);

  ctx.fillStyle = landColor;
  const halfSize = dotSize * 0.5;

  for (let i = 0; i < dots.length; i++) {
    const d = dots[i]!;
    const x1 = d[0] * cyaw - d[2] * syaw;
    const z1 = d[0] * syaw + d[2] * cyaw;
    const y2 = d[1] * ctilt - z1 * stilt;
    const z2 = d[1] * stilt + z1 * ctilt;

    const px = cx + x1 * r;
    const py = cy - y2 * r;

    if (z2 > 0) {
      ctx.globalAlpha = 0.18 + z2 * 0.72;
      const sz = dotSize * (0.72 + z2 * 0.35);
      ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz);
    } else if (z2 > -0.35) {
      ctx.globalAlpha = 0.055;
      ctx.fillRect(px - halfSize, py - halfSize, dotSize * 0.75, dotSize * 0.75);
    }
  }

  ctx.globalAlpha = 1;
}
