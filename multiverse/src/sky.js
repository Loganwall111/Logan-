import * as THREE from 'three';
import { smooth, rng } from './util/noise.js';
import { glowTexture, moonTexture, gasGiantTexture, oceanPlanetTexture, rustPlanetTexture, ringTexture } from './textures.js';

export const SKY_RADIUS = 5000;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // always at far plane
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform float uDay;
  uniform float uNight;
  uniform float uCloud;
  uniform float uRain;
  uniform float uAurora;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    // Below the horizon: darker ground haze.
    col = mix(col, uHorizon * 0.5, 1.0 - smoothstep(-0.25, 0.0, h));

    // Sun: glow + disc.
    float sd = dot(d, uSunDir);
    col += uSunColor * (pow(max(sd, 0.0), 12.0) * 0.45 + pow(max(sd, 0.0), 300.0) * 6.0 + smoothstep(0.9995, 0.9999, sd) * 40.0) * uDay;

    // Milky Way band across the night sky.
    float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.85, 0.4))) * 3.5, 2.0));
    float mw = fbm(d.xz / (abs(d.y) + 0.3) * 4.0) * band * 0.9;
    col += vec3(0.55, 0.6, 0.85) * mw * uNight * 0.7;

    // Clouds: a projected noise layer above the horizon.
    if (h > 0.02) {
      vec2 cp = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
      float cover = mix(0.56, 0.36, uRain);
      float c = smoothstep(cover, cover + 0.22, fbm(cp) * (0.9 + 0.1 * uCloud));
      float lit = clamp(0.35 + 0.65 * max(dot(d, uSunDir) * 0.5 + 0.5, 0.0), 0.0, 1.0) * uDay;
      vec3 cc = mix(vec3(0.18, 0.2, 0.25), vec3(1.0, 0.97, 0.92), lit) * (0.35 + 0.65 * (1.0 - uRain * 0.6));
      cc = mix(cc, uHorizon, 0.15);
      col = mix(col, cc, c * uCloud * smoothstep(0.02, 0.2, h) * 0.92);
    }

    // Aurora borealis: curtains in the north-ish sky.
    float ah = smoothstep(0.08, 0.25, h) * (1.0 - smoothstep(0.55, 0.9, h));
    float az = atan(d.z, d.x);
    float curtain = sin(az * 9.0 + fbm(vec2(az * 3.0, uTime * 0.05)) * 6.0 + uTime * 0.08) * 0.5 + 0.5;
    float rays = fbm(vec2(az * 40.0, h * 6.0 - uTime * 0.25));
    float northMask = smoothstep(-0.6, 0.4, -d.z) * 0.9 + 0.1;
    float aur = ah * curtain * (0.3 + rays * 1.1) * northMask * uAurora;
    vec3 aurCol = mix(vec3(0.1, 1.0, 0.45), vec3(0.85, 0.2, 0.95), smoothstep(0.2, 0.7, h + 0.25 * sin(az * 2.0)));
    col += aurCol * aur * 1.25;

    // Moon glow.
    float md = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.25, 0.3, 0.45) * pow(md, 40.0) * 0.5 * uNight;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// Keyframed sky palette, indexed by sun elevation.
export class Sky {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.hour = 18.6;
    this.sunDir = new THREE.Vector3(1, 0, 0);
    this.moonDir = new THREE.Vector3(-1, 0, 0);
    this.elev = 0;
    this.day = 0;
    this.night = 0;
    this.uniforms = {
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uDay: { value: 0 },
      uNight: { value: 0 },
      uCloud: { value: 0.45 },
      uRain: { value: 0 },
      uAurora: { value: 0 },
      uTime: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    dome.name = 'sky';
    this.dome = dome;
    scene.add(dome);
    scene.userData.sky = dome;

    this.buildStars();
    this.buildBodies();
    this.buildPlanets();
    this.setHour(this.hour);
  }

  buildStars() {
    const r = rng(42);
    const N = 9000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1;
      const t = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = SKY_RADIUS * 0.9;
      pos.set([R * s * Math.cos(t), R * u, R * s * Math.sin(t)], i * 3);
      const tint = r();
      const c = tint < 0.7 ? [1, 1, 1] : tint < 0.85 ? [0.7, 0.8, 1] : [1, 0.85, 0.6];
      const k = 0.5 + 0.5 * r();
      col.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 2.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -900;
    this.scene.add(this.stars);
  }

  buildBodies() {
    // Sun and moon are billboard sprites placed on the sky sphere.
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,250,230,1)'), color: 0xffffff, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    }));
    this.sunSprite.scale.setScalar(900);
    this.sunSprite.renderOrder = -800;
    this.scene.add(this.sunSprite);

    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: moonTexture(), transparent: true, depthWrite: false, fog: false,
    }));
    this.moonSprite.scale.setScalar(340);
    this.moonSprite.renderOrder = -800;
    this.scene.add(this.moonSprite);

    this.moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(170,190,255,0.8)'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.6,
    }));
    this.moonGlow.scale.setScalar(1100);
    this.moonGlow.renderOrder = -801;
    this.scene.add(this.moonGlow);
  }

  buildPlanets() {
    // Far away planets in the night sky. Each is a lit sphere placed on the sky at a fixed direction.
    const defs = [
      { dir: [-0.6, 0.35, -0.7], r: 230, tex: () => oceanPlanetTexture(5), name: 'Verdant' },
      { dir: [0.7, 0.22, -0.45], r: 140, tex: () => rustPlanetTexture(8), name: 'Ember' },
      { dir: [0.2, 0.55, 0.7], r: 320, tex: () => gasGiantTexture(['#e8c79a', '#b57a4b', '#f2dcb8', '#8a5a36', '#d9a06a'], 3), name: 'Gilded Giant', ring: true },
      { dir: [-0.8, 0.12, 0.45], r: 90, tex: () => gasGiantTexture(['#7fd3ff', '#3f7fd6', '#b3f0ff', '#2c4fa8'], 14), name: 'Azure' },
    ];
    this.planets = [];
    this.planetGroup = new THREE.Group();
    this.planetGroup.name = 'planets';
    this.scene.add(this.planetGroup);
    const sunLight = new THREE.DirectionalLight(0xffffff, 0);
    for (const d of defs) {
      const dir = new THREE.Vector3(...d.dir).normalize();
      const mat = new THREE.MeshBasicMaterial({ map: d.tex(), transparent: true, opacity: 0, fog: false, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(d.r, 48, 32), mat);
      mesh.position.copy(dir).multiplyScalar(SKY_RADIUS * 0.82);
      mesh.userData.dir = dir;
      mesh.userData.spin = 0.01 + Math.random() * 0.02;
      mesh.renderOrder = -700;
      this.planetGroup.add(mesh);
      if (d.ring) {
        const ringMat = new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
        const ring = new THREE.Mesh(new THREE.RingGeometry(d.r * 1.35, d.r * 2.3, 128), ringMat);
        ring.rotation.x = Math.PI / 2 - 0.35;
        mesh.add(ring);
        mesh.userData.ring = ring;
      }
      this.planets.push(mesh);
    }
    this.planetLight = sunLight;
  }

  // hour in [0, 24). Noon = 12, midnight = 0.
  setHour(hour) {
    this.hour = ((hour % 24) + 24) % 24;
    const theta = ((this.hour - 6) / 24) * Math.PI * 2;
    // Sun travels east to west on a tilted arc.
    this.sunDir.set(Math.cos(theta), Math.sin(theta), 0.32).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);
    this.moonDir.z += 0.25;
    this.moonDir.normalize();
    this.elev = this.sunDir.y;

    const e = this.elev;
    this.day = smooth(-0.08, 0.28, e);
    this.night = smooth(0.02, -0.2, e);
    const dusk = Math.exp(-((e - 0.02) ** 2) / (2 * 0.12 * 0.12));

    const dayZ = new THREE.Color('#2c6fc4');
    const dayH = new THREE.Color('#bfe2f7');
    const nightZ = new THREE.Color('#02030b');
    const nightH = new THREE.Color('#0b1a33');
    const duskZ = new THREE.Color('#3b2d62');
    const duskH = new THREE.Color('#ff9a5a');
    const zen = new THREE.Color().copy(nightZ).lerp(dayZ, this.day).lerp(duskZ, dusk * 0.7);
    const hor = new THREE.Color().copy(nightH).lerp(dayH, this.day).lerp(duskH, dusk * 0.9);
    this.uniforms.uZenith.value.copy(zen);
    this.uniforms.uHorizon.value.copy(hor);
    this.uniforms.uDay.value = this.day;
    this.uniforms.uNight.value = this.night;
    this.uniforms.uSunColor.value.setRGB(1, 0.92 - 0.25 * dusk, 0.78 - 0.4 * dusk);
    this.uniforms.uAurora.value = this.night * 0.95;

    this.starMat.opacity = this.night * 0.95;
    this.sunSprite.visible = e > -0.12;
    this.sunBaseOpacity = smooth(-0.12, 0.05, e);
    this.sunSprite.material.opacity = this.sunBaseOpacity;
    this.sunSprite.material.color.setRGB(1, 0.93 - 0.2 * dusk, 0.75 - 0.35 * dusk);
    this.moonSprite.material.opacity = this.night;
    this.moonGlow.material.opacity = this.night * 0.6;
    this.planetGroup.visible = this.night > 0.02;
    for (const p of this.planets) {
      p.material.opacity = this.night;
      if (p.userData.ring) p.userData.ring.material.opacity = this.night * 0.85;
    }
    return this;
  }

  update(dt, camera, time, rain) {
    const cam = camera.position;
    const place = (obj, dir, dist) => obj.position.copy(cam).addScaledVector(dir, dist);
    this.dome.position.copy(cam);
    this.stars.position.copy(cam);
    this.uniforms.uTime.value = time;
    this.uniforms.uRain.value = rain;
    this.uniforms.uCloud.value = 0.45 + 0.4 * rain;
    place(this.sunSprite, this.sunDir, SKY_RADIUS * 0.85);
    place(this.moonSprite, this.moonDir, SKY_RADIUS * 0.85);
    place(this.moonGlow, this.moonDir, SKY_RADIUS * 0.85);
    this.planetGroup.position.copy(cam);
    for (const p of this.planets) p.rotation.y += p.userData.spin * dt;
    this.sunSprite.material.opacity = (this.sunBaseOpacity ?? 1) * (1 - rain * 0.7);
  }
}
