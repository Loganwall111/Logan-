import * as THREE from 'three';
import { makeLodamis } from './features.js';
import { glowTexture, rustPlanetTexture } from './textures.js';
import { rng, lerp, clamp } from './util/noise.js';

// Four-part cinematic. Each scene is paired with one narration clip.
export class Intro {
  constructor(renderer, { clips, onDone, audio, ui }) {
    this.renderer = renderer;
    this.clips = clips;
    this.onDone = onDone;
    this.audio = audio;
    this.ui = ui; // { subtitle(el), flash(), setSubtitle(text, progress) }
    this.scenes = [this.buildBigBang(), this.buildGrain(), this.buildGalaxies(), this.buildPlugIn()];
    this.index = -1;
    this.localStart = 0;
    this.localT = 0;
    this.done = false;
    this.timer = null;
  }

  get aspect() {
    return this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
  }

  resize() {
    for (const s of this.scenes) {
      s.camera.aspect = this.aspect;
      s.camera.updateProjectionMatrix();
    }
  }

  start() {
    this.resize();
    this.playClip(0);
  }

  playClip(i) {
    if (this.done) return;
    if (i >= this.clips.length) {
      this.finish();
      return;
    }
    this.index = i;
    this.localStart = performance.now();
    this.clip = this.clips[i];
    this.scenes[i].enter?.();
    this.ui.flash();
    const estimate = this.clip.text.split(/\s+/).length / 2.5 + 1.2;
    this.duration = estimate;
    this.typed = 0;
    const advance = () => this.playClip(i + 1);
    if (this.audio) {
      this.audio.playVoice(this.clip.src).then(advance).catch(() => {
        this.timer = setTimeout(advance, estimate * 1000);
      });
      // Read the true length once metadata is known (for typing speed).
      const probe = new Audio(this.clip.src);
      probe.addEventListener('loadedmetadata', () => { if (isFinite(probe.duration)) this.duration = probe.duration; });
    } else {
      this.timer = setTimeout(advance, estimate * 1000);
    }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    this.audio?.stopVoice();
    this.onDone();
  }

  skip() {
    this.finish();
  }

  update(dt) {
    if (this.done || this.index < 0) return;
    const lt = (performance.now() - this.localStart) / 1000;
    this.localT = lt;
    const s = this.scenes[this.index];
    s.update(lt, dt);
    const p = clamp(lt / Math.max(1, this.duration), 0, 1);
    this.ui.setSubtitle(this.clip.text, p);
    this.renderer.render(s.scene, s.camera);
  }

  // ---------- Scene 1: before life, the burst ----------
  buildBigBang() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
    const N = 16000;
    const r = rng(9);
    const dirs = new Float32Array(N * 3);
    const speeds = new Float32Array(N);
    const colors = new Float32Array(N * 3);
    const pal = [[1, 0.95, 0.8], [1, 0.62, 0.28], [0.55, 0.75, 1], [1, 0.35, 0.55], [0.9, 0.95, 1]];
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1;
      const t = r() * Math.PI * 2;
      const sq = Math.sqrt(1 - u * u);
      dirs.set([sq * Math.cos(t), u, sq * Math.sin(t)], i * 3);
      speeds[i] = 40 + Math.pow(r(), 2) * 220;
      const c = pal[Math.floor(r() * pal.length)];
      colors.set(c, i * 3);
    }
    const pos = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    pts.frustumCulled = false;
    scene.add(pts);

    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,250,235,1)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(core);
    const shock = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 160), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(shock);
    const shock2 = shock.clone();
    shock2.material = shock.material.clone();
    shock2.material.color.set(0xffb27a);
    scene.add(shock2);

    const BURST = 2.6;
    const ui = this.ui;
    let flashed = false;
    return {
      scene,
      camera,
      enter() { flashed = false; },
      update(lt) {
        const b = Math.max(0, lt - BURST);
        const sh = Math.max(0, 1 - b / 3) * 1.2;
        camera.position.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, 70 - Math.min(lt, 12) * 1.5);
        camera.lookAt(0, 0, 0);
        if (lt < BURST) {
          // The dark, then a single point of potential.
          const pulse = 0.5 + 0.5 * Math.sin(lt * 3.1);
          core.scale.setScalar(0.4 + pulse * 0.6 * (lt / BURST));
          core.material.opacity = 0.2 + 0.6 * (lt / BURST) * pulse;
          pts.visible = false;
          shock.material.opacity = 0;
          shock2.material.opacity = 0;
        } else {
          if (!flashed) { flashed = true; ui.flash('white'); }
          pts.visible = true;
          const p = geo.attributes.position.array;
          for (let i = 0; i < N; i++) {
            const d = speeds[i] * (1 - Math.exp(-b * 0.9)) / 0.9 * 1.2;
            p[i * 3] = dirs[i * 3] * d;
            p[i * 3 + 1] = dirs[i * 3 + 1] * d;
            p[i * 3 + 2] = dirs[i * 3 + 2] * d;
          }
          geo.attributes.position.needsUpdate = true;
          pts.material.size = 1.6 * Math.max(0.2, 1 - b / 12);
          core.scale.setScalar(20 + b * 40);
          core.material.opacity = Math.max(0, 1 - b / 2.5);
          shock.scale.setScalar(b * 160 + 1);
          shock.material.opacity = Math.max(0, 0.8 - b * 0.25);
          shock2.scale.setScalar(b * 110 + 1);
          shock2.material.opacity = Math.max(0, 0.6 - b * 0.22);
          shock.lookAt(camera.position);
          shock2.lookAt(camera.position);
        }
      },
    };
  }

  // ---------- Scene 2: a single grain of dust, an atom-like shell ----------
  buildGrain() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03030a);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    const r = rng(21);
    scene.add(new THREE.AmbientLight(0x404a60, 0.6));
    const key = new THREE.PointLight(0xffd7a0, 180, 0, 2);
    key.position.set(6, 5, 8);
    scene.add(key);
    const grainGeo = new THREE.IcosahedronGeometry(1.3, 3);
    const gp = grainGeo.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const k = 0.85 + r() * 0.3;
      gp.setXYZ(i, gp.getX(i) * k, gp.getY(i) * k, gp.getZ(i) * k);
    }
    grainGeo.computeVertexNormals();
    const grain = new THREE.Mesh(grainGeo, new THREE.MeshStandardMaterial({ color: 0x8e8073, roughness: 0.95, metalness: 0.05, flatShading: true }));
    scene.add(grain);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,200,140,1)'), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(8);
    scene.add(glow);

    const rings = [];
    const electrons = [];
    for (let i = 0; i < 3; i++) {
      const rad = 2.6 + i * 1.1;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.02, 8, 160), new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.35 }));
      ring.rotation.set(i * 0.9, i * 0.6, i * 0.3);
      scene.add(ring);
      rings.push(ring);
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
      scene.add(e);
      electrons.push({ mesh: e, rad, speed: 0.8 + i * 0.35, ring });
    }

    const motesN = 1500;
    const mp = new Float32Array(motesN * 3);
    for (let i = 0; i < motesN; i++) mp.set([(r() - 0.5) * 60, (r() - 0.5) * 60, (r() - 0.5) * 60], i * 3);
    const motesGeo = new THREE.BufferGeometry();
    motesGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    const motes = new THREE.Points(motesGeo, new THREE.PointsMaterial({ size: 0.14, color: 0xffe9c8, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(motes);

    return {
      scene,
      camera,
      update(lt, dt) {
        grain.rotation.y += dt * 0.15;
        grain.rotation.x += dt * 0.05;
        const pull = lt > 7 ? 1 + (lt - 7) * 0.9 : 1;
        const orbit = 9.5 + Math.min(pull, 12) * 2;
        camera.position.set(Math.sin(lt * 0.18) * orbit * 0.6, 1.5 + Math.sin(lt * 0.1) * 1.2, Math.cos(lt * 0.18) * orbit);
        camera.lookAt(0, 0, 0);
        for (const e of electrons) {
          const a = lt * e.speed;
          e.mesh.position.set(Math.cos(a) * e.rad, 0, Math.sin(a) * e.rad);
          e.mesh.position.applyEuler(e.ring.rotation);
        }
        motes.rotation.y += dt * 0.02;
        glow.material.opacity = 0.25 + 0.1 * Math.sin(lt * 1.3);
      },
    };
  }

  // ---------- Scene 3: galaxies, the dead Earth, the meteor, Lodamis ----------
  buildGalaxies() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010106);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 6000);
    const galaxies = [];
    const r = rng(33);
    for (let g = 0; g < 9; g++) {
      const N = 3500;
      const arms = 2 + Math.floor(r() * 3);
      const p = new Float32Array(N * 3);
      const c = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const rr = 4 + Math.pow(r(), 0.65) * 70;
        const arm = (i % arms) * ((Math.PI * 2) / arms);
        const th = arm + Math.log(1 + rr) * 2.4 + (r() - 0.5) * 0.7;
        const y = (r() - 0.5) * (6 + rr * 0.06);
        p.set([Math.cos(th) * rr, y, Math.sin(th) * rr], i * 3);
        const k = rr / 74;
        c.set([lerp(1, 0.55, k), lerp(0.9, 0.7, k), lerp(0.7, 1, k)], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.4, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      const s = 0.8 + r() * 1.6;
      pts.scale.setScalar(s);
      pts.position.set((r() - 0.5) * 700, (r() - 0.5) * 300, (r() - 0.5) * 700 - 180);
      pts.rotation.set(r() * 0.8, r() * 6, 0);
      scene.add(pts);
      galaxies.push(pts);
    }
    // Background stars.
    const sN = 2500;
    const sp = new Float32Array(sN * 3);
    for (let i = 0; i < sN; i++) sp.set([(r() - 0.5) * 2000, (r() - 0.5) * 2000, (r() - 0.5) * 2000], i * 3);
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ size: 1.2, color: 0xffffff, sizeAttenuation: false })));

    // The dead Earth.
    const earthPos = new THREE.Vector3(0, -6, -60);
    const earth = new THREE.Mesh(new THREE.SphereGeometry(14, 64, 48), new THREE.MeshStandardMaterial({ map: rustPlanetTexture(9), roughness: 0.95 }));
    earth.position.copy(earthPos);
    scene.add(earth);
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
    sun.position.set(-80, 40, 60);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x303848, 0.6));

    // The meteor.
    const meteorStart = new THREE.Vector3(90, 70, 10);
    const meteorEnd = earthPos.clone().add(new THREE.Vector3(3, 9, 6));
    const meteor = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), new THREE.MeshBasicMaterial({ color: 0xffa050 }));
    scene.add(meteor);
    const trailN = 90;
    const trailPos = new Float32Array(trailN * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ size: 1.8, color: 0xffb070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(trail);
    const impact = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,170,90,1)'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    impact.position.copy(meteorEnd);
    scene.add(impact);

    // Lodamis, hanging above the ruins.
    const lodamis = makeLodamis();
    lodamis.position.set(-16, -4, -44);
    lodamis.scale.setScalar(0.12);
    scene.add(lodamis);

    return {
      scene,
      camera,
      update(lt, dt) {
        for (const g of galaxies) g.rotation.y += dt * 0.02;
        camera.position.set(Math.sin(lt * 0.1) * 26, 12 + Math.sin(lt * 0.07) * 6, 150 - lt * 9);
        camera.lookAt(earthPos.x, earthPos.y, earthPos.z);
        earth.rotation.y += dt * 0.05;

        const p = clamp((lt - 6) / 9, 0, 1);
        const eased = Math.pow(p, 1.6);
        meteor.position.lerpVectors(meteorStart, meteorEnd, eased);
        meteor.visible = lt > 6 && p < 1;
        meteor.rotation.x += dt * 4;
        const tp = trailPos;
        for (let i = trailN - 1; i > 0; i--) {
          tp[i * 3] = tp[(i - 1) * 3];
          tp[i * 3 + 1] = tp[(i - 1) * 3 + 1];
          tp[i * 3 + 2] = tp[(i - 1) * 3 + 2];
        }
        tp[0] = meteor.position.x;
        tp[1] = meteor.position.y;
        tp[2] = meteor.position.z;
        trailGeo.attributes.position.needsUpdate = true;
        trail.visible = lt > 6;
        impact.material.opacity = p >= 1 ? Math.max(0, 0.9 - (lt - 15) * 0.25) : 0;
        impact.scale.setScalar(6 + Math.max(0, lt - 15) * 6);

        const lodamisIn = clamp((lt - 12) / 4, 0, 1);
        lodamis.scale.setScalar(0.12 * lodamisIn);
        lodamis.userData.rings.forEach((rg, i) => { rg.rotation.z = lt * (0.5 + i * 0.3); });
        lodamis.userData.core.rotation.y = lt;
      },
    };
  }

  // ---------- Scene 4: plugging in, the endless tunnel, the white void ----------
  buildPlugIn() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
    const rings = [];
    const torus = new THREE.TorusGeometry(9, 0.14, 8, 64);
    for (let i = 0; i < 140; i++) {
      const m = new THREE.Mesh(torus, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL((i * 0.07) % 1, 1, 0.6), transparent: true, opacity: 0.9 }));
      m.position.z = -i * 14;
      scene.add(m);
      rings.push(m);
    }
    // Fractal-like nested cages in the distance.
    const cages = [];
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(10 - k * 2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.55 + k * 0.1, 1, 0.6), wireframe: true, transparent: true, opacity: 0.6 }));
      c.position.set(0, 0, -260);
      scene.add(c);
      cages.push(c);
    }
    const voidGlow = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    voidGlow.position.set(0, 0, -600);
    scene.add(voidGlow);

    return {
      scene,
      camera,
      update(lt, dt) {
        camera.position.set(Math.sin(lt * 0.9) * 0.8, Math.cos(lt * 1.1) * 0.6, 4 - lt * 22);
        camera.lookAt(camera.position.x * 0.2, camera.position.y * 0.2, camera.position.z - 20);
        rings.forEach((m, i) => {
          m.rotation.z += dt * (0.4 + (i % 5) * 0.1) * (i % 2 ? 1 : -1);
          const h = (i * 0.07 + lt * 0.2) % 1;
          m.material.color.setHSL(h, 1, 0.6);
        });
        cages.forEach((c, k) => {
          c.rotation.x += dt * (0.4 + k * 0.2);
          c.rotation.y += dt * (0.3 - k * 0.1);
          c.position.z = camera.position.z - 260;
        });
        voidGlow.position.z = camera.position.z - 600;
        voidGlow.material.opacity = clamp((lt - 14) / 8, 0, 1);
        if (lt > 14) scene.background.setRGB(clamp((lt - 14) / 8, 0, 1), clamp((lt - 14) / 8, 0, 1), clamp((lt - 14) / 8, 0, 1));
      },
    };
  }
}
