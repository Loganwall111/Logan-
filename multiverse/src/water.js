import * as THREE from 'three';

// Shared water shader. Above the surface it shows a planar reflection with Fresnel,
// sun glints and rain ripples. Below the surface it shows Snell's window (the sky
// seen through the surface) and the mirrored underwater world beyond the critical angle.
const vertexShader = /* glsl */ `
  uniform mat4 uTextureMatrix;
  varying vec3 vWorld;
  varying vec4 vReflCoord;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vReflCoord = uTextureMatrix * wp;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tReflection;
  uniform float uTime;
  uniform float uSurfaceY;
  uniform float uUseRefl;
  uniform float uWaveAmp;
  uniform float uRain;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uSunStrength;
  varying vec3 vWorld;
  varying vec4 vReflCoord;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  // Analytic gradient of a sum of directional waves.
  vec2 waveGrad(vec2 p, float t) {
    vec2 g = vec2(0.0);
    vec2 d;
    float k;
    float a;
    d = normalize(vec2(1.0, 0.35)); k = 0.55; a = 0.10 * uWaveAmp;
    g += d * k * a * cos(dot(d, p) * k + t * 1.1);
    d = normalize(vec2(-0.6, 1.0)); k = 0.9; a = 0.07 * uWaveAmp;
    g += d * k * a * cos(dot(d, p) * k + t * 1.5);
    d = normalize(vec2(0.2, -1.0)); k = 1.7; a = 0.035 * uWaveAmp;
    g += d * k * a * cos(dot(d, p) * k + t * 2.2);
    d = normalize(vec2(-1.0, -0.4)); k = 3.1; a = 0.018 * uWaveAmp;
    g += d * k * a * cos(dot(d, p) * k + t * 3.0);
    d = normalize(vec2(0.8, 0.9)); k = 6.0; a = 0.008 * uWaveAmp;
    g += d * k * a * cos(dot(d, p) * k + t * 4.2);
    // Rain ripples: high-frequency noise slope, scaled by rain amount.
    if (uRain > 0.001) {
      float e = 0.08;
      vec2 q = p * 3.2 + vec2(t * 0.35, -t * 0.2);
      float h0 = vnoise(q);
      float hx = vnoise(q + vec2(e, 0.0));
      float hz = vnoise(q + vec2(0.0, e));
      g += vec2(hx - h0, hz - h0) / e * 0.05 * uRain;
    }
    return g;
  }

  vec3 skyColor(vec3 d) {
    float h = clamp(d.y, 0.0, 1.0);
    vec3 c = mix(uSkyHorizon, uSkyZenith, pow(h, 0.45));
    float s = pow(max(dot(d, uSunDir), 0.0), 220.0) * 6.0;
    return c + uSunColor * s;
  }

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    vec2 g = waveGrad(vWorld.xz, uTime);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

    vec2 ruv = vReflCoord.xy / max(vReflCoord.w, 0.0001) + N.xz * 0.045;
    ruv = clamp(ruv, vec2(0.002), vec2(0.998));
    vec3 refl = texture2D(tReflection, ruv).rgb;

    vec3 col;
    float under = step(cameraPosition.y, uSurfaceY);

    if (under < 0.5) {
      // Above water: Fresnel mix of body colour and reflection.
      float cosV = clamp(dot(N, V), 0.0, 1.0);
      float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
      vec3 body = mix(uDeep, uShallow, pow(cosV, 2.0));
      vec3 reflCol = uUseRefl > 0.5 ? refl : skyColor(reflect(-V, N));
      col = mix(body, reflCol, clamp(F * 1.15 + 0.03, 0.0, 1.0));
      vec3 H = normalize(uSunDir + V);
      float spec = pow(max(dot(N, H), 0.0), 900.0) * 6.0 + pow(max(dot(N, H), 0.0), 90.0) * 0.12;
      col += uSunColor * spec * uSunStrength;
    } else {
      // Below water: incoming ray from the eye, looking up at the surface.
      vec3 D = normalize(vWorld - cameraPosition);
      vec3 Rf = refract(D, -N, 1.333);
      float inWindow = smoothstep(0.64, 0.69, D.y);
      vec3 winCol = skyColor(normalize(Rf + vec3(0.0, 1e-4, 0.0)));
      winCol *= vec3(0.85, 1.0, 1.02);
      vec3 tir = refl * vec3(0.55, 0.85, 0.9);
      col = mix(tir, winCol, inWindow);
      // Silvery total internal reflection edge.
      col += vec3(0.25, 0.4, 0.42) * (1.0 - inWindow) * pow(1.0 - abs(D.y), 6.0);
    }

    // Distance fog matching the scene's FogExp2.
    float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createWaterMaterial(opts = {}) {
  const uniforms = {
    tReflection: { value: null },
    uTextureMatrix: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uSurfaceY: { value: opts.y ?? 0 },
    uUseRefl: { value: opts.useRefl === false ? 0 : 1 },
    uWaveAmp: { value: 1 },
    uRain: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uDeep: { value: new THREE.Color(opts.deep ?? '#06304a') },
    uShallow: { value: new THREE.Color(opts.shallow ?? '#1b7f8f') },
    uSkyZenith: { value: new THREE.Color('#2a5fb0') },
    uSkyHorizon: { value: new THREE.Color('#bfe0f5') },
    uFogColor: { value: new THREE.Color('#9fc6e0') },
    uFogDensity: { value: 0.0016 },
    uSunStrength: { value: 1 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: false,
    extensions: { derivatives: false },
  });
}

// Planar reflector: renders the scene from a mirrored camera into a texture.
// When the camera is under the surface the mirrored view shows the underwater world,
// which is what produces the mirror-like view from below.
export class Reflector {
  constructor(renderer, scale = 0.5) {
    this.renderer = renderer;
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0 });
    this.vc = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();
    this.bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.clipAbove = new THREE.Plane();
    this.clipBelow = new THREE.Plane();
    this.hidden = [];
  }

  setScale(s) {
    this.scale = s;
  }

  render(scene, camera, surfaceY, hideObjects, onBeforeRender) {
    const { renderer, vc } = this;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.floor(size.x * this.scale));
    const h = Math.max(2, Math.floor(size.y * this.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);

    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const pos = new THREE.Vector3(0, surfaceY, 0);
    const normal = new THREE.Vector3(0, 1, 0);

    // Mirror the eye position across the surface.
    const view = new THREE.Vector3().subVectors(camPos, pos).reflect(normal).negate().add(pos);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = new THREE.Vector3().subVectors(pos, look).reflect(normal).negate().add(pos);
    const up = new THREE.Vector3(0, 1, 0).applyMatrix4(rot).reflect(normal);

    vc.fov = camera.fov;
    vc.aspect = camera.aspect;
    vc.near = camera.near;
    vc.far = camera.far;
    vc.updateProjectionMatrix();
    vc.position.copy(view);
    vc.up.copy(up);
    vc.lookAt(target);
    vc.updateMatrixWorld(true);

    this.textureMatrix.multiplyMatrices(this.bias, vc.projectionMatrix);
    this.textureMatrix.multiply(vc.matrixWorldInverse);

    // Keep only geometry on the camera's side of the surface.
    const above = camPos.y >= surfaceY;
    this.clipAbove.set(normal, -surfaceY);
    this.clipBelow.set(normal.clone().negate(), surfaceY);
    renderer.clippingPlanes = [above ? this.clipAbove : this.clipBelow];

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    const skyRef = scene.userData.sky;
    const skyPrev = skyRef ? skyRef.position.clone() : null;
    if (skyRef) skyRef.position.copy(vc.position);

    this.hidden.length = 0;
    for (const o of hideObjects) {
      if (o.visible) {
        this.hidden.push(o);
        o.visible = false;
      }
    }
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, vc);
    renderer.setClearColor(prevClear, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    renderer.clippingPlanes = [];
    for (const o of this.hidden) o.visible = true;
    if (skyRef && skyPrev) skyRef.position.copy(skyPrev);
    if (onBeforeRender) onBeforeRender();
    return this.rt.texture;
  }
}
