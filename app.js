/* ----------------------------------------------------------------------------
 * Scroll-driven voyage - Earth to Kepler-452b
 *
 * One continuous scroll-driven flight:
 *   LAUNCH      the stack stands on its launcher at LC-39A on the Florida
 *               coast, engines cold. Scrolling lights them; it climbs through
 *               fair-weather cumulus and up through the atmosphere's layers
 *               (the sky darkens from blue to black as it goes), sheds its
 *               boosters and tank, and reaches space as Earth's curve opens
 *               out beneath it.
 *   VOYAGE      Moon slingshot, Mars, Jupiter, Saturn, the ice giants, Kuiper
 *               belt, Oort cloud, then the interstellar leg through nebulae.
 *   ARRIVAL     one full orbit of Kepler-452b, then entry, descent through its
 *               atmosphere and touchdown at a surface base.
 *
 * Assets: NASA public-domain textures and models ("Images and Textures/",
 * "3D Models/", "models/"). Built with Three.js; all motion is procedural and
 * driven by scroll.
 *
 * The one idea that makes the launch work: a planet seen from altitude h with
 * radius R looks identical to one of radius kR seen from kh. So Earth is a
 * sphere whose radius shrinks as the ship climbs (pinned at the launch site),
 * from a ground-scale 12,000 units - where the pad, the gantry and the coast
 * read as flat land - down to the 112-unit globe the rest of the voyage uses.
 * The sky and the limb glow are one physically based scattering model, so the
 * blue daytime sky, the darkening layers and the thin blue line seen from space
 * are the same atmosphere at different altitudes. Kepler-452b uses the same
 * machinery in reverse for the landing.
 * -------------------------------------------------------------------------- */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const U = (s) => encodeURI(s);
const TEX = "Images and Textures/";
const TEXURL = {
  sky: U(TEX + "Tycho Star Map/Tycho Star Map.jpg"),      // 2880x1440
  earth: U(TEX + "Earth (A)/Earth (A).jpg"),              // 1440x720 equirect
  moon: U(TEX + "Saturn - Rhea/Saturn - Rhea.jpg"),       // 1440x720, cratered grey (no 2:1 lunar map in the library)
  mars: U(TEX + "Mars/Mars.jpg"),
  jupiter: U(TEX + "Jupiter/Jupiter.jpg"),
  saturn: U(TEX + "Saturn/Saturn.jpg"),
  neptune: U(TEX + "Neptune/Neptune.jpg"),
  pluto: U(TEX + "Pluto/Pluto.jpg"),
};
const MODEL = {
  stack: U("Space Shuttle (1).glb"),
  orbiter: U("Space Shuttle Orbiter.glb"),
  gantry: U("models/Gantry.glb"),
  crawler: U("3D Models/Crawler/Crawler.glb"),
  habitat: U("3D Models/Habitat Demonstration Unit/Habitat Demonstration Unit (part 1).glb"),
  dish: U("3D Models/Deep Space Network 34-meter/Deep Space Network 34-meter.glb"),
  ship2: U("models/Spaceship.glb"),
};

/* --- Math ----------------------------------------------------------------- */
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
/* Monotone cubic (Fritsch-Carlson): a smooth curve through the table points that
 * never overshoots, used for the Earth radius schedule so the apparent altitude
 * changes at a continuous rate. */
function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
function rand(i, salt) { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); }

/* --- Renderer / scene / camera ------------------------------------------- *
 * antialias is off on the renderer: every frame goes through EffectComposer, so
 * the drawing buffer's MSAA would be resolved and thrown away. The AA lives on
 * the composer's own target instead - when the GPU can multisample a half-float
 * buffer, which WebGL2 alone does not guarantee. */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
const DPR_MAX = Math.min(window.devicePixelRatio || 1, 1.5);
let dprNow = DPR_MAX;
renderer.setPixelRatio(dprNow);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 9000);
camera.position.set(20, 12, 30);

const canMsaaFloat = renderer.capabilities.isWebGL2 &&
  (renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
const composerRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: canMsaaFloat ? 4 : 0 });
const composer = new EffectComposer(renderer, composerRT);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
/* Bloom only - there is deliberately no depth-of-field pass. The old BokehPass
 * blurred everything by depth, and the star sphere sits at the far plane, so
 * from p=0.07 onward every star was smeared to its maximum blur: the colourful
 * star field went dull and dark between chapters 01 and 02, and the planets
 * lost their detail. Softening that matters (Earth receding) is done in the
 * planet's own shader instead. UnrealBloomPass halves whatever size it is
 * handed; applySize() hands it half the framebuffer, so the blur chain starts
 * at a quarter resolution. */
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.5, 0.55, 0.9);
composer.addPass(bloom);

let pointScale = 1;   // pixels per world unit at distance 1, for the point-sprite shaders
function applySize() {
  // Clamp to >=1: a collapsed/hidden pane reports 0x0, which would make
  // camera.aspect NaN and poison the projection matrix.
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setPixelRatio(dprNow);
  renderer.setSize(w, h);
  composer.setPixelRatio(dprNow);
  composer.setSize(w, h);
  bloom.setSize(Math.max(1, (w * dprNow) / 2), Math.max(1, (h * dprNow) / 2));
  pointScale = (h * dprNow) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (const m of pointMaterials) m.uniforms.uScale.value = pointScale;
}
const pointMaterials = [];
function resizeAll() { applySize(); measureScroll(); }

/* Trailing-debounced: applySize() reallocates every render target, and mobile
 * browsers fire a burst of resize events as the URL bar collapses mid-scroll. */
let resizeTimer = 0;
function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(resizeAll, 120); }

/* Adaptive resolution: step the pixel ratio down when the frame budget is blown
 * for a sustained stretch, back up when there is headroom - but never mid-scroll,
 * since the resize is itself a dropped frame. */
const DPR_MIN = 0.85;
let frameAcc = 0, frameCount = 0;
function adaptResolution(dt) {
  frameAcc += dt; frameCount++;
  if (frameCount < 45) return;
  const avg = frameAcc / frameCount;
  frameAcc = 0; frameCount = 0;
  if (scrollVel > 0.004) return;
  let next = dprNow;
  if (avg > 0.0215 && dprNow > DPR_MIN) next = Math.max(DPR_MIN, dprNow - 0.15);
  else if (avg < 0.0135 && dprNow < DPR_MAX) next = Math.min(DPR_MAX, dprNow + 0.1);
  if (next !== dprNow) { dprNow = next; applySize(); }
}

/* --- Lighting ------------------------------------------------------------- *
 * One sun. For the solar-system leg it shines from high and behind the chase
 * camera (+Z), so every body is seen on its lit side with a three-quarter
 * terminator; near the end it swings round to come from Kepler-452. The old
 * blue "fill" light from behind is gone: it painted a cold blue rim on every
 * planet, part of the artificial shield-like edge they had. */
const SUN_DIR = new THREE.Vector3(0.42, 0.62, 0.66).normalize();
const sunDir = SUN_DIR.clone();                     // current (may swing to Kepler-452)
const sunLight = new THREE.DirectionalLight(0xfff4e6, 2.6);
scene.add(sunLight); scene.add(sunLight.target);
const hemi = new THREE.HemisphereLight(0xa9cdf5, 0x5f5444, 1.1);   // daylight sky fill, fades with altitude
scene.add(hemi);
const ambient = new THREE.AmbientLight(0x3a4150, 0.45);            // space fill
scene.add(ambient);
const escort = new THREE.PointLight(0xffb070, 2.4, 120);           // engine glow on the vehicle and pad
scene.add(escort);

/* --- Flight path: one anchor per original chapter (18) -------------------- *
 * Anchors 0-2 are collinear on the Y axis, so the Catmull-Rom tangent is
 * exactly vertical for the whole first chapter: the ship climbs straight up
 * because the path does. The pitch-over begins at anchor 3. */
const ANCHORS = [
  [0, 4, 0], [0, 44, 0], [0, 96, 0], [14, 138, -60], [38, 146, -148],
  [64, 108, -228],                      // 5 lunar swing
  [16, 6, -360],                        // 6 asteroid belt
  [84, -6, -585],                       // 7 Jupiter slingshot
  [-54, 22, -840],                      // 8 Saturn
  [44, 26, -1075],                      // 9 ice giants
  [4, 8, -1380],                        // 10 Kuiper
  [0, 2, -1680],                        // 11 Oort
  [0, 0, -1980],                        // 12 local cloud
  [0, 0, -2330],                        // 13 local bubble
  [0, 0, -2700],                        // 14 great rift
  [0, 0, -3050],                        // 15 Orion-Cygnus arm
  [40, 8, -3320],                       // 16 Kepler-452
  [0, -6, -3480],                       // 17 Kepler-452b approach
].map((p) => new THREE.Vector3(...p));
const path = new THREE.CatmullRomCurve3(ANCHORS, false, "catmullrom", 0.5);
const NSEG = ANCHORS.length - 1;
const pAt = (i) => i / NSEG;

/* --- Earth: the shrinking launch planet ----------------------------------- *
 * EARTH_R(p) is the radius schedule. It holds at ground scale through liftoff,
 * then falls through the climb so the ratio altitude/radius - what the eye
 * actually reads as altitude - rises continuously from the pad to orbit. The
 * table is in ln(R) so the change is even on a log scale. The surface stays
 * pinned under the pad (top point) while it is large; only once it is small and
 * far below does the top point drift to the orbital layout the voyage uses. */
const EARTH_FINAL_R = 112;
const EARTH_FINAL_C = new THREE.Vector3(0, -140, -70);
const ATM_T = 0.025;          // atmosphere thickness / radius (2.7x real, for legibility)
const CLOUD_H = 0.0088;       // cloud deck altitude / radius (~1 km over the pad)
const earthLnR = monotone(
  [0, 0.035, 0.07, 0.125, 0.17, 0.22],
  [Math.log(12000), Math.log(11000), Math.log(6900), Math.log(4300), Math.log(900), Math.log(EARTH_FINAL_R)]
);
const EARTH_R0 = 12000;
let Y_G = 0.13;               // ground level under the pad; set from the measured launcher
const earthTop = new THREE.Vector3();
const earthC = new THREE.Vector3();
let earthR = EARTH_R0;
function earthAt(p) {
  earthR = Math.exp(earthLnR(p));
  // Drift weight in 1/R: ~0 while the planet is ground-scale, 1 at orbit scale.
  const k = clamp((1 / earthR - 1 / EARTH_R0) / (1 / EARTH_FINAL_R - 1 / EARTH_R0), 0, 1);
  earthTop.set(0, Y_G, 0).lerp(_finalTop, k);
  earthC.copy(earthTop).y -= earthR;
}
const _finalTop = EARTH_FINAL_C.clone().add(new THREE.Vector3(0, EARTH_FINAL_R, 0));

/* --- Shared GLSL ---------------------------------------------------------- */
const GLSL_NOISE = /* glsl */ `
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vn2(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm2(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
  float vn3(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

/* Single-scattering atmosphere (Rayleigh + Mie), integrated along the view ray
 * with a short light march toward the sun at each sample. One model gives the
 * blue daytime sky from the ground, the darkening through the layers as the
 * ship climbs, the warm horizon band and the thin glowing limb from orbit -
 * which is what replaces the old hard-edged shells (the "bluish shield" lines).
 * All lengths are world units; coefficients are passed in already divided by
 * the current radius, so the look holds as the planet is rescaled. */
const GLSL_ATMO_CORE = /* glsl */ `
  vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c; float b = dot(oc, rd); float cc = dot(oc, oc) - r * r; float h = b * b - cc;
    if (h < 0.0) return vec2(1e9, -1e9);
    h = sqrt(h); return vec2(-b - h, -b + h);
  }
  vec3 atmo(vec3 ro, vec3 rd, float tMax, vec3 C, float R, float Ra, vec3 bR, float bM, float hR, float hM,
            vec3 L, float sunI, int nV, int nL, out vec3 T) {
    T = vec3(1.0);
    vec2 ta = raySphere(ro, rd, C, Ra);
    float t0 = max(ta.x, 0.0), t1 = min(ta.y, tMax);
    if (t1 <= t0) return vec3(0.0);
    vec2 tp = raySphere(ro, rd, C, R);
    if (tp.x > 0.0) t1 = min(t1, tp.x);
    float ds = (t1 - t0) / float(nV);
    float mu = dot(rd, L);
    float pR = 0.0596831 * (1.0 + mu * mu);
    float g = 0.76;
    float pM = 0.1193662 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    vec3 sR = vec3(0.0), sM = vec3(0.0); float oR = 0.0, oM = 0.0;
    for (int i = 0; i < 16; i++) {
      if (i >= nV) break;
      vec3 pos = ro + rd * (t0 + ds * (float(i) + 0.5));
      float h = length(pos - C) - R;
      float dR = exp(-h / hR) * ds, dM = exp(-h / hM) * ds;
      oR += dR; oM += dM;
      vec2 tl = raySphere(pos, L, C, Ra);
      float dl = tl.y / float(nL);
      float lR = 0.0, lM = 0.0; bool lit = true;
      for (int j = 0; j < 8; j++) {
        if (j >= nL) break;
        vec3 pl = pos + L * (dl * (float(j) + 0.5));
        float hl = length(pl - C) - R;
        if (hl < 0.0) { lit = false; break; }
        lR += exp(-hl / hR) * dl; lM += exp(-hl / hM) * dl;
      }
      if (lit) {
        vec3 att = exp(-(bR * (oR + lR) + bM * 1.1 * (oM + lM)));
        sR += att * dR; sM += att * dM;
      }
    }
    T = exp(-(bR * oR + bM * 1.1 * oM));
    return sunI * (sR * bR * pR + sM * bM * pM);
  }
`;
const GLSL_HAZE = /* glsl */ `
  /* Aerial perspective with the optical depth scaled by uHaze near the camera.
   * Earth is drawn ~20x larger than real relative to the ship (so that its
   * curvature can be shown at all), which makes ground-level air 20x too thick
   * per unit of distance: the pad and coast vanished into white. Near the
   * ground the depth is thinned (uHaze ~0.1); toward the horizon it ramps back
   * to the physical value so the land still melts into the sky at the edge. */
  uniform float uHaze;
  vec3 applyHaze(vec3 col, vec3 T, vec3 ins, float dist) {
    float hcam = max(length(cameraPosition - uC) - uR, 0.5);
    float horizon = sqrt(2.0 * uR * hcam);
    float hk = mix(uHaze, 1.0, smoothstep(0.3, 1.1, dist / horizon));
    vec3 Th = pow(max(T, vec3(1e-4)), vec3(hk));
    vec3 insH = ins * (1.0 - Th) / max(1.0 - T, vec3(1e-4));
    return col * Th + insH;
  }
`;
const GLSL_SUNT = /* glsl */ `
  // Sunlight reaching a point inside the atmosphere (reddens near the terminator).
  vec3 sunTrans(vec3 pos, vec3 C, float R, float Ra, vec3 bR, float bM, float hR, float hM, vec3 L) {
    vec2 tl = raySphere(pos, L, C, Ra);
    if (tl.y <= 0.0) return vec3(1.0);
    vec2 tp = raySphere(pos + L * 0.01 * R, L, C, R);
    if (tp.x > 0.0) return vec3(0.0);
    float dl = tl.y / 6.0; float lR = 0.0, lM = 0.0;
    for (int j = 0; j < 6; j++) {
      vec3 pl = pos + L * (dl * (float(j) + 0.5));
      float hl = max(length(pl - C) - R, 0.0);
      lR += exp(-hl / hR) * dl; lM += exp(-hl / hM) * dl;
    }
    return exp(-(bR * lR + bM * 1.1 * lM));
  }
`;

/* Per-planet atmosphere uniforms, shared by reference between the sky shader and
 * that planet's surface and cloud shaders, so one update per frame reaches all. */
function makeAtmoUniforms(betaRPerR, betaMPerR, hRPerR, hMPerR, thick) {
  return {
    uC: { value: new THREE.Vector3() }, uR: { value: 1 }, uRa: { value: 1 },
    uBR: { value: new THREE.Vector3() }, uBM: { value: 0 }, uHR: { value: 1 }, uHM: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 17 },
    _cfg: { betaRPerR, betaMPerR, hRPerR, hMPerR, thick },
  };
}
function setAtmo(u, center, R, sun) {
  const c = u._cfg;
  u.uC.value.copy(center); u.uR.value = R; u.uRa.value = R * (1 + c.thick);
  u.uBR.value.copy(c.betaRPerR).multiplyScalar(1 / R); u.uBM.value = c.betaMPerR / R;
  u.uHR.value = c.hRPerR * R; u.uHM.value = c.hMPerR * R;
  u.uSunDir.value.copy(sun);
}
/* Earth: real Rayleigh/Mie coefficients in units of the planet radius, divided by
 * the same 2.7x the thickness is exaggerated by, so the optical depths - and so
 * the colours - stay physical. */
const EARTH_ATMO = makeAtmoUniforms(new THREE.Vector3(13.9, 32.3, 79.1), 50.2, 0.00335, 0.0005, ATM_T);
/* Kepler-452b: a thicker, slightly greener-scattering sky, its own look. */
const KEPLER_ATMO = makeAtmoUniforms(new THREE.Vector3(11.0, 26.0, 46.0), 42.0, 0.0042, 0.0007, 0.032);

/* Sky: a camera-centred sphere drawn first, with no depth, that integrates the
 * atmosphere along every view ray. Premultiplied output (in-scatter, 1 - T) lays
 * it over the star sphere, so the stars are dimmed by exactly the air in front
 * of them: hidden in daylight, back once the ship is above the atmosphere. */
const skyUniforms = {
  uEOn: { value: 1 }, uKOn: { value: 0 },
  ...Object.fromEntries(Object.entries(EARTH_ATMO).filter(([k]) => k[0] === "u").map(([k, v]) => ["uE" + k.slice(1), v])),
  ...Object.fromEntries(Object.entries(KEPLER_ATMO).filter(([k]) => k[0] === "u").map(([k, v]) => ["uK" + k.slice(1), v])),
};
const skyMaterial = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  vertexShader: /* glsl */ `
    varying vec3 vWP;
    void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: /* glsl */ `
    uniform float uEOn; uniform float uKOn;
    uniform vec3 uEC; uniform float uER; uniform float uERa; uniform vec3 uEBR; uniform float uEBM; uniform float uEHR; uniform float uEHM; uniform vec3 uESunDir; uniform float uESunI;
    uniform vec3 uKC; uniform float uKR; uniform float uKRa; uniform vec3 uKBR; uniform float uKBM; uniform float uKHR; uniform float uKHM; uniform vec3 uKSunDir; uniform float uKSunI;
    varying vec3 vWP;
    ${GLSL_ATMO_CORE}
    void main() {
      vec3 rd = normalize(vWP - cameraPosition);
      vec3 col = vec3(0.0), Tt = vec3(1.0), T;
      if (uEOn > 0.5) {
        col += atmo(cameraPosition, rd, 1e9, uEC, uER, uERa, uEBR, uEBM, uEHR, uEHM, uESunDir, uESunI, 14, 6, T);
        // the sun's disc, seen through the air
        float sd = dot(rd, uESunDir);
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99985, 0.99995, sd) * 30.0 * T;
        Tt *= T;
      }
      if (uKOn > 0.5) {
        vec3 c2 = atmo(cameraPosition, rd, 1e9, uKC, uKR, uKRa, uKBR, uKBM, uKHR, uKHM, uKSunDir, uKSunI, 14, 6, T);
        col = col * T + c2; Tt *= T;
      }
      float a = 1.0 - clamp(dot(Tt, vec3(0.3333)), 0.0, 1.0);
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 32), skyMaterial);
skyDome.renderOrder = -9; skyDome.frustumCulled = false;
scene.add(skyDome);
let starSphere = null;
function makeStarSphere(tex) {
  const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthTest: false, depthWrite: false });
  starSphere = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 32), m);
  starSphere.renderOrder = -10; starSphere.frustumCulled = false;
  scene.add(starSphere);
}

/* --- Planet geometry ------------------------------------------------------- *
 * A unit sphere whose rings crowd toward the +Y pole. The launch site and the
 * Kepler base both sit at that pole while their planet is enormous, so this is
 * where the tessellation has to be fine: a regular UV sphere at radius 12,000
 * has ~600-unit facets, which would put visible kinks in the ground right under
 * the pad. Texture coordinates are computed in the shader from the direction,
 * so the pole is not a texture singularity. */
function polarDenseSphere(widthSeg = 192, heightSeg = 220, pow = 2.4) {
  const pos = [], nor = [], idx = [];
  for (let j = 0; j <= heightSeg; j++) {
    const th = Math.PI * Math.pow(j / heightSeg, pow);
    for (let i = 0; i <= widthSeg; i++) {
      const ph = (i / widthSeg) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      pos.push(x, y, z); nor.push(x, y, z);
    }
  }
  const W = widthSeg + 1;
  for (let j = 0; j < heightSeg; j++) for (let i = 0; i < widthSeg; i++) {
    const a = j * W + i, b = a + W;
    if (j > 0) idx.push(a, a + 1, b);
    idx.push(a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.0);
  return g;
}
const PLANET_GEO = polarDenseSphere();

/* Orientation of an equirectangular map relative to the planet's object frame:
 * object +Y (the pole the site sits on) maps to (lat, lon), object +X to east,
 * object -Z to north. Using mapDir = (cos lat cos lon, sin lat, -cos lat sin lon)
 * so that longitude increases eastward when seen from outside. */
function siteRotation(latDeg, lonDeg) {
  const la = THREE.MathUtils.degToRad(latDeg), lo = THREE.MathUtils.degToRad(lonDeg);
  const up = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
  const east = new THREE.Vector3(-Math.sin(lo), 0, -Math.cos(lo));
  const north = new THREE.Vector3().crossVectors(up, east).normalize();   // completes a right-handed (east, up, north) frame
  // columns: object X -> east, object Y -> up, object Z -> -north (south)
  return new THREE.Matrix3().set(
    east.x, up.x, -north.x,
    east.y, up.y, -north.y,
    east.z, up.z, -north.z
  );
}

/* --- Terrestrial planet surface (Earth and Kepler-452b) -------------------- */
const GLSL_UV = /* glsl */ `
  // Equirect sampling with a seam-safe gradient: at the antimeridian u jumps
  // from 1 to 0, and taking the derivative across that jump selects the
  // smallest mip and draws a hard line - so take the smaller of two gradients.
  vec3 sampleEq(sampler2D tex, vec3 md, float lodScale) {
    float lat = asin(clamp(md.y, -1.0, 1.0)); float lon = atan(-md.z, md.x);
    vec2 uv = vec2(lon * 0.15915494 + 0.5, lat * 0.31830989 + 0.5);
    vec2 uvB = vec2(fract(uv.x + 0.5), uv.y);
    vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
    vec2 gx = dot(dxA, dxA) < dot(dxB, dxB) ? dxA : dxB;
    vec2 gy = dot(dyA, dyA) < dot(dyB, dyB) ? dyA : dyB;
    return textureGrad(tex, uv, gx * lodScale, gy * lodScale).rgb;
  }
  vec4 sampleEq4(sampler2D tex, vec3 md, float lodScale) {
    float lat = asin(clamp(md.y, -1.0, 1.0)); float lon = atan(-md.z, md.x);
    vec2 uv = vec2(lon * 0.15915494 + 0.5, lat * 0.31830989 + 0.5);
    vec2 uvB = vec2(fract(uv.x + 0.5), uv.y);
    vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
    vec2 gx = dot(dxA, dxA) < dot(dxB, dxB) ? dxA : dxB;
    vec2 gy = dot(dyA, dyA) < dot(dyB, dyB) ? dyA : dyB;
    return textureGrad(tex, uv, gx * lodScale, gy * lodScale);
  }
`;

const GLSL_TERRAIN = /* glsl */ `
  // Launch Complex 39A and the Florida coast. q.x is east, q.y is south, world
  // units from the pad. Ocean to the east, the beach, coastal scrub and
  // lagoons, the concrete hardstand with its flame trench and scorch, the
  // perimeter road and the crawlerway running west.
  vec3 terrainEarth(vec2 q, out float water) {
    float coast = 46.0 + 9.0 * sin(q.y * 0.012 + 1.3) + (fbm2(vec2(q.y * 0.02, 5.3)) - 0.5) * 16.0;
    float lagoon = smoothstep(0.6, 0.64, fbm2(q * 0.006 + vec2(3.0, 7.0))) * smoothstep(-80.0, -170.0, q.x);
    water = max(step(coast, q.x), lagoon);
    float v1 = fbm2(q * 0.035), v2 = fbm2(q * 0.17 + 11.0), v3 = vn2(q * 1.1);
    vec3 col = mix(vec3(0.12, 0.17, 0.08), vec3(0.25, 0.26, 0.14), v1);
    col = mix(col, vec3(0.06, 0.11, 0.05), smoothstep(0.55, 0.7, v2) * 0.75);
    col *= 0.86 + 0.28 * v3;
    col = mix(col, vec3(0.74, 0.69, 0.55), smoothstep(coast - 7.0, coast - 2.0, q.x));
    float oct = max(max(abs(q.x), abs(q.y)), (abs(q.x) + abs(q.y)) * 0.7071);
    float hard = 1.0 - smoothstep(9.4, 10.0, oct);
    vec3 conc = vec3(0.47, 0.47, 0.45) * (0.8 + 0.3 * vn2(q * 1.9)) * (0.88 + 0.16 * fbm2(q * 0.35));
    conc *= 1.0 - 0.25 * (1.0 - smoothstep(0.04, 0.09, abs(fract(q.x * 0.25) - 0.5))) * step(abs(q.y), 9.0);
    col = mix(col, conc, hard);
    col *= 1.0 - 0.5 * exp(-dot(q, q) / 22.0) * hard;
    float trench = (1.0 - smoothstep(1.1, 1.35, abs(q.x))) * (1.0 - smoothstep(13.0, 14.0, abs(q.y)));
    col = mix(col, vec3(0.045), trench);
    float ring = smoothstep(25.0, 25.5, oct) * (1.0 - smoothstep(26.5, 27.0, oct));
    col = mix(col, vec3(0.1, 0.1, 0.11), ring);
    float cw = step(q.x, -10.0) * (1.0 - smoothstep(0.5, 0.8, abs(abs(q.y) - 1.7)));
    col = mix(col, vec3(0.56, 0.54, 0.49), cw);
    float nr = step(q.y, -26.5) * (1.0 - smoothstep(0.6, 0.9, abs(q.x - 8.0)));
    col = mix(col, vec3(0.11), nr);
    if (water > 0.5) col = vec3(0.016, 0.06, 0.1) + 0.035 * fbm2(q * 0.05);
    float surf = (1.0 - smoothstep(0.0, 1.8, abs(q.x - coast))) * (1.0 - lagoon);
    col = mix(col, vec3(0.86, 0.9, 0.92), surf * 0.55);
    return col;
  }
  // Kepler-452b around Base One: ochre plains, darker mossy patches, rust
  // ridges, with the landing pad and its markings.
  vec3 terrainKepler(vec2 q, out float water) {
    float e = fbm2(q * 0.01 + 4.0);
    water = step(e, 0.34) * smoothstep(70.0, 130.0, length(q));
    vec3 col = mix(vec3(0.47, 0.37, 0.22), vec3(0.2, 0.27, 0.17), smoothstep(0.45, 0.62, fbm2(q * 0.035 + 7.0)));
    col = mix(col, vec3(0.56, 0.35, 0.22), smoothstep(0.6, 0.76, fbm2(q * 0.08 + 3.0)) * 0.6);
    col *= 0.84 + 0.32 * vn2(q * 0.9);
    float r = length(q);
    float pad = 1.0 - smoothstep(4.2, 4.5, r);
    col = mix(col, vec3(0.42, 0.43, 0.45) * (0.9 + 0.2 * vn2(q * 3.0)), pad);
    col = mix(col, vec3(0.95, 0.75, 0.2), (1.0 - smoothstep(0.08, 0.15, abs(r - 3.5))) * pad);
    col = mix(col, vec3(0.95, 0.75, 0.2), (1.0 - smoothstep(0.1, 0.18, abs(q.x))) * (1.0 - smoothstep(1.3, 1.5, abs(q.y))) * pad);
    float road = (1.0 - smoothstep(0.5, 0.8, abs(q.y - 0.35 * q.x))) * step(4.2, r) * step(r, 16.0) * step(0.0, q.x);
    col = mix(col, vec3(0.32, 0.3, 0.28), road);
    if (water > 0.5) col = vec3(0.03, 0.11, 0.13) + 0.03 * fbm2(q * 0.05);
    return col;
  }
`;

function terrestrialMaterial({ day, night = null, kind, atmoU, texRot }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: day }, uNight: { value: night || day }, uNightK: { value: night ? 1.3 : 0 },
      uTexRot: { value: texRot }, uLod: { value: 0 }, uOpacity: { value: 1 },
      uPad: { value: new THREE.Vector3() }, uPadX: { value: new THREE.Vector3(1, 0, 0) }, uPadZ: { value: new THREE.Vector3(0, 0, 1) },
      uDetail: { value: 0 }, uKind: { value: kind }, uWaterAlpha: { value: kind === 1 ? 1 : 0 }, uHaze: { value: 1 },
      uC: atmoU.uC, uR: atmoU.uR, uRa: atmoU.uRa, uBR: atmoU.uBR, uBM: atmoU.uBM, uHR: atmoU.uHR, uHM: atmoU.uHM,
      uSunDir: atmoU.uSunDir, uSunI: atmoU.uSunI,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWP; varying vec3 vN; varying vec3 vO;
      void main() {
        vO = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDay; uniform sampler2D uNight; uniform float uNightK;
      uniform mat3 uTexRot; uniform float uLod; uniform float uOpacity;
      uniform vec3 uPad; uniform vec3 uPadX; uniform vec3 uPadZ; uniform float uDetail; uniform int uKind; uniform float uWaterAlpha;
      uniform vec3 uC; uniform float uR; uniform float uRa; uniform vec3 uBR; uniform float uBM; uniform float uHR; uniform float uHM;
      uniform vec3 uSunDir; uniform float uSunI;
      varying vec3 vWP; varying vec3 vN; varying vec3 vO;
      ${GLSL_NOISE}
      ${GLSL_ATMO_CORE}
      ${GLSL_SUNT}
      ${GLSL_HAZE}
      ${GLSL_UV}
      ${GLSL_TERRAIN}
      float lumOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      void main() {
        vec3 N = normalize(vN), L = normalize(uSunDir);
        vec3 md = uTexRot * normalize(vO);
        float ls = exp2(uLod);
        vec4 day4 = sampleEq4(uDay, md, ls);
        vec3 base = day4.rgb;
        float lum = lumOf(base);
        float ocean = uWaterAlpha > 0.5 ? day4.a : smoothstep(0.44, 0.14, lum) * smoothstep(0.0, 0.05, base.b - base.r);
        if (uKind == 0) {
          // The Earth map is a colourised relief chart: pull the saturation
          // back and deepen the water so it reads as a photograph.
          base = mix(vec3(lum), base, 0.7);
          base = mix(base, vec3(0.012, 0.048, 0.125) + base * 0.3, ocean * 0.85);
        }
        // Ground detail around the site while the planet is ground-scale.
        if (uDetail > 0.001) {
          vec3 rel = vWP - uPad;
          vec2 q = vec2(dot(rel, uPadX), dot(rel, uPadZ));
          float w = uDetail * (1.0 - smoothstep(550.0, 1100.0, length(q)));
          if (w > 0.001) {
            float tw;
            vec3 ta = uKind == 0 ? terrainEarth(q, tw) : terrainKepler(q, tw);
            base = mix(base, ta, w); ocean = mix(ocean, tw, w);
          }
        }
        float ndl = dot(N, L);
        vec3 sunT = sunTrans(vWP, uC, uR, uRa, uBR, uBM, uHR, uHM, L);
        float day = smoothstep(-0.12, 0.25, ndl);
        vec3 skyAmb = vec3(0.32, 0.42, 0.6) * 0.18 * day;
        vec3 col = base * (sunT * uSunI * 0.055 * max(ndl, 0.0) + skyAmb);
        vec3 V = normalize(cameraPosition - vWP), H = normalize(L + V);
        col += vec3(1.0, 0.96, 0.88) * pow(max(dot(N, H), 0.0), 140.0) * ocean * sunT * uSunI * 0.06;
        float night = 1.0 - smoothstep(-0.25, 0.06, ndl);
        if (uNightK > 0.0) col += sampleEq(uNight, md, ls) * night * uNightK;
        col += vec3(0.01, 0.016, 0.03) * (1.0 - day);
        vec3 T;
        vec3 rd = normalize(vWP - cameraPosition);
        float dist = length(vWP - cameraPosition);
        vec3 ins = atmo(cameraPosition, rd, dist, uC, uR, uRa, uBR, uBM, uHR, uHM, L, uSunI, 8, 4, T);
        col = applyHaze(col, T, ins, dist);
        gl_FragColor = vec4(col, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,   // authored once for the chapter fade; never toggled (a toggle recompiles)
  });
}

/* The cloud deck: a shell at CLOUD_H above the surface. Seen from the ground it
 * is the underside of the clouds (hence DoubleSide); near the site its coverage
 * comes from 3D noise in world units so the cumulus has real structure at
 * ground scale, blending into the global cloud map as the planet shrinks. */
function cloudShellMaterial({ map, atmoU, texRot, coverage = 1 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map }, uTexRot: { value: texRot }, uOpacity: { value: 1 }, uLod: { value: 0 },
      uPad: { value: new THREE.Vector3() }, uDetail: { value: 0 }, uTime: { value: 0 }, uCover: { value: coverage }, uHaze: { value: 1 },
      uC: atmoU.uC, uR: atmoU.uR, uRa: atmoU.uRa, uBR: atmoU.uBR, uBM: atmoU.uBM, uHR: atmoU.uHR, uHM: atmoU.uHM,
      uSunDir: atmoU.uSunDir, uSunI: atmoU.uSunI,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWP; varying vec3 vN; varying vec3 vO;
      void main() { vO = position; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform mat3 uTexRot; uniform float uOpacity; uniform float uLod;
      uniform vec3 uPad; uniform float uDetail; uniform float uTime; uniform float uCover;
      uniform vec3 uC; uniform float uR; uniform float uRa; uniform vec3 uBR; uniform float uBM; uniform float uHR; uniform float uHM;
      uniform vec3 uSunDir; uniform float uSunI;
      varying vec3 vWP; varying vec3 vN; varying vec3 vO;
      ${GLSL_NOISE}
      ${GLSL_ATMO_CORE}
      ${GLSL_SUNT}
      ${GLSL_HAZE}
      ${GLSL_UV}
      void main() {
        vec3 N = normalize(vN), L = normalize(uSunDir);
        vec3 o = normalize(vO);
        float ca = cos(uTime * 0.004), sa = sin(uTime * 0.004);
        vec3 md = uTexRot * vec3(ca * o.x - sa * o.z, o.y, sa * o.x + ca * o.z);   // slow drift
        float a = sampleEq4(uMap, md, exp2(uLod)).a * uCover;
        if (uDetail > 0.001) {
          vec3 rel = vWP - uPad;
          float n = fbm3(rel / 34.0 + vec3(uTime * 0.01, 0.0, 0.0));
          float puff = smoothstep(0.5, 0.68, n) * 0.95;
          float w = uDetail * (1.0 - smoothstep(700.0, 1500.0, length(rel.xz)));
          a = mix(a, puff, w);
        }
        if (a < 0.003) discard;
        float ndl = dot(N, L);
        vec3 sunT = sunTrans(vWP, uC, uR, uRa, uBR, uBM, uHR, uHM, L);
        float lit = smoothstep(-0.2, 0.35, ndl);
        vec3 col = vec3(0.94, 0.95, 0.97) * (sunT * uSunI * 0.05 * (0.35 + 0.65 * lit)) + vec3(0.04, 0.06, 0.09) * (0.3 + lit);
        vec3 T; vec3 rd = normalize(vWP - cameraPosition);
        float dist = length(vWP - cameraPosition);
        vec3 ins = atmo(cameraPosition, rd, dist, uC, uR, uRa, uBR, uBM, uHR, uHM, L, uSunI, 6, 3, T);
        col = applyHaze(col, T, ins, dist);
        gl_FragColor = vec4(col, a * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
}

/* --- Procedural textures (generated once at load) ------------------------- *
 * Periodic value noise: the lattice wraps at `px` cells in x, so equirect maps
 * meet cleanly at the seam. */
const nHash = (x, y, px) => { x = ((x % px) + px) % px; const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
function pnoise(x, y, px) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(nHash(xi, yi, px), nHash(xi + 1, yi, px), u), lerp(nHash(xi, yi + 1, px), nHash(xi + 1, yi + 1, px), u), v);
}
function fbmP(x, y, px, oct) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * pnoise(x * f, y * f, px * f); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}
const smoothstep01 = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/* Cloud alpha map. Latitude weighting follows the real pattern (wet ITCZ, dry
 * subtropics, mid-latitude storm tracks). The fbm has a mean of 0.5 and a
 * standard deviation of ~0.12, so the cutoff sits inside that band with a wide
 * soft edge - thresholding as if it filled [0,1] saturates into a white shell. */
function cloudTexture(w = 1024, seed = 0) {
  const h = w / 2, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"), img = g.createImageData(w, h), d = img.data;
  const gauss = (x, s) => Math.exp(-(x / s) * (x / s));
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - y / h) * Math.PI, al = Math.abs(lat);
    const band = clamp(0.22 + 0.72 * gauss(lat, 0.21) + 0.6 * gauss(al - 0.98, 0.32) - 0.34 * gauss(al - 0.46, 0.2), 0, 1);
    const thr = 0.6 - 0.13 * band;
    for (let x = 0; x < w; x++) {
      const n = fbmP((x / w) * 20, (y / h) * 10 + seed, 20, 4) * 0.56 + fbmP((x / w) * 58, (y / h) * 29 + seed, 58, 4) * 0.3 + fbmP((x / w) * 170, (y / h) * 85 + seed, 170, 3) * 0.14;
      let a = smoothstep01((n - thr) / 0.155) * (0.55 + 0.4 * band);
      a *= 1 - smoothstep01((al - 1.34) / 0.24) * 0.45;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c);
}

/* Night-side city lights from the day map: warm-biased land that is neither
 * dark nor icy, thinned toward the poles and clustered by a low-frequency field,
 * then bloomed into conurbation glows. */
function nightLightsTexture(dayImage, w = 1024) {
  const h = w / 2;
  const src = document.createElement("canvas"); src.width = w; src.height = h;
  const sg = src.getContext("2d", { willReadFrequently: true });
  sg.drawImage(dayImage, 0, 0, w, h);
  const s = sg.getImageData(0, 0, w, h).data;
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const og = out.getContext("2d"), img = og.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - y / h) * Math.PI, latW = Math.exp(-Math.pow((lat - 0.14) / 0.6, 2));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = s[i] / 255, gg = s[i + 1] / 255, b = s[i + 2] / 255;
      const lum = 0.299 * r + 0.587 * gg + 0.114 * b, sat = Math.max(r, gg, b) - Math.min(r, gg, b);
      const land = clamp((r - b) * 3.4, 0, 1) * clamp((lum - 0.09) * 5, 0, 1);
      const ice = clamp((lum - 0.6) * 3.2, 0, 1) * clamp(1 - sat * 4.5, 0, 1);
      const p0 = land * latW * (1 - ice);
      if (p0 <= 0.015) continue;                       // cheap reject before the noise
      const p = p0 * clamp((fbmP((x / w) * 16, (y / h) * 8, 16, 3) - 0.3) * 2.4, 0, 1);
      if (p <= 0.015 || nHash(x * 7 + 3, y * 13 + 11, w * 7) > p * 0.16) continue;
      const warm = 0.55 + 0.45 * nHash(x * 3, y * 5, w * 3), v = clamp(p * 2.1, 0.25, 1);
      d[i] = Math.round(255 * v); d[i + 1] = Math.round(215 * v * (0.78 + 0.22 * warm)); d[i + 2] = Math.round(150 * v * (0.42 + 0.58 * warm)); d[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  const blurred = document.createElement("canvas"); blurred.width = w; blurred.height = h;
  const bg = blurred.getContext("2d");
  bg.filter = "blur(2.4px)"; bg.drawImage(out, 0, 0); bg.filter = "none";
  bg.globalCompositeOperation = "lighter"; bg.drawImage(out, 0, 0);
  return canvasTex(blurred);
}

/* Kepler-452b's surface: continents from periodic fbm elevation, teal oceans
 * (water mask in alpha), ochre plains, mossy uplands, rust deserts, grey
 * highlands and polar ice. */
function keplerSurfaceTexture(w = 1024) {
  const h = w / 2, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - y / h) * Math.PI, al = Math.abs(lat);
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const e = fbmP(u * 6, v * 3 + 11, 6, 5) * 0.75 + fbmP(u * 24, v * 12 + 3, 24, 3) * 0.25;
      const moist = fbmP(u * 9, v * 4.5 + 40, 9, 4);
      let r, gg, b, water = 0;
      if (e < 0.47) {
        const deep = smoothstep01((0.47 - e) / 0.1);
        r = lerp(0.07, 0.02, deep); gg = lerp(0.24, 0.09, deep); b = lerp(0.27, 0.15, deep); water = 1;
      } else {
        const hgt = smoothstep01((e - 0.47) / 0.2);
        r = lerp(0.52, 0.2, moist); gg = lerp(0.41, 0.3, moist); b = lerp(0.24, 0.17, moist);
        if (moist < 0.38) { r = lerp(r, 0.62, 0.6); gg = lerp(gg, 0.36, 0.6); b = lerp(b, 0.22, 0.6); }
        r = lerp(r, 0.46, hgt * 0.6); gg = lerp(gg, 0.44, hgt * 0.6); b = lerp(b, 0.42, hgt * 0.6);
      }
      const ice = smoothstep01((al - 1.18) / 0.15);
      r = lerp(r, 0.9, ice); gg = lerp(gg, 0.93, ice); b = lerp(b, 0.95, ice); water *= 1 - ice;
      const i = (y * w + x) * 4;
      d[i] = r * 255; d[i + 1] = gg * 255; d[i + 2] = b * 255; d[i + 3] = water * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c);
}

/* Uranus has no map in the library: pale cyan with faint, soft banding. */
function uranusTexture(w = 512) {
  const h = w / 2, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const v = y / h, band = 0.5 + 0.5 * Math.sin(v * 38) * 0.35 + 0.15 * Math.sin(v * 11 + 1);
    for (let x = 0; x < w; x++) {
      const n = fbmP((x / w) * 8, v * 30, 8, 3);
      const k = 0.92 + 0.06 * band + 0.05 * (n - 0.5);
      const i = (y * w + x) * 4;
      d[i] = 158 * k; d[i + 1] = 222 * k; d[i + 2] = 230 * k; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c);
}

/* Soft sprite textures for clouds, smoke, glows and nebulae. */
function spriteTexture(kind, seed = 1, size = 256) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"), img = g.createImageData(size, size), d = img.data;
  const blobs = [];
  for (let i = 0; i < 22; i++) blobs.push([0.5 + (rand(i, seed) - 0.5) * 0.55, 0.5 + (rand(i, seed + 7) - 0.5) * (kind === "puff" ? 0.35 : 0.55), 0.09 + rand(i, seed + 3) * 0.16]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    let a = 0, cr = 255, cg = 255, cb = 255;
    if (kind === "glow") {
      a = Math.exp(-r * r * 5) * 0.9 + Math.exp(-r * r * 40) * 0.6;
    } else if (kind === "puff") {
      // Fair-weather cumulus: billowing tops, a flat base, lit from above
      // with a grey-blue underside - not the round cotton balls of before.
      // a dome of lumps resting on a flat base, sharper edges at the top
      let m = 0;
      for (let k = 0; k < 26; k++) {
        const bx = 0.18 + rand(k, seed) * 0.64, base = 0.62;
        const hgt = 0.18 + 0.3 * Math.sin(Math.PI * (bx - 0.18) / 0.64) * (0.6 + 0.4 * rand(k, seed + 4));
        const by = base - hgt * rand(k, seed + 9), br = 0.06 + rand(k, seed + 3) * 0.1;
        const q = Math.hypot(u - bx, v - by) / br; m += Math.exp(-q * q * 2.4);
      }
      const n = fbmP(u * 14 + seed, v * 14, 14, 4);
      a = smoothstep01((m + (n - 0.5) * 0.6 - 0.32) / 0.32);
      a *= 1 - smoothstep01((v - 0.6) / 0.035);                    // flat base
      const lit = clamp(1.0 - Math.max(0, v - 0.25) * 1.05 + (n - 0.5) * 0.18, 0.5, 1.0);
      cr = 255 * lit * 0.96; cg = 255 * lit * 0.98; cb = 255 * Math.min(1, lit * 1.05);
    } else if (kind === "smoke") {
      let m = 0;
      for (const [bx, by, br] of blobs) { const q = Math.hypot(u - bx, v - by) / br; m += Math.exp(-q * q * 1.6); }
      const n = fbmP(u * 8 + seed, v * 8, 8, 4);
      a = smoothstep01((m * (0.65 + 0.7 * n) - 0.45) / 0.9) * (1 - smoothstep01((r - 0.75) / 0.25));
    } else if (kind === "nebula") {
      const wx = fbmP(u * 4 + seed, v * 4, 64, 4), wy = fbmP(u * 4, v * 4 + seed * 1.7, 64, 4);
      const n = fbmP(u * 5 + wx * 2.2 + seed, v * 5 + wy * 2.2, 64, 5);
      a = smoothstep01((n - 0.35) / 0.45) * Math.pow(1 - smoothstep01((r - 0.25) / 0.75), 1.4);
      const fil = Math.pow(1 - Math.abs(fbmP(u * 9 + seed * 2, v * 9, 64, 4) - 0.5) * 2, 6);
      a = Math.min(1, a * (0.7 + 0.8 * fil));
    }
    d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = Math.round(clamp(a, 0, 1) * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* --- Other planets: one lit-sphere shader ---------------------------------- *
 * Wrapped Lambert with a soft terminator, limb darkening for the gas giants,
 * fine banding to break up the low-resolution maps, Saturn's ring shadow, and
 * an atmospheric haze that lives INSIDE the disc on the lit limb. The old
 * version wrapped each planet in a bigger additive shell, which is what read
 * as a hard bluish "shield" line floating around it. */
const GLSL_RING = /* glsl */ `
  float ringAlpha(float x) {
    float a = 0.58 + 0.22 * sin(x * 37.0) * sin(x * 13.0 + 1.0) + 0.08 * sin(x * 91.0 + 2.0);
    a *= 1.0 - 0.92 * (1.0 - smoothstep(0.0, 0.022, abs(x - 0.63)));   // Cassini division
    a *= mix(0.3, 1.0, smoothstep(0.08, 0.22, x));                      // faint inner C ring
    a *= smoothstep(0.0, 0.03, x) * (1.0 - smoothstep(0.95, 1.0, x));
    return clamp(a, 0.0, 1.0);
  }
  vec3 ringColor(float x) { return mix(vec3(0.66, 0.55, 0.4), vec3(0.9, 0.82, 0.66), 0.5 + 0.5 * sin(x * 11.0 + 0.7)); }
`;
function planetMaterial({ map = null, color = 0xffffff, rim = 0x000000, rimK = 0, limb = 0, band = 0, ring = null }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map }, uHasMap: { value: map ? 1 : 0 }, uColor: { value: new THREE.Color(color) },
      uSunDir: { value: sunDir }, uRim: { value: new THREE.Color(rim) }, uRimK: { value: rimK }, uLimb: { value: limb }, uBand: { value: band },
      uOpacity: { value: 1 }, uCenter: { value: new THREE.Vector3() }, uRingN: { value: new THREE.Vector3(0, 1, 0) },
      uRing: { value: new THREE.Vector2(ring ? ring[0] : 0, ring ? ring[1] : 0) }, uRingOn: { value: ring ? 1 : 0 }, uAlbedo: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vWP;
      void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uHasMap; uniform vec3 uColor; uniform vec3 uSunDir; uniform vec3 uRim; uniform float uRimK;
      uniform float uLimb; uniform float uBand; uniform float uOpacity; uniform vec3 uCenter; uniform vec3 uRingN; uniform vec2 uRing; uniform float uRingOn; uniform float uAlbedo;
      varying vec2 vUv; varying vec3 vN; varying vec3 vWP;
      ${GLSL_NOISE}
      ${GLSL_RING}
      void main() {
        vec3 N = normalize(vN), L = normalize(uSunDir), V = normalize(cameraPosition - vWP);
        vec3 alb = (uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : uColor) * uAlbedo;
        alb *= 1.0 + uBand * (fbm2(vec2(vUv.x * 18.0, vUv.y * 260.0)) - 0.5);
        float ndl = dot(N, L), ndv = max(dot(N, V), 0.0);
        alb *= mix(1.0, pow(ndv, 0.45), uLimb);
        float shade = 1.0;
        if (uRingOn > 0.5) {
          float den = dot(L, uRingN);
          if (abs(den) > 1e-4) {
            float t = dot(uCenter - vWP, uRingN) / den;
            if (t > 0.0) {
              float rr = length(vWP + L * t - uCenter);
              if (rr > uRing.x && rr < uRing.y) shade *= 1.0 - 0.8 * ringAlpha((rr - uRing.x) / (uRing.y - uRing.x));
            }
          }
        }
        float wrap = max((ndl + 0.1) / 1.1, 0.0);
        vec3 col = alb * (1.15 * wrap * shade + 0.025);
        col += uRim * pow(1.0 - ndv, 3.0) * smoothstep(-0.2, 0.5, ndl) * uRimK;
        gl_FragColor = vec4(col, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
  });
}
function ringMaterial(planetR, ring) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: sunDir }, uCenter: { value: new THREE.Vector3() }, uRingN: { value: new THREE.Vector3(0, 1, 0) },
      uRing: { value: new THREE.Vector2(ring[0], ring[1]) }, uPR: { value: planetR }, uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `varying vec3 vWP; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir; uniform vec3 uCenter; uniform vec3 uRingN; uniform vec2 uRing; uniform float uPR; uniform float uOpacity;
      varying vec3 vWP;
      ${GLSL_RING}
      void main() {
        float rr = length(vWP - uCenter); float x = (rr - uRing.x) / (uRing.y - uRing.x);
        if (x < 0.0 || x > 1.0) discard;
        vec3 L = normalize(uSunDir);
        vec3 oc = vWP - uCenter; float b = dot(oc, L); float h = b * b - (dot(oc, oc) - uPR * uPR);
        float sh = (h > 0.0 && -b - sqrt(h) > 0.0) ? 0.07 : 1.0;    // in the planet's shadow
        float lit = 0.4 + 0.6 * abs(dot(uRingN, L));
        vec3 col = ringColor(x) * (1.05 * lit * sh + 0.02);
        gl_FragColor = vec4(col, ringAlpha(x) * 0.78 * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
}
function starMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vWP; varying vec3 vO; void main() { vO = position; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uOpacity; varying vec3 vN; varying vec3 vWP; varying vec3 vO;
      ${GLSL_NOISE}
      void main() {
        float ndv = max(dot(normalize(vN), normalize(cameraPosition - vWP)), 0.0);
        float gran = fbm3(normalize(vO) * 9.0 + vec3(uTime * 0.05));
        vec3 col = uColor * (1.4 + 2.2 * pow(ndv, 0.6)) * (0.85 + 0.3 * gran);   // limb darkening + granulation
        gl_FragColor = vec4(col, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
  });
}

/* --- Billboard sprite batches (clouds, smoke, glows, nebulae) ------------- *
 * One instanced quad per sprite, turned to face the camera in the vertex
 * shader. Positions/sizes/colours live in instance attributes that the frame
 * loop rewrites for the animated batches. */
const FX_ORDER = 2;
function makeSpriteBatch({ count, map, additive = false, lit = false, nearFade = [0, 0], renderOrder = 1, softTop = false }) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.setAttribute("position", base.getAttribute("position")); g.setAttribute("uv", base.getAttribute("uv"));
  const off = new Float32Array(count * 3), size = new Float32Array(count), rot = new Float32Array(count), col = new Float32Array(count * 4);
  g.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 3));
  g.setAttribute("aSize", new THREE.InstancedBufferAttribute(size, 1));
  g.setAttribute("aRot", new THREE.InstancedBufferAttribute(rot, 1));
  g.setAttribute("aCol", new THREE.InstancedBufferAttribute(col, 4));
  g.instanceCount = count;
  const m = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uSunDir: { value: sunDir }, uLit: { value: lit ? 1 : 0 }, uNear: { value: new THREE.Vector2(...nearFade) }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aOff; attribute float aSize; attribute float aRot; attribute vec4 aCol;
      varying vec2 vUv; varying vec4 vCol; varying float vDist;
      void main() {
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float c = cos(aRot), s = sin(aRot);
        vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
        vec3 wp = aOff + (right * p.x + up * p.y) * aSize;
        // distance from the sprite's centre in units of its size: a huge cloud
        // sprite fades as the camera enters it, not when its corners do
        vUv = uv; vCol = aCol; vDist = distance(aOff, cameraPosition) / max(aSize, 1e-3);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uSunDir; uniform float uLit; uniform vec2 uNear; uniform float uOpacity;
      varying vec2 vUv; varying vec4 vCol; varying float vDist;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        float a = t.a * vCol.a * uOpacity;
        if (uNear.y > 0.0) a *= smoothstep(uNear.x, uNear.y, vDist);
        if (a < 0.004) discard;
        vec3 col = vCol.rgb * t.rgb;
        if (uLit > 0.5) col *= mix(0.62, 1.08, smoothstep(0.1, 0.95, vUv.y));
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = renderOrder;
  const batch = {
    mesh, count, off, size, rot, col,
    set(i, x, y, z, s, r, cr, cg, cb, ca) { off[i * 3] = x; off[i * 3 + 1] = y; off[i * 3 + 2] = z; size[i] = s; rot[i] = r; col[i * 4] = cr; col[i * 4 + 1] = cg; col[i * 4 + 2] = cb; col[i * 4 + 3] = ca; },
    upload() { for (const k of ["aOff", "aSize", "aRot", "aCol"]) g.getAttribute(k).needsUpdate = true; },
  };
  return batch;
}

/* Soft round point sprites with size attenuation clamped in pixels (the old
 * PointsMaterial squares blew up into big flat tiles near the camera). */
function softPointsMaterial({ opacity = 1, maxPx = 24, additive = true }) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: pointScale }, uMaxPx: { value: maxPx }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute vec3 color; uniform float uScale; uniform float uMaxPx;
      varying vec3 vC; varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float px = aSize * uScale / max(-mv.z, 0.001);
        gl_PointSize = clamp(px, 1.0, uMaxPx);
        vFade = clamp(px, 0.0, 1.0);          // sub-pixel points dim instead of flickering
        vC = color; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; varying vec3 vC; varying float vFade;
      void main() {
        vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
        if (r > 1.0) discard;
        float a = (exp(-r * r * 4.5) * 0.85 + exp(-r * r * 28.0) * 0.5) * uOpacity * vFade;
        gl_FragColor = vec4(vC, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  pointMaterials.push(m);
  return m;
}

/* --- Earth ----------------------------------------------------------------- */
const LC39A = siteRotation(28.6, -80.6);       // Launch Complex 39A, Kennedy Space Center
let earthGroup = null, earthSurf = null, earthClouds = null, earthCloudMat = null, earthSurfMat = null;
function makeEarth(dayTex) {
  dayTex.wrapS = THREE.RepeatWrapping; dayTex.anisotropy = 16;
  dayTex.minFilter = THREE.LinearMipmapLinearFilter; dayTex.generateMipmaps = true; dayTex.needsUpdate = true;
  earthGroup = new THREE.Group();
  earthSurfMat = terrestrialMaterial({ day: dayTex, night: nightLightsTexture(dayTex.image), kind: 0, atmoU: EARTH_ATMO, texRot: LC39A });
  earthSurf = new THREE.Mesh(PLANET_GEO, earthSurfMat);
  earthSurf.frustumCulled = false;
  earthGroup.add(earthSurf);
  earthCloudMat = cloudShellMaterial({ map: cloudTexture(1024, 0), atmoU: EARTH_ATMO, texRot: LC39A });
  earthClouds = new THREE.Mesh(PLANET_GEO, earthCloudMat);
  earthClouds.scale.setScalar(1 + CLOUD_H); earthClouds.frustumCulled = false;
  earthGroup.add(earthClouds);
  scene.add(earthGroup);
}

/* --- Launch complex -------------------------------------------------------- *
 * The gantry model carries both the fixed service structure (tower, lightning
 * mast, access arms) and the mobile launcher platform. Measured in its own
 * units: launcher deck top y=1.26, centre (0.73, -1.885); tower ~7 units north
 * of it; ground y=-1.39. Scaled so the tower-plus-mast stands ~105 m against
 * the 56 m stack, turned so the tower stands behind the stack as seen from the
 * launch camera, and placed so the deck meets the stack's measured tail. */
let gantry = null, crawler = null;
const GANTRY = { scale: 0.516, deckTop: 1.26, deckC: new THREE.Vector2(0.73, -1.885), ground: -1.39, rotY: -2.498 };
function placeGantry(root, tailY) {
  gantry = new THREE.Group(); gantry.add(root);
  gantry.scale.setScalar(GANTRY.scale);
  gantry.rotation.y = GANTRY.rotY;
  const c = new THREE.Vector3(GANTRY.deckC.x, 0, GANTRY.deckC.y).multiplyScalar(GANTRY.scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), GANTRY.rotY);
  gantry.position.set(-c.x, tailY - GANTRY.deckTop * GANTRY.scale, -c.z);
  Y_G = gantry.position.y + GANTRY.ground * GANTRY.scale;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = o.material.clone(); o.material.color.multiplyScalar(0.92); } });
  scene.add(gantry);
}
/* The landmarks of the pad perimeter: the 290-foot sound-suppression water
 * tower and the two big storage spheres, liquid oxygen and liquid hydrogen. */
function makePadProps() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.45, metalness: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c939c, roughness: 0.6, metalness: 0.6 });
  const tower = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 16), white); tank.scale.set(1, 0.8, 1); tank.position.y = 7.7; tower.add(tank);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 7.4, 6), steel);
    leg.position.set(Math.cos(a) * 0.62, 3.7, Math.sin(a) * 0.62); leg.rotation.set(Math.sin(a) * 0.05, 0, -Math.cos(a) * 0.05);
    tower.add(leg);
  }
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7.4, 8), steel); riser.position.y = 3.7; tower.add(riser);
  tower.position.set(-15, Y_G, 13); g.add(tower);
  const lox = new THREE.Mesh(new THREE.SphereGeometry(1.25, 28, 18), white); lox.position.set(-13.5, Y_G + 1.5, -12.5); g.add(lox);
  const lh2 = new THREE.Mesh(new THREE.SphereGeometry(1.6, 28, 18), white); lh2.position.set(15.5, Y_G + 1.9, 10.5); g.add(lh2);
  for (const [sph, r] of [[lox, 1.25], [lh2, 1.6]]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r * 0.85, r * 0.5, 16), steel);
    ring.position.copy(sph.position).y = Y_G + r * 0.25; g.add(ring);
  }
  scene.add(g);
  padProps = g;
}
let padProps = null;
function placeCrawler(root) {
  crawler = new THREE.Group(); crawler.add(root);
  crawler.scale.setScalar(0.407);
  crawler.position.set(-26, Y_G + 0.22 * 0.407, -1.7);
  scene.add(crawler);
}

/* --- Bodies ---------------------------------------------------------------- *
 * `mode` is how the flight meets each one: "below" passes over it, "around"
 * swings round it on the inside of the path's curve, "side" passes beside it. */
const BODY_DEFS = [
  { key: "moon", pos: [40, 14, -220], r: 18, tex: "moon", spin: 0.02, mode: "around", limb: 0.15, albedo: 0.62 },
  { key: "mars", pos: [-40, 12, -345], r: 9, tex: "mars", spin: 0.05, mode: "below", rim: 0xe0a080, rimK: 0.3 },
  { key: "jupiter", pos: [46, -14, -610], r: 48, tex: "jupiter", spin: 0.03, mode: "around", limb: 0.55, band: 0.1, rim: 0xe6d2a8, rimK: 0.12 },
  { key: "saturn", pos: [-70, 20, -870], r: 38, tex: "saturn", spin: 0.03, ring: [50, 86], mode: "below", limb: 0.5, band: 0.06 },
  { key: "uranus", pos: [56, 30, -1060], r: 24, tex: "uranus", spin: 0.04, mode: "side", limb: 0.3, rim: 0xa8f0f6, rimK: 0.35 },
  { key: "neptune", pos: [-34, -16, -1200], r: 24, tex: "neptune", spin: 0.04, mode: "side", limb: 0.4, rim: 0x6a9cff, rimK: 0.4 },
  { key: "pluto", pos: [24, 8, -1430], r: 7, tex: "pluto", spin: 0.02, mode: "below" },
];
const FEATURES = [
  { key: "moon", pAt: pAt(5), w: 0.05, strength: 0.6 },
  { key: "mars", pAt: pAt(6) - 0.015, w: 0.035, strength: 0.4 },
  { key: "jupiter", pAt: pAt(7), w: 0.05, strength: 0.62 },
  { key: "saturn", pAt: pAt(8), w: 0.05, strength: 0.6 },
  { key: "uranus", pAt: pAt(9), w: 0.045, strength: 0.5 },
  { key: "neptune", pAt: pAt(9) + 0.03, w: 0.04, strength: 0.45 },
  { key: "pluto", pAt: pAt(10), w: 0.045, strength: 0.4 },
  { key: "star", pAt: 0.9, w: 0.045, strength: 0.5 },
  { key: "earth", pAt: 0.225, w: 0.06, strength: 0.5, pos: new THREE.Vector3() },   // look back at the receding planet
  { key: "kepler", pAt: 0.948, w: 0.04, strength: 0.65, pos: new THREE.Vector3() },  // the destination, ahead on approach
];
const EARTH_FEATURE = FEATURES.find((f) => f.key === "earth");
const VIS = {
  moon: [0.0, 0.06, 0.34, 0.44], mars: [0.26, 0.32, 0.41, 0.47], jupiter: [0.33, 0.39, 0.47, 0.53],
  saturn: [0.39, 0.45, 0.53, 0.59], uranus: [0.45, 0.51, 0.58, 0.64], neptune: [0.48, 0.54, 0.61, 0.67],
  pluto: [0.53, 0.58, 0.65, 0.71], star: [0.74, 0.84, 1.01, 1.02],
};
const bodies = {};
const textures = {};
function makeBody(def) {
  const g = new THREE.Group();
  const mat = planetMaterial({ map: textures[def.tex], rim: def.rim || 0, rimK: def.rimK || 0, limb: def.limb || 0, band: def.band || 0, ring: def.ring });
  if (def.albedo) mat.uniforms.uAlbedo.value = def.albedo;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.r, 96, 64), mat);
  g.add(mesh);
  let ring = null;
  if (def.ring) {
    ring = new THREE.Mesh(new THREE.RingGeometry(def.ring[0], def.ring[1], 160, 1), ringMaterial(def.r, def.ring));
    ring.rotation.x = -Math.PI / 2 + 0.38; ring.rotation.y = 0.2;
    g.add(ring);
  }
  scene.add(g);
  bodies[def.key] = { group: g, mesh, mat, ring, pos: new THREE.Vector3(...def.pos), r: def.r, spin: def.spin || 0, def };
}
let starGlow = null;
function makeStar() {
  const g = new THREE.Group();
  const mat = starMaterial(0xffd9a0);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(42, 64, 48), mat);
  g.add(mesh);
  starGlow = makeSpriteBatch({ count: 2, map: spriteTexture("glow", 3, 128), additive: true, renderOrder: FX_ORDER });
  starGlow.set(0, 0, 0, 0, 42 * 9, 0, 1.0, 0.82, 0.55, 0.85);
  starGlow.set(1, 0, 0, 0, 42 * 3.2, 0, 1.0, 0.95, 0.85, 1.0);
  starGlow.upload();
  scene.add(starGlow.mesh);
  scene.add(g);
  bodies.star = { group: g, mesh, mat, pos: new THREE.Vector3(10, 4, -3320), r: 42, spin: 0, def: { key: "star" } };
}

/* Place every body relative to its chapter's point on the path, then check the
 * real ship and chase-camera positions across the window it is visible in and
 * push it outward until both clear it. (Placing against the chapter point alone
 * let the path curve back through Jupiter.) */
const _pp = new THREE.Vector3(), _tn = new THREE.Vector3(), _dr = new THREE.Vector3(), _tA = new THREE.Vector3(), _tB = new THREE.Vector3();
function placeBodies() {
  for (const f of FEATURES) {
    const body = bodies[f.key]; if (!body || f.key === "star") continue;
    const def = body.def, r = body.r;
    const at = clamp(f.pAt, 0, 1);
    path.getPoint(at, _pp); safeTangent(at, _tn);
    if (def.mode === "below") {
      _dr.set(0, -1, 0).addScaledVector(_tn, _tn.y).normalize();
    } else if (def.mode === "around") {
      safeTangent(clamp(at - 0.01, 0, 1), _tA); safeTangent(clamp(at + 0.01, 0, 1), _tB);
      _dr.subVectors(_tB, _tA); _dr.addScaledVector(_tn, -_dr.dot(_tn));
      if (_dr.lengthSq() < 1e-6) _dr.copy(body.pos).sub(_pp).addScaledVector(_tn, -body.pos.clone().sub(_pp).dot(_tn));
      _dr.normalize();
    } else {
      _dr.copy(body.pos).sub(_pp); _dr.addScaledVector(_tn, -_dr.dot(_tn));
      if (_dr.lengthSq() < 1e-4) _dr.crossVectors(_tn, UP);
      _dr.normalize();
    }
    const visR = def.ring ? def.ring[1] + 4 : r;
    const ahead = def.mode === "side" ? r * 2.6 : r * 0.9;
    const off = def.mode === "side" ? r * 1.7 : visR + Math.max(6, r * 0.35);
    body.pos.copy(_pp).addScaledVector(_tn, ahead).addScaledVector(_dr, off);
    // clearance against the real ship and camera positions
    const need = visR + Math.max(5, visR * 0.15);
    const w = VIS[f.key] || [at - 0.1, at - 0.1, at + 0.1, at + 0.1];
    const near = clearanceSamples().filter((s) => s.p >= w[0] && s.p <= w[3]);
    for (let i = 0; i < 80; i++) {
      let min = Infinity;
      for (const s of near) min = Math.min(min, s.ship.distanceTo(body.pos), s.cam.distanceTo(body.pos));
      if (min >= need) break;
      body.pos.addScaledVector(_dr, visR * 0.08);
    }
    body.group.position.copy(body.pos);
    f.pos = body.pos;
  }
}
let _clearSamples = null;
function clearanceSamples() {
  if (_clearSamples) return _clearSamples;
  _clearSamples = [];
  const t = new THREE.Vector3(), r = new THREE.Vector3();
  for (let p = 0.2; p <= 0.951; p += 0.002) {
    const ship = path.getPoint(p, new THREE.Vector3());
    safeTangent(p, t); rightOf(t, r);
    const cam = ship.clone().addScaledVector(t, -27).addScaledVector(UP, 7).addScaledVector(r, 5);
    _clearSamples.push({ p, ship, cam });
  }
  return _clearSamples;
}

/* --- Belts, starfield, nebulae, galaxy ------------------------------------- */
const fields = [];   // { obj, vis:[a,b], mats:[{m, op0, key}] }
function addField(obj, vis, mats) { obj.visible = false; scene.add(obj); fields.push({ obj, vis, mats: mats.map((m) => ({ m, op0: m.uniforms ? m.uniforms.uOpacity.value : m.opacity })) }); }

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.getAttribute("position"), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 0.72 + 0.5 * fbmP(v.x * 1.7 + seed, v.y * 1.7 + v.z * 0.9, 64, 3);
    v.multiplyScalar(n); v.x *= 1.25; p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function makeBelt({ center, rIn, rOut, thick, rocks, dust, rockColor, dustColor, vis, rockSize }) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.05, flatShading: true, transparent: true });
  const geos = [rockGeometry(1.3), rockGeometry(7.1), rockGeometry(4.4)];
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const per = Math.ceil(rocks / geos.length);
  geos.forEach((geo, gi) => {
    const im = new THREE.InstancedMesh(geo, mat, per);
    for (let i = 0; i < per; i++) {
      const k = gi * 1000 + i;
      const ang = rand(k, 1) * Math.PI * 2, r = rIn + Math.pow(rand(k, 2), 0.8) * (rOut - rIn);
      dummy.position.set(center[0] + Math.cos(ang) * r, center[1] + (rand(k, 3) - 0.5) * thick, center[2] + Math.sin(ang) * r * 0.5);
      dummy.rotation.set(rand(k, 4) * 6.3, rand(k, 5) * 6.3, rand(k, 6) * 6.3);
      dummy.scale.setScalar(rockSize * (0.25 + Math.pow(rand(k, 7), 3) * 1.8));
      dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      col.set(rockColor).multiplyScalar(0.7 + rand(k, 8) * 0.5); im.setColorAt(i, col);
    }
    grp.add(im);
  });
  const pts = makePointCloud(dust, (i, out) => {
    const ang = rand(i, 11) * Math.PI * 2, r = rIn + rand(i, 12) * (rOut - rIn);
    out.set(center[0] + Math.cos(ang) * r, center[1] + (rand(i, 13) - 0.5) * thick * 1.2, center[2] + Math.sin(ang) * r * 0.5);
  }, dustColor, [0.3, 0.9], 0.12, { opacity: 0.6, maxPx: 6 });
  grp.add(pts);
  addField(grp, vis, [mat, pts.material]);
}
function makePointCloud(n, placer, colors, sizeRange, hueJitter, opts) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const v = new THREE.Vector3(), c = new THREE.Color(), palette = (Array.isArray(colors) ? colors : [colors]).map((x) => new THREE.Color(x));
  for (let i = 0; i < n; i++) {
    placer(i, v); pos.set([v.x, v.y, v.z], i * 3);
    c.copy(palette[Math.floor(rand(i, 21) * palette.length) % palette.length]);
    c.offsetHSL((rand(i, 22) - 0.5) * hueJitter, (rand(i, 23) - 0.5) * 0.2, (rand(i, 24) - 0.5) * 0.25);
    col.set([c.r, c.g, c.b], i * 3);
    size[i] = lerp(sizeRange[0], sizeRange[1], Math.pow(rand(i, 25), 2.2));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const pts = new THREE.Points(g, softPointsMaterial(opts));
  pts.renderOrder = FX_ORDER; pts.frustumCulled = false;
  return pts;
}
let nebulaTex = [];
function makeNebula({ center, spread, flat = 0.6, points, palette, sprites, spriteAlpha, vis, dark = false }) {
  const grp = new THREE.Group();
  const g3 = (i, s) => (rand(i, s) + rand(i, s + 1) + rand(i, s + 2) - 1.5) / 1.5;
  const pts = makePointCloud(points, (i, out) => out.set(center[0] + g3(i, 31) * spread, center[1] + g3(i, 34) * spread * flat, center[2] + g3(i, 37) * spread),
    palette, [0.5, 2.6], 0.08, { opacity: 0.85, maxPx: 10 });
  grp.add(pts);
  const mats = [pts.material];
  const byTex = nebulaTex.map((t) => makeSpriteBatch({ count: Math.ceil(sprites / nebulaTex.length), map: t, additive: !dark, renderOrder: dark ? FX_ORDER + 1 : FX_ORDER, nearFade: [0.25, 0.8] }));
  byTex.forEach((b, bi) => {
    for (let i = 0; i < b.count; i++) {
      const k = bi * 100 + i;
      const c = new THREE.Color(palette[k % palette.length]);
      if (dark) c.setRGB(0.035, 0.022, 0.016);
      b.set(i, center[0] + g3(k, 41) * spread * 0.8, center[1] + g3(k, 44) * spread * flat * 0.7, center[2] + g3(k, 47) * spread * 0.8,
        spread * (0.45 + rand(k, 50) * 0.75), rand(k, 51) * 6.3, c.r, c.g, c.b, spriteAlpha * (0.6 + rand(k, 52) * 0.6));
    }
    b.upload(); grp.add(b.mesh); mats.push(b.mesh.material);
  });
  addField(grp, vis, mats);
}
function makeGalaxy() {
  const grp = new THREE.Group();
  grp.position.set(-950, 560, -3950); grp.rotation.set(-1.05, 0.2, 0.42);
  const n = 16000, arms = 4, core = new THREE.Color(0xfff0d0), edge = new THREE.Color(0x5577ff), pink = new THREE.Color(0xff6aa8);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = i / n, radius = Math.pow(t, 0.55) * 620, arm = i % arms;
    const angle = radius * 0.0105 + (arm / arms) * Math.PI * 2 + (rand(i, 61) - 0.5) * 0.5;
    const sc = (1 - t) * 26 + 10;
    pos[i * 3] = Math.cos(angle) * radius + (rand(i, 62) - 0.5) * sc * 2;
    pos[i * 3 + 1] = (rand(i, 63) - 0.5) * sc * (1 - t) * 1.4;
    pos[i * 3 + 2] = Math.sin(angle) * radius + (rand(i, 64) - 0.5) * sc * 2;
    c.copy(core).lerp(edge, Math.min(1, t * 1.25));
    if (rand(i, 65) < 0.06) c.copy(pink);
    col.set([c.r, c.g, c.b], i * 3);
    size[i] = 2.2 + Math.pow(rand(i, 66), 3) * 7;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const pts = new THREE.Points(g, softPointsMaterial({ opacity: 0.9, maxPx: 7 }));
  pts.frustumCulled = false; pts.renderOrder = FX_ORDER;
  grp.add(pts);
  const glow = makeSpriteBatch({ count: 1, map: spriteTexture("glow", 5, 128), additive: true, renderOrder: FX_ORDER });
  glow.set(0, 0, 0, 0, 380, 0, 1.0, 0.86, 0.66, 0.55); glow.upload();
  grp.add(glow.mesh);
  addField(grp, [0.6, 1.01], [pts.material, glow.mesh.material]);
}
/* A deep local starfield around the whole route, for parallax: the star map is
 * at infinity, so without near stars the voyage has no sense of motion. */
let localStars = null;
function makeLocalStars() {
  localStars = makePointCloud(9000, (i, out) => {
    const z = 300 - rand(i, 71) * 4200, a = rand(i, 72) * Math.PI * 2, r = 120 + Math.pow(rand(i, 73), 0.6) * 1500;
    out.set(Math.cos(a) * r, Math.sin(a) * r * 0.75, z);
  }, [0xffffff, 0xcfe0ff, 0xffe7c4, 0xaecbff, 0xffd2a8], [1.2, 6.0], 0.05, { opacity: 0, maxPx: 5 });
  scene.add(localStars);
}

/* --- Launch effects: cloud puffs, pad steam, exhaust trail ----------------- */
let puffs = null, smoke = null, trail = null, engineGlow = null;
const PUFF_N = 70, SMOKE_N = 96, TRAIL_N = 120;
function makeLaunchFx() {
  puffs = makeSpriteBatch({ count: PUFF_N, map: spriteTexture("puff", 2, 512), lit: false, renderOrder: 1, nearFade: [0.35, 1.1] });
  smoke = makeSpriteBatch({ count: SMOKE_N, map: spriteTexture("smoke", 9), lit: true, renderOrder: 1, nearFade: [0.3, 0.9] });
  trail = makeSpriteBatch({ count: TRAIL_N, map: spriteTexture("smoke", 13), lit: true, renderOrder: 1, nearFade: [0.4, 1.2] });
  engineGlow = makeSpriteBatch({ count: 5, map: spriteTexture("glow", 7, 128), additive: true, renderOrder: FX_ORDER + 1 });
  for (const b of [puffs, smoke, trail, engineGlow]) scene.add(b.mesh);
}
const _sp = new THREE.Vector3();
function updateLaunchFx(p) {
  // Fair-weather cumulus at the cloud deck's current altitude: as the planet
  // shrinks the deck sinks relative to the pad, and the ship climbs up through it.
  const deckY = Y_G + CLOUD_H * earthR;
  // Billboards only read as cumulus from below and beside; once the camera is
  // above the deck they turn into cut-outs standing on the horizon, and the
  // cloud shell (with its own world-space structure) carries the view down.
  // Distant ones go before the camera reaches their height (at eye level they
  // line up along the horizon like a row of cut-outs); the few around the
  // climb column stay long enough to fly through.
  const puffOn = 1 - smooth(seg(earthR, 3200, 2200));
  const camRel = camera.position.y - deckY;
  const farOn = 1 - smooth(seg(camRel, -16, -2)), nearOn = 1 - smooth(seg(camRel, 4, 22));
  puffs.mesh.visible = puffOn * Math.max(farOn, nearOn) > 0.01;
  if (puffs.mesh.visible) {
    for (let i = 0; i < PUFF_N; i++) {
      const on = puffOn * (i < 8 ? nearOn : farOn);
      // a few near the climb column, the rest spread out to the horizon
      const a = rand(i, 81) * Math.PI * 2, r = i < 8 ? 6 + rand(i, 82) * 30 : 60 + Math.pow(rand(i, 82), 0.7) * 900;
      const s = 34 + rand(i, 83) * 60;
      const tone = 1.08 + rand(i, 85) * 0.1;
      puffs.set(i, Math.cos(a) * r, deckY + (rand(i, 84) - 0.5) * 8 + s * 0.1, Math.sin(a) * r, s, 0, tone, tone, tone * 1.01, 0.97 * on);
    }
    puffs.upload();
  }
  // Pad steam: the sound-suppression deluge flashing to steam and billowing out
  // of both ends of the flame trench, scroll-driven so it plays in reverse too.
  const smokeOn = seg(p, 0.004, 0.012) * (1 - seg(p, 0.07, 0.1));
  smoke.mesh.visible = smokeOn > 0.01;
  if (smoke.mesh.visible) {
    for (let i = 0; i < SMOKE_N; i++) {
      const born = 0.006 + rand(i, 91) * 0.03;
      const age = Math.max(0, (p - born) / 0.03) + 0.04 * Math.sin(elapsed * 0.4 + i);
      const side = i % 2 ? 1 : -1;
      const spread = (rand(i, 92) - 0.5) * 1.4;
      const d = 11 + Math.pow(age, 0.6) * 22 * (0.6 + rand(i, 93) * 0.6);
      const x = spread * d * 0.45, z = side * d, y = Y_G + 0.6 + Math.pow(age, 0.8) * (2 + rand(i, 94) * 6);
      const s = 2.5 + Math.pow(age, 0.7) * (7 + rand(i, 95) * 7);
      const a = p > born ? smokeOn * 0.9 * (1 - smooth(seg(age, 2.5, 5))) : 0;
      const warm = Math.exp(-age * 3) * 0.3;
      smoke.set(i, x, y, z, s, rand(i, 96) * 6.3, 0.8 + warm, 0.79 + warm * 0.4, 0.78, a);
    }
    smoke.upload();
  }
  // Exhaust trail: left behind along the path while the solids burn, then it
  // widens and thins out.
  const trailOn = 1 - seg(p, 0.16, 0.24);
  trail.mesh.visible = trailOn > 0.01 && p > 0.014;
  if (trail.mesh.visible) {
    for (let i = 0; i < TRAIL_N; i++) {
      const pi = 0.014 + (i / TRAIL_N) * (P.boostA + 0.012 - 0.014);
      if (pi > p - 0.0015) { trail.set(i, 0, 0, 0, 0, 0, 0, 0, 0, 0); continue; }
      path.getPoint(pi, _sp);
      const age = (p - pi) / 0.02;
      const s = 1.6 + Math.pow(age, 0.6) * 3.2;
      trail.set(i, _sp.x + (rand(i, 101) - 0.5) * s * 0.3, _sp.y - 6.5, _sp.z + (rand(i, 102) - 0.5) * s * 0.3, s, rand(i, 103) * 6.3,
        0.74, 0.73, 0.72, 0.55 * trailOn * smooth(seg(age, 0.15, 0.6)) * (1 - smooth(seg(age, 4, 9))) * (0.7 + 0.3 * rand(i, 104)));
    }
    trail.upload();
  }
}

/* --- Fades ----------------------------------------------------------------- *
 * Anything that fades is made transparent once, at setup, and never toggled:
 * since r155 `Material.transparent` bumps the material version, so flipping it
 * mid-fade recompiles shaders in the middle of a scroll. */
function rememberOpacity(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.userData.op0 = mats[0].opacity !== undefined ? mats[0].opacity : 1;
    for (const m of mats) if (!m.uniforms) m.transparent = true;
  });
}
function fadeGroup(root, v) {
  if (root.userData.fadeV !== undefined && Math.abs(root.userData.fadeV - v) < 0.0015) return;
  root.userData.fadeV = v;
  root.visible = v > 0.02;
  if (!root.visible) return;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.uniforms && m.uniforms.uOpacity) m.uniforms.uOpacity.value = v;
      else m.opacity = (o.userData.op0 !== undefined ? o.userData.op0 : 1) * v;
    }
  });
}

/* --- Vehicle --------------------------------------------------------------- */
const TARGET = 5;
const vehicle = new THREE.Group();
scene.add(vehicle);
let stackRoot = null, orbiterRoot = null, tailY = 1.5;
const P = { boostA: 0.105, boostB: 0.155, tankA: 0.165, tankB: 0.225 };
const plumes = [];
const debris = [];   // { obj, booster, kick:Vector3 (vehicle-local), c:Vector3 (centre, vehicle-local), axis, spin }

/* Engine exhaust: nose is +Z, so each flame trails along -Z from its nozzle.
 * forceSinglePass: a transparent DoubleSide material otherwise renders in two
 * passes and sets needsUpdate around each, invalidating its shader program every
 * frame; additive blending gains nothing from the ordering. */
function makePlume(rad, len) {
  const g = new THREE.Group();
  const flame = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  const core = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.55, len * 0.62, 20, 1, true), flame(0xcfe8ff, 0.9));
  const outer = new THREE.Mesh(new THREE.ConeGeometry(rad, len, 20, 1, true), flame(0xff8a3c, 0.42));
  core.rotation.x = -Math.PI / 2; core.position.z = -len * 0.31;
  outer.rotation.x = -Math.PI / 2; outer.position.z = -len / 2;
  const bead = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.62, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(outer); g.add(core); g.add(bead);
  for (const m of g.children) m.renderOrder = FX_ORDER;
  return g;
}
function setPlumes(t, flick) {
  for (const p of plumes) {
    const on = p.live * t;
    p.group.visible = on > 0.01;
    if (!p.group.visible) continue;
    const w = lerp(0.55, 1, Math.min(on, 1));
    p.group.scale.set(w, w, on * flick);
  }
}

/* Normalize a loaded model to vehicle convention: nose +Z, up +Y, centred,
 * longest dimension == target. ("Space Shuttle (1).glb": nose +Y, so rotate
 * x +90deg; "Space Shuttle Orbiter.glb": nose -X, so rotate y +90deg.) */
function normalize(root, target, euler = { x: Math.PI / 2, y: 0, z: 0 }) {
  root.rotation.set(euler.x || 0, euler.y || 0, euler.z || 0);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const scale = target / Math.max(size.x, size.y, size.z);
  root.scale.setScalar(scale);
  root.position.sub(center.multiplyScalar(scale));
}

function setupVehicle(stack, orbiter) {
  /* Classify per ASSEMBLY, not per mesh: this GLB stores each assembly as
   * sibling meshes, one per material ("<base>", "<base>_1", ...). The orbiter
   * is four of them; classifying meshes one by one tore three of those off with
   * the tank. Group first, then: orbiter = widest in X (wingspan), boosters =
   * offset in X and tall, everything else jettisons with the tank. */
  const byKey = new Map();
  stack.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const key = (o.parent && o.parent !== stack && o.parent.children.length > 1) ? o.parent.uuid : String(o.name || o.uuid).replace(/_\d+$/, "");
    let g = byKey.get(key);
    if (!g) { g = { key, meshes: [], box: new THREE.Box3() }; byKey.set(key, g); }
    g.meshes.push(o); g.box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrix));
  });
  const groups = [...byKey.values()];
  groups.forEach((g) => { g.size = g.box.getSize(new THREE.Vector3()); g.c = g.box.getCenter(new THREE.Vector3()); });
  let orbiterGroup = groups[0];
  groups.forEach((g) => { if (g.size.x > orbiterGroup.size.x) orbiterGroup = g; });
  const boosterGroups = groups.filter((g) => g !== orbiterGroup && Math.abs(g.c.x) > 0.5 && g.size.y > 3);
  const others = groups.filter((g) => g !== orbiterGroup && !boosterGroups.includes(g));

  normalize(stack, TARGET, { x: Math.PI / 2, y: 0, z: 0 });
  stackRoot = stack; vehicle.add(stackRoot);
  vehicle.updateMatrixWorld(true);
  const boxOf = (meshes) => { const b = new THREE.Box3(); for (const m of meshes) b.union(new THREE.Box3().setFromObject(m)); return b; };
  const stackBox = new THREE.Box3().setFromObject(stackRoot);
  tailY = ANCHORS[0].y + stackBox.min.z;
  const oBox = boxOf(orbiterGroup.meshes), oSize = oBox.getSize(new THREE.Vector3()), oMid = oBox.getCenter(new THREE.Vector3());

  // Plumes at measured nozzles (boosters' aft faces, the orbiter's tail).
  const plumeHost = new THREE.Group(); vehicle.add(plumeHost);
  for (const g of boosterGroups) {
    const b = boxOf(g.meshes), c = b.getCenter(new THREE.Vector3());
    const pl = makePlume(0.34, 4.2); pl.position.set(c.x, c.y, b.min.z + 0.04);
    plumeHost.add(pl); plumes.push({ group: pl, kind: "srb", live: 1 });
  }
  for (const [dx, dy, s] of [[0, 0.3, 1.0], [-0.26, -0.02, 0.85], [0.26, -0.02, 0.85]]) {
    const pl = makePlume(0.17 * s, 2.6 * s); pl.position.set(oMid.x + dx, oMid.y + dy - oSize.y * 0.16, oBox.min.z + 0.06);
    plumeHost.add(pl); plumes.push({ group: pl, kind: "main", live: 1 });
  }

  /* Jettisoned parts become free pieces in the scene. Each keeps its vehicle-
   * relative matrix, so until separation it rides along exactly where it was;
   * after it, it carries on with some of the stack's momentum, gets a push away
   * from the orbiter and falls under gravity, tumbling, until it has dropped out
   * of frame - rather than fading to nothing in mid-air. */
  for (const g of [...boosterGroups, ...others]) {
    const isBooster = boosterGroups.includes(g);
    const b = boxOf(g.meshes), c = b.getCenter(new THREE.Vector3());
    const obj = new THREE.Group(); obj.matrixAutoUpdate = false;
    for (const m of g.meshes) {
      m.updateMatrixWorld(true);
      const rel = m.matrixWorld.clone();
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      m.removeFromParent();
      m.matrixAutoUpdate = false; m.matrix.copy(rel);
      obj.add(m);
    }
    const kick = isBooster ? new THREE.Vector3(Math.sign(c.x || 1) * 1.0, -0.25, 0) : new THREE.Vector3(0, -1, 0);
    const k = debris.length;
    debris.push({ obj, booster: isBooster, kick, c, axis: new THREE.Vector3(rand(k, 201) - 0.5, rand(k, 202) - 0.5, rand(k, 203) - 0.5).normalize(), spin: (isBooster ? 0.9 : 0.35) * (0.7 + rand(k, 204)) });
    scene.add(obj);
  }

  // The standalone orbiter overlays the stack's orbiter assembly (boxes agree to
  // ~0.01) and takes over when the tank goes.
  normalize(orbiter, oSize.z, { x: 0, y: Math.PI / 2, z: 0 });
  orbiter.position.add(oMid);
  orbiter.visible = false;
  orbiterRoot = orbiter; vehicle.add(orbiterRoot);
}

const _dq = new THREE.Quaternion(), _dq2 = new THREE.Quaternion(), _dp = new THREE.Vector3(), _dt = new THREE.Vector3(), _dk = new THREE.Vector3();
const _dm = new THREE.Matrix4(), _dm2 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);
function updateDebris(p) {
  for (const d of debris) {
    const sepP = d.booster ? P.boostA : P.tankA;
    if (p >= FINALE_START) { d.obj.visible = false; continue; }
    if (p < sepP) { d.obj.visible = stackRoot.visible; d.obj.matrix.copy(vehicle.matrixWorld); d.obj.matrixWorldNeedsUpdate = true; continue; }
    const t = (p - sepP) / 0.012;
    if (t > 10) { d.obj.visible = false; continue; }
    d.obj.visible = true;
    safeTangent(sepP, _dt); shipQuat(_dt, null, _dq);
    path.getPoint(Math.min(1, sepP + (p - sepP) * 0.42), _dp);                // coasts on with some of the stack's speed
    _dk.copy(d.kick).applyQuaternion(_dq);
    _dp.addScaledVector(_dk, 1.4 * t).addScaledVector(UP, -0.22 * t * t);      // pushed off, then falling
    _dq2.setFromAxisAngle(d.axis, d.spin * t);
    // T(pos) * R(sep) * T(c) * R(tumble) * T(-c): tumble about the part's own centre
    _dm.compose(_dp, _dq, _one);
    _dm2.makeTranslation(d.c.x, d.c.y, d.c.z); _dm.multiply(_dm2);
    _dm2.makeRotationFromQuaternion(_dq2); _dm.multiply(_dm2);
    _dm2.makeTranslation(-d.c.x, -d.c.y, -d.c.z); _dm.multiply(_dm2);
    d.obj.matrix.copy(_dm); d.obj.matrixWorldNeedsUpdate = true;
  }
}

/* --- Kepler-452b and Base One ---------------------------------------------- *
 * The finale is its own motion: the path hands the ship over at FINALE_START,
 * tangent to a circular orbit; one full orbit; a descending arc; then the
 * landing, during which the planet grows from 30 to 2,400 units around the
 * fixed landing point B - the launch's shrinking-Earth trick in reverse - so
 * the ship drops out of orbit, through the atmosphere and onto the pad as the
 * base comes into view around it. */
const FINALE_START = 0.95, F_ORBIT_END = 0.972, F_DESC_END = 0.986;
const KEP_R0 = 30, KEP_ORBIT = 66, KEP_R_LAND = 2400, DESC_ANGLE = Math.PI * 0.62, LAND_AHEAD = 0.5;
const KF = {};          // finale frame, built once the path is known
let kepler = null, base = null;
function buildKeplerFrame() {
  KF.E = path.getPoint(FINALE_START, new THREE.Vector3());
  KF.t0 = safeTangent(FINALE_START, new THREE.Vector3()).clone();
  const right = rightOf(KF.t0, new THREE.Vector3());
  KF.n = new THREE.Vector3(0, -0.85, 0).addScaledVector(right, 0.55);
  KF.n.addScaledVector(KF.t0, -KF.n.dot(KF.t0)).normalize();         // orbit centre: below-right of the path
  KF.K = KF.E.clone().addScaledVector(KF.n, KEP_ORBIT);
  KF.u = KF.n.clone().negate(); KF.v = KF.t0.clone();                 // orbit plane basis (radial at entry, tangent)
  const thEnd = Math.PI * 2 + DESC_ANGLE, thB = thEnd + LAND_AHEAD;
  KF.nB = KF.u.clone().multiplyScalar(Math.cos(thB)).addScaledVector(KF.v, Math.sin(thB)).normalize();
  KF.B = KF.K.clone().addScaledVector(KF.nB, KEP_R0);
  KF.fwd = KF.u.clone().multiplyScalar(-Math.sin(thB)).addScaledVector(KF.v, Math.cos(thB)).normalize();
  KF.side = new THREE.Vector3().crossVectors(KF.fwd, KF.nB).normalize();
  const E2 = KF.K.clone().addScaledVector(KF.u.clone().multiplyScalar(Math.cos(thEnd)).addScaledVector(KF.v, Math.sin(thEnd)), KEP_R0 + 5);
  KF.h0 = E2.clone().sub(KF.B).dot(KF.nB);
  KF.d0 = -E2.clone().sub(KF.B).dot(KF.fwd);
  // Kepler-452 hangs well off to one side, ahead and high: a bright sun in the
  // approach, and the light that sculpts Kepler-452b's day side.
  KF.starDir = KF.t0.clone().multiplyScalar(0.75).addScaledVector(UP, 0.42).addScaledVector(right, -0.52).normalize();
  KF.starPos = KF.K.clone().addScaledVector(KF.starDir, 460);
}
function makeKepler() {
  const tex = keplerSurfaceTexture(1024);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const texRot = siteRotation(18, 30);
  const group = new THREE.Group();
  const surfMat = terrestrialMaterial({ day: tex, kind: 1, atmoU: KEPLER_ATMO, texRot });
  const surf = new THREE.Mesh(PLANET_GEO, surfMat); surf.frustumCulled = false;
  const cloudMat = cloudShellMaterial({ map: cloudTexture(1024, 37), atmoU: KEPLER_ATMO, texRot, coverage: 0.85 });
  const clouds = new THREE.Mesh(PLANET_GEO, cloudMat); clouds.scale.setScalar(1.012); clouds.frustumCulled = false;
  group.add(surf); group.add(clouds);
  // object +Y -> nB (the base sits on the dense pole), +X -> landing direction
  const m = new THREE.Matrix4().makeBasis(KF.fwd, KF.nB, KF.side);
  group.quaternion.setFromRotationMatrix(m);
  scene.add(group);
  kepler = { group, surf, clouds, surfMat, cloudMat, R: KEP_R0, C: KF.K.clone() };
  surfMat.uniforms.uPad.value.copy(KF.B); surfMat.uniforms.uPadX.value.copy(KF.fwd); surfMat.uniforms.uPadZ.value.copy(KF.side);
  cloudMat.uniforms.uPad.value.copy(KF.B);
  base = new THREE.Group();
  base.matrixAutoUpdate = false;
  base.matrix.makeBasis(KF.fwd, KF.nB, KF.side).setPosition(KF.B);
  // pad lights
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), lightMat);
    l.position.set(Math.cos(a) * 4.35, 0.06, Math.sin(a) * 4.35); base.add(l);
  }
  scene.add(base);
}
/* Base modules arrive in the background after the main load. Placement is in
 * the landing frame: x along the approach, z to the side, y up. */
function placeOnBase(root, size, x, z, rotY, axis = "max") {
  const box = new THREE.Box3().setFromObject(root), s = box.getSize(new THREE.Vector3());
  const k = size / (axis === "max" ? Math.max(s.x, s.y, s.z) : s[axis]);
  root.scale.setScalar(k);
  const b2 = new THREE.Box3().setFromObject(root), c2 = b2.getCenter(new THREE.Vector3());
  const holder = new THREE.Group(); holder.add(root);
  root.position.set(-c2.x, -b2.min.y, -c2.z);
  holder.position.set(x, 0, z); holder.rotation.y = rotY;
  base.add(holder);
  rememberOpacity(holder);
}

/* --- Loading --------------------------------------------------------------- */
const loaderEl = document.getElementById("loader");
const fillEl = document.getElementById("loader-fill");
const pctEl = document.getElementById("loader-pct");
const manager = new THREE.LoadingManager();
manager.onProgress = (_u, l, t) => { const pct = t ? Math.round((l / t) * 100) : 0; fillEl.style.width = pct + "%"; pctEl.textContent = pct; };
const texLoader = new THREE.TextureLoader(manager);
const draco = new DRACOLoader().setDecoderPath("https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/");
const gltfLoader = new GLTFLoader(manager).setDRACOLoader(draco);
const lateLoader = new GLTFLoader().setDRACOLoader(draco);
const loadTex = (url) => new Promise((res, rej) => texLoader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, rej));
const loadGlb = (url, l = gltfLoader) => new Promise((res, rej) => l.load(url, res, undefined, rej));

Promise.all([
  loadTex(TEXURL.sky), loadGlb(MODEL.stack), loadGlb(MODEL.orbiter), loadGlb(MODEL.gantry), loadGlb(MODEL.crawler),
  loadTex(TEXURL.earth), loadTex(TEXURL.moon), loadTex(TEXURL.mars), loadTex(TEXURL.jupiter), loadTex(TEXURL.saturn), loadTex(TEXURL.neptune), loadTex(TEXURL.pluto),
]).then(([sky, stack, orbiter, gantryG, crawlerG, earth, moon, mars, jupiter, saturn, neptune, pluto]) => {
  makeStarSphere(sky);
  setupVehicle(stack.scene, orbiter.scene);
  placeGantry(gantryG.scene, tailY);
  placeCrawler(crawlerG.scene);
  makePadProps();
  Object.assign(textures, { moon, mars, jupiter, saturn, neptune, pluto, uranus: uranusTexture() });
  makeEarth(earth);
  BODY_DEFS.forEach(makeBody);
  makeStar();
  buildKeplerFrame();
  makeKepler();
  bodies.star.pos.copy(KF.starPos); bodies.star.group.position.copy(KF.starPos);
  starGlow.set(0, KF.starPos.x, KF.starPos.y, KF.starPos.z, 42 * 9, 0, 1.0, 0.82, 0.55, 0.85);
  starGlow.set(1, KF.starPos.x, KF.starPos.y, KF.starPos.z, 42 * 3.2, 0, 1.0, 0.95, 0.85, 1.0);
  starGlow.upload();
  FEATURES.find((f) => f.key === "star").pos = KF.starPos;
  FEATURES.find((f) => f.key === "kepler").pos.copy(KF.K);
  placeBodies();
  const sat = bodies.saturn;
  sat.group.updateMatrixWorld(true);
  const ringN = sat.ring.getWorldDirection(new THREE.Vector3());
  for (const u of [sat.mat.uniforms, sat.ring.material.uniforms]) { u.uCenter.value.copy(sat.pos); u.uRingN.value.copy(ringN); }
  nebulaTex = [spriteTexture("nebula", 3), spriteTexture("nebula", 11), spriteTexture("nebula", 23), spriteTexture("nebula", 37)];
  makeBelt({ center: [16, 6, -360], rIn: 22, rOut: 150, thick: 34, rocks: 540, dust: 2600, rockColor: 0x8a7f72, dustColor: [0x9a8a78, 0x7d7468], vis: [0.27, 0.47], rockSize: 1.3 });
  makeBelt({ center: [4, 8, -1410], rIn: 40, rOut: 260, thick: 60, rocks: 360, dust: 3200, rockColor: 0xb8c6d8, dustColor: [0xb8c8e0, 0x9fb4d0], vis: [0.53, 0.68], rockSize: 1.6 });
  addField(makePointCloud(5000, (i, out) => {
    const u = rand(i, 1) * 2 - 1, th = rand(i, 2) * Math.PI * 2, rr = 360 * (0.85 + rand(i, 3) * 0.15), s = Math.sqrt(1 - u * u);
    out.set(Math.cos(th) * s * rr, 2 + u * rr, -1700 + Math.sin(th) * s * rr);
  }, [0xd6e4f4, 0xbfd2ea], [0.8, 2.6], 0.04, { opacity: 0.9, maxPx: 6 }), [0.6, 0.72], []);
  fields[fields.length - 1].mats = [{ m: fields[fields.length - 1].obj.material, op0: 0.9 }];
  makeNebula({ center: [0, 0, -1980], spread: 140, points: 2600, palette: [0x5a7dff, 0x9a6bff, 0x4fc3ff], sprites: 20, spriteAlpha: 0.32, vis: [0.66, 0.79] });
  makeNebula({ center: [0, 10, -2330], spread: 200, points: 3000, palette: [0xbfe6ff, 0x7fd6ff, 0xffffff, 0xffb6e0], sprites: 20, spriteAlpha: 0.22, vis: [0.73, 0.85] });
  makeNebula({ center: [0, -10, -2760], spread: 230, flat: 0.3, points: 7000, palette: [0xffe2b0, 0xfff3d8, 0xffc78a, 0xffb07a], sprites: 16, spriteAlpha: 0.3, vis: [0.79, 0.9] });
  makeNebula({ center: [0, 0, -2700], spread: 170, flat: 0.25, points: 10, palette: [0x000000], sprites: 22, spriteAlpha: 0.85, vis: [0.79, 0.9], dark: true });
  makeNebula({ center: [-10, 0, -3050], spread: 220, points: 3400, palette: [0xff4f9d, 0xff7ac0, 0x7a5cff, 0xff9b5c], sprites: 24, spriteAlpha: 0.36, vis: [0.84, 0.97] });
  makeNebula({ center: [60, 30, -3080], spread: 170, points: 2000, palette: [0x21d4ff, 0x4f8bff, 0x9ff0ff], sprites: 14, spriteAlpha: 0.3, vis: [0.84, 0.97] });
  makeGalaxy();
  makeLocalStars();
  makeLaunchFx();
  measureScroll();
  applySize();
  updatePath(0);
  warmup();
  loaderEl.classList.add("is-hidden");
  loadBase();
}).catch((err) => {
  console.error("Asset load failed:", err);
  if (pctEl) pctEl.parentElement.textContent = "Could not load assets - serve over http (see README).";
});
function loadBase() {
  Promise.all([loadGlb(MODEL.habitat, lateLoader), loadGlb(MODEL.dish, lateLoader), loadGlb(MODEL.ship2, lateLoader)]).then(([hab, dish, ship2]) => {
    placeOnBase(hab.scene, 4.4, 6.5, 9.5, -0.6);
    placeOnBase(dish.scene, 4.2, -4.5, -12.5, 0.9, "y");
    placeOnBase(ship2.scene, 3.0, 11, -6.5, 2.4);
    warmupBase();
  }).catch((e) => console.warn("Base modules failed to load:", e));
}

/* Compile every shader the voyage needs while the loader is still up, by
 * rendering real frames across the range (this also warms the post passes,
 * which renderer.compile() does not touch). Compiling lazily put 10-60ms stalls
 * on the frames where things first appeared. */
function warmup() {
  for (const p of [0, 0.012, 0.05, 0.09, 0.14, 0.2, 0.3, 0.45, 0.62, 0.8, 0.9, 0.96, 0.98, 0.995]) { updatePath(p); renderFrame(); }
  updatePath(progress);
}
function warmupBase() { const keep = progress; updatePath(0.999); renderFrame(); updatePath(keep); }

/* --- Scroll -> timeline ---------------------------------------------------- *
 * Every panel declares the timeline point it narrates (data-t). The scroll
 * position where a panel sits centred maps to that t, and scroll between panels
 * interpolates - so panels can be any height (the finale gets more scroll room)
 * without dragging the rest of the voyage out of sync with its text.
 * Read once per frame from a cached layout (no layout reads in the loop), then
 * eased with a frame-rate-independent exponential so trackpad and momentum
 * scrolling come out smooth. */
let progress = 0, rawProgress = 0, scrollVel = 0, scrollMax = 1;
const panels = [...document.querySelectorAll(".panel")];
let panelMap = [];   // { el, s (scroll where centred), t, top, h }
function measureScroll() {
  const vh = Math.max(1, window.innerHeight);
  scrollMax = Math.max(1, document.documentElement.scrollHeight - vh);
  panelMap = panels.map((el, i) => {
    const top = el.offsetTop, h = el.offsetHeight;
    let s = clamp(top + h / 2 - vh / 2, 0, scrollMax);
    if (i === 0) s = 0;
    if (i === panels.length - 1) s = scrollMax;
    return { el, s, t: parseFloat(el.dataset.t), top, h, last: "" };
  });
}
function scrollToT(y) {
  const m = panelMap; if (!m.length) return clamp(y / scrollMax, 0, 1);
  if (y <= m[0].s) return m[0].t;
  for (let i = 0; i < m.length - 1; i++) {
    if (y <= m[i + 1].s) return lerp(m[i].t, m[i + 1].t, (y - m[i].s) / Math.max(1, m[i + 1].s - m[i].s));
  }
  return m[m.length - 1].t;
}
measureScroll();
window.addEventListener("load", measureScroll);
if (window.ResizeObserver) new ResizeObserver(measureScroll).observe(document.documentElement);

/* Text: each panel's title and copy are driven from scroll position directly
 * (CSS variables), so they glide in and out with the scene instead of popping
 * when an observer fires. The copy rises in a beat after the title. */
function updatePanels(y) {
  const vh = Math.max(1, window.innerHeight);
  for (const m of panelMap) {
    const k = (y + vh / 2 - (m.top + m.h / 2)) / vh;          // -1 below .. 0 centred .. +1 above
    const a = Math.abs(k);
    const tv = 1 - smooth(seg(a, 0.22 + Math.max(0, (m.h / vh - 1) * 0.5), 0.58 + Math.max(0, (m.h / vh - 1) * 0.5)));
    const dv = 1 - smooth(seg(a, 0.1 + Math.max(0, (m.h / vh - 1) * 0.5), 0.36 + Math.max(0, (m.h / vh - 1) * 0.5)));
    const key = tv.toFixed(3) + "|" + dv.toFixed(3) + "|" + clamp(k, -1, 1).toFixed(3);
    if (key === m.last) continue;
    m.last = key;
    m.el.style.setProperty("--tv", tv.toFixed(3));
    m.el.style.setProperty("--dv", dv.toFixed(3));
    m.el.style.setProperty("--k", clamp(k, -1, 1).toFixed(3));
  }
}

/* --- HUD ------------------------------------------------------------------- */
const hud = document.getElementById("hud-label");
const PHASES = [
  [0.25, "TRANS-LUNAR INJECTION"], [0.29, "LUNAR SLINGSHOT - GRAVITY ASSIST"], [0.33, "OVER MARS"],
  [0.37, "THE ASTEROID BELT"], [0.4, "JUPITER - GRAVITY ASSIST"], [0.46, "OVER SATURN'S RINGS"],
  [0.52, "THE ICE GIANTS - URANUS AND NEPTUNE"], [0.575, "THE KUIPER BELT"], [0.635, "THE OORT CLOUD - 1 LY"],
  [0.695, "LOCAL INTERSTELLAR CLOUD - 30 LY"], [0.755, "THE LOCAL BUBBLE - 300 LY"], [0.815, "THE GREAT RIFT - 700 LY"],
  [0.87, "THE ORION-CYGNUS ARM - 1,200 LY"], [0.915, "KEPLER-452 - 1,800 LY"], [0.95, "ORBITING KEPLER-452b"],
  [F_ORBIT_END, "DE-ORBIT BURN - ENTRY INTERFACE"], [F_DESC_END, "DESCENT THROUGH THE ATMOSPHERE"], [0.996, "TOUCHDOWN - BASE ONE"],
];
let shipAlt = 0;   // ship altitude above Earth, in atmosphere thicknesses
function hudText(p) {
  if (p < 0.008) return "ON THE PAD - LC-39A, KENNEDY SPACE CENTER";
  if (p < 0.024) return "IGNITION - LIFTOFF";
  if (p >= P.boostA - 0.002 && p < P.boostA + 0.03) return "BOOSTER SEPARATION";
  if (p >= P.tankA && p < P.tankA + 0.03) return "EXTERNAL TANK JETTISON";
  if (p < 0.25) {
    if (shipAlt < 0.12) return "TROPOSPHERE - THROUGH THE CLOUDS";
    if (shipAlt < 0.5) return "STRATOSPHERE";
    if (shipAlt < 0.85) return "MESOSPHERE";
    if (shipAlt < 1.15) return "THERMOSPHERE - THE KARMAN LINE";
    return "EXOSPHERE - ESCAPE VELOCITY";
  }
  let l = PHASES[0][1];
  for (const [a, t] of PHASES) if (p >= a) l = t;
  return l;
}
function updateHud(p) { const l = hudText(p); if (hud && hud.textContent !== l) hud.textContent = l; }

/* --- Path evaluation ------------------------------------------------------- */
const pos = new THREE.Vector3(), tangent = new THREE.Vector3(), chasePos = new THREE.Vector3(), lookAt = new THREE.Vector3();
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), right = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const featPos = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
const lastTan = new THREE.Vector3(0, 0, -1);
const _shipRight = new THREE.Vector3(), _shipUp = new THREE.Vector3(), _refUp = new THREE.Vector3(), _basis = new THREE.Matrix4();
const _launch = new THREE.Vector3(), _bias = new THREE.Vector3(), _side = new THREE.Vector3(), _q = new THREE.Quaternion();
const ALT_UP = new THREE.Vector3(0, 0, 1);
function rightOf(t, out) { out.crossVectors(t, UP); if (out.lengthSq() < 1e-6) out.set(1, 0, 0); return out.normalize(); }
/* Ship attitude as an explicit basis: x = right, y = up, z = nose. Near-vertical
 * flight blends the reference up toward +Z so the cross products stay well
 * conditioned; right x up == nose keeps it a proper rotation. */
function shipQuat(fwd, upRef, out) {
  if (upRef) _refUp.copy(upRef);
  else { const vert = clamp((Math.abs(fwd.y) - 0.72) / 0.2, 0, 1); _refUp.set(0, 1, 0).lerp(ALT_UP, vert); }
  if (_refUp.lengthSq() < 1e-8) _refUp.copy(ALT_UP);
  _refUp.normalize();
  _shipRight.crossVectors(_refUp, fwd);
  if (_shipRight.lengthSq() < 1e-8) { _shipRight.crossVectors(ALT_UP, fwd); if (_shipRight.lengthSq() < 1e-8) _shipRight.set(1, 0, 0); }
  _shipRight.normalize();
  _shipUp.crossVectors(fwd, _shipRight).normalize();
  _basis.makeBasis(_shipRight, _shipUp, fwd);
  return out.setFromRotationMatrix(_basis);
}
function orientShip(fwd, upRef = null) { shipQuat(fwd, upRef, vehicle.quaternion); }
function safeTangent(p, out) {
  const e = 0.001;
  path.getPoint(clamp(p - e, 0, 1), _a); path.getPoint(clamp(p + e, 0, 1), _b);
  out.subVectors(_b, _a);
  if (out.lengthSq() < 1e-9) out.copy(lastTan); else out.normalize();
  lastTan.copy(out);
  return out;
}
function safeLookAt(target, upHint = UP) {
  _dir.subVectors(target, camera.position);
  if (_dir.lengthSq() < 1e-9) return;
  _dir.normalize();
  if (Math.abs(_dir.dot(upHint)) > 0.95) camera.up.copy(tmp2.crossVectors(_dir, upHint).normalize().cross(_dir));
  else camera.up.copy(upHint);
  camera.lookAt(target);
}

/* Thrust, flame and the ignition flash, shared by the cruise and the finale. */
function engines(p, thrust) {
  const flick = 0.94 + 0.06 * Math.sin(elapsed * 21) + 0.03 * Math.sin(elapsed * 47.3);
  setPlumes(thrust, flick);
  escort.position.copy(vehicle.position).addScaledVector(tmp.set(0, 0, -1).applyQuaternion(vehicle.quaternion), 3.4);
  escort.intensity = 2.2 + 22 * Math.exp(-Math.pow((p - 0.016) / 0.0055, 2)) + 5 * thrust;
  // engine glow billboards at the nozzles
  let n = 0;
  for (const pl of plumes) {
    if (n >= 5) break;
    if (!pl.group.visible) { engineGlow.set(n++, 0, 0, 0, 0, 0, 0, 0, 0, 0); continue; }
    pl.group.getWorldPosition(tmp);
    const big = pl.kind === "srb" ? 2.2 : 1.2;
    engineGlow.set(n++, tmp.x, tmp.y, tmp.z, big * Math.min(1.2, pl.live * thrust) * vehicle.scale.x, 0, 1.0, 0.68, 0.38, 0.55);
  }
  engineGlow.upload();
}

function updatePath(p) {
  if (!stackRoot) return;
  if (p >= FINALE_START && kepler) { finale(p); commonUpdates(p); return; }
  vehicle.scale.setScalar(1);
  path.getPoint(clamp(p, 0, 1), pos);
  safeTangent(p, tangent);
  vehicle.position.copy(pos);
  orientShip(tangent);
  vehicle.updateMatrixWorld(true);

  /* Thrusters: cold on the pad; scrolling lights them. `ignite` snaps up over
   * the first 1.8% of scroll, `climb` holds the burn then eases to a cruise
   * glow, and a low-passed scroll speed makes the flame swell with the scroll.
   * The solids cut out at separation; the mains throttle back once the tank
   * goes. */
  const ignite = smooth(seg(p, 0.0015, 0.018));
  const climb = 1 - smooth(seg(p, 0.075, 0.3));
  const thrust = ignite * lerp(0.3, 1.25, climb) * (1 + 0.22 * Math.min(scrollVel * 9, 1));
  for (const q of plumes) q.live = q.kind === "srb" ? 1 - seg(p, P.boostA, P.boostA + 0.012) : lerp(1, 0.3, seg(p, P.tankA, P.tankB));
  engines(p, thrust);
  const swapped = p >= P.tankB;
  stackRoot.visible = !swapped;
  orbiterRoot.visible = swapped;

  /* Camera. Launch rig: starts low beside the pad looking up at the stack with
   * the tower behind it, then rises past the ship so that from the cloud deck
   * up it looks down on the vehicle with the ground and the curving horizon
   * beyond. Chase rig from p=0.13: behind/above/beside, aligned to the path.
   * At toChase == 1 the lerp is exactly the chase position: no snap. */
  const toChase = smooth(seg(p, 0.13, 0.26));
  rightOf(tangent, right);
  chasePos.copy(pos).addScaledVector(tangent, -27).addScaledVector(UP, 7).addScaledVector(right, 5);
  // Low beside the pad, then rising with the stack (a little below it at
  // first so it climbs up the frame), ending a few units above it looking down.
  const rise = smooth(seg(p, 0.008, 0.05));
  const over = smooth(seg(p, 0.04, 0.1));
  _launch.set(pos.x + 14, lerp(Y_G + 7.2, pos.y - 1.5 + 6.5 * over, rise), pos.z + 17);
  camera.position.copy(_launch).lerp(chasePos, toChase);
  lookAt.copy(pos).addScaledVector(tangent, 6 * toChase);
  // Bias the aim toward the bodies being passed, blended by weight (no snaps).
  let totalW = 0; featPos.set(0, 0, 0);
  for (const f of FEATURES) {
    if (!f.pos) continue;
    const d = Math.abs(p - f.pAt); if (d >= f.w) continue;
    const wgt = f.strength * smooth(1 - d / f.w);
    featPos.addScaledVector(f.pos, wgt); totalW += wgt;
  }
  if (totalW > 0) {
    featPos.multiplyScalar(1 / totalW);
    _bias.copy(featPos).sub(lookAt).multiplyScalar(Math.min(totalW, 1));
    const maxBias = camera.position.distanceTo(pos) * 0.22;
    if (_bias.length() > maxBias) _bias.setLength(maxBias);
    lookAt.add(_bias);
  }
  // During the climb, keep the horizon in the frame below the ship.
  lookAt.y -= 3.5 * smooth(seg(p, 0.06, 0.11)) * (1 - toChase);
  // At launch, aim right of the ship so it sits left of the centred headline.
  const sideShift = (1 - toChase) * 7;
  if (sideShift > 0.01) { _side.subVectors(pos, camera.position).normalize().cross(UP); if (_side.lengthSq() > 1e-8) lookAt.addScaledVector(_side.normalize(), sideShift); }
  safeLookAt(lookAt);
  commonUpdates(p);
}

/* --- Finale ---------------------------------------------------------------- */
const _fu = new THREE.Vector3(), _fr = new THREE.Vector3(), _fc = new THREE.Vector3(), _fl = new THREE.Vector3();
function orbitPoint(th, rho, outP, outT) {
  outP.copy(KF.K).addScaledVector(KF.u, Math.cos(th) * rho).addScaledVector(KF.v, Math.sin(th) * rho);
  outT.copy(KF.u).multiplyScalar(-Math.sin(th)).addScaledVector(KF.v, Math.cos(th)).normalize();
}
let kepR = KEP_R0;
function finale(p) {
  stackRoot.visible = false; orbiterRoot.visible = true;
  for (const q of plumes) q.live = q.kind === "srb" ? 0 : 0.3;
  let thrust = 0.34, upRef = null;
  if (p < F_ORBIT_END) {
    // one full orbit, at constant speed
    const th = Math.PI * 2 * (p - FINALE_START) / (F_ORBIT_END - FINALE_START);
    orbitPoint(th, KEP_ORBIT, pos, tangent);
    _fu.copy(pos).sub(KF.K).normalize();
    upRef = _fu;
  } else if (p < F_DESC_END) {
    // de-orbit: a descending arc, the mains burning harder
    const s = seg(p, F_ORBIT_END, F_DESC_END);
    const th = Math.PI * 2 + DESC_ANGLE * s;
    const rho = lerp(KEP_ORBIT, KEP_R0 + 5, smooth(s));
    orbitPoint(th, rho, pos, tangent);
    _fu.copy(pos).sub(KF.K).normalize();
    tangent.addScaledVector(_fu, -0.6 * (KEP_ORBIT - KEP_R0 - 5) / KEP_ORBIT * Math.sin(Math.PI * s)).normalize();
    upRef = _fu; thrust = 0.34 + 0.7 * Math.sin(Math.PI * s);
  } else {
    // landing: the planet grows around the fixed landing point B
    const s = seg(p, F_DESC_END, 1);
    const e = 1 - Math.pow(1 - s, 2.2);
    const h = lerp(KF.h0, 0.06, e), d = lerp(KF.d0, 0, 1 - Math.pow(1 - s, 1.6));   // belly is ~0.08 above the vehicle origin
    pos.copy(KF.B).addScaledVector(KF.nB, h).addScaledVector(KF.fwd, -d);
    // nose along the approach with a glide slope that flattens into a flare
    const glide = lerp(0.32, -0.12, smooth(seg(s, 0.4, 0.86))) + 0.12 * smooth(seg(s, 0.88, 1));
    tangent.copy(KF.fwd).multiplyScalar(Math.cos(glide)).addScaledVector(KF.nB, -Math.sin(glide)).normalize();
    upRef = KF.nB; thrust = lerp(0.6, 0.15, s);
  }
  vehicle.position.copy(pos); vehicle.scale.setScalar(1);
  orientShip(tangent, upRef);
  vehicle.updateMatrixWorld(true);
  engines(p, thrust);


  // Camera: from the cruise chase into an orbit chase in the planet's radial
  // frame, then into a low three-quarter view of the base for touchdown.
  rightOf(tangent, right);
  const cruise = _fc.copy(pos).addScaledVector(tangent, -27).addScaledVector(UP, 7).addScaledVector(right, 5);
  _fr.crossVectors(tangent, _fu.lengthSq() > 0 ? _fu : UP).normalize();
  const orbitCam = tmp.copy(pos).addScaledVector(tangent, -20).addScaledVector(upRef || UP, 9).addScaledVector(_fr, -6);
  camera.position.copy(cruise).lerp(orbitCam, smooth(seg(p, FINALE_START, FINALE_START + 0.006)));
  lookAt.copy(pos).addScaledVector(tangent, 5);
  _bias.copy(KF.K).sub(lookAt).multiplyScalar(0.18);
  lookAt.add(_bias.multiplyScalar(1 - seg(p, F_DESC_END, F_DESC_END + 0.004)));
  let camUp = upRef || UP;
  if (p >= F_DESC_END) {
    const s = seg(p, F_DESC_END, 1);
    const hNow = pos.clone().sub(KF.B).dot(KF.nB), dNow = -pos.clone().sub(KF.B).dot(KF.fwd);
    const landCam = _fl.copy(KF.B).addScaledVector(KF.fwd, -(dNow + 11) * (1 - s * 0.6) - 3 * s).addScaledVector(KF.nB, hNow + 3.5 + 1.5 * (1 - s)).addScaledVector(KF.side, 6 + 6 * s);
    camera.position.lerp(landCam, smooth(seg(s, 0, 0.3)));
    camUp = KF.nB;
  }
  safeLookAt(lookAt, camUp);
}

/* Everything that depends on p but not on which branch moved the ship. */
function commonUpdates(p) {
  // Earth
  earthAt(Math.min(p, 0.3));
  if (earthGroup) {
    earthGroup.position.copy(earthC); earthGroup.scale.setScalar(earthR);
    EARTH_FEATURE.pos.copy(earthC).addScaledVector(tmp.copy(camera.position).sub(earthC).normalize(), earthR);
    const shipD = vehicle.position.distanceTo(earthC) - earthR;
    shipAlt = shipD / (ATM_T * earthR);
    const detail = 1 - smooth(seg(earthR, 5200, 2600));
    earthSurfMat.uniforms.uPad.value.copy(earthTop); earthSurfMat.uniforms.uDetail.value = detail;
    earthCloudMat.uniforms.uPad.value.copy(earthTop); earthCloudMat.uniforms.uDetail.value = detail;
    const hz = lerp(0.1, 1, smooth(clamp(Math.log(EARTH_R0 / earthR) / Math.log(EARTH_R0 / 1500), 0, 1)));
    earthSurfMat.uniforms.uHaze.value = hz; earthCloudMat.uniforms.uHaze.value = hz;
    earthSurfMat.uniforms.uLod.value = smooth(seg(p, 0.22, 0.42)) * 2.2;
    earthCloudMat.uniforms.uLod.value = smooth(seg(p, 0.22, 0.42)) * 1.8;
    const ev = 1 - smooth(seg(p, 0.3, 0.46));
    earthGroup.visible = ev > 0.01;
    earthSurfMat.uniforms.uOpacity.value = ev; earthCloudMat.uniforms.uOpacity.value = ev;
    skyUniforms.uEOn.value = ev > 0.01 ? 1 : 0;
  }
  // sun swings from the Sun to Kepler-452 for the arrival
  const toKep = smooth(seg(p, 0.82, 0.9));
  sunDir.copy(SUN_DIR).lerp(KF.starDir || SUN_DIR, toKep).normalize();
  sunLight.position.copy(sunDir).multiplyScalar(1000).add(vehicle.position); sunLight.target.position.copy(vehicle.position);
  setAtmo(EARTH_ATMO, earthC, earthR, SUN_DIR);
  if (kepler) {
    /* Kepler-452b's size and position are a function of p alone. They used to
     * be written only inside finale(), so everywhere before it the planet kept
     * whatever the last finale frame (or the shader warm-up) had left: a
     * 2,400-unit landing-scale sphere that the camera flew 500 units inside
     * on the approach, so the planet seemed to be missing. */
    kepR = p >= F_DESC_END ? Math.exp(lerp(Math.log(KEP_R0), Math.log(KEP_R_LAND), Math.pow(seg(p, F_DESC_END, 1), 0.85))) : KEP_R0;
    kepler.R = kepR;
    kepler.C.copy(KF.B).addScaledVector(KF.nB, -kepR);
    kepler.group.position.copy(kepler.C); kepler.group.scale.setScalar(kepR);
    const kSun = tmp.copy(KF.starPos).sub(kepler.C).normalize();
    setAtmo(KEPLER_ATMO, kepler.C, kepler.R, kSun);
    const kv = smooth(seg(p, 0.78, 0.9));
    kepler.group.visible = kv > 0.01;
    kepler.surfMat.uniforms.uOpacity.value = kv; kepler.cloudMat.uniforms.uOpacity.value = kv;
    skyUniforms.uKOn.value = kv > 0.01 ? 1 : 0;
    const kd = smooth(seg(kepler.R, 250, 900));
    kepler.surfMat.uniforms.uDetail.value = kd; kepler.cloudMat.uniforms.uDetail.value = kd;
    const khz = lerp(1, 0.14, smooth(clamp(Math.log(kepler.R / KEP_R0) / Math.log(KEP_R_LAND / KEP_R0), 0, 1)));
    kepler.surfMat.uniforms.uHaze.value = khz; kepler.cloudMat.uniforms.uHaze.value = khz;
    if (base) { fadeGroup(base, smooth(seg(kepler.R, 320, 760))); }
  }
  // daylight: how deep in Earth's atmosphere the camera is
  const camAlt = (camera.position.distanceTo(earthC) - earthR) / (ATM_T * earthR);
  const kepAlt = kepler ? (camera.position.distanceTo(kepler.C) - kepler.R) / (0.032 * kepler.R) : 9;
  const day = Math.max(earthGroup && earthGroup.visible ? 1 - smooth(seg(camAlt, 0.1, 1.0)) : 0, kepler && kepler.group.visible ? 1 - smooth(seg(kepAlt, 0.1, 1.0)) : 0);
  hemi.intensity = 0.7 * day;
  if (starSphere) starSphere.material.color.setScalar(1 - 0.92 * day);
  ambient.intensity = 0.18 + 0.3 * (1 - day);
  // launch site
  const groundOn = p < 0.11;
  if (gantry) gantry.visible = groundOn;
  if (crawler) crawler.visible = groundOn;
  if (padProps) padProps.visible = groundOn;
  if (puffs) updateLaunchFx(p);
  // bodies
  for (const k in bodies) {
    const w = VIS[k]; if (!w) continue;
    const v = Math.min(seg(p, w[0], w[1]), 1 - seg(p, w[2], w[3]));
    fadeGroup(bodies[k].group, v);
  }
  if (starGlow) {
    const w = VIS.star, v = Math.min(seg(p, w[0], w[1]), 1 - seg(p, w[2], w[3]));
    starGlow.mesh.visible = v > 0.01; starGlow.mesh.material.uniforms.uOpacity.value = v;
  }
  // fields: cross-fade over the edges of each window
  for (const f of fields) {
    const v = Math.min(seg(p, f.vis[0], f.vis[0] + 0.03), 1 - seg(p, f.vis[1] - 0.03, f.vis[1]));
    f.obj.visible = v > 0.01;
    if (f.obj.visible) for (const mm of f.mats) { if (mm.m.uniforms) mm.m.uniforms.uOpacity.value = mm.op0 * v; else mm.m.opacity = mm.op0 * v; }
  }
  if (localStars) { localStars.material.uniforms.uOpacity.value = 0.9 * (1 - day) * (1 - seg(p, 0.985, 1)); localStars.visible = localStars.material.uniforms.uOpacity.value > 0.01; }
  updateDebris(p);
  updateHud(p);
}

/* --- Render loop ----------------------------------------------------------- */
const clock = new THREE.Clock();
let elapsed = 0;
function renderFrame() { composer.render(); }
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  const y = window.scrollY;
  // window.__pin: dev override that drives the scene from a fixed timeline point.
  rawProgress = window.__pin != null ? clamp(window.__pin, 0, 1) : scrollToT(y);
  const prev = progress;
  progress += (rawProgress - progress) * (1 - Math.exp(-9 * dt));
  if (Math.abs(rawProgress - progress) < 1e-5) progress = rawProgress;
  scrollVel += (Math.abs(progress - prev) / Math.max(dt, 1e-4) - scrollVel) * (1 - Math.exp(-7 * dt));
  updatePath(progress);
  updatePanels(y);
  if (starSphere) starSphere.position.copy(camera.position);
  skyDome.position.copy(camera.position);
  for (const k in bodies) if (bodies[k].spin) bodies[k].mesh.rotation.y = elapsed * bodies[k].spin;
  if (earthCloudMat) earthCloudMat.uniforms.uTime.value = elapsed;
  if (kepler) kepler.cloudMat.uniforms.uTime.value = elapsed;
  if (bodies.star) bodies.star.mat.uniforms.uTime.value = elapsed;
  renderFrame();
  adaptResolution(dt);
}
applySize();
tick();
window.addEventListener("resize", onResize);

/* --- Dev hooks ------------------------------------------------------------- */
window.__three = { renderer, scene, camera, composer, bloom, vehicle, plumes, fields, bodies, debris,
  get kepler() { return kepler; }, get earth() { return { group: earthGroup, R: earthR, C: earthC, surf: earthSurfMat, clouds: earthCloudMat }; }, KF };
window.__renderAt = (p) => {
  progress = clamp(p, 0, 1); updatePath(progress); renderFrame();
  const ndc = vehicle.position.clone().project(camera);
  return { p: progress, hud: hud.textContent, onScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1,
    finite: [vehicle.position.x, vehicle.position.y, vehicle.position.z, camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite),
    shipNDC: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)], earthR: +earthR.toFixed(1), shipAlt: +shipAlt.toFixed(2), kepR: +kepR.toFixed(1) };
};
