import * as THREE from 'three';
import { rng, fbm } from './util/noise.js';
import { glowTexture } from './textures.js';

// Every realm is a self-contained scene with its own physics hooks for the player.
// realm = { id, name, scene, background, fog, ground, waterY, blocked, bounds, spawn, ghostAllowed, update(dt, t, cam, p) }

const CELL = 8;      // backrooms room size
const WALL_H = 3.2;

function wallpaperTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d8c77a';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = 'rgba(160,140,60,0.35)';
    g.fillRect(x, 0, 6, 256);
  }
  const img = g.getImageData(0, 0, 256, 256);
  const r = rng(3);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.5;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function carpetTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#8c7a46';
  g.fillRect(0, 0, 128, 128);
  const img = g.getImageData(0, 0, 128, 128);
  const r = rng(5);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 40;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 16);
  return t;
}

// ---------- 1. The Backrooms: an endless, hashed grid of yellow rooms ----------
function buildBackrooms() {
  const scene = new THREE.Scene();
  const hash = (i, j, s) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const wallEast = (i, j) => hash(i, j, 1) > 0.42;   // wall on the east edge of cell (i,j)
  const wallSouth = (i, j) => hash(i, j, 2) > 0.42;  // wall on the south edge
  const lit = (i, j) => hash(i, j, 3) > 0.35;        // ceiling light in this cell

  const wallMat = new THREE.MeshStandardMaterial({ map: wallpaperTexture(), roughness: 0.95, side: THREE.DoubleSide });
  wallMat.map.repeat.set(1, 1);
  const floorMat = new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xe8e2b0, roughness: 0.9, side: THREE.DoubleSide });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff8d0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), floorMat);
  floor.rotation.x = -Math.PI / 2;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  scene.add(floor, ceil);
  const walls = new THREE.Group();
  const lights = new THREE.Group();
  scene.add(walls, lights);
  const lightGeo = new THREE.PlaneGeometry(2.4, 0.9);
  lightGeo.rotateX(Math.PI / 2);

  // Chunked: rebuild the visible block of rooms whenever the player moves into a new cell.
  let lastCell = '';
  const RADIUS = 5;
  function rebuild(px, pz) {
    const ci = Math.floor(px / CELL);
    const cj = Math.floor(pz / CELL);
    const key = `${ci},${cj}`;
    if (key === lastCell) return;
    lastCell = key;
    walls.clear();
    lights.clear();
    const positions = [];
    const uvs = [];
    const idx = [];
    const addQuad = (x0, z0, x1, z1) => {
      const b = positions.length / 3;
      const len = Math.hypot(x1 - x0, z1 - z0);
      positions.push(x0, 0, z0, x1, 0, z1, x1, WALL_H, z1, x0, WALL_H, z0);
      uvs.push(0, 0, len / 3, 0, len / 3, WALL_H / 3, 0, WALL_H / 3);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    for (let i = ci - RADIUS; i <= ci + RADIUS; i++) {
      for (let j = cj - RADIUS; j <= cj + RADIUS; j++) {
        const x = i * CELL;
        const z = j * CELL;
        if (wallEast(i, j)) addQuad(x + CELL, z, x + CELL, z + CELL);
        if (wallSouth(i, j)) addQuad(x, z + CELL, x + CELL, z + CELL);
        if (lit(i, j)) {
          const l = new THREE.Mesh(lightGeo, lightMat);
          l.position.set(x + CELL / 2, WALL_H - 0.02, z + CELL / 2);
          lights.add(l);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    walls.add(new THREE.Mesh(g, wallMat));
  }

  const realm = {
    id: 'backrooms',
    name: 'The Backrooms',
    scene,
    background: new THREE.Color(0x3d3a1f),
    fog: new THREE.Fog(0x8f8a4c, 6, 46),
    waterY: -1000,
    spawn: { x: 4, y: 0.05, z: 4 },
    ghostAllowed: true,
    ground: () => 0,
    blocked(x, z, r) {
      const i = Math.floor(x / CELL);
      const j = Math.floor(z / CELL);
      for (let a = i - 1; a <= i + 1; a++) {
        for (let b = j - 1; b <= j + 1; b++) {
          // East wall at x = (a+1)*CELL, spanning z in [b*CELL, (b+1)*CELL].
          if (wallEast(a, b)) {
            const X = (a + 1) * CELL;
            if (Math.abs(x - X) < r + 0.1 && z > b * CELL - r && z < (b + 1) * CELL + r) return true;
          }
          if (wallSouth(a, b)) {
            const Z = (b + 1) * CELL;
            if (Math.abs(z - Z) < r + 0.1 && x > a * CELL - r && x < (a + 1) * CELL + r) return true;
          }
        }
      }
      return false;
    },
    update(dt, t, cam, p) {
      rebuild(p.pos.x, p.pos.z);
      floor.position.set(p.pos.x, 0, p.pos.z);
      ceil.position.set(p.pos.x, WALL_H, p.pos.z);
      // Fluorescent flicker on random lights.
      lights.children.forEach((l, k) => {
        l.visible = (Math.sin(t * 7 + k * 12.9898) * 43758.5453) % 1 > -0.97;
      });
    },
  };
  return realm;
}

// ---------- 2. Infinity fractal maze: a raymarched Menger sponge enclosing the player ----------
const mengerFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uScale;
  varying vec3 vWorld;
  float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
  float menger(vec3 p) {
    float d = sdBox(p, vec3(1.0));
    float s = 1.0;
    for (int m = 0; m < 4; m++) {
      vec3 a = mod(p * s, 2.0) - 1.0;
      s *= 3.0;
      vec3 r = abs(1.0 - 3.0 * abs(a));
      float da = max(r.x, r.y);
      float db = max(r.y, r.z);
      float dc = max(r.z, r.x);
      float c = (min(da, min(db, dc)) - 1.0) / s;
      d = max(d, c);
    }
    return d;
  }
  void main() {
    vec3 ro = (cameraPosition - uCenter) / uScale;
    vec3 rd = normalize((vWorld - cameraPosition));
    float t = 0.0;
    float hit = 0.0;
    vec3 p;
    for (int i = 0; i < 90; i++) {
      p = ro + rd * t;
      float d = menger(p);
      if (d < 0.0008) { hit = 1.0; break; }
      t += max(d, 0.002);
      if (t > 12.0) break;
    }
    vec3 col = vec3(0.02, 0.01, 0.05);
    if (hit > 0.5) {
      vec2 e = vec2(0.002, 0.0);
      vec3 n = normalize(vec3(menger(p + e.xyy) - menger(p - e.xyy), menger(p + e.yxy) - menger(p - e.yxy), menger(p + e.yyx) - menger(p - e.yyx)));
      float fres = pow(1.0 - abs(dot(n, -rd)), 3.0);
      float depth = t / 12.0;
      vec3 base = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + p.y * 0.6 + uTime * 0.05));
      col = base * (0.25 + 0.75 * max(dot(n, normalize(vec3(0.4, 1.0, 0.3))), 0.0)) + fres * vec3(0.9, 0.6, 1.0);
      col *= 1.0 - depth * 0.6;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
const boxVert = /* glsl */ `
  varying vec3 vWorld;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

function buildFractal() {
  const scene = new THREE.Scene();
  const center = new THREE.Vector3(0, 30, 0);
  const R = 30;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCenter: { value: center }, uScale: { value: 30 } },
    vertexShader: boxVert,
    fragmentShader: mengerFrag,
    side: THREE.BackSide,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(R * 2, R * 2, R * 2), mat);
  box.position.copy(center);
  scene.add(box);
  // Mirror floor to suggest an infinite reflection.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), new THREE.MeshStandardMaterial({ color: 0x14102a, roughness: 0.2, metalness: 0.6 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.01, 0);
  scene.add(floor);
  scene.add(new THREE.AmbientLight(0xbb99ff, 0.8));
  const light = new THREE.PointLight(0xff88ff, 60, 80);
  light.position.set(0, 20, 0);
  scene.add(light);
  return {
    id: 'fractal',
    name: 'Infinity Fractal Maze',
    scene,
    background: new THREE.Color(0x05010d),
    fog: null,
    waterY: -1000,
    spawn: { x: 0, y: 0.05, z: 10 },
    ghostAllowed: true,
    bounds: R - 1,
    ground: () => 0,
    blocked: () => false,
    update(dt, t) { mat.uniforms.uTime.value = t; },
  };
}

// ---------- 3. Black hole: gravitational well, accretion disk, photon ring ----------
function buildBlackHole() {
  const scene = new THREE.Scene();
  const r = rng(77);
  // Star field, bent around the hole: stars closer to the centre are pulled inward.
  const N = 6000;
  const sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), R = 1500;
    sp.set([s * Math.cos(t) * R, u * R, s * Math.sin(t) * R], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 2, color: 0xffffff, sizeAttenuation: false })));

  const hole = new THREE.Mesh(new THREE.SphereGeometry(16, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  hole.position.set(0, 22, 0);
  scene.add(hole);
  const diskMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      void main(){
        float r = vUv.x; // 0 at inner edge, 1 at outer
        float a = vUv.y * 6.2831;
        float swirl = 0.5 + 0.5 * sin(a * 6.0 - uTime * 2.0 - log(r + 0.05) * 9.0);
        float doppler = 0.6 + 0.4 * cos(a);          // approaching side is brighter
        vec3 hot = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.45, 0.1), r);
        float fade = smoothstep(0.0, 0.1, r) * (1.0 - smoothstep(0.9, 1.0, r));
        gl_FragColor = vec4(hot * (0.4 + swirl) * doppler * fade * 2.2, fade * 0.9);
      }`,
  });
  const disk = new THREE.Mesh(new THREE.RingGeometry(20, 70, 160, 1), diskMat);
  disk.rotation.x = -Math.PI / 2 + 0.12;
  disk.position.copy(hole.position);
  scene.add(disk);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(17.5, 0.6, 12, 160), new THREE.MeshBasicMaterial({ color: 0xfff2d6, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
  ring.position.copy(hole.position);
  ring.rotation.x = Math.PI / 2 * 0.8;
  scene.add(ring);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,200,140,0.9)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
  halo.scale.setScalar(120);
  halo.position.copy(hole.position);
  scene.add(halo);

  // The sheet of spacetime: a grid that sinks into a well under the hole.
  const sheetN = 160;
  const sheetGeo = new THREE.PlaneGeometry(500, 500, sheetN, sheetN);
  sheetGeo.rotateX(-Math.PI / 2);
  const shape = (x, z) => -48 * Math.exp(-(x * x + z * z) / (2 * 55 * 55)) - 6 * Math.exp(-(x * x + z * z) / (2 * 220 * 220));
  const sp2 = sheetGeo.attributes.position;
  for (let i = 0; i < sp2.count; i++) sp2.setY(i, shape(sp2.getX(i), sp2.getZ(i)));
  sheetGeo.computeVertexNormals();
  const gridTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#0b0820'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#6a58ff'; g.lineWidth = 3; g.strokeRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(50, 50); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const sheet = new THREE.Mesh(sheetGeo, new THREE.MeshStandardMaterial({ map: gridTex, emissive: 0x2a1f66, emissiveIntensity: 0.8, roughness: 0.6 }));
  scene.add(sheet);
  scene.add(new THREE.AmbientLight(0x667799, 0.6));

  return {
    id: 'blackhole',
    name: 'Black Hole',
    scene,
    background: new THREE.Color(0x000000),
    fog: null,
    waterY: -1000,
    spawn: { x: 90, y: 0, z: 60 },
    ghostAllowed: true,
    bounds: 300,
    ground: (x, z) => shape(x, z),
    blocked: () => false,
    update(dt, t) {
      diskMat.uniforms.uTime.value = t;
      disk.rotation.z += dt * 0.15;
      halo.material.opacity = 0.5 + 0.1 * Math.sin(t * 2);
    },
  };
}

// ---------- 4. The floating white void ----------
function buildVoid() {
  const scene = new THREE.Scene();
  const r = rng(91);
  const shapesN = 400;
  const geos = [new THREE.BoxGeometry(1, 1, 1), new THREE.SphereGeometry(0.6, 16, 12), new THREE.OctahedronGeometry(0.8, 0), new THREE.TorusKnotGeometry(0.5, 0.15, 48, 8)];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const group = new THREE.Group();
  const floats = [];
  for (let i = 0; i < shapesN; i++) {
    const m = new THREE.Mesh(geos[i % geos.length], mat);
    const s = 1 + r() * 6;
    m.scale.setScalar(s);
    m.position.set((r() - 0.5) * 300, 4 + r() * 90, (r() - 0.5) * 300);
    m.rotation.set(r() * 6, r() * 6, r() * 6);
    floats.push({ m, ph: r() * 6, sp: 0.1 + r() * 0.3, base: m.position.y });
    group.add(m);
  }
  scene.add(group);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdddddd, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(20, 40, 10);
  scene.add(sun);
  return {
    id: 'void',
    name: 'The Floating White Void',
    scene,
    background: new THREE.Color(0xf4f4f8),
    fog: new THREE.Fog(0xf4f4f8, 40, 380),
    waterY: -1000,
    spawn: { x: 0, y: 0, z: 0 },
    ghostAllowed: true,
    ground: () => 0,
    blocked: () => false,
    update(dt, t) {
      for (const f of floats) {
        f.m.rotation.x += dt * f.sp;
        f.m.rotation.y += dt * f.sp * 0.7;
        f.m.position.y = f.base + Math.sin(t * f.sp + f.ph) * 2;
      }
    },
  };
}

// ---------- 5. Heaven: golden clouds, light columns, a gate of light ----------
function buildHeaven() {
  const scene = new THREE.Scene();
  const cloudTex = glowTexture('rgba(255,250,230,0.95)');
  const clouds = [];
  const r = rng(13);
  for (let i = 0; i < 140; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.55 + r() * 0.3, depthWrite: false, color: new THREE.Color().setHSL(0.12, 0.6, 0.85) }));
    const a = r() * Math.PI * 2;
    const d = 60 + r() * 500;
    s.position.set(Math.cos(a) * d, r() * 20 - 4, Math.sin(a) * d);
    s.scale.set(60 + r() * 90, 30 + r() * 30, 1);
    scene.add(s);
    clouds.push(s);
  }
  const cloudFloor = new THREE.Mesh(new THREE.CircleGeometry(900, 64), new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffe49a, emissiveIntensity: 0.35, roughness: 1 }));
  cloudFloor.rotation.x = -Math.PI / 2;
  scene.add(cloudFloor);
  const beams = [];
  for (let i = 0; i < 12; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(3, 14, 500, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3c2, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const a = (i / 12) * Math.PI * 2;
    b.position.set(Math.cos(a) * 260, 250, Math.sin(a) * 260);
    scene.add(b);
    beams.push(b);
  }
  // A gate of light in the distance.
  const gate = new THREE.Group();
  const gateMat = new THREE.MeshBasicMaterial({ color: 0xfff4cc });
  const pillarL = new THREE.Mesh(new THREE.BoxGeometry(6, 90, 6), gateMat);
  pillarL.position.set(-22, 45, -320);
  const pillarR = pillarL.clone();
  pillarR.position.x = 22;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(50, 6, 6), gateMat);
  lintel.position.set(0, 90, -320);
  gate.add(pillarL, pillarR, lintel);
  scene.add(gate);
  scene.add(new THREE.HemisphereLight(0xfff6dd, 0xffd38a, 1.4));
  return {
    id: 'heaven',
    name: 'Heaven',
    scene,
    background: new THREE.Color(0xffe9b8),
    fog: new THREE.Fog(0xffe9b8, 80, 900),
    waterY: -1000,
    spawn: { x: 0, y: 0, z: 0 },
    ghostAllowed: true,
    ground: () => 0,
    blocked: () => false,
    update(dt, t) {
      clouds.forEach((c, i) => { c.position.y += Math.sin(t * 0.2 + i) * 0.002; });
      beams.forEach((b, i) => { b.material.opacity = 0.08 + 0.06 * Math.sin(t * 0.7 + i); });
    },
  };
}

export const REALM_LIST = [
  { id: 'backrooms', label: 'The Backrooms', blurb: 'Endless yellow rooms. Flickering light. Keep walking.' },
  { id: 'fractal', label: 'Infinity Fractal Maze', blurb: 'A raymarched Menger sponge that folds around you forever.' },
  { id: 'blackhole', label: 'Black Hole', blurb: 'Spacetime sinks into a well. The disk burns around the event horizon.' },
  { id: 'void', label: 'Floating White Void', blurb: 'Empty white space, drifting forms, and nothing to hold onto.' },
  { id: 'heaven', label: 'Heaven', blurb: 'Golden clouds and a gate of light. Ghosts come here to rest.' },
];

export function buildRealm(id) {
  switch (id) {
    case 'backrooms': return buildBackrooms();
    case 'fractal': return buildFractal();
    case 'blackhole': return buildBlackHole();
    case 'void': return buildVoid();
    case 'heaven': return buildHeaven();
    default: return null;
  }
}
