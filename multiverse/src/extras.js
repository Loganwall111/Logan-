import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, WATER_Y, LODAMIS } from './terrain.js';
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

// ---------- Midnight TV: static screens; figures step out after midnight ----------
const staticFrag = /* glsl */ `
  uniform float uTime;
  uniform float uActive;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
  void main() {
    float n = hash(floor(vUv * vec2(160.0, 90.0)));
    vec3 col = vec3(n) * 0.9;
    // Once active, a dim figure silhouette flickers in the middle of the screen.
    vec2 p = vUv - vec2(0.5, 0.45);
    float head = smoothstep(0.09, 0.08, length(p - vec2(0.0, 0.18)));
    float body = smoothstep(0.2, 0.17, abs(p.x) * 2.2 + max(0.0, -p.y - 0.05) * 0.2) * step(p.y, 0.1) * step(-0.3, p.y);
    float fig = max(head, body) * uActive;
    col = mix(col, vec3(0.0), fig * 0.85);
    col = mix(col, vec3(0.6, 0.85, 1.0) * 0.5, uActive * 0.15);
    gl_FragColor = vec4(col, 1.0);
  }
`;
const screenVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

function makeTV(group, x, z, rand) {
  const tv = new THREE.Group();
  const h = heightAt(x, z);
  tv.position.set(x, h, z);
  tv.rotation.y = -Math.PI / 2;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x151518, roughness: 0.5 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(34, 22, 1.6), frameMat);
  frame.position.set(0, 26, -0.5);
  tv.add(frame);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(12, 26, 2.5), frameMat);
  stand.position.set(0, 13, -0.5);
  tv.add(stand);
  const uniforms = { uTime: { value: 0 }, uActive: { value: 0 } };
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(31, 19), new THREE.ShaderMaterial({ uniforms, vertexShader: screenVert, fragmentShader: staticFrag }));
  screen.position.set(0, 26, 0.35);
  tv.add(screen);
  group.add(tv);
  // Figures that step out of the glass when it is midnight.
  const figures = [];
  const figMat = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 2.6, 6, 12), figMat);
    body.position.y = 2.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), figMat);
    head.position.y = 4.6;
    f.add(body, head);
    f.position.set(-6 + i * 6, 0, 3 + rand() * 2);
    f.visible = false;
    tv.add(f);
    figures.push({ f, ph: rand() * 6, lean: rand() * 0.4 });
  }
  return { tv, uniforms, figures };
}

// ---------- Giant ant ----------
function makeAnt(rand) {
  const body = '#2b1b10';
  const parts = [
    paint(clean(new THREE.SphereGeometry(2.4, 14, 10)), body),
    paint(clean(new THREE.SphereGeometry(3.6, 16, 12)), body),
    paint(clean(new THREE.SphereGeometry(5.2, 18, 12)), body),
  ];
  parts[0].translate(8, 3.2, 0);
  parts[1].translate(0, 3.2, 0);
  parts[2].scale(1, 0.9, 1);
  parts[2].translate(-7, 3.6, 0);
  const antennae = [];
  for (let s = -1; s <= 1; s += 2) {
    const a = paint(clean(new THREE.CylinderGeometry(0.12, 0.12, 7, 5)), body);
    a.rotateZ(-0.9);
    a.translate(11.2, 6.2, s * 0.9);
    antennae.push(a);
  }
  const geo = mergeGeometries([...parts, ...antennae]);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })));
  const legs = [];
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2b1b10, roughness: 0.6 });
  for (let i = 0; i < 6; i++) {
    const lg = new THREE.Group();
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.2, 7.5, 6), legMat);
    seg.position.y = -3.5;
    lg.add(seg);
    lg.position.set((i % 3) * 4 - 4, 3, i < 3 ? 2.2 : -2.2);
    lg.rotation.z = i < 3 ? -0.9 : 0.9;
    g.add(lg);
    legs.push({ lg, ph: i % 2 ? 0 : Math.PI });
  }
  g.userData.legs = legs;
  g.userData.ph = rand() * 6;
  return g;
}

// ---------- Floating city on an island ----------
function makeCity(rand) {
  const g = new THREE.Group();
  const base = paint(clean(new THREE.CylinderGeometry(120, 70, 60, 40, 1)), '#5b5b5f');
  base.translate(0, -30, 0);
  const grass = paint(clean(new THREE.CylinderGeometry(122, 122, 3, 40, 1)), '#4f8a46');
  const bmesh = new THREE.Mesh(base, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  g.add(bmesh);
  const towers = [];
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 95;
    const h = 12 + Math.pow(rand(), 2) * 90;
    const w = 4 + rand() * 6;
    const b = clean(new THREE.BoxGeometry(w, h, w));
    b.translate(Math.cos(a) * d, h / 2 + 1.5, Math.sin(a) * d);
    paint(b, ['#c9d3e0', '#9fb0c4', '#e1d9c4', '#7f8fa6'][i % 4]);
    towers.push(b);
  }
  g.add(new THREE.Mesh(mergeGeometries(towers), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 })));
  const lightsGeo = clean(new THREE.SphereGeometry(0.6, 6, 4));
  paint(lightsGeo, '#ffd98a');
  g.add(new THREE.Mesh(lightsGeo, new THREE.MeshBasicMaterial({ vertexColors: true })));
  g.add(new THREE.Mesh(grass, new THREE.MeshStandardMaterial({ color: 0x4f8a46, roughness: 0.9 })).translateY(1));
  return g;
}

export function buildExtras(group, quality = 'high') {
  const rand = rng(4321);
  const hi = quality === 'high';

  // The midnight TV: placed a short walk west of the Lodamis gate.
  const tvX = LODAMIS.x - 40;
  const tvZ = LODAMIS.z + 18;
  const tv = makeTV(group, tvX, tvZ, rand);

  // Giant ants patrolling a meadow.
  const ants = [];
  for (let i = 0; i < (hi ? 3 : 2); i++) {
    const a = makeAnt(rand);
    a.userData.center = { x: -120 + i * 60, z: -60 - i * 40 };
    a.userData.r = 70 + rand() * 40;
    group.add(a);
    ants.push(a);
  }

  // Giant water drops hanging in the air.
  const dropMat = new THREE.MeshPhysicalMaterial({ color: 0x9fdcff, roughness: 0.02, metalness: 0, transmission: 0, transparent: true, opacity: 0.35, clearcoat: 1, clearcoatRoughness: 0, ior: 1.33, specularIntensity: 1 });
  const drops = [];
  for (let i = 0; i < 2; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(18, 40, 30), dropMat);
    d.scale.set(1, 1.25, 1);
    d.position.set(-260 + i * 90, 60 + i * 20, 80 - i * 150);
    d.userData = { base: d.position.y, ph: i * 2 };
    group.add(d);
    drops.push(d);
  }

  // A floating city high above the western valley.
  const city = makeCity(rand);
  city.position.set(-200, 230, 300);
  group.add(city);

  return {
    update(dt, time, hour) {
      // Midnight window: 23:30 to 00:30.
      const night = hour >= 23.5 || hour < 0.5;
      tv.uniforms.uTime.value = time;
      tv.uniforms.uActive.value = night ? 1 : 0;
      tv.figures.forEach((fg, i) => {
        fg.f.visible = night;
        if (!night) { fg.f.position.z = 3 + i; return; }
        // Figures wade out of the screen toward the valley floor, then sway.
        const t = (time + fg.ph) % 40;
        const out = Math.min(1, t / 6);
        fg.f.position.z = 3 + out * 8 + Math.sin(time * 0.8 + fg.ph) * 0.3;
        fg.f.position.y = Math.sin(time * 6 + i) * 0.1 + fg.lean * 0;
        fg.f.rotation.z = Math.sin(time * 1.3 + fg.ph) * fg.lean;
      });
      for (const a of ants) {
        const u = a.userData;
        u.ph = (u.ph ?? 0) + dt * 0.5;
        const ang = u.ph * 0.08;
        const x = u.center.x + Math.cos(ang) * u.r;
        const z = u.center.z + Math.sin(ang) * u.r;
        const nx = u.center.x + Math.cos(ang + 0.02) * u.r;
        const nz = u.center.z + Math.sin(ang + 0.02) * u.r;
        a.position.set(x, heightAt(x, z) + 0.2, z);
        a.rotation.y = Math.atan2(-(nz - z), nx - x);
        a.userData.legs.forEach((l) => { l.lg.rotation.x = Math.sin(time * 9 + l.ph) * 0.35; });
      }
      for (const d of drops) {
        d.position.y = d.userData.base + Math.sin(time * 0.4 + d.userData.ph) * 4;
      }
    },
    hasWater: WATER_Y,
  };
}
