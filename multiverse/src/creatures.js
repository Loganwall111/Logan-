import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, WATER_Y, scatter, normalYAt } from './terrain.js';
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
function part(geo, hex, x, y, z, rz = 0) {
  const g = paint(clean(geo), hex);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

// A low-poly stag built from merged boxes, origin at the hooves.
function makeDeerGeometry() {
  const body = '#8a5a34';
  const belly = '#c9a77a';
  const parts = [
    part(new THREE.BoxGeometry(2.2, 0.95, 0.75), body, 0, 1.45, 0),
    part(new THREE.BoxGeometry(0.9, 0.5, 0.6), belly, 0, 1.0, 0),
    part(new THREE.BoxGeometry(0.36, 1.0, 0.36), body, 1.05, 1.95, 0, -0.45),
    part(new THREE.BoxGeometry(0.6, 0.48, 0.38), body, 1.5, 2.45, 0, 0.05),
    part(new THREE.BoxGeometry(0.22, 0.2, 0.3), '#2a2018', 1.85, 2.38, 0),
    part(new THREE.BoxGeometry(0.1, 0.5, 0.1), '#e8dcc2', 1.3, 2.95, 0.22, -0.3),
    part(new THREE.BoxGeometry(0.1, 0.5, 0.1), '#e8dcc2', 1.3, 2.95, -0.22, -0.3),
    part(new THREE.BoxGeometry(0.14, 1.0, 0.14), body, 0.75, 0.5, 0.26),
    part(new THREE.BoxGeometry(0.14, 1.0, 0.14), body, 0.75, 0.5, -0.26),
    part(new THREE.BoxGeometry(0.14, 1.0, 0.14), body, -0.75, 0.5, 0.26),
    part(new THREE.BoxGeometry(0.14, 1.0, 0.14), body, -0.75, 0.5, -0.26),
    part(new THREE.BoxGeometry(0.16, 0.3, 0.16), '#f2ebd8', -1.15, 1.6, 0, 0.6),
  ];
  return mergeGeometries(parts);
}

export function buildCreatures(quality = 'high') {
  const group = new THREE.Group();
  group.name = 'creatures';
  const deerCount = quality === 'high' ? 46 : 20;
  const deerSpots = scatter(deerCount, 606, (x, z, h, ny) => h > WATER_Y + 2 && h < 60 && ny > 0.9 && Math.abs(x) < 700);
  const deerGeo = makeDeerGeometry();
  const deerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const deer = [];
  const r = rng(12);
  for (const s of deerSpots) {
    const m = new THREE.Mesh(deerGeo, deerMat);
    m.castShadow = quality === 'high';
    m.position.set(s.x, s.h, s.z);
    m.rotation.y = r() * 6.28;
    m.scale.setScalar(0.9 + r() * 0.2);
    group.add(m);
    deer.push({
      mesh: m, home: new THREE.Vector2(s.x, s.z), target: new THREE.Vector2(s.x, s.z),
      speed: 1.6, fleeT: 0, phase: r() * 10, dir: new THREE.Vector2(Math.sin(m.rotation.y), Math.cos(m.rotation.y)),
      pickT: 0,
    });
  }

  // Birds: flocks wheeling in the upper air.
  const birds = [];
  const birdBodyGeo = new THREE.BoxGeometry(0.2, 0.12, 1.1);
  const wingGeo = new THREE.BoxGeometry(1.4, 0.05, 0.4);
  const birdMat = new THREE.MeshStandardMaterial({ color: 0x1e1e26, roughness: 0.8 });
  const flockCount = quality === 'high' ? 60 : 24;
  const flockCenter = new THREE.Vector3(120, 120, -80);
  for (let i = 0; i < flockCount; i++) {
    const b = new THREE.Group();
    const body = new THREE.Mesh(birdBodyGeo, birdMat);
    const wl = new THREE.Mesh(wingGeo, birdMat);
    const wr = new THREE.Mesh(wingGeo, birdMat);
    wl.position.x = -0.7;
    wr.position.x = 0.7;
    b.add(body, wl, wr);
    const rad = 60 + r() * 140;
    const alt = 90 + r() * 80;
    b.userData = { rad, alt, speed: 0.12 + r() * 0.12, phase: r() * 6.28, wl, wr };
    group.add(b);
    birds.push(b);
  }

  // Fish schools in the lakes and sea.
  const fishCount = quality === 'high' ? 360 : 140;
  const fishSpots = scatter(fishCount, 707, (x, z, h) => h < WATER_Y - 2.5 && Math.abs(x) < 700, fishCount * 80);
  const fishGeo = new THREE.IcosahedronGeometry(1, 1);
  fishGeo.scale(0.25, 0.22, 0.9);
  const fishMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2 });
  const fish = new THREE.InstancedMesh(fishGeo, fishMat, Math.max(1, fishSpots.length));
  const colors = ['#ffb347', '#9ad0ff', '#f2f2f2', '#ff6f61', '#c8ff7e'];
  const col = new THREE.Color();
  const fishData = fishSpots.map((s, i) => {
    fish.setColorAt(i, col.set(colors[Math.floor(s.r * 50) % colors.length]));
    return { ax: s.x, az: s.z, r: 4 + s.r * 14, sp: 0.3 + s.r * 0.6, ph: s.r * 20, depth: s.h };
  });
  fish.frustumCulled = false;
  group.add(fish);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const e = new THREE.Euler();

  return {
    group,
    update(dt, time, player) {
      // Deer: wander, graze, flee from the player.
      for (const d of deer) {
        const m = d.mesh;
        const dx = m.position.x - player.x;
        const dz = m.position.z - player.z;
        const dist = Math.hypot(dx, dz);
        d.pickT -= dt;
        if (dist < 18) {
          d.fleeT = 4;
          d.target.set(m.position.x + dx * 4, m.position.z + dz * 4);
        }
        let speed = 0;
        if (d.fleeT > 0) {
          d.fleeT -= dt;
          speed = 6.5;
        } else if (d.pickT <= 0) {
          const a = r() * 6.28;
          const rr = 10 + r() * 30;
          d.target.set(d.home.x + Math.cos(a) * rr, d.home.y + Math.sin(a) * rr);
          d.pickT = 6 + r() * 8;
          speed = 0;
        }
        if (d.fleeT <= 0 && d.pickT > 0) {
          // Grazing: sometimes stand still.
          speed = Math.sin(time * 0.2 + d.phase) > -0.3 ? d.speed : 0;
        }
        const tx = d.target.x - m.position.x;
        const tz = d.target.y - m.position.z;
        const tl = Math.hypot(tx, tz);
        if (tl > 0.5 && speed > 0) {
          const nx = m.position.x + (tx / tl) * speed * dt;
          const nz = m.position.z + (tz / tl) * speed * dt;
          // Keep out of the water and off cliffs.
          if (heightAt(nx, nz) > WATER_Y + 1.0 && normalYAt(nx, nz) > 0.8) {
            m.position.x = nx;
            m.position.z = nz;
            m.rotation.y = Math.atan2(tx, tz);
          } else {
            d.target.set(d.home.x, d.home.y);
            d.fleeT = 0;
          }
        }
        const moving = speed > 0 && tl > 0.5;
        m.position.y = heightAt(m.position.x, m.position.z) + (moving ? Math.abs(Math.sin(time * speed * 3.2 + d.phase)) * 0.08 : 0);
      }

      // Birds: circle the valley, flap their wings.
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        const u = b.userData;
        const a = u.phase + time * u.speed;
        b.position.set(flockCenter.x + Math.cos(a) * u.rad, u.alt + Math.sin(time * 0.3 + i) * 6, flockCenter.z + Math.sin(a) * u.rad);
        b.rotation.set(0, -a + Math.PI / 2, 0);
        const flap = Math.sin(time * 8 + i) * 0.5;
        u.wl.rotation.z = flap;
        u.wr.rotation.z = -flap;
      }

      // Fish: each school swims around its anchor, kept below the surface and above the lakebed.
      for (let i = 0; i < fishData.length; i++) {
        const f = fishData[i];
        const a = time * f.sp * 0.4 + f.ph;
        const x = f.ax + Math.cos(a) * f.r;
        const z = f.az + Math.sin(a * 1.3) * f.r;
        const floor = heightAt(x, z);
        const y = Math.min(-0.8, Math.max(floor + 0.8, -2.5 + Math.sin(a * 0.7) * 1.2));
        const dxa = -Math.sin(a) * f.r;
        const dza = Math.cos(a * 1.3) * 1.3 * f.r;
        e.set(0, Math.atan2(dxa, dza), 0);
        q.setFromEuler(e);
        p.set(x, y, z);
        sc.set(1, 1, 1);
        m4.compose(p, q, sc);
        fish.setMatrixAt(i, m4);
      }
      fish.instanceMatrix.needsUpdate = true;
    },
  };
}
