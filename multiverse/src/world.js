import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildTerrain, heightAt, WATER_Y, PLATEAU_Y, CLIFF_X, riverZ, SPAWN } from './terrain.js';
import { createWaterMaterial, Reflector } from './water.js';
import { Sky } from './sky.js';
import { Weather } from './weather.js';
import { buildFoliage, windU } from './foliage.js';
import { buildFeatures } from './features.js';
import { buildCreatures } from './creatures.js';

const DAY_LENGTH_SECONDS = 60; // one in-game hour lasts one real minute (24 minutes per day)
const FOG_CLEAR = 0.00075;
const FOG_RAIN = 0.0013;
const FOG_UNDER = 0.03;
const UNDER_COLOR = new THREE.Color('#0d5d6b');

function buildRiver() {
  // Ribbon of water following the plateau river from the far west, over the cliff lip.
  const pos = [];
  const idx = [];
  const y = PLATEAU_Y - 1.2;
  const halfW = 8;
  const xStart = -900;
  const xEnd = CLIFF_X + 4;
  const steps = Math.ceil((xEnd - xStart) / 4);
  for (let i = 0; i <= steps; i++) {
    const x = xStart + i * 4;
    const z = riverZ(x);
    pos.push(x, y, z - halfW, x, y, z + halfW);
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = createWaterMaterial({ y, useRefl: false, deep: '#0c4a66', shallow: '#3aa6b8' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'river';
  return mesh;
}

export class World {
  constructor(renderer, quality = 'high') {
    this.renderer = renderer;
    this.quality = quality;
    this.hi = quality === 'high';
    this.time = 0;
    this.hour = 18.6;
    this.underwater = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.3, 14000);
    this.scene.fog = new THREE.FogExp2(0x9fc6e0, FOG_CLEAR);

    this.sky = new Sky(this.scene, this.camera);
    this.weather = new Weather(this.scene);

    // Lights: sun/moon as one directional light, plus a sky/ground hemisphere fill.
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfe6ff, 0x3b4a2a, 0.9);
    this.scene.add(this.hemi);
    renderer.shadowMap.enabled = this.hi;
    if (this.hi) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 10; sc.far = 900;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.6;
    }

    // Terrain.
    this.terrain = buildTerrain();
    this.scene.add(this.terrain);

    // Sea and lakes: one large water plane at sea level, plus the river over the plateau.
    this.seaMat = createWaterMaterial({ y: WATER_Y, deep: '#052f49', shallow: '#23a0a6' });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 1, 1), this.seaMat);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = WATER_Y;
    this.sea.name = 'sea';
    this.scene.add(this.sea);
    this.river = buildRiver();
    this.scene.add(this.river);

    // Life and landmarks.
    this.foliage = buildFoliage(quality);
    this.scene.add(this.foliage.group);
    this.features = buildFeatures(quality);
    this.scene.add(this.features.group);
    this.creatures = buildCreatures(quality);
    this.scene.add(this.creatures.group);

    // Reflections.
    this.reflector = new Reflector(renderer, this.hi ? 0.6 : 0.4);

    // Post processing: bloom for the sun, aurora, wormhole and Lodamis glow.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.hi ? 0.32 : 0.12, 0.6, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.sky.setHour(this.hour);
    this.spawnPoint = new THREE.Vector3(SPAWN.x, heightAt(SPAWN.x, SPAWN.z), SPAWN.z);
  }

  resize(w, h, pixelRatio) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
  }

  update(dt, player) {
    this.time += dt;
    this.hour = (this.hour + dt / DAY_LENGTH_SECONDS) % 24;
    this.sky.setHour(this.hour);
    this.weather.update(dt, this.camera, this.sky);
    this.sky.update(dt, this.camera, this.time, this.weather.rainAmt);

    const cam = this.camera.position;
    const rain = this.weather.rainAmt;
    const day = this.sky.day;
    const night = this.sky.night;
    this.underwater = cam.y < WATER_Y;

    // Sun / moon lighting.
    this.sun.position.copy(cam).addScaledVector(this.sky.sunDir, 500);
    this.sun.target.position.copy(cam);
    const sunUp = Math.max(0, this.sky.elev);
    this.sun.intensity = (0.15 + sunUp * 2.6) * (1 - rain * 0.45) + night * 0.18;
    const warm = new THREE.Color().setRGB(1, 0.94 - 0.2 * (1 - sunUp), 0.82 - 0.4 * (1 - sunUp));
    this.sun.color.copy(warm);
    this.hemi.intensity = 0.22 + day * 0.75 + night * 0.15;
    this.hemi.color.copy(this.sky.uniforms.uHorizon.value).lerp(new THREE.Color(0xbfe6ff), 0.5);
    this.hemi.groundColor.setRGB(0.22 * (0.4 + day * 0.6), 0.27 * (0.4 + day * 0.6), 0.14 * (0.4 + day * 0.6));

    // Fog follows the sky colour; underwater it turns murky teal.
    const fogColor = this.underwater ? UNDER_COLOR : this.sky.uniforms.uHorizon.value;
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.density = this.underwater ? FOG_UNDER : FOG_CLEAR + (FOG_RAIN - FOG_CLEAR) * rain;
    this.scene.background = null;

    // Vegetation sway strength.
    windU.uTime.value = this.time;
    windU.uWind.value = 0.6 + rain * 1.3;

    // Water.
    const u = this.seaMat.uniforms;
    u.uTime.value = this.time;
    u.uSunDir.value.copy(this.sky.sunDir);
    u.uSunColor.value.copy(this.sky.uniforms.uSunColor.value);
    u.uSunStrength.value = day * 0.9 + night * 0.15;
    u.uSkyZenith.value.copy(this.sky.uniforms.uZenith.value);
    u.uSkyHorizon.value.copy(this.sky.uniforms.uHorizon.value);
    u.uFogColor.value.copy(fogColor);
    u.uFogDensity.value = this.scene.fog.density;
    u.uRain.value = rain;
    u.uWaveAmp.value = 1 + rain * 2.2;
    for (const mat of [this.seaMat, this.river.material]) {
      mat.uniforms.uSunDir.value = u.uSunDir.value;
      mat.uniforms.uSunColor.value = u.uSunColor.value;
      mat.uniforms.uSkyZenith.value = u.uSkyZenith.value;
      mat.uniforms.uSkyHorizon.value = u.uSkyHorizon.value;
      mat.uniforms.uFogColor.value = u.uFogColor.value;
      mat.uniforms.uFogDensity.value = u.uFogDensity.value;
      mat.uniforms.uTime.value = this.time;
      mat.uniforms.uRain.value = rain;
      mat.uniforms.uWaveAmp.value = u.uWaveAmp.value;
      mat.uniforms.uSunStrength.value = u.uSunStrength.value;
    }
    this.bloom.strength = (this.hi ? 0.32 : 0.12) + night * 0.12;

    this.creatures.update(dt, this.time, player);
    this.features.update(dt, this.time, this.camera);
  }

  render() {
    const r = this.renderer;
    // 1) Planar reflection (sea surface). Shadows reuse last frame's map to save time.
    const prevAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    const tex = this.reflector.render(this.scene, this.camera, WATER_Y, [this.sea, this.river, this.weather.rain, this.weather.rainbow, this.weather.shafts], null);
    r.shadowMap.autoUpdate = prevAuto;
    this.seaMat.uniforms.tReflection.value = tex;
    this.seaMat.uniforms.uTextureMatrix.value.copy(this.reflector.textureMatrix);
    // The river does not use reflections; it still gets the same texture to keep the shader valid.
    this.river.material.uniforms.tReflection.value = tex;
    this.river.material.uniforms.uTextureMatrix.value.copy(this.reflector.textureMatrix);

    // 2) Main frame.
    this.composer.render();
  }
}
