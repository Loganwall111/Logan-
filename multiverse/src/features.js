import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, WATER_Y, PLATEAU_Y, CLIFF_X, riverZ, scatter, LODAMIS } from './terrain.js';
import { glowTexture, irisTexture } from './textures.js';
import { rng } from './util/noise.js';

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
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') geo.deleteAttribute(k);
  return geo;
}

// ---------- Waterfalls ----------
const fallVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const fallFragment = /* glsl */ `
  uniform float uTime;
  uniform float uRain;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float x = vUv.x;
    float y = vUv.y;                 // 1 = top of fall, 0 = bottom
    float s1 = vnoise(vec2(x * 14.0, y * 2.0 + uTime * 0.2));
    float s2 = vnoise(vec2(x * 60.0, y * 5.0 + uTime * 6.0));
    float streak = clamp(s2 * 0.7 + s1 * 0.5, 0.0, 1.0);
    float edge = smoothstep(0.0, 0.12, x) * (1.0 - smoothstep(0.88, 1.0, x));
    vec3 water = mix(vec3(0.55, 0.78, 0.9), vec3(0.95, 1.0, 1.0), streak);
    float foam = (1.0 - smoothstep(0.0, 0.35, y)) * (0.5 + 0.5 * s2);
    vec3 col = mix(water, vec3(1.0), clamp(foam, 0.0, 1.0));
    float alpha = edge * (0.55 + 0.35 * streak) * (0.8 + 0.2 * (1.0 - y)) + foam * 0.4;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
  }
`;

function makeFall(x, z, width, top, bottom, faceAxis = 'x') {
  const height = Math.max(4, top - bottom);
  const geo = new THREE.PlaneGeometry(width, height, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uRain: { value: 0 } },
    vertexShader: fallVertex,
    fragmentShader: fallFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, bottom + height / 2, z);
  if (faceAxis === 'x') mesh.rotation.y = Math.PI / 2;
  mesh.renderOrder = 5;
  return mesh;
}

function makeMist(x, y, z, count = 700, spread = 16) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const r = rng(count + Math.floor(x));
  for (let i = 0; i < count; i++) {
    pos.set([x + (r() - 0.5) * spread, y, z + (r() - 0.5) * spread], i * 3);
    vel.set([(r() - 0.5) * 2, 2 + r() * 4, (r() - 0.5) * 2], i * 3);
    life[i] = r() * 4;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 18, map: glowTexture('rgba(230,245,255,0.8)'), transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData = { vel, life, base: new THREE.Vector3(x, y, z), spread };
  return pts;
}

function updateMist(pts, dt) {
  const { vel, life, base, spread } = pts.userData;
  const p = pts.geometry.attributes.position.array;
  for (let i = 0; i < life.length; i++) {
    life[i] += dt;
    if (life[i] > 4) {
      life[i] = 0;
      p[i * 3] = base.x + (Math.random() - 0.5) * spread;
      p[i * 3 + 1] = base.y;
      p[i * 3 + 2] = base.z + (Math.random() - 0.5) * spread;
    } else {
      p[i * 3] += vel[i * 3] * dt;
      p[i * 3 + 1] += vel[i * 3 + 1] * dt * (1 - life[i] / 4);
      p[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
  }
  pts.geometry.attributes.position.needsUpdate = true;
}

// ---------- Floating islands ----------
function makeIsland(r, rand) {
  const g = new THREE.Group();
  const top = clean(new THREE.IcosahedronGeometry(r, 3));
  top.scale(1, 0.28, 1);
  const tp = top.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const k = 0.92 + rand() * 0.14;
    tp.setXYZ(i, tp.getX(i) * k, tp.getY(i), tp.getZ(i) * k);
  }
  top.computeVertexNormals();
  paint(top, '#4f9a3a');
  const under = clean(new THREE.ConeGeometry(r * 0.95, r * 1.9, 10, 4));
  under.rotateX(Math.PI);
  under.translate(0, -r * 0.95, 0);
  const up = under.attributes.position;
  for (let i = 0; i < up.count; i++) {
    const k = 0.85 + rand() * 0.3;
    up.setXYZ(i, up.getX(i) * k, up.getY(i), up.getZ(i) * k);
  }
  under.computeVertexNormals();
  paint(under, '#6b5a48');
  const merged = mergeGeometries([top, under]);
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  g.add(mesh);
  // A couple of pines standing on the island.
  const treeGeo = paint(clean(new THREE.ConeGeometry(r * 0.08, r * 0.5, 7)), '#23542a');
  treeGeo.translate(0, r * 0.2, 0);
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    const a = rand() * Math.PI * 2;
    const d = rand() * r * 0.6;
    t.position.set(Math.cos(a) * d, r * 0.1, Math.sin(a) * d);
    g.add(t);
  }
  return g;
}

// ---------- Sky whale ----------
function makeWhale() {
  const g = new THREE.Group();
  const body = clean(new THREE.SphereGeometry(1, 32, 20));
  body.scale(72, 16, 19);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    // Taper the head and tail; keep a lively belly.
    const taper = 1 - Math.pow(Math.abs(x) / 72, 3) * 0.6;
    p.setY(i, y * taper + (y < 0 ? 2 : 0));
    p.setZ(i, p.getZ(i) * taper);
  }
  body.computeVertexNormals();
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const belly = p.getY(i) < -2;
    const c = belly ? [0.78, 0.82, 0.9] : [0.16, 0.22, 0.34];
    colors.set(c, i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x112244, emissiveIntensity: 0.25 }));
  g.add(mesh);
  const fluke = paint(clean(new THREE.BoxGeometry(18, 1.5, 36)), '#1d2a44');
  fluke.translate(-74, 2, 0);
  g.add(new THREE.Mesh(fluke, new THREE.MeshStandardMaterial({ vertexColors: true })));
  const fin = paint(clean(new THREE.ConeGeometry(7, 24, 8)), '#1d2a44');
  fin.translate(0, 18, 0);
  g.add(new THREE.Mesh(fin, new THREE.MeshStandardMaterial({ vertexColors: true })));
  return g;
}

// ---------- Wormhole ----------
const wormVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const wormFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float a = vUv.x * 6.2831;
    float s = sin(a * 12.0 + uTime * 3.0 + vUv.y * 20.0) * 0.5 + 0.5;
    vec3 c = mix(vec3(0.2, 0.9, 1.0), vec3(0.8, 0.2, 1.0), s);
    float rim = smoothstep(0.0, 0.5, vUv.y) * (1.0 - smoothstep(0.5, 1.0, vUv.y));
    gl_FragColor = vec4(c * (1.2 + s), 0.5 + 0.5 * rim);
  }
`;
const spiralFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float sp = sin(a * 5.0 - log(r + 0.01) * 6.0 - uTime * 2.0) * 0.5 + 0.5;
    float fade = 1.0 - smoothstep(0.2, 1.0, r);
    gl_FragColor = vec4(mix(vec3(0.1, 0.4, 1.0), vec3(1.0, 0.9, 1.0), sp) * fade * (0.4 + sp), fade * 0.9);
  }
`;

function makeWormhole(animated) {
  const g = new THREE.Group();
  const u = { uTime: { value: 0 } };
  animated.push(u);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(95, 14, 32, 160), new THREE.ShaderMaterial({
    uniforms: u, vertexShader: wormVertex, fragmentShader: wormFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(84, 96), new THREE.ShaderMaterial({
    uniforms: u, vertexShader: wormVertex, fragmentShader: spiralFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  g.add(ring, disc);
  return g;
}

// ---------- The watching eye with tentacles ----------
function makeEye(rand) {
  const g = new THREE.Group();
  const sclera = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.25, emissive: 0x222018, emissiveIntensity: 0.4 }));
  g.add(sclera);
  const iris = new THREE.Mesh(new THREE.CircleGeometry(34, 64), new THREE.MeshBasicMaterial({ map: irisTexture(), transparent: true }));
  iris.position.z = 69.5;
  g.add(iris);
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(11, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pupil.position.z = 70.2;
  g.add(pupil);
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x3b1a4a, roughness: 0.5, emissive: 0x1a0822, emissiveIntensity: 0.6 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.3;
    const pts = [];
    const len = 160 + rand() * 120;
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push(new THREE.Vector3(
        Math.cos(a) * (60 + t * len * 0.7) + Math.sin(t * 6 + i) * 18 * t,
        -40 - t * len,
        Math.sin(a) * (60 + t * len * 0.7) + Math.cos(t * 5 + i) * 14 * t,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 5 - 2 * (i % 2) * 0.3, 8, false), tentMat);
    g.add(tube);
  }
  return g;
}

// ---------- The Lodamis machine (spawn landmark) ----------
export function makeLodamis() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b313c, roughness: 0.35, metalness: 0.8 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 4, 40), metal);
  base.position.y = 2;
  g.add(base);
  const rings = [];
  const glow = new THREE.MeshBasicMaterial({ color: 0x7ef3ff, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(9 - i * 2, 0.45, 12, 96), glow);
    r.position.y = 12 + i * 4;
    r.rotation.x = Math.PI / 2 + i * 0.4;
    g.add(r);
    rings.push(r);
  }
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(3, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  core.position.y = 14;
  g.add(core);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 6, 600, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x7ef3ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 300;
  g.add(beam);
  g.userData = { rings, core };
  return g;
}

export function buildFeatures(quality = 'high') {
  const group = new THREE.Group();
  group.name = 'features';
  const rand = rng(777);
  const animated = [];
  const mists = [];

  // Giant cliff waterfall off the plateau.
  const rz = riverZ(CLIFF_X);
  const cliffBase = heightAt(CLIFF_X + 14, rz);
  const fall = makeFall(CLIFF_X + 1.2, rz, 16, PLATEAU_Y - 1.0, cliffBase + 1, 'x');
  animated.push(fall.material.uniforms);
  group.add(fall);
  const mist = makeMist(CLIFF_X + 12, Math.max(cliffBase, WATER_Y) + 2, rz, 1200, 60);
  mists.push(mist);
  group.add(mist);

  // Smaller cascades on the valley slopes.
  const cascades = scatter(hi(quality) ? 6 : 3, 4242, (x, z, h, ny) => h > 25 && h < 80 && ny < 0.6 && x < CLIFF_X - 40 && x > -600 && Math.abs(z) < 500);
  for (const c of cascades) {
    const top = c.h + 25 + c.r * 18;
    const f = makeFall(c.x, c.z, 7, top, c.h - 1, 'z');
    animated.push(f.material.uniforms);
    group.add(f);
    const m = makeMist(c.x, c.h, c.z, 260, 10);
    mists.push(m);
    group.add(m);
  }

  // Floating islands.
  const islands = [];
  for (let i = 0; i < 6; i++) {
    const isl = makeIsland(35 + rand() * 45, rand);
    isl.position.set(400 + rand() * 500, 190 + rand() * 120, -500 + rand() * 1000);
    isl.userData = { base: isl.position.y, phase: rand() * 6.28 };
    islands.push(isl);
    group.add(isl);
  }

  // Sky whale circling high above the valley.
  const whale = makeWhale();
  whale.userData = { center: new THREE.Vector3(0, 300, 0), r: 620, phase: 0 };
  group.add(whale);

  // Wormhole on the far horizon.
  const worm = makeWormhole(animated);
  worm.position.set(640, 130, -520);
  worm.lookAt(0, 100, 0);
  group.add(worm);

  // The watching eye on the mountains to the west-south.
  const eyeX = -640;
  const eyeZ = 500;
  const eyeY = Math.max(heightAt(eyeX, eyeZ) + 120, 170);
  const eye = makeEye(rand);
  eye.position.set(eyeX, eyeY, eyeZ);
  group.add(eye);

  // Lodamis machine at spawn.
  const lodamis = makeLodamis();
  lodamis.position.set(LODAMIS.x, heightAt(LODAMIS.x, LODAMIS.z) + 0.2, LODAMIS.z);
  group.add(lodamis);

  // Dust motes drifting through the air.
  const dustN = quality === 'high' ? 2500 : 900;
  const dustGeo = new THREE.BufferGeometry();
  const dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) dp.set([(rand() - 0.5) * 500, rand() * 60 + 2, (rand() - 0.5) * 500], i * 3);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.12, color: 0xfff1d6, transparent: true, opacity: 0.45, depthWrite: false }));
  group.add(dust);

  group.userData = { fall, mists, animated, islands, whale, worm, eye, lodamis, dust, dustN, cascadeCount: cascades.length };

  return {
    group,
    update(dt, time, camera) {
      for (const u of animated) u.uTime.value = time;
      for (const m of mists) updateMist(m, dt);
      islands.forEach((isl, i) => {
        const u = isl.userData;
        isl.position.y = u.base + Math.sin(time * 0.3 + u.phase) * 4;
        isl.rotation.y = time * 0.01 * (i % 2 ? 1 : -1);
      });
      // Whale glides in a wide circle.
      const w = whale.userData;
      w.phase += dt * 0.012;
      whale.position.set(Math.cos(w.phase) * w.r, w.center.y + Math.sin(time * 0.4) * 6, Math.sin(w.phase) * w.r);
      whale.rotation.set(0, -w.phase + Math.PI / 2, Math.sin(time * 0.5) * 0.04);
      // Wormhole spins.
      worm.rotation.z = time * 0.2;
      // The eye keeps watching the player.
      eye.lookAt(camera.position.x, eye.position.y, camera.position.z);
      // Lodamis rings and core.
      lodamis.userData.rings.forEach((r, i) => {
        r.rotation.z = time * (0.5 + i * 0.3);
      });
      lodamis.userData.core.rotation.y = time;
      lodamis.userData.core.rotation.x = time * 0.7;
    },
  };
}

function hi(q) {
  return q === 'high';
}
