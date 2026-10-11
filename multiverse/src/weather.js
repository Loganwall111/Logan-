import * as THREE from 'three';
import { rng } from './util/noise.js';

// ---------- Rain: GPU-animated streaks around the camera ----------
const rainVertex = /* glsl */ `
  attribute vec4 seed;
  attribute float endF;
  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uAmt;
  varying float vA;
  void main() {
    float fall = fract(seed.z + uTime * (0.55 + seed.w * 0.35));
    vec3 p = vec3((seed.x - 0.5) * 110.0, (1.0 - fall) * 38.0 - 14.0, (seed.y - 0.5) * 110.0);
    p += mix(vec3(0.0), vec3(-0.7, -1.6, -0.25), endF);
    vec4 mv = viewMatrix * vec4(uCenter + p, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = uAmt * smoothstep(0.0, 0.08, fall) * (0.25 + 0.75 * seed.w) * (1.0 - endF * 0.5);
  }
`;
const rainFragment = /* glsl */ `
  varying float vA;
  void main() { gl_FragColor = vec4(0.72, 0.8, 0.9, vA * 0.4); }
`;

// ---------- Rainbow: a billboard ring with physically ordered colours ----------
const rainbowFragment = /* glsl */ `
  uniform float uStrength;
  varying vec2 vUv;
  vec3 spectrum(float t) {
    // t = 0 violet -> 1 red
    return clamp(vec3(1.5 - abs(t * 4.0 - 3.0), 1.5 - abs(t * 4.0 - 2.0), 1.5 - abs(t * 4.0 - 1.0)), 0.0, 1.0);
  }
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    // r = 1.0 at the primary bow (42 degrees). Quad half-size 1300 at 900 units => scale 1300/810.
    float r = length(p) * (1300.0 / 810.0);
    // Primary bow: violet inside (40 deg), red outside (42 deg).
    float primary = smoothstep(0.948, 0.962, r) * (1.0 - smoothstep(0.995, 1.01, r));
    float tP = clamp((r - 0.952) / 0.048, 0.0, 1.0);
    // Secondary bow (50-53 deg): red inside, violet outside, fainter.
    float secondary = smoothstep(1.315, 1.33, r) * (1.0 - smoothstep(1.465, 1.48, r));
    float tS = clamp((r - 1.32) / 0.15, 0.0, 1.0);
    vec3 col = spectrum(tP) * primary + spectrum(1.0 - tS) * secondary;
    float a = (primary * 0.75 + secondary * 0.3) * uStrength;
    gl_FragColor = vec4(col, a);
  }
`;
const billboardVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// ---------- God rays: soft additive shafts from the sun (also visible from under water) ----------
const shaftFragment = /* glsl */ `
  uniform float uStrength;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float fade = pow(across, 3.0) * smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
    gl_FragColor = vec4(uColor, fade * uStrength * 0.22);
  }
`;

export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.rainAmt = 0;       // 0..1 smoothed
    this.rainTarget = 0;
    this.autoTimer = 90 + Math.random() * 60;
    this.time = 0;
    this.rainbowStrength = 0;

    // Rain
    const N = 9000;
    const r = rng(7);
    const seeds = new Float32Array(N * 2 * 4);
    const ends = new Float32Array(N * 2);
    const pos = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N; i++) {
      const s = [r(), r(), r(), r()];
      for (let v = 0; v < 2; v++) {
        seeds.set(s, (i * 2 + v) * 4);
        ends[i * 2 + v] = v;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('endF', new THREE.BufferAttribute(ends, 1));
    this.rainUniforms = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uAmt: { value: 0 } };
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: this.rainUniforms, vertexShader: rainVertex, fragmentShader: rainFragment,
      transparent: true, depthWrite: false,
    });
    this.rain = new THREE.LineSegments(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 50;
    scene.add(this.rain);

    // Rainbow
    this.rainbowMat = new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: 0 } },
      vertexShader: billboardVertex,
      fragmentShader: rainbowFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.rainbow = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), this.rainbowMat);
    this.rainbow.visible = false;
    this.rainbow.renderOrder = 60;
    scene.add(this.rainbow);

    // God rays: long tilted shafts that always stay around the camera.
    this.shafts = new THREE.Group();
    this.shafts.name = 'godrays';
    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: 0 }, uColor: { value: new THREE.Color(1, 0.95, 0.8) } },
      vertexShader: billboardVertex,
      fragmentShader: shaftFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shaftList = [];
    const sr = rng(99);
    for (let i = 0; i < 14; i++) {
      const w = 40 + sr() * 70;
      const h = 320 + sr() * 240;
      const geoS = new THREE.PlaneGeometry(w, h, 1, 1);
      geoS.translate(0, h / 2, 0);
      const m = new THREE.Mesh(geoS, this.shaftMat);
      m.userData.angle = sr() * Math.PI * 2;
      m.userData.radius = 20 + sr() * 120;
      m.userData.tilt = (sr() - 0.5) * 0.25;
      m.renderOrder = 70;
      this.shafts.add(m);
      this.shaftList.push(m);
    }
    scene.add(this.shafts);
  }

  toggleRain() {
    this.rainTarget = this.rainTarget > 0.5 ? 0 : 1;
    return this.rainTarget;
  }

  get label() {
    if (this.rainAmt > 0.6) return 'Rain';
    if (this.rainAmt > 0.15) return 'Drizzle';
    return 'Clear';
  }

  update(dt, camera, sky) {
    this.time += dt;
    // Automatic weather: rain rolls in now and then.
    this.autoTimer -= dt;
    if (this.autoTimer <= 0) {
      this.rainTarget = this.rainTarget > 0.5 ? 0 : 1;
      this.autoTimer = this.rainTarget > 0.5 ? 120 + Math.random() * 90 : 150 + Math.random() * 200;
    }
    this.rainAmt += (this.rainTarget - this.rainAmt) * Math.min(1, dt * 0.35);

    this.rainUniforms.uTime.value = this.time;
    this.rainUniforms.uAmt.value = this.rainAmt;
    this.rainUniforms.uCenter.value.copy(camera.position);
    this.rain.visible = this.rainAmt > 0.01;

    // Rainbow appears when rain is easing off while the sun is low and shining.
    const e = sky.elev;
    const sunOk = Math.max(0, Math.min(1, (e - 0.02) / 0.1)) * Math.max(0, Math.min(1, (0.6 - e) / 0.15));
    const target = Math.min(1, this.rainAmt * 1.5) * sunOk;
    this.rainbowStrength += (target - this.rainbowStrength) * Math.min(1, dt * 0.8);
    this.rainbowMat.uniforms.uStrength.value = this.rainbowStrength;
    this.rainbow.visible = this.rainbowStrength > 0.01;
    if (this.rainbow.visible) {
      const anti = sky.sunDir.clone().negate();
      this.rainbow.position.copy(camera.position).addScaledVector(anti, 900);
      this.rainbow.lookAt(camera.position);
    }

    // God rays: visible in daylight, strongest in clear weather, and they follow the camera.
    const shaftStrength = sky.day * (1 - this.rainAmt * 0.6) * Math.max(0, Math.min(1, sky.elev * 3));
    this.shaftMat.uniforms.uStrength.value = shaftStrength;
    this.shafts.visible = shaftStrength > 0.01;
    this.shafts.position.set(camera.position.x, 0, camera.position.z);
    for (const m of this.shaftList) {
      const a = m.userData.angle + this.time * 0.01;
      m.position.set(Math.cos(a) * m.userData.radius, 0, Math.sin(a) * m.userData.radius);
      // Face the camera around the vertical axis, then lean the shaft toward the away-from-sun direction.
      const yaw = Math.atan2(camera.position.x - (this.shafts.position.x + m.position.x), camera.position.z - (this.shafts.position.z + m.position.z));
      m.rotation.set(0, yaw, m.userData.tilt + Math.atan2(sky.sunDir.x, sky.sunDir.y) * 0.08, 'YXZ');
    }
  }
}
