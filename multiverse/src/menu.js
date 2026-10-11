import * as THREE from 'three';
import { rng, lerp } from './util/noise.js';
import { glowTexture } from './textures.js';

// The 3D backdrop for the main menu: a turning galaxy, a holographic Lodamis globe and orbit rings.
export class MenuScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x01030a);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
    this.t = 0;
    this.pointer = { x: 0, y: 0 };
    this.shootTimer = 2;
    const r = rng(71);

    // Galaxy disc.
    const N = 30000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const rr = 18 + Math.pow(r(), 0.7) * 160;
      const arms = 3;
      const arm = (i % arms) * ((Math.PI * 2) / arms);
      const th = arm + Math.log(1 + rr) * 2.1 + (r() - 0.5) * 0.6;
      const y = (r() - 0.5) * (4 + rr * 0.05);
      pos.set([Math.cos(th) * rr, y, Math.sin(th) * rr], i * 3);
      const k = Math.min(1, rr / 170);
      col.set([lerp(1, 0.45, k), lerp(0.85, 0.6, k), lerp(0.6, 1, k)], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.disc = new THREE.Points(dg, new THREE.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.disc.rotation.x = 0.1;
    this.scene.add(this.disc);

    // Distant stars.
    const S = 5000;
    const sp = new Float32Array(S * 3);
    for (let i = 0; i < S; i++) {
      const u = r() * 2 - 1;
      const t = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      sp.set([s * Math.cos(t) * 1200, u * 1200, s * Math.sin(t) * 1200], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, color: 0xffffff, sizeAttenuation: false, transparent: true, opacity: 0.9 }));
    this.scene.add(this.stars);

    // Holographic Lodamis globe.
    this.globe = new THREE.Group();
    this.globe.position.set(0, 26, 0);
    const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(16, 3), new THREE.MeshBasicMaterial({ color: 0x0a2a44, transparent: true, opacity: 0.6 }));
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(16.25, 2), new THREE.MeshBasicMaterial({ color: 0x7ef3ff, wireframe: true, transparent: true, opacity: 0.35 }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(126,243,255,0.9)'), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(110);
    this.globe.add(inner, wire, halo);
    this.scene.add(this.globe);
    this.wire = wire;

    // Orbit rings.
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(26 + i * 9, 0.16, 8, 180), new THREE.MeshBasicMaterial({ color: i === 1 ? 0xff7bd9 : 0x7ef3ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.copy(this.globe.position);
      ring.rotation.set(Math.PI / 2 + i * 0.5, 0, i * 0.7);
      this.scene.add(ring);
      this.rings.push(ring);
    }

    // Shooting star.
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(-14, -2, 0)]);
    this.shoot = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xbff8ff, transparent: true, opacity: 0 }));
    this.scene.add(this.shoot);
    this.shootT = -1;
    this.shootStart = new THREE.Vector3();
    this.shootDir = new THREE.Vector3(1, -0.4, 0);
  }

  resize(w, h) {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setPointer(x, y) {
    this.pointer.x = x;
    this.pointer.y = y;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    this.disc.rotation.y += dt * 0.025;
    this.stars.rotation.y += dt * 0.004;
    this.globe.rotation.y += dt * 0.12;
    this.wire.rotation.x += dt * 0.05;
    this.rings.forEach((rg, i) => { rg.rotation.z += dt * (0.1 + i * 0.05) * (i % 2 ? -1 : 1); });

    const a = t * 0.035;
    const R = 230;
    this.camera.position.set(Math.sin(a) * R + this.pointer.x * 22, 70 + Math.sin(t * 0.2) * 6 - this.pointer.y * 14, Math.cos(a) * R);
    this.camera.lookAt(0, 16, 0);

    // Shooting stars every few seconds.
    this.shootTimer -= dt;
    if (this.shootTimer <= 0 && this.shootT < 0) {
      this.shootT = 0;
      this.shootTimer = 4 + Math.random() * 6;
      this.shootStart.set((Math.random() - 0.5) * 500, 180 + Math.random() * 120, (Math.random() - 0.5) * 500);
    }
    if (this.shootT >= 0) {
      this.shootT += dt;
      const p = this.shootT / 1.2;
      this.shoot.position.copy(this.shootStart).addScaledVector(this.shootDir, p * 280);
      this.shoot.lookAt(this.camera.position);
      this.shoot.material.opacity = Math.max(0, 1 - p) * 0.9;
      if (p >= 1) this.shootT = -1;
    }
  }
}
