import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, WATER_Y, scatter, isRiverPlateau } from './terrain.js';
import { rng } from './util/noise.js';

export const windU = { uTime: { value: 0 }, uWind: { value: 0.7 } };

// Adds wind sway to a material's vertex shader. Works for instanced and non-instanced meshes.
export function applyWind(material, amp = 1) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windU.uTime;
    sh.uniforms.uWind = windU.uWind;
    sh.uniforms.uAmp = { value: amp };
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uAmp;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `
      vec3 transformed = vec3(position);
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float hh = max(position.y, 0.0);
      float gust = sin(uTime * 1.3 + ip.x * 0.07 + ip.z * 0.05) * 0.6 + sin(uTime * 2.9 + ip.z * 0.21 + ip.x * 0.1) * 0.4;
      float bend = pow(hh, 1.4) * uWind * uAmp * 0.07;
      transformed.x += gust * bend * 1.6;
      transformed.z += gust * bend * 0.7;
      `,
    );
  };
  material.customProgramCacheKey = () => `wind-${amp}`;
  return material;
}

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function clean(geo) {
  if (geo.index) geo = geo.toNonIndexed();
  for (const k of Object.keys(geo.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'color') geo.deleteAttribute(k);
  }
  return geo;
}

function makePine() {
  const parts = [];
  const trunk = paint(clean(new THREE.CylinderGeometry(0.22, 0.34, 6, 6, 1)), '#4a3322');
  trunk.translate(0, 3, 0);
  parts.push(trunk);
  const tiers = [[3.4, 4.2, 4.0], [2.6, 3.6, 7.0], [1.7, 3.0, 9.6]];
  for (const [r, h, y] of tiers) {
    const c = paint(clean(new THREE.ConeGeometry(r, h, 8, 1)), '#ffffff');
    c.translate(0, y, 0);
    parts.push(c);
  }
  return { canopy: mergeGeometries(parts.slice(1)), trunk: parts[0] };
}

function makeBroadleaf() {
  const trunk = paint(clean(new THREE.CylinderGeometry(0.28, 0.45, 5, 6, 1)), '#5a3e28');
  trunk.translate(0, 2.5, 0);
  const canopy = clean(new THREE.IcosahedronGeometry(2.6, 2));
  const pos = canopy.attributes.position;
  const r = rng(5);
  // Lumpy organic canopy.
  const jitter = [];
  for (let i = 0; i < pos.count; i += 3) jitter.push(0.85 + r() * 0.3);
  for (let i = 0; i < pos.count; i++) {
    const k = jitter[Math.floor(i / 3)];
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.9 + 0.5, pos.getZ(i) * k);
  }
  canopy.computeVertexNormals();
  paint(canopy, '#ffffff');
  canopy.translate(0, 5.5, 0);
  return { canopy, trunk };
}

function instancedWithColors(geo, mat, items, colorFn, castShadow = false) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  items.forEach((it, i) => {
    const sc = it.scale ?? 1;
    e.set(0, it.rot ?? 0, 0);
    q.setFromEuler(e);
    p.set(it.x, it.h + (it.lift ?? 0), it.z);
    s.set(sc * (it.sx ?? 1), sc * (it.sy ?? 1), sc * (it.sz ?? 1));
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (colorFn) {
      colorFn(col, it, i);
      mesh.setColorAt(i, col);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

// Builds all vegetation for the valley.
export function buildFoliage(quality = 'high') {
  const hi = quality === 'high';
  const group = new THREE.Group();
  group.name = 'foliage';

  const okLand = (x, z, h, ny) => h > WATER_Y + 1.2 && h < 95 && ny > 0.78 && !isRiverPlateau(x, z);

  // Trees
  const pineSpots = scatter(hi ? 1500 : 500, 101, (x, z, h, ny, r) => okLand(x, z, h, ny) && h < 60 && r() < 0.55);
  const leafSpots = scatter(hi ? 1100 : 400, 202, (x, z, h, ny, r) => okLand(x, z, h, ny) && h < 85 && r() < 0.5);
  const pine = makePine();
  const leaf = makeBroadleaf();
  const trunkMat = applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 0.4);
  const canopyMat = applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: false }), 1.0);

  const pineItems = pineSpots.map((s) => ({ ...s, scale: 0.8 + s.r * 0.9, rot: s.r * 6.28 }));
  const leafItems = leafSpots.map((s) => ({ ...s, scale: 0.8 + s.r * 0.7, rot: s.r * 6.28 }));
  const greens = ['#2e6b2a', '#3a7d32', '#27591f', '#4b8a36'];
  const pineGreens = ['#1e4a2b', '#245a32', '#1a3f25', '#2c6038'];

  const pt = instancedWithColors(pine.trunk, trunkMat, pineItems, null, hi);
  const pc = instancedWithColors(pine.canopy, canopyMat, pineItems, (c, it, i) => c.set(pineGreens[Math.floor(it.r * 40) % 4]), hi);
  const lt = instancedWithColors(leaf.trunk, trunkMat, leafItems, null, hi);
  const lc = instancedWithColors(leaf.canopy, canopyMat, leafItems, (c, it) => c.set(greens[Math.floor(it.r * 97) % 4]), hi);
  group.add(pt, pc, lt, lc);

  // Grass blades: tapered quads.
  const blade = new THREE.PlaneGeometry(0.16, 1.0, 1, 3);
  blade.translate(0, 0.5, 0);
  const bp = blade.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i);
    bp.setX(i, bp.getX(i) * (1 - y * 0.85));
  }
  blade.computeVertexNormals();
  const grassMat = applyWind(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }), 1.6);
  const grassSpots = scatter(hi ? 90000 : 30000, 303, (x, z, h, ny, r) => okLand(x, z, h, ny) && h < 70 && r() < 0.9, hi ? 220000 : 90000);
  const grassItems = grassSpots.map((s) => ({ ...s, scale: 0.6 + s.r * 0.9, rot: s.r * 6.28, sx: 0.8 + s.r * 0.6 }));
  const grass = instancedWithColors(blade, grassMat, grassItems, (c, it) => {
    const k = it.r;
    c.setHSL(0.22 + k * 0.05, 0.5 + k * 0.2, 0.22 + k * 0.12);
  });
  group.add(grass);

  // Flowers: tiny coloured low-poly heads on stems.
  const flowerSpots = scatter(hi ? 5000 : 1500, 404, (x, z, h, ny, r) => okLand(x, z, h, ny) && h < 55 && r() < 0.5);
  const flowerGeo = new THREE.IcosahedronGeometry(0.22, 0);
  const flowerMat = applyWind(new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0x000000 }), 1.2);
  const flowerCols = ['#ff6fa3', '#ffd34d', '#ffffff', '#b28cff', '#ff8c42'];
  const flowers = instancedWithColors(flowerGeo, flowerMat, flowerSpots.map((s) => ({ ...s, lift: 0.5 + s.r * 0.3, scale: 0.9 + s.r * 0.6 })), (c, it) => c.set(flowerCols[Math.floor(it.r * 50) % flowerCols.length]));
  group.add(flowers);

  // Bushes and ferns.
  const bushSpots = scatter(hi ? 2600 : 900, 505, (x, z, h, ny, r) => okLand(x, z, h, ny) && h < 60 && r() < 0.6);
  const bushGeo = paint(clean(new THREE.IcosahedronGeometry(1.2, 1)), '#ffffff');
  const bushMat = applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 0.8);
  const bushes = instancedWithColors(bushGeo, bushMat, bushSpots.map((s) => ({ ...s, lift: 0.5, scale: 0.6 + s.r * 0.9, sy: 0.7 })), (c, it) => c.set(['#2f7a31', '#3f8c3a', '#6aa24a', '#2a6b46'][Math.floor(it.r * 33) % 4]));
  group.add(bushes);

  return { group, treeCount: pineItems.length + leafItems.length, grassCount: grassItems.length };
}
