import * as THREE from 'three';
import { fbm, smooth, lerp, rng } from './util/noise.js';

export const WORLD_HALF = 900;      // map runs from -900 to +900 on both axes
export const WATER_Y = 0;           // sea level / lake surface
export const PLATEAU_Y = 140;       // height of the high western plateau
export const CLIFF_X = 240;         // x position of the giant cliff edge
export const SPAWN = new THREE.Vector3(345, 0, 20);
// The Lodamis machine stands on dry ground near the spawn point.
export const LODAMIS = { x: 318, z: 14 };

// Meandering river that runs over the plateau, off the cliff and down into the valley.
export function riverZ(x) {
  return Math.sin(x * 0.006) * 45 + Math.sin(x * 0.017 + 1.3) * 12;
}

// Plateau weight: 1 on the high western tableland, 0 in the valley. Very steep transition = cliff.
export function plateauAt(x) {
  return 1 - smooth(CLIFF_X - 3, CLIFF_X + 3, x);
}

export function heightAt(x, z) {
  // Lush rolling valley floor.
  let valley = fbm(x * 0.0032, z * 0.0032, 5, 11) * 60 - 24;
  valley += fbm(x * 0.012, z * 0.012, 3, 12) * 6;

  // Distant mountain walls toward the edges of the world.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  valley += smooth(WORLD_HALF * 0.55, WORLD_HALF, edge) * 190 * (0.6 + 0.4 * fbm(x * 0.004, z * 0.004, 4, 13));

  // Lake basin (below sea level) and a river channel through the valley.
  const lake = Math.exp(-((x - 160) ** 2 + (z + 160) ** 2) / (2 * 95 * 95));
  valley -= lake * 34;
  // A sea basin to the south-east, shoreline and all.
  const sea = Math.exp(-((x - 430) ** 2 + (z - 470) ** 2) / (2 * 230 * 230));
  valley -= sea * 90;
  const rd = z - riverZ(x);
  valley -= Math.exp(-(rd * rd) / (2 * 14 * 14)) * 5;

  // High plateau with a flat river channel running across it.
  let plateau = PLATEAU_Y + (fbm(x * 0.006 + 5, z * 0.006, 4, 21) - 0.5) * 22;
  const pd = z - riverZ(x);
  const channel = Math.exp(-(pd * pd) / (2 * 15 * 15));
  plateau = lerp(plateau, PLATEAU_Y - 2.2, channel);

  const p = plateauAt(x);
  return lerp(valley, plateau, p);
}

// Surface normal y component (1 = flat, 0 = vertical wall).
export function normalYAt(x, z) {
  const e = 1.5;
  const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

export function isRiverPlateau(x, z) {
  return plateauAt(x) > 0.5 && Math.abs(z - riverZ(x)) < 9;
}

function terrainColor(x, z, h, ny, out) {
  const n = fbm(x * 0.02, z * 0.02, 3, 31);
  const p = plateauAt(x);
  // Lush green valley, dry golden grass on the plateau.
  const lush = [0.19, 0.44, 0.13];
  const dry = [0.5, 0.47, 0.22];
  let c = [lerp(lush[0], dry[0], p), lerp(lush[1], dry[1], p), lerp(lush[2], dry[2], p)];
  const v = 0.8 + 0.4 * n;
  c = c.map((k) => k * v);
  // Rock on steep faces.
  const steep = smooth(0.62, 0.86, 1 - ny);
  const rock = [0.42, 0.38, 0.33];
  c = c.map((k, i) => lerp(k, rock[i] * (0.85 + 0.3 * n), steep));
  // Wet sand / gravel at the shoreline.
  const shore = 1 - smooth(1.2, 4.5, Math.abs(h - 0.6));
  const sand = [0.62, 0.56, 0.4];
  c = c.map((k, i) => lerp(k, sand[i], shore * 0.85));
  // Underwater ground.
  if (h < WATER_Y) {
    const d = smooth(0, -20, h);
    const under = [0.22, 0.2, 0.16];
    c = c.map((k, i) => lerp(k, under[i], 0.6 + 0.3 * d));
  }
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
}

export function buildTerrain() {
  const seg = 420;
  const geo = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    terrainColor(x, z, h, normalYAt(x, z), tmp);
    colors[i * 3] = tmp[0];
    colors[i * 3 + 1] = tmp[1];
    colors[i * 3 + 2] = tmp[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// Finds `count` random spots on the map that satisfy `accept(x, z, h, ny)`.
export function scatter(count, seed, accept, maxTries = count * 40) {
  const r = rng(seed);
  const out = [];
  for (let t = 0; t < maxTries && out.length < count; t++) {
    const x = (r() * 2 - 1) * WORLD_HALF * 0.95;
    const z = (r() * 2 - 1) * WORLD_HALF * 0.95;
    const h = heightAt(x, z);
    const ny = normalYAt(x, z);
    if (accept(x, z, h, ny, r)) out.push({ x, z, h, ny, r: r() });
  }
  return out;
}
