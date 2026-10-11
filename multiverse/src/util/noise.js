// Small deterministic noise helpers used by terrain, foliage placement and effects.

export function hash2(ix, iy, seed = 0) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Value noise in [0, 1].
export function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal value noise in [0, 1], with a per-octave rotation to hide grid artefacts.
export function fbm(x, y, octaves = 5, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(px * f, py * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    const rx = px * 0.8 - py * 0.6;
    const ry = px * 0.6 + py * 0.8;
    px = rx + 1.7;
    py = ry - 0.9;
    f *= 2.03;
  }
  return sum / norm;
}

export function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function clamp(x, a, b) {
  return Math.min(b, Math.max(a, x));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Deterministic random number generator (mulberry32).
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
