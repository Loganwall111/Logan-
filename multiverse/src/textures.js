import * as THREE from 'three';
import { fbm, rng } from './util/noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, g] = canvas(256, 256);
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.45)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Moon with maria and craters, drawn from noise.
export function moonTexture() {
  const N = 512;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const dx = u * 2 - 1;
      const dy = v * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      const i = (y * N + x) * 4;
      if (d > 1) {
        img.data[i + 3] = 0;
        continue;
      }
      const maria = fbm(u * 3.2, v * 3.2, 4, 91);
      const craters = fbm(u * 18, v * 18, 3, 92);
      let s = 0.72 + 0.25 * (maria - 0.5) * 2 - 0.12 * smoothCrater(craters);
      s = Math.min(1, Math.max(0, s));
      const edge = Math.min(1, (1 - d) * 40);
      img.data[i] = 235 * s;
      img.data[i + 1] = 236 * s;
      img.data[i + 2] = 240 * s;
      img.data[i + 3] = 255 * edge;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smoothCrater(v) {
  return Math.max(0, v - 0.6) * 2.5;
}

// Banded gas giant.
export function gasGiantTexture(colorsHex, seed = 3) {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  for (let y = 0; y < H; y++) {
    const band = Math.sin(y * 0.09 + fbm(0, y * 0.02, 3, seed) * 6) * 0.5 + 0.5;
    const col = colorsHex[Math.floor(band * (colorsHex.length - 1))];
    for (let x = 0; x < W; x++) {
      const n = fbm(x * 0.02, y * 0.05, 4, seed + 4);
      g.fillStyle = shade(col, 0.85 + 0.3 * n);
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  r();
  return t;
}

// Earth-like planet (oceans, continents, clouds).
export function oceanPlanetTexture(seed = 5) {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = fbm(x / W * 4, y / H * 2, 5, seed);
      const cl = fbm(x / W * 6 + 3, y / H * 3, 4, seed + 9);
      const land = n > 0.52;
      let r;
      let gg;
      let b;
      if (land) {
        r = 60 + 40 * (n - 0.5) * 4; gg = 110 + 50 * (n - 0.5) * 3; b = 50;
      } else {
        r = 15; gg = 60 + 40 * n; b = 130 + 60 * n;
      }
      if (cl > 0.58) { r = r * 0.3 + 200; gg = gg * 0.3 + 200; b = b * 0.3 + 200; }
      const i = (y * W + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Rust / dust planet.
export function rustPlanetTexture(seed = 8) {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = fbm(x / W * 5, y / H * 2.5, 5, seed);
      const i = (y * W + x) * 4;
      img.data[i] = 150 + 90 * n;
      img.data[i + 1] = 60 + 50 * n;
      img.data[i + 2] = 35 + 25 * n;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function ringTexture() {
  const W = 512;
  const [c, g] = canvas(W, 8);
  for (let x = 0; x < W; x++) {
    const d = x / W;
    const a = (0.25 + 0.5 * fbm(d * 30, 0, 3, 77)) * (d > 0.4 && d < 0.95 ? 1 : 0.1);
    g.fillStyle = `rgba(230,215,180,${a})`;
    g.fillRect(x, 0, 1, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Iris texture for the watching eye.
export function irisTexture() {
  const N = 512;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x / N) * 2 - 1;
      const dy = (y / N) * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.atan2(dy, dx);
      const streak = 0.5 + 0.5 * Math.sin(a * 60 + fbm(d * 6, a, 2, 4) * 8);
      const i = (y * N + x) * 4;
      const pupil = d < 0.22 ? 0 : 1;
      img.data[i] = (pupil ? 240 * (0.5 + 0.5 * streak) : 0);
      img.data[i + 1] = pupil ? 90 + 80 * streak : 0;
      img.data[i + 2] = pupil ? 20 : 0;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k);
  const gg = Math.min(255, ((n >> 8) & 255) * k);
  const b = Math.min(255, (n & 255) * k);
  return `rgb(${r | 0},${gg | 0},${b | 0})`;
}
