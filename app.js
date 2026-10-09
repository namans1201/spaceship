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
import { mergeVertices, mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeKSCBuildings } from "./lib/ksc.js";
import { spiralGalaxyTexture, edgeOnGalaxyTexture, ellipticalGalaxyTexture, nebulaTexture } from "./lib/deepsky.js";

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
// Moons, loaded after the opening is up (the bodies show their glint colour until then).
const MOONURL = {
  phobos: "Mars - Phobos/Mars - Phobos.jpg", deimos: "Mars - Deimos/Mars - Deimos.jpg",
  io: "Jupiter - Io (A)/Jupiter - Io (A).jpg", europa: "Jupiter - Europa/Jupiter - Europa.jpg",
  ganymede: "Jupiter - Ganymede/Jupiter - Ganymede.jpg", callisto: "Jupiter - Callisto/Jupiter - Callisto.jpg",
  titan: "Saturn - Titan/Saturn - Titan.jpg", enceladus: "Saturn - Enceladus/Saturn - Enceladus.jpg",
  rhea: "Saturn - Rhea/Saturn - Rhea.jpg", dione: "Saturn - Dione/Saturn - Dione.jpg", tethys: "Saturn - Tethys/Saturn - Tethys.jpg",
  mimas: "Saturn - Mimas/Saturn - Mimas.jpg", iapetus: "Saturn - Iapetus/Saturn - Iapetus.jpg",
  triton: "Neptune - Triton/Neptune - Triton.jpg", charon: "Pluto - Charon/Pluto - Charon.jpg",
};
const MODEL = {
  stack: U("Space Shuttle (1).glb"),
  orbiter: U("Space Shuttle Orbiter.glb"),
  gantry: U("models/Gantry.glb"),
  crawler: U("3D Models/Crawler/Crawler.glb"),
  habitat: U("3D Models/Habitat Demonstration Unit/Habitat Demonstration Unit (part 1).glb"),
  dish: U("3D Models/Deep Space Network 34-meter/Deep Space Network 34-meter.glb"),
  ship2: U("models/Spaceship.glb"),
  hq: U("3D Models/Headquarters Building/Headquarters Building.glb"),
  // the library's craft: ISS (A) is the light one (6.6k triangles; (B) is 174k), the rest are baked on load
  iss: U("3D Models/International Space Station (ISS) (A)/International Space Station (ISS) (A).glb"),
  hubble: U("3D Models/Hubble Space Telescope (A)/Hubble Space Telescope (A).glb"),
  lm: U("3D Models/Apollo Lunar Module/Apollo Lunar Module.glb"),
  bennu: U("3D Models/1999 RQ36 asteroid/1999 RQ36 asteroid.glb"),
  dawn: U("3D Models/Dawn/Dawn.glb"),
  galileo: U("3D Models/Galileo/Galileo.glb"),
  cassini: U("3D Models/Cassini-Huygens (A)/Cassini-Huygens (A).glb"),
  astro: U("3D Models/Astronaut/Astronaut.glb"),
  dish70: U("3D Models/Deep Space Network 70-meter/Deep Space Network 70-meter.glb"),
  ares: U("3D Models/Ares 1 (A)/Ares 1 (A).glb"),
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
/* Aerial haze for the launch site's models (the ground and sky shaders do
 * their own): without it the VAB and the towers stand out bright and flat
 * against a landscape that is softened by distance. Only the standard
 * materials use it, and it is switched off above the launch. */
scene.fog = new THREE.FogExp2(0x9fb6cf, 0);
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
/* A soft fill from the camera's side in space: the chase camera swings round
 * the ship to frame each planet, which can put it on the ship's night side,
 * where the orbiter read as a black cut-out against the planet. */
const fill = new THREE.DirectionalLight(0xdfe8ff, 0);
scene.add(fill); scene.add(fill.target);

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
  // three-octave versions, for broad shapes where the fine octaves are never seen
  float fbm2l(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vn2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s + 0.0625; }
  float fbm3l(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vn3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s + 0.0625; }
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
    // the planet's shadow, with a soft edge (the sun is a disc, and the air
    // bends and scatters light round the limb) rather than a hard cut-off
    float b = dot(C - pos, L);
    float shadow = b > 0.0 ? smoothstep(R * 0.992, R * 1.006, length(C - pos - L * b)) : 1.0;
    if (shadow <= 0.0) return vec3(0.0);
    float dl = tl.y / 6.0; float lR = 0.0, lM = 0.0;
    for (int j = 0; j < 6; j++) {
      vec3 pl = pos + L * (dl * (float(j) + 0.5));
      float hl = max(length(pl - C) - R, 0.0);
      lR += exp(-hl / hR) * dl; lM += exp(-hl / hM) * dl;
    }
    return exp(-(bR * lR + bM * 1.1 * lM)) * shadow;
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
        col += atmo(cameraPosition, rd, 1e9, uEC, uER, uERa, uEBR, uEBM, uEHR, uEHM, uESunDir, uESunI, 12, 5, T);
        // the sun's disc, seen through the air
        float sd = dot(rd, uESunDir);
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99985, 0.99995, sd) * 30.0 * T;
        Tt *= T;
      }
      if (uKOn > 0.5) {
        vec3 c2 = atmo(cameraPosition, rd, 1e9, uKC, uKR, uKRa, uKBR, uKBM, uKHR, uKHM, uKSunDir, uKSunI, 12, 5, T);
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
let starSphere = null, skyStars = null;
/* The star map is 2,880 px around the whole sky and draws its stars as small
 * blocks of texels; magnified ~2.5x on screen they read as coloured squares.
 * So the map is split in two: its stars are found once at load (local maxima)
 * and redrawn as anti-aliased point sprites at infinity, keeping their real
 * positions, colours and brightness; the map itself is drawn blurred, which
 * leaves the diffuse glow of the Milky Way and its dust lanes. */
function makeStarSphere(tex) {
  const glow = skyGlowTexture(tex.image);
  const m = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: glow }, uColor: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(uMap, vUv).rgb;
        c = max(c - 0.01, 0.0) * 1.3;                            // lift the band off a clean black
        gl_FragColor = vec4(c * uColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthTest: false, depthWrite: false,
  });
  starSphere = new THREE.Mesh(new THREE.SphereGeometry(6000, 64, 40), m);
  starSphere.renderOrder = -10; starSphere.frustumCulled = false;
  scene.add(starSphere);
  skyStars = extractStars(tex.image, 14000);
  skyStars.renderOrder = -9.5;
  starSphere.add(skyStars);
}
/* The diffuse light of the map without its stars: halve it (stars shrink to a
 * pixel), erode with a 3x3 minimum (which removes isolated points but keeps
 * the broad band and its dust lanes), then blur. */
function skyGlowTexture(img) {
  const w = img.width >> 1, h = img.height >> 1;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, w, h);
  const src = g.getImageData(0, 0, w, h), s = src.data, out = g.createImageData(w, h), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4;
    for (let ch = 0; ch < 3; ch++) {
      let mn = 255;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = clamp(y + dy, 0, h - 1);
        for (let dx = -1; dx <= 1; dx++) { const v = s[(yy * w + ((x + dx + w) % w)) * 4 + ch]; if (v < mn) mn = v; }
      }
      o[j + ch] = mn;
    }
    o[j + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const b = document.createElement("canvas"); b.width = w; b.height = h;
  const bg = b.getContext("2d"); bg.filter = "blur(2px)"; bg.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(b);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function extractStars(img, maxN) {
  const w = img.width, h = img.height;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = 0.3 * d[j] + 0.59 * d[j + 1] + 0.11 * d[j + 2];
  const found = [];
  for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = lum[i];
    if (v < 46) continue;
    const xl = y * w + ((x + w - 1) % w), xr = y * w + ((x + 1) % w);
    // strict on one side, non-strict on the other, so a flat-topped star counts once
    if (v <= lum[xl] || v < lum[xr] || v <= lum[i - w] || v < lum[i + w] || v <= lum[xl - w] || v < lum[xr + w] || v <= lum[xr - w] || v < lum[xl + w]) continue;
    found.push(i);
  }
  found.sort((a, b) => lum[b] - lum[a]);
  const n = Math.min(maxN, found.length);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const R = 5000, cc = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const i = found[k], x = i % w, y = (i - x) / w;
    // SphereGeometry's mapping (texture flipped so row 0 is the top): phi from u, theta from v
    const phi = ((x + 0.5) / w) * Math.PI * 2, th = ((y + 0.5) / h) * Math.PI;
    pos.set([-Math.cos(phi) * Math.sin(th) * R, Math.cos(th) * R, Math.sin(phi) * Math.sin(th) * R], k * 3);
    const j = i * 4, b = lum[i] / 255;
    cc.setRGB(d[j] / 255, d[j + 1] / 255, d[j + 2] / 255, THREE.SRGBColorSpace);
    const mx = Math.max(cc.r, cc.g, cc.b, 1e-3);
    cc.multiplyScalar(1 / mx);                                   // hue from the map, brightness from size
    cc.lerp(new THREE.Color(1, 1, 1), 0.25);
    const k2 = 0.35 + 1.25 * Math.pow(b, 2.2);
    col.set([cc.r * k2, cc.g * k2, cc.b * k2], k * 3);
    size[k] = R * (0.9 + 2.4 * Math.pow(b, 3)) / 1100;           // ~1-3 px at 800 px tall, whatever the distance
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const pts = new THREE.Points(geo, softPointsMaterial({ opacity: 1, maxPx: 5 }));
  // In the opaque list (additive blending still applies), between the sky map
  // and the atmosphere, so daylight hides them exactly as it hides the map.
  pts.material.depthTest = false; pts.material.transparent = false;
  pts.frustumCulled = false;
  return pts;
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
    // detail finer than a pixel fades out instead of shimmering
    float fw = max(length(fwidth(q)), 1e-4);
    float hf = 1.0 - smoothstep(0.12, 0.5, fw), mf = 1.0 - smoothstep(0.6, 2.5, fw);
    vec2 q0 = vec2(0.848 * q.x + 0.53 * q.y, -0.53 * q.x + 0.848 * q.y);   // frame of the crawlerway (x0 < 0 toward the VAB)
    vec2 vab = vec2(-118.7, -74.2);
    vec2 qv = q - vab; vec2 qv0 = vec2(0.848 * qv.x + 0.53 * qv.y, -0.53 * qv.x + 0.848 * qv.y);
    float coast = 46.0 + 9.0 * sin(q.y * 0.012 + 1.3) + (fbm2l(vec2(q.y * 0.02, 5.3)) - 0.5) * 16.0 + (vn2(vec2(q.y * 0.15, 2.0)) - 0.5) * 2.0 * mf;
    float lagoonN = fbm2l(q * 0.006 + vec2(3.0, 7.0));
    float lagoon = smoothstep(0.6, 0.64, lagoonN) * smoothstep(-80.0, -170.0, q.x) * smoothstep(40.0, 60.0, length(qv));
    water = max(step(coast, q.x), lagoon);
    // coastal scrub and palmetto, oak and pine stands, tree clumps, sandy
    // clearings, and marsh grass toward the lagoons
    float v1 = fbm2l(q * 0.035), v2 = fbm2(q * 0.17 + 11.0), v3 = vn2(q * 1.1), v4 = vn2(q * 4.3 + 3.1), v5 = fbm2l(q * 0.012 + 40.0);
    vec3 col = mix(vec3(0.11, 0.15, 0.07), vec3(0.23, 0.25, 0.12), v1);
    col = mix(col, vec3(0.05, 0.09, 0.04), smoothstep(0.55, 0.7, v2) * 0.8);
    vec2 cell = floor(q * 0.75), fc = fract(q * 0.75) - 0.5;
    vec2 off = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5;
    float tree = (1.0 - smoothstep(0.12, 0.3, length(fc - off * 0.5))) * step(0.5, hash12(cell)) * smoothstep(0.42, 0.6, v2);
    col = mix(col, vec3(0.03, 0.055, 0.025), tree * mf * 0.85);
    col = mix(col, vec3(0.44, 0.4, 0.29), smoothstep(0.68, 0.8, v5) * 0.55);
    float marsh = smoothstep(-60.0, -100.0, q.x) * smoothstep(0.5, 0.6, lagoonN);
    col = mix(col, vec3(0.24, 0.23, 0.12) * (0.85 + 0.3 * vn2(q * vec2(0.4, 2.0))), marsh * 0.75);
    col *= 0.84 + 0.3 * v3;
    col *= mix(1.0, 0.82 + 0.36 * v4, hf);
    // the beach: dry sand, then darker wet sand at the waterline
    col = mix(col, vec3(0.78, 0.72, 0.58) * (0.92 + 0.12 * v4 * hf), smoothstep(coast - 9.0, coast - 4.0, q.x));
    col = mix(col, vec3(0.5, 0.46, 0.37), smoothstep(coast - 2.6, coast - 0.6, q.x));
    // concrete: jointed slabs, each a slightly different pour, with stains
    vec2 slab = floor(q * 0.5), sf = fract(q * 0.5);
    float joint = (1.0 - smoothstep(0.0, 0.025 + fw * 0.6, min(min(sf.x, 1.0 - sf.x), min(sf.y, 1.0 - sf.y)))) * hf;
    vec3 conc = vec3(0.52, 0.52, 0.5) * (0.9 + 0.12 * hash12(slab)) * (0.86 + 0.18 * fbm2l(q * 0.35)) * (0.93 + 0.1 * vn2(q * 3.0) * hf);
    conc *= 1.0 - 0.3 * joint;
    conc *= 1.0 - 0.35 * smoothstep(0.6, 0.8, fbm2l(q * 0.6 + 9.0));
    float oct = max(max(abs(q.x), abs(q.y)), (abs(q.x) + abs(q.y)) * 0.7071);
    float hard = 1.0 - smoothstep(9.4, 10.0, oct);
    col = mix(col, conc, hard);
    // soot: around the launcher and fanned north and south out of the flame trench
    float soot = exp(-dot(q, q) / 22.0) + 0.6 * exp(-pow(q.x / (2.0 + abs(q.y) * 0.3), 2.0) - pow((abs(q.y) - 12.5) / 3.5, 2.0));
    col *= 1.0 - 0.4 * clamp(soot, 0.0, 1.0) * (0.6 + 0.4 * vn2(q * 0.9));
    // the flame trench: a narrow slot under the launcher, its walls blackened
    float trench = (1.0 - smoothstep(0.7, 0.85, abs(q.x))) * (1.0 - smoothstep(11.0, 11.6, abs(q.y)));
    col = mix(col, vec3(0.05, 0.048, 0.045) * (0.8 + 0.4 * vn2(q * 2.0)), trench * 0.92);
    // the perimeter road round the pad, and the access road north
    float ring = smoothstep(25.0, 25.5, oct) * (1.0 - smoothstep(26.5, 27.0, oct));
    vec3 asphalt = vec3(0.1, 0.1, 0.105) * (0.9 + 0.2 * vn2(q * 2.0));
    col = mix(col, asphalt, ring);
    float nr = step(q.y, -26.5) * (1.0 - smoothstep(0.6, 0.9, abs(q.x - 8.0)));
    float dash = step(0.5, fract(q.y * 0.25)) * (1.0 - smoothstep(0.03, 0.07 + fw * 0.5, abs(q.x - 8.0))) * hf;
    col = mix(col, mix(asphalt, vec3(0.85, 0.75, 0.3), dash), nr);
    // the crawlerway: two lanes of river-rock gravel with a grass median,
    // and a service road alongside it
    float cwBand = step(q0.x, -10.0) * step(-110.0, q0.x);
    float lane = 1.0 - smoothstep(0.5, 0.8, abs(abs(q0.y) - 1.7));
    vec3 gravel = vec3(0.62, 0.6, 0.55) * (0.86 + 0.22 * vn2(q * 7.0) * hf + 0.1 * vn2(q * 1.4));
    col = mix(col, gravel, lane * cwBand);
    float sr = step(q0.x, -27.0) * step(-112.0, q0.x) * (1.0 - smoothstep(0.45, 0.7, abs(q0.y + 7.0)));
    col = mix(col, asphalt, sr);
    // the VAB's apron and car park
    float apron = (1.0 - smoothstep(17.0, 18.0, abs(qv0.x))) * (1.0 - smoothstep(21.0, 22.0, abs(qv0.y)));
    float park = (1.0 - smoothstep(0.03, 0.06 + fw * 0.5, abs(fract(qv0.y * 0.6) - 0.5))) * step(8.0, qv0.x) * hf;
    col = mix(col, mix(conc * 0.9, vec3(0.8), park * 0.6), apron);
    if (water > 0.5) {
      // shallow turquoise over the sand, deepening to Atlantic blue
      float depth = clamp((q.x - coast) / 70.0, 0.0, 1.0);
      col = mix(vec3(0.06, 0.18, 0.18), vec3(0.012, 0.045, 0.085), smoothstep(0.0, 0.5, depth));
      col *= 0.92 + 0.12 * fbm2l(q * 0.05);
      if (lagoon > 0.5) col = vec3(0.03, 0.07, 0.07) * (0.9 + 0.2 * fbm2l(q * 0.04));
    }
    // surf: the break at the shore and a second line of white water off it
    float surf = (1.0 - smoothstep(0.0, 1.6, abs(q.x - coast))) * (1.0 - lagoon);
    float surf2 = (1.0 - smoothstep(0.0, 0.7, abs(q.x - coast - 4.5 - sin(q.y * 0.07) * 1.5))) * smoothstep(0.35, 0.7, vn2(q * vec2(0.3, 0.9))) * (1.0 - lagoon);
    col = mix(col, vec3(0.86, 0.9, 0.92), clamp(surf * 0.6 + surf2 * 0.4 * mf, 0.0, 1.0));
    return col;
  }
  // Kepler-452b around Base One: ochre sand and clay, mossy lowlands, pale salt
  // flats and rust ridges, strewn with rocks and wind ripples, a slab-jointed
  // apron round the landing pad with its markings and scorch, and a track out
  // to the buildings.
  float kRockMask = 0.0;   // set by terrainKepler: where a rock stands (the caller shades it)
  vec3 terrainKepler(vec2 q, out float water) {
    float fw = max(length(fwidth(q)), 1e-4);
    float hf = 1.0 - smoothstep(0.1, 0.5, fw), mf = 1.0 - smoothstep(0.5, 2.5, fw);
    float e = fbm2l(q * 0.01 + 4.0);
    water = step(e, 0.34) * smoothstep(70.0, 130.0, length(q));
    float m1 = fbm2l(q * 0.035 + 7.0), m2 = fbm2l(q * 0.08 + 3.0), m3 = fbm2l(q * 0.3 + 21.0), m4 = vn2(q * 2.4 + 5.0);
    vec3 sand = vec3(0.43, 0.3, 0.16), moss = vec3(0.14, 0.2, 0.09), rust = vec3(0.4, 0.19, 0.1), pale = vec3(0.58, 0.48, 0.34), rockc = vec3(0.17, 0.13, 0.11);
    vec3 col = mix(sand, moss, smoothstep(0.45, 0.62, m1));
    col = mix(col, rust, smoothstep(0.58, 0.74, m2) * 0.75);
    col = mix(col, pale, smoothstep(0.62, 0.78, fbm2l(q * 0.02 + 60.0)) * 0.65);
    // wind ripples on the open sand, streaks of lighter grit
    float rip = sin((q.x * 0.8 + q.y * 0.3 + m3 * 6.0) * 3.2);
    col *= 1.0 + 0.07 * rip * mf * (1.0 - smoothstep(0.55, 0.65, m1));
    col *= 0.86 + 0.26 * m4 * hf + 0.12 * (vn2(q * 9.0) - 0.5) * hf + 0.18 * (m3 - 0.5);
    // dried-mud cracks in the rust clay
    float crack = 1.0 - smoothstep(0.0, 0.05 + fw * 0.4, abs(fract(q.x * 0.35 + vn2(q * 0.7) * 1.6) - 0.5) - 0.44);
    crack *= smoothstep(0.62, 0.72, m2) * hf;
    col *= 1.0 - 0.32 * crack;
    float r = length(q);
    // pebbles and boulders: two scales of scattered cells, darker with a pale
    // dusted top; none on the concrete
    vec2 rc = floor(q * 0.9), rf = fract(q * 0.9) - 0.5;
    vec2 ro = (vec2(hash12(rc + 1.3), hash12(rc + 8.1)) - 0.5) * 0.6;
    float rr = 0.12 + 0.2 * hash12(rc + 4.4);
    float rd = length(rf - ro);
    float pebble = step(0.74, hash12(rc)) * (1.0 - smoothstep(rr * 0.4, rr, rd)) * mf;
    vec2 bc = floor(q * 0.22), bf = fract(q * 0.22) - 0.5;
    vec2 bo = (vec2(hash12(bc + 11.3), hash12(bc + 3.1)) - 0.5) * 0.5;
    float br = 0.16 + 0.16 * hash12(bc + 9.4);
    float bd = length(bf - bo);
    float boulder = step(0.7, hash12(bc + 5.0)) * (1.0 - smoothstep(br * 0.4, br, bd)) * step(7.5, r);
    kRockMask = max(pebble, boulder * 1.0) * smoothstep(5.8, 7.4, r);
    float rtop = clamp(1.0 - min(rd / rr, bd / br), 0.0, 1.0);
    col = mix(col, rockc * (0.55 + 0.8 * vn2(q * 7.0)) * (0.75 + 0.6 * rtop), kRockMask);
    // the apron, the pad and its markings
    float apron = 1.0 - smoothstep(5.7, 6.3, r);
    vec2 slab = floor(q * 0.5), sf = fract(q * 0.5);
    float joint = (1.0 - smoothstep(0.0, 0.03 + fw * 0.6, min(min(sf.x, 1.0 - sf.x), min(sf.y, 1.0 - sf.y)))) * hf;
    vec3 conc = vec3(0.4, 0.39, 0.38) * (0.88 + 0.14 * hash12(slab)) * (0.9 + 0.16 * vn2(q * 3.0) * hf) * (0.92 + 0.14 * fbm2l(q * 0.5));
    conc *= 1.0 - 0.32 * joint;
    // dust drifted over the apron's edge, and scorch from a hundred landings
    conc = mix(conc, col, smoothstep(4.6, 6.2, r) * 0.6);
    conc *= 1.0 - 0.5 * exp(-r * r / 6.0) * (0.7 + 0.3 * vn2(q * 1.3));
    col = mix(col, conc, apron);
    float pad = 1.0 - smoothstep(4.2, 4.5, r);
    col = mix(col, conc * 1.08, pad);
    vec3 yellow = vec3(0.95, 0.75, 0.2), white = vec3(0.86);
    col = mix(col, yellow, (1.0 - smoothstep(0.08, 0.16, abs(r - 3.5))) * pad);
    col = mix(col, white, (1.0 - smoothstep(0.04, 0.1, abs(r - 5.1))) * apron * 0.4);
    float hbar = (1.0 - smoothstep(0.1, 0.18, abs(q.x))) * (1.0 - smoothstep(1.3, 1.5, abs(q.y)));
    float hbar2 = (1.0 - smoothstep(0.1, 0.18, abs(q.y))) * (1.0 - smoothstep(1.3, 1.5, abs(q.x)));
    col = mix(col, yellow, max(hbar, hbar2) * pad);
    // hazard chevrons on the pad edge
    float chev = step(0.5, fract((atan(q.y, q.x) * 6.0 / 3.14159 + r * 0.0))) * (1.0 - smoothstep(0.1, 0.2, abs(r - 4.0)));
    col = mix(col, vec3(0.05), chev * pad * 0.8);
    // the track out to the buildings, and the edge of its gravel
    float road = (1.0 - smoothstep(0.5, 0.8, abs(q.y - 0.35 * q.x))) * step(4.2, r) * step(r, 28.0) * step(0.0, q.x);
    col = mix(col, vec3(0.34, 0.31, 0.29) * (0.85 + 0.3 * vn2(q * 4.0)), road);
    if (water > 0.5) col = vec3(0.03, 0.11, 0.13) + 0.03 * fbm2l(q * 0.05);
    return col;
  }
`;

function terrestrialMaterial({ day, night = null, kind, atmoU, texRot }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: day }, uNight: { value: night || day }, uNightK: { value: night ? 1.3 : 0 },
      uTexRot: { value: texRot }, uLod: { value: 0 }, uOpacity: { value: 1 },
      uPad: { value: new THREE.Vector3() }, uPadX: { value: new THREE.Vector3(1, 0, 0) }, uPadZ: { value: new THREE.Vector3(0, 0, 1) },
      uDetail: { value: 0 }, uKind: { value: kind }, uWaterAlpha: { value: kind === 1 ? 1 : 0 }, uHaze: { value: 1 }, uTime: { value: 0 },
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
      uniform vec3 uPad; uniform vec3 uPadX; uniform vec3 uPadZ; uniform float uDetail; uniform int uKind; uniform float uWaterAlpha; uniform float uTime;
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
            if (uKind == 1 && tw < 0.5) {
              // relief from screen-space derivatives of the ground's height: grit, ripples, rocks standing up
              float hq = (0.5 * vn2(q * 3.1) + 0.25 * vn2(q * 9.0) + 1.0 * kRockMask) * 0.35 * w;
              vec3 dpx = dFdx(vWP), dpy = dFdy(vWP);
              vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
              float det = dot(dpx, r1);
              vec3 grad = sign(det) * (dFdx(hq) * r1 + dFdy(hq) * r2);
              N = normalize(abs(det) * N - grad * 0.12);
            }
            if (tw > 0.5) {
              // wind swell and chop, as a moving normal: the sun glitters on it
              float fwq = length(fwidth(q));
              vec2 wq = q * vec2(0.55, 0.22) + vec2(uTime * 0.35, uTime * 0.08);
              float e = 0.25;
              float h0 = vn2(wq) + 0.5 * vn2(wq * 2.3), hx = vn2(wq + vec2(e, 0.0)) + 0.5 * vn2((wq + vec2(e, 0.0)) * 2.3), hy = vn2(wq + vec2(0.0, e)) + 0.5 * vn2((wq + vec2(0.0, e)) * 2.3);
              vec2 g = vec2(hx - h0, hy - h0) / e;
              N = normalize(N - (uPadX * g.x + uPadZ * g.y) * 0.5 * w * (1.0 - smoothstep(0.5, 4.0, fwq)));
            }
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
        vec3 ins = atmo(cameraPosition, rd, dist, uC, uR, uRa, uBR, uBM, uHR, uHM, L, uSunI, 6, 3, T);
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
        float shade = 1.0;
        if (uDetail > 0.001) {
          // fair-weather cumulus in world units: rounded cells with crisp
          // edges, lit on the side toward the sun (the density a step sunward
          // is the self-shadowing), thick cores grey from below
          vec3 rel = vWP - uPad;
          vec3 drift = vec3(uTime * 0.01, 0.0, 0.0);
          float n = fbm3(rel / 34.0 + drift) + (vn3(rel / 7.0 + drift * 3.0) - 0.5) * 0.1;
          float n2 = fbm3l((rel + normalize(uSunDir) * 9.0) / 34.0 + drift);
          float puff = smoothstep(0.5, 0.64, n) * 0.96;
          float w = uDetail * (1.0 - smoothstep(700.0, 1500.0, length(rel.xz)));
          a = mix(a, puff, w);
          float below = step(dot(cameraPosition - vWP, normalize(vWP - uC)), 0.0);
          float s = clamp(0.62 + (n - n2) * 4.0, 0.35, 1.1) * (1.0 - 0.38 * below * smoothstep(0.56, 0.8, n));
          shade = mix(1.0, s, w);
        }
        if (a < 0.003) discard;
        float ndl = dot(N, L);
        vec3 sunT = sunTrans(vWP, uC, uR, uRa, uBR, uBM, uHR, uHM, L);
        float lit = smoothstep(-0.2, 0.35, ndl);
        vec3 col = vec3(0.94, 0.95, 0.97) * (sunT * uSunI * 0.05 * (0.35 + 0.65 * lit)) * shade + vec3(0.04, 0.06, 0.09) * (0.3 + lit);
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
  for (let i = 0; i < 22; i++) blobs.push([0.5 + (rand(i, seed) - 0.5) * 0.55, 0.5 + (rand(i, seed + 7) - 0.5) * 0.55, 0.09 + rand(i, seed + 3) * 0.16]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    let a = 0, cr = 255, cg = 255, cb = 255;
    if (kind === "glow") {
      a = Math.exp(-r * r * 5) * 0.9 + Math.exp(-r * r * 40) * 0.6;
    } else if (kind === "glint") {
      // a planet as a point of light: a hard bright core in a soft halo
      a = Math.min(1, Math.exp(-r * r * 90) * 1.0 + Math.exp(-r * r * 14) * 0.45 + Math.exp(-r * r * 4) * 0.12);
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
  // Ring opacity across the span (x: 0 inner edge .. 1 outer edge): the C, B
  // and A rings, the Cassini division and the Encke gap, plus fine ringlets
  // that fade out with the screen-space footprint so they never alias.
  float ringAlpha(float x, float fw) {
    float a = mix(0.18, 0.92, smoothstep(0.12, 0.3, x));               // faint C ring, dense B ring
    a *= mix(1.0, 0.72, smoothstep(0.66, 0.72, x));                     // A ring is thinner
    a *= 1.0 - 0.93 * (1.0 - smoothstep(0.0, 0.025, abs(x - 0.63)));   // Cassini division
    a *= 1.0 - 0.7 * (1.0 - smoothstep(0.0, 0.006, abs(x - 0.9)));     // Encke gap
    float k1 = 1.0 - smoothstep(0.004, 0.02, fw), k2 = 1.0 - smoothstep(0.0015, 0.007, fw);
    a *= 1.0 + 0.2 * sin(x * 37.0) * sin(x * 13.0 + 1.0) + 0.1 * k1 * sin(x * 160.0 + 2.0) * sin(x * 71.0);
    a *= 1.0 + 0.16 * k2 * sin(x * 640.0 + sin(x * 90.0) * 3.0);
    a *= smoothstep(0.0, 0.03, x) * (1.0 - smoothstep(0.96, 1.0, x));
    return clamp(a, 0.0, 1.0);
  }
  vec3 ringColor(float x) {
    vec3 c = mix(vec3(0.5, 0.42, 0.33), vec3(0.8, 0.7, 0.55), smoothstep(0.1, 0.45, x));
    c = mix(c, vec3(0.66, 0.6, 0.52), smoothstep(0.64, 0.75, x));
    return c * (0.92 + 0.08 * sin(x * 23.0 + 0.7));
  }
`;
/* uSoft (0 near .. 1 far) is how the planets come out of the distance: far off
 * a body is a blurred, soft-edged disc (texture sampled at a coarser mip, limb
 * fading out), and it sharpens as the ship closes in. uKind picks the detail
 * layer that keeps the low-resolution maps from looking blurry up close:
 * 1 = rocky (cratered relief and mottling, as bump and albedo), 2 = banded gas
 * giant (turbulent streaks along the belts). It is computed in object space,
 * so it has no seam or pole pinch. */
function planetMaterial({ map = null, color = 0xffffff, rim = 0x000000, rimK = 0, limb = 0, band = 0, ring = null, kind = 0, detailFreq = 6, maria = 0 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map }, uHasMap: { value: map ? 1 : 0 }, uColor: { value: new THREE.Color(color) },
      uSunDir: { value: sunDir }, uRim: { value: new THREE.Color(rim) }, uRimK: { value: rimK }, uLimb: { value: limb }, uBand: { value: band },
      uOpacity: { value: 1 }, uCenter: { value: new THREE.Vector3() }, uRingN: { value: new THREE.Vector3(0, 1, 0) },
      uRing: { value: new THREE.Vector2(ring ? ring[0] : 0, ring ? ring[1] : 0) }, uRingOn: { value: ring ? 1 : 0 }, uAlbedo: { value: 1 },
      uSoft: { value: 0 }, uKind: { value: kind }, uFreq: { value: detailFreq }, uBumpA: { value: 0.1 }, uMaria: { value: maria },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vWP; varying vec3 vO;
      void main() {
        vUv = uv; vO = normalize(position); vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uHasMap; uniform vec3 uColor; uniform vec3 uSunDir; uniform vec3 uRim; uniform float uRimK;
      uniform float uLimb; uniform float uBand; uniform float uOpacity; uniform vec3 uCenter; uniform vec3 uRingN; uniform vec2 uRing; uniform float uRingOn; uniform float uAlbedo;
      uniform float uSoft; uniform int uKind; uniform float uFreq; uniform float uBumpA; uniform float uMaria;
      varying vec2 vUv; varying vec3 vN; varying vec3 vWP; varying vec3 vO;
      ${GLSL_NOISE}
      ${GLSL_RING}
      // craters: one per noise cell (some cells empty), a bowl with a raised
      // rim. Radii stay under half a cell, so only the 2x2x2 cells on the
      // pixel's side of each axis can reach it.
      float craters(vec3 p) {
        vec3 i = floor(p), f = fract(p), s = step(0.5, f) - 1.0; float h = 0.0;
        for (int z = 0; z < 2; z++) for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
          vec3 g = s + vec3(float(x), float(y), float(z));
          vec3 c = i + g;
          float r = 0.1 + 0.2 * hash13(c + 73.0);
          float d = length(g + vec3(hash13(c), hash13(c + 17.0), hash13(c + 41.0)) * 0.9 + 0.05 - f) / r;
          if (hash13(c + 91.0) < 0.6 && d < 1.45) h += d < 1.0 ? (d * d - 1.0) * 0.6 : (1.45 - d) * (d - 1.0) * 2.2;
        }
        return h;
      }
      float relief(vec3 q) { return craters(q) + vn3(q * 5.0) * 0.35; }
      void main() {
        vec3 N = normalize(vN), L = normalize(uSunDir), V = normalize(cameraPosition - vWP);
        float detail = 1.0 - uSoft;
        vec2 uv = vUv;
        if (uKind == 2) {
          // gas giant: warp the low-resolution map along the flow, so the
          // band edges break into eddies and festoons instead of a soft blur
          vec3 q = vO * uFreq;
          vec2 w = vec2(fbm3(q * vec3(2.0, 9.0, 2.0)), fbm3(q * vec3(2.0, 9.0, 2.0) + 7.3)) - 0.5;
          float shear = sin(vO.y * 40.0 + w.x * 4.0);
          uv += detail * vec2(w.x * 0.012 + shear * 0.002, w.y * 0.0045);
        }
        vec3 alb = (uHasMap > 0.5 ? texture2D(uMap, uv, uSoft * 3.5).rgb : uColor) * uAlbedo;
        if (uMaria > 0.5) {
          // the Moon: the stand-in map (Rhea) pulled to lunar grey, with dark basalt seas
          // (maria) across a third of the face and a few bright ray craters
          float lumM = dot(alb, vec3(0.3, 0.59, 0.11));
          alb = mix(vec3(lumM), alb, 0.12) * vec3(1.02, 1.0, 0.96);
          float sea = smoothstep(0.47, 0.57, fbm3l(vO * 1.35 + vec3(4.0, 1.0, 2.0)));
          alb *= 1.0 - 0.6 * sea * (0.6 + 0.4 * vn3(vO * 7.0));
        }
        if (uKind == 2) {
          vec3 q = vO * uFreq;
          float streak = fbm3(vec3(q.x * 1.5, vO.y * uFreq * 26.0 + fbm3(q * 3.0) * 2.5, q.z * 1.5));
          alb *= 1.0 + detail * (0.2 * (streak - 0.5) + uBand * (fbm2(vec2(vUv.x * 18.0, vUv.y * 260.0)) - 0.5));
          alb = mix(alb, pow(alb, vec3(1.18)) * 1.12, detail);       // a little more contrast up close
        } else if (uKind == 1) {
          // rocky: mottled albedo and cratered relief, lit as a bump
          vec3 q = vO * uFreq;
          float m = fbm3l(q * 1.7);
          alb *= 1.0 + detail * (0.34 * (m - 0.5) + 0.12 * (vn3(q * 9.0) - 0.5) - 0.1 * clamp(-craters(q * 2.7 + 5.0), 0.0, 1.0));
          if (detail > 0.02) {
            // bump from screen-space derivatives of one relief sample (the
            // surface-gradient method): a third of the cost of finite differences
            float h0 = relief(q);
            float hW = h0 * uBumpA * detail;
            vec3 dpx = dFdx(vWP), dpy = dFdy(vWP);
            vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
            float det = dot(dpx, r1);
            vec3 grad = sign(det) * (dFdx(hW) * r1 + dFdy(hW) * r2);
            N = normalize(abs(det) * N - grad);
            alb *= 1.0 - 0.16 * detail * clamp(-h0, 0.0, 1.0);
          }
        }
        float ndl = dot(N, L), ndv = max(dot(normalize(vN), V), 0.0);
        alb *= mix(1.0, pow(ndv, 0.45), uLimb);
        float shade = 1.0;
        if (uRingOn > 0.5) {
          float den = dot(L, uRingN);
          if (abs(den) > 1e-4) {
            float t = dot(uCenter - vWP, uRingN) / den;
            if (t > 0.0) {
              float rr = length(vWP + L * t - uCenter);
              if (rr > uRing.x && rr < uRing.y) shade *= 1.0 - 0.8 * ringAlpha((rr - uRing.x) / (uRing.y - uRing.x), 0.05);
            }
          }
        }
        float wrap = max((ndl + 0.1) / 1.1, 0.0);
        vec3 col = alb * (1.15 * wrap * shade + 0.025);
        col += uRim * pow(1.0 - ndv, 3.0) * smoothstep(-0.2, 0.5, ndl) * uRimK;
        // far away: a soft edge instead of a hard limb
        float a = uOpacity * mix(1.0, smoothstep(0.0, 0.75, ndv), uSoft);
        gl_FragColor = vec4(col, a);
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
        float fw = fwidth(x);
        vec3 L = normalize(uSunDir);
        vec3 oc = vWP - uCenter; float b = dot(oc, L); float h = b * b - (dot(oc, oc) - uPR * uPR);
        float sh = (h > 0.0 && -b - sqrt(h) > 0.0) ? 0.07 : 1.0;    // in the planet's shadow
        // lit side vs. the unlit face (light diffusing through the ring)
        vec3 V = normalize(cameraPosition - vWP);
        float sameSide = step(0.0, dot(uRingN, L) * dot(uRingN, V));
        float lit = mix(0.35, 0.4 + 0.6 * abs(dot(uRingN, L)), sameSide);
        float al = ringAlpha(x, fw) * 0.85 * uOpacity;
        if (al < 0.08) discard;          // the gaps write no depth; the ring itself hides the stars behind it
        vec3 col = ringColor(x) * (0.92 * lit * sh + 0.02);
        gl_FragColor = vec4(col, al);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: true, side: THREE.DoubleSide, forceSinglePass: true,
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

/* Soft round point sprites, anti-aliased at every size. A point's falloff is
 * computed in PIXELS from its centre, with a floor on the blur radius and two
 * pixels of padding, so a star that projects to 1-3 px is still a soft round
 * dot rather than a 1x1 or 2x2 square (an even-sized sprite with a falloff in
 * sprite units lights a hard 2x2 block). Sub-pixel points shed brightness in
 * proportion to their area instead of flickering or vanishing. */
function softPointsMaterial({ opacity = 1, maxPx = 24, additive = true }) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: pointScale }, uMaxPx: { value: maxPx }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute vec3 color; uniform float uScale; uniform float uMaxPx;
      varying vec3 vC; varying float vAmp; varying float vSig; varying float vSize;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float px = min(aSize * uScale / max(-mv.z, 0.001), uMaxPx);
        vSig = max(px * 0.3, 0.62);                       // blur radius in pixels, never below ~1px FWHM
        vSize = ceil(vSig * 6.0 + 2.0);                   // covers the falloff, plus AA padding
        // brightness: full above ~1.5 px, by area below (a 0.5px star is a quarter as bright)
        vAmp = clamp(px * px / 2.25, 0.0, 1.0);
        gl_PointSize = vSize;
        vC = color; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; varying vec3 vC; varying float vAmp; varying float vSig; varying float vSize;
      void main() {
        float d = length(gl_PointCoord - 0.5) * vSize;   // distance from the centre in pixels
        float g = exp(-0.5 * d * d / (vSig * vSig));
        float a = (g * 0.9 + exp(-0.5 * d * d / (vSig * vSig * 5.0)) * 0.12) * vAmp * uOpacity;
        if (a < 0.002) discard;
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
  root = bake(root);                       // a few draw calls instead of hundreds (same geometry, same space)
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
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.7, metalness: 0.4 });
  /* The 290-foot water tower: a four-legged steel truss, tapering, cross-braced
   * at every level and ringed with girders, carrying the white tank on a
   * platform with a catwalk rail and a ladder, and the fat deluge pipe down one
   * side. (An earlier version was a ball on four sticks.) */
  const tower = new THREE.Group();
  const strut = (p0, p1, r, mat) => {
    const d = new THREE.Vector3().subVectors(p1, p0), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 5), mat);
    m.position.copy(p0).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); return m;
  };
  const H = 6.6, bw = 1.5, tw = 0.9, levels = [0, 1.7, 3.3, 4.9, H];
  const half = (y) => lerp(bw, tw, y / H);
  const corner = (y, sx, sz) => new THREE.Vector3(sx * half(y), y, sz * half(y));
  const signs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (const [sx, sz] of signs) tower.add(strut(corner(0, sx, sz), corner(H, sx, sz), 0.07, steel));
  for (let l = 1; l < levels.length; l++) {
    for (let k = 0; k < 4; k++) {
      const [ax, az] = signs[k], [bx, bz] = signs[(k + 1) % 4];
      tower.add(strut(corner(levels[l], ax, az), corner(levels[l], bx, bz), 0.04, steel));                   // girder ring
      tower.add(strut(corner(levels[l - 1], ax, az), corner(levels[l], bx, bz), 0.025, steel));              // X bracing
      tower.add(strut(corner(levels[l - 1], bx, bz), corner(levels[l], ax, az), 0.025, steel));
    }
  }
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.1, 20), steel); plat.position.y = H + 0.05; tower.add(plat);
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 1.0, 6, 22), white); tank.position.y = H + 1.55; tower.add(tank);
  for (let k = 0; k < 16; k++) { const a1 = (k / 16) * Math.PI * 2; tower.add(strut(new THREE.Vector3(Math.cos(a1) * 1.4, H + 0.1, Math.sin(a1) * 1.4), new THREE.Vector3(Math.cos(a1) * 1.4, H + 0.65, Math.sin(a1) * 1.4), 0.015, steel)); }
  const rail = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.018, 4, 24), steel); rail.rotation.x = Math.PI / 2; rail.position.y = H + 0.65; tower.add(rail);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.07, 1.07, 0.08, 22), new THREE.MeshStandardMaterial({ color: 0xc9412f, roughness: 0.6, metalness: 0.2 })); band.position.y = H + 1.55; tower.add(band);
  tower.add(strut(corner(0, 1, 1).setX(bw + 0.05), corner(H, 1, 1).setX(tw + 0.05), 0.05, dark));                // ladder rail
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, H, 8), steel); pipe.position.set(0, H / 2, 0); tower.add(pipe);   // deluge riser up the middle
  for (const [sx, sz] of signs) { const foot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), dark); foot.position.set(sx * bw, 0.06, sz * bw); tower.add(foot); }
  const towerBaked = bake(tower);          // ~150 struts -> a handful of draw calls
  towerBaked.position.set(-15, Y_G, 13); g.add(towerBaked);
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
/* The rest of the Kennedy Space Center skyline (lib/ksc.js): the Vehicle
 * Assembly Building with its flag and insignia at the end of the crawlerway,
 * the Launch Control Center beside it, an orbiter hangar - all pulled in from
 * their real ~5 km for the frame - and the press-site countdown clock in the
 * foreground, counting down with the scroll and up again after liftoff. */
let kscGroup = null, countdown = null;
const CW_YAW = -0.559;   // the crawlerway's heading: -X turned toward the north-west (matches terrainEarth's frame)
function makeKSC() {
  const ksc = makeKSCBuildings({ groundY: 0 });
  countdown = ksc.parts.clock; scene.add(countdown);      // out of the group first: it is animated, the buildings are not
  kscGroup = bake(ksc.group);
  // at the far end of the crawlerway, which runs west-north-west (CW_YAW), doors to the pad
  kscGroup.position.set(-140 * Math.cos(CW_YAW), Y_G, 140 * Math.sin(CW_YAW));
  kscGroup.rotation.y = CW_YAW;
  scene.add(kscGroup);
  countdown.position.set(0.4, Y_G, 10.7);
  countdown.rotation.y = Math.atan2(14 - 0.4, 17 - 10.7);   // face the opening camera
  countdown.scale.setScalar(1.3);
}
// Mission time from scroll: ten seconds of countdown before ignition, then
// T+ at the real pace of the ascent (booster separation lands at T+2:04).
/* The stack holds on the pad through the count (path parameter 0), lifts off
 * at T-0 and accelerates away, joining the timeline exactly - position and
 * rate - at LIFT_JOIN, so nothing later in the voyage moves. */
const LIFTOFF = 0.008, LIFT_JOIN = 0.03;
function shipP(p) {
  if (p <= LIFTOFF) return 0;
  if (p >= LIFT_JOIN) return p;
  const x = (p - LIFTOFF) / (LIFT_JOIN - LIFTOFF);
  return LIFT_JOIN * x * x * (2.267 - 1.267 * x);    // g(0)=0, g'(0)=0; g(1)=1, slope matched at the join
}
function missionTime(p) { return p < 0.008 ? -10 + (p / 0.008) * 10 : (p - 0.008) * (124 / (P.boostA - 0.008)); }
function placeCrawler(root) {
  root = bake(root);
  crawler = new THREE.Group(); crawler.add(root);
  crawler.scale.setScalar(0.407);
  crawler.position.set(-26, Y_G + 0.22 * 0.407, -1.7).applyAxisAngle(UP, CW_YAW);
  crawler.rotation.y = CW_YAW;
  scene.add(crawler);
}

/* --- Bodies ---------------------------------------------------------------- *
 * `mode` is how the flight meets each one: "below" passes over it, "around"
 * swings round it on the inside of the path's curve, "side" passes beside it,
 * "rings" skims low over its ring plane. Sizes are not to scale but keep the
 * real order (Jupiter > Saturn > Uranus ~ Neptune > Mars > Moon > Pluto).
 * `glint` is the colour of the body as a point of light, before it resolves. */
const BODY_DEFS = [
  { key: "moon", pos: [40, 14, -220], r: 18, tex: "moon", spin: 0, mode: "around", limb: 0.15, albedo: 0.6, kind: 1, freq: 7, glint: 0xdcdcdc, maria: 1 },
  { key: "mars", pos: [-40, 12, -345], r: 22, tex: "mars", spin: 0.05, mode: "below", rim: 0xe0a080, rimK: 0.3, kind: 1, freq: 5, glint: 0xffa070 },
  { key: "jupiter", pos: [46, -14, -610], r: 48, tex: "jupiter", spin: 0.03, mode: "around", limb: 0.55, band: 0.1, rim: 0xe6d2a8, rimK: 0.12, kind: 2, freq: 3, glint: 0xf2d6ae },
  { key: "saturn", pos: [-70, 20, -870], r: 38, tex: "saturn", spin: 0.03, ring: [50, 86], mode: "rings", limb: 0.5, band: 0.06, kind: 2, freq: 3, glint: 0xf6e2b4 },
  { key: "uranus", pos: [56, 30, -1060], r: 28, tex: "uranus", spin: 0.04, mode: "side", limb: 0.3, rim: 0xa8f0f6, rimK: 0.35, kind: 2, freq: 2.5, tilt: 1.71, glint: 0xc4f4f8 },
  { key: "neptune", pos: [-34, -16, -1200], r: 27, tex: "neptune", spin: 0.04, mode: "side", limb: 0.4, rim: 0x6a9cff, rimK: 0.4, kind: 2, freq: 2.5, glint: 0x84a8ff },
  { key: "pluto", pos: [24, 8, -1430], r: 8, tex: "pluto", spin: 0.02, mode: "below", kind: 1, freq: 6, glint: 0xead6bc },
];
/* Moons and minor bodies: placed relative to a parent once it is placed (or
 * absolutely), then pushed clear of the flight path. Offsets for Saturn's
 * moons are in its ring plane: [along the flight, out from Saturn toward the
 * path, 0]. */
const MINOR_DEFS = [
  { key: "phobos", parent: "mars", off: [-40, 6, 34], r: 1.6, tex: "phobos", kind: 1, freq: 9, glint: 0xb8a898 },
  { key: "deimos", parent: "mars", off: [-95, 10, 50], r: 1.1, tex: "deimos", kind: 1, freq: 9, glint: 0xc8b8a8 },
  { key: "ceres", pos: [44, -2, -400], r: 4, color: 0x8a8780, kind: 1, freq: 8, glint: 0xb0aca4, vis: [0.28, 0.33, 0.41, 0.46] },
  { key: "vesta", pos: [-14, 12, -462], r: 3, color: 0xb9b1a4, kind: 1, freq: 8, glint: 0xd0c8bc, vis: [0.3, 0.35, 0.42, 0.47] },
  { key: "io", parent: "jupiter", off: [-30, 3, 57], r: 3.8, tex: "io", kind: 1, freq: 6, glint: 0xf0e080 },
  { key: "europa", parent: "jupiter", off: [-90, -4, -30], r: 3.2, tex: "europa", kind: 1, freq: 5, glint: 0xf0ece0 },
  { key: "ganymede", parent: "jupiter", off: [35, 10, -125], r: 5.4, tex: "ganymede", kind: 1, freq: 6, glint: 0xd8d0c4 },
  { key: "callisto", parent: "jupiter", off: [110, -8, -120], r: 5.0, tex: "callisto", kind: 1, freq: 6, glint: 0xa89c8c },
  { key: "titan", parent: "saturn", ringOff: [170, -90], r: 5.2, tex: "titan", kind: 0, glint: 0xf0c070 },
  { key: "rhea", parent: "saturn", ringOff: [-110, -120], r: 3.4, tex: "rhea", kind: 1, freq: 6, glint: 0xdcdcdc },
  { key: "dione", parent: "saturn", ringOff: [150, 95], r: 3.0, tex: "dione", kind: 1, freq: 6, glint: 0xe6e6e6 },
  { key: "tethys", parent: "saturn", ringOff: [60, 115], r: 2.8, tex: "tethys", kind: 1, freq: 6, glint: 0xf0f0f0 },
  { key: "mimas", parent: "saturn", ringOff: [-40, -100], r: 1.9, tex: "mimas", kind: 1, freq: 8, glint: 0xd0d0d0 },
  { key: "iapetus", parent: "saturn", ringOff: [260, -60], r: 3.2, tex: "iapetus", kind: 1, freq: 6, glint: 0xc8c0b0 },
  { key: "enceladus", parent: "saturn", ringOff: [110, -20], r: 1.9, tex: "enceladus", kind: 1, freq: 7, glint: 0xffffff, albedo: 1.1 },
  { key: "triton", parent: "neptune", off: [-30, -18, -52], r: 4, tex: "triton", kind: 1, freq: 6, glint: 0xf0dcd4 },
  { key: "charon", parent: "pluto", off: [26, -3, -9], r: 4, tex: "charon", kind: 1, freq: 7, glint: 0xc8c0b8 },
  { key: "makemake", pos: [-48, 12, -1445], r: 4.2, color: 0xb5785a, kind: 1, freq: 6, glint: 0xd09070, vis: [0.5, 0.56, 0.63, 0.69] },
  { key: "haumea", pos: [60, -18, -1340], r: 4.2, color: 0xf2f4f8, kind: 1, freq: 6, glint: 0xffffff, scale: [2, 1, 1], vis: [0.48, 0.54, 0.6, 0.66] },
  { key: "eris", pos: [-110, 30, -1560], r: 6.8, color: 0xe8eef2, kind: 1, freq: 6, glint: 0xf4f8ff, vis: [0.52, 0.58, 0.66, 0.72] },
];
const SATURN_P = pAt(8);
const FEATURES = [
  { key: "moon", pAt: pAt(5), w: 0.05, strength: 0.6 },
  { key: "mars", pAt: pAt(6) - 0.015, w: 0.035, strength: 0.4 },
  { key: "jupiter", pAt: pAt(7), w: 0.05, strength: 0.62 },
  { key: "saturn", pAt: pAt(8), w: 0.05, strength: 0.6 },
  { key: "uranus", pAt: pAt(9), w: 0.045, strength: 0.5 },
  { key: "neptune", pAt: pAt(9) + 0.03, w: 0.04, strength: 0.45 },
  { key: "pluto", pAt: pAt(10), w: 0.045, strength: 0.4 },
  { key: "star", pAt: 0.9, w: 0.045, strength: 0.5 },
  { key: "earth", pAt: 0.228, w: 0.07, strength: 1.15, pos: new THREE.Vector3() },   // look back at the receding planet
  { key: "kepler", pAt: 0.948, w: 0.04, strength: 0.65, pos: new THREE.Vector3() },  // the destination, ahead on approach
];
const EARTH_FEATURE = FEATURES.find((f) => f.key === "earth");
const VIS = {
  moon: [0.17, 0.2, 0.34, 0.44], mars: [0.2, 0.26, 0.41, 0.47], jupiter: [0.27, 0.33, 0.47, 0.53],
  saturn: [0.33, 0.39, 0.53, 0.59], uranus: [0.4, 0.46, 0.58, 0.64], neptune: [0.43, 0.49, 0.61, 0.67],
  pluto: [0.48, 0.54, 0.65, 0.71], star: [0.6, 0.8, 1.01, 1.02],
};
const bodies = {};
const textures = {};
function makeBody(def, minor = false) {
  const g = new THREE.Group();
  const mat = planetMaterial({ map: textures[def.tex] || null, color: def.color || 0xffffff, rim: def.rim || 0, rimK: def.rimK || 0, limb: def.limb || 0, band: def.band || 0, ring: def.ring, kind: def.kind || 0, detailFreq: def.freq || 6, maria: def.maria || 0 });
  if (def.albedo) mat.uniforms.uAlbedo.value = def.albedo;
  mat.uniforms.uBumpA.value = def.r * 0.012 / Math.max(1, (def.freq || 6) / 6);   // relief height in world units
  const res = minor ? [48, 32] : [128, 96];
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.r, res[0], res[1]), mat);
  if (def.scale) mesh.scale.set(...def.scale);
  g.add(mesh);
  let ring = null;
  if (def.ring) {
    // flat in the planet's equatorial (local XZ) plane; the group carries the tilt
    ring = new THREE.Mesh(new THREE.RingGeometry(def.ring[0], def.ring[1], 256, 1), ringMaterial(def.r, def.ring));
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
  }
  if (def.tilt) g.rotation.z = def.tilt;
  g.visible = false;
  scene.add(g);
  bodies[def.key] = { group: g, mesh, mat, ring, pos: new THREE.Vector3(...(def.pos || [0, 0, 0])), r: def.r, spin: def.spin || 0.01, def,
    dClose: 30, glint: new THREE.Color(def.glint || 0xffffff), vis: def.vis || null, ringBase: new THREE.Vector2(...(def.ring || [0, 0])) };
}
let starGlow = null;
function makeStar() {
  const g = new THREE.Group();
  const mat = starMaterial(0xfff0d8);                 // Kepler-452: a G2V star, ~5,760 K - yellow-white, like the Sun
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(42, 64, 48), mat);
  g.add(mesh);
  starGlow = makeSpriteBatch({ count: 2, map: spriteTexture("glow", 3, 128), additive: true, renderOrder: FX_ORDER });
  scene.add(starGlow.mesh);
  scene.add(g);
  bodies.star = { group: g, mesh, mat, pos: new THREE.Vector3(10, 4, -3320), r: 42, spin: 0, def: { key: "star" } };
}

/* Place every body relative to its chapter's point on the path, then check the
 * real ship and chase-camera positions across the window it is visible in and
 * push it outward until both clear it. (Placing against the chapter point alone
 * let the path curve back through Jupiter.) */
const _pp = new THREE.Vector3(), _tn = new THREE.Vector3(), _dr = new THREE.Vector3(), _tA = new THREE.Vector3(), _tB = new THREE.Vector3();
const RING_PASS = { rho: 66, h: 6.5 };   // Saturn: radius over the rings and height above their plane at closest approach
function placeBodies() {
  for (const f of FEATURES) {
    const body = bodies[f.key]; if (!body || f.key === "star") continue;
    const def = body.def, r = body.r;
    const at = clamp(f.pAt, 0, 1);
    path.getPoint(at, _pp); safeTangent(at, _tn);
    if (def.mode === "rings") {
      /* Over the rings: the ring plane is laid along the flight (its normal is
       * the path's local "up", rolled a little for a sense of tilt), and the
       * planet sits beside and below so the ship crosses the B and A rings a
       * few units above them. */
      const up = new THREE.Vector3(0, 1, 0).addScaledVector(_tn, -_tn.y).normalize();
      const side = new THREE.Vector3().crossVectors(_tn, up).normalize();
      const n = up.clone().applyAxisAngle(_tn, -0.16).normalize();
      _dr.copy(side).negate().addScaledVector(n, -side.clone().negate().dot(n)).normalize();   // toward the planet, in the ring plane
      body.pos.copy(_pp).addScaledVector(n, -RING_PASS.h).addScaledVector(_dr, RING_PASS.rho);
      body.ringN = n; body.ringE1 = _dr.clone().negate(); body.ringE2 = _tn.clone().addScaledVector(n, -_tn.dot(n)).normalize();
      body.group.quaternion.setFromUnitVectors(UP, n);
      body.group.position.copy(body.pos);
      f.pos = body.pos;
      continue;
    }
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
    pushClear(body, visR + Math.max(5, visR * 0.15), VIS[f.key] || [at - 0.1, at - 0.1, at + 0.1, at + 0.1], _dr);
    body.group.position.copy(body.pos);
    f.pos = body.pos;
  }
  for (const def of MINOR_DEFS) {
    const body = bodies[def.key]; if (!body) continue;
    const par = def.parent ? bodies[def.parent] : null;
    if (par && def.ringOff) body.pos.copy(par.pos).addScaledVector(par.ringE2, def.ringOff[0]).addScaledVector(par.ringE1, def.ringOff[1]);
    else if (par) body.pos.copy(par.pos).add(new THREE.Vector3(...def.off));
    body.vis = body.vis || VIS[def.parent];
    const w = body.vis;
    // push away from the nearest point of the path in its window
    let best = Infinity, bp = 0;
    for (const s of clearanceSamples()) if (s.p >= w[0] && s.p <= w[3]) { const d = s.ship.distanceTo(body.pos); if (d < best) { best = d; bp = s.p; } }
    path.getPoint(bp, _pp); _dr.copy(body.pos).sub(_pp); if (_dr.lengthSq() < 1e-6) _dr.set(1, 0, 0); _dr.normalize();
    pushClear(body, body.r + 9, w, _dr);
    body.group.position.copy(body.pos);
  }
  // how close the chase camera gets to each body: the scale for its distance reveal
  for (const k in bodies) {
    const b = bodies[k]; if (k === "star") continue;
    const w = b.vis || VIS[k]; let min = Infinity;
    for (const s of clearanceSamples()) if (s.p >= w[0] && s.p <= w[3]) min = Math.min(min, s.cam.distanceTo(b.pos));
    b.dClose = Math.max(min, b.r * 1.5);
  }
}
function pushClear(body, need, w, dir) {
  const near = clearanceSamples().filter((s) => s.p >= w[0] && s.p <= w[3]);
  for (let i = 0; i < 120; i++) {
    let min = Infinity;
    for (const s of near) min = Math.min(min, s.ship.distanceTo(body.pos), s.cam.distanceTo(body.pos));
    if (min >= need) break;
    body.pos.addScaledVector(dir, Math.max(1, need * 0.08));
  }
}

/* The distance reveal. Far off, a body is a point of light (a glint, its own
 * colour); closing in, the disc fades up blurred and soft-edged and sharpens
 * as the ship arrives; once passed, its chapter window fades it out. Measured
 * against how close the camera will get (dClose), so a giant and a moonlet
 * both resolve at the same point of their approach. */
let glints = null;
const _gp = new THREE.Vector3();
/* Real-time perspective, exaggerated a little: a body is a point of light far
 * off and swells to its designated size as the ship closes, then stays that
 * size past closest approach and is dropped once its chapter is over. Its
 * scale is a function of distance (relative to how near the camera will come,
 * dClose), so the giant and the moonlet grow on the same schedule - on top of
 * the ordinary shrinking of anything distant. Nothing is blurred or faded in:
 * what you see far off is the same small world, getting bigger. The glint is
 * only for the last pixels, before the disc resolves. */
function bodyScale(ratio) {
  return lerp(0.025, 1, Math.pow(seg(ratio, 11, 1.7), 2.2));
}
function updateBodies(p) {
  let gi = 0;
  for (const k in bodies) {
    if (k === "star") continue;
    const b = bodies[k], w = b.vis || VIS[k];
    const win = Math.min(seg(p, w[0], w[1]), 1 - seg(p, w[2], w[3]));
    const d = camera.position.distanceTo(b.pos);
    const sc = bodyScale(d / b.dClose);
    const rpx = (b.r * sc / Math.max(d, 1e-3)) * pointScale;       // apparent radius in pixels
    const disc = win * smooth(seg(rpx, 0.8, 2.6));
    b.group.visible = disc > 0.004;
    if (b.group.visible) {
      b.group.scale.setScalar(sc);
      b.mat.uniforms.uOpacity.value = disc; b.mat.uniforms.uSoft.value = 0;
      b.mat.depthWrite = disc > 0.98;
      if (b.ring) {
        // the ring and its shadow are measured in world units: scale them with the body
        b.ring.material.uniforms.uOpacity.value = disc;
        b.ring.material.uniforms.uRing.value.copy(b.ringBase).multiplyScalar(sc); b.ring.material.uniforms.uPR.value = b.r * sc;
        b.mat.uniforms.uRing.value.copy(b.ringBase).multiplyScalar(sc);
      }
    }
    if (!glints) continue;
    const g = win * (1 - smooth(seg(rpx, 1.4, 3.2)));
    if (g > 0.004 && gi < glints.count) {
      const px = clamp(5 + rpx * 2.5, 5, 12);
      const size = (d * px * 2.2) / pointScale;
      const bright = 0.5 + 0.5 * smooth(seg(rpx, 0.2, 2));
      glints.set(gi++, b.pos.x, b.pos.y, b.pos.z, size, 0, b.glint.r * bright, b.glint.g * bright, b.glint.b * bright, g);
    }
  }
  if (glints) { for (let i = gi; i < glints.count; i++) glints.set(i, 0, 0, 0, 0, 0, 0, 0, 0, 0); glints.upload(); }
}

/* Chase camera offsets (behind, above, beside the ship). Tighter than before so
 * the vehicle reads as the subject, and tighter again over Saturn's rings. */
const CHASE = { back: 20, up: 5, side: 3.4 };
function chaseOffset(p, out) {
  const s = Math.exp(-Math.pow((p - SATURN_P) / 0.03, 2));
  return out.set(lerp(CHASE.back, 13.5, s), lerp(CHASE.up, 3.4, s), lerp(CHASE.side, 2.6, s));
}
const _co = new THREE.Vector3();
function chaseFrom(p, shipPos, t, r, out) {
  chaseOffset(p, _co);
  return out.copy(shipPos).addScaledVector(t, -_co.x).addScaledVector(UP, _co.y).addScaledVector(r, _co.z);
}
let _clearSamples = null;
function clearanceSamples() {
  if (_clearSamples) return _clearSamples;
  _clearSamples = [];
  const t = new THREE.Vector3(), r = new THREE.Vector3();
  for (let p = 0.2; p <= 0.951; p += 0.002) {
    const ship = path.getPoint(p, new THREE.Vector3());
    safeTangent(p, t); rightOf(t, r);
    const cam = chaseFrom(p, ship, t, r, new THREE.Vector3());
    _clearSamples.push({ p, ship, cam });
  }
  return _clearSamples;
}

/* --- Belts, starfield, nebulae, galaxy ------------------------------------- */
/* Fields (belts, clouds, nebulae) come out of the distance the same way the
 * planets do: inside their chapter window, their own material is held faint
 * while the camera is far (dGhost) and reaches full strength close in (dFull);
 * an impostor - a soft glow in the field's colours - stands in for it from
 * afar and dissolves as the ship flies in, so nothing pops up around the ship. */
const fields = [];   // { obj, vis:[a,b], mats:[{m, op0}], center, dFull, dGhost, imp }
function addField(obj, vis, mats, opt = {}) {
  obj.visible = false; scene.add(obj);
  const f = { obj, vis, mats: mats.map((m) => ({ m, op0: m.uniforms ? m.uniforms.uOpacity.value : m.opacity })),
    center: opt.center ? new THREE.Vector3(...opt.center) : null, dFull: opt.dFull || 0, dGhost: opt.dGhost || 1, imp: null, impOp: 0 };
  if (opt.impostor) {
    const im = opt.impostor;
    const b = makeSpriteBatch({ count: im.n || 3, map: im.map || nebulaTex[0], additive: true, renderOrder: FX_ORDER, nearFade: [0.2, 0.7] });
    for (let i = 0; i < b.count; i++) {
      const c = new THREE.Color(im.colors[i % im.colors.length]);
      const o = im.spread || 0;
      b.set(i, f.center.x + (rand(i, 301) - 0.5) * o, f.center.y + (rand(i, 302) - 0.5) * o * 0.5, f.center.z + (rand(i, 303) - 0.5) * o,
        im.size * (0.7 + 0.5 * rand(i, 304)), rand(i, 305) * 6.3, c.r, c.g, c.b, im.alpha || 0.5);
    }
    b.upload(); b.mesh.visible = false; scene.add(b.mesh);
    f.imp = b;
  }
  fields.push(f);
  return f;
}

function rockGeometry(seed) {
  // lumpy, elongated, with a few impact dents; smooth-shaded so it reads as a
  // rock, not a faceted gem, with crevices darkened and the surface speckled
  // through vertex colour
  // (polyhedra come unindexed: weld the vertices so the normals come out smooth)
  const g0 = new THREE.IcosahedronGeometry(1, 3); g0.deleteAttribute("normal"); g0.deleteAttribute("uv");
  const g = mergeVertices(g0);
  const p = g.getAttribute("position"), v = new THREE.Vector3();
  const col = new Float32Array(p.count * 3);
  const dents = [0, 1, 2, 3, 4, 5].map((k) => new THREE.Vector3(rand(k, seed * 3 + 1) - 0.5, rand(k, seed * 3 + 2) - 0.5, rand(k, seed * 3 + 3) - 0.5).normalize());
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const big = fbmP(v.x * 1.4 + seed, v.y * 1.4 + v.z * 0.9, 64, 3);
    const fine = fbmP(v.x * 6 + v.z * 3 + seed, v.y * 6 - v.z * 2, 64, 3);
    let n = 0.68 + 0.46 * big + 0.16 * fine;
    let dent = 0;
    for (const d of dents) { const t = v.dot(d); if (t > 0.88) dent += Math.sin(((t - 0.88) / 0.12) * Math.PI) * (0.5 + 0.5 * rand(seed, t)); }
    n -= 0.1 * dent;
    v.multiplyScalar(n); v.x *= 1.3; v.z *= 0.88; p.setXYZ(i, v.x, v.y, v.z);
    const shade = clamp(0.62 + 0.7 * (n - 0.95) + 0.25 * (fine - 0.5) - 0.12 * dent, 0.35, 1.15);
    const speck = 0.9 + 0.2 * nHash(i * 7, seed * 13, 9973);
    col.set([shade * speck, shade * speck * 0.97, shade * speck * 0.94], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
/* Keep a lane open along the flight path: a rock that would sit in it is
 * pushed out sideways, so the ship threads the field instead of a boulder
 * filling the screen. */
const _lane = new THREE.Vector3();
function clearLane(pos, need) {
  let best = Infinity, bs = null;
  for (const s of clearanceSamples()) { const d = s.ship.distanceToSquared(pos); if (d < best) { best = d; bs = s; } }
  if (!bs || best >= need * need) return;
  _lane.subVectors(pos, bs.ship); if (_lane.lengthSq() < 1e-6) _lane.set(1, 0.3, 0);
  pos.copy(bs.ship).addScaledVector(_lane.normalize(), need);
}
/* Per-instance reveal with distance from the camera: a belt is a faint band of
 * dust from afar and its rocks grow out of it one by one as the ship closes
 * (scaled from nothing in the vertex shader - no transparency, so nothing to
 * sort and no half-faded rock cutting a dark hole in the glow behind it). */
function distanceFadeMaterial(mat, near, far) {
  mat.userData.fade = { uFadeNear: { value: near }, uFadeFar: { value: far } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.fade);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uFadeNear; uniform float uFadeFar;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 icW = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          transformed *= 1.0 - smoothstep(uFadeNear, uFadeFar, distance(icW, cameraPosition));
        #endif`);
  };
  return mat;
}
function makeBelt({ center, rIn, rOut, thick, rocks, dust, rockColor, dustColor, vis, rockSize, glow }) {
  const grp = new THREE.Group();
  const mat = distanceFadeMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0.02, transparent: true }), 90, 240);
  const geos = [rockGeometry(1.3), rockGeometry(7.1), rockGeometry(4.4), rockGeometry(9.7)];
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const per = Math.ceil(rocks / geos.length);
  geos.forEach((geo, gi) => {
    const im = new THREE.InstancedMesh(geo, mat, per);
    for (let i = 0; i < per; i++) {
      const k = gi * 1000 + i;
      const ang = rand(k, 1) * Math.PI * 2, r = rIn + Math.pow(rand(k, 2), 0.8) * (rOut - rIn);
      dummy.position.set(center[0] + Math.cos(ang) * r, center[1] + (rand(k, 3) - 0.5) * thick, center[2] + Math.sin(ang) * r * 0.5);
      dummy.rotation.set(rand(k, 4) * 6.3, rand(k, 5) * 6.3, rand(k, 6) * 6.3);
      const sc = rockSize * (0.25 + Math.pow(rand(k, 7), 3) * 1.8);
      dummy.scale.setScalar(sc);
      clearLane(dummy.position, 7 + sc * 2.2);
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
  // the band as seen from afar: soft dust glows strung along the ring
  const n = 14, imp = { n, colors: [dustColor[0]], size: (rOut - rIn) * 1.1, alpha: glow || 0.16, map: spriteTexture("glow", 21, 128) };
  const f = addField(grp, vis, [mat, pts.material], { center, dFull: rOut * 1.05, dGhost: rOut * 3, impostor: imp });
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2, r = (rIn + rOut) / 2;
    f.imp.off[i * 3] = center[0] + Math.cos(ang) * r; f.imp.off[i * 3 + 1] = center[1]; f.imp.off[i * 3 + 2] = center[2] + Math.sin(ang) * r * 0.5;
  }
  f.imp.upload();
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
function makeNebula({ center, spread, flat = 0.6, points, palette, sprites, spriteAlpha, vis, dark = false, dFull = spread * 1.3, dGhost = spread * 3.5, seed = 4 }) {
  const grp = new THREE.Group();
  const g3 = (i, s) => (rand(i, s) + rand(i, s + 1) + rand(i, s + 2) - 1.5) / 1.5;
  const pts = makePointCloud(points, (i, out) => out.set(center[0] + g3(i, 31) * spread, center[1] + g3(i, 34) * spread * flat, center[2] + g3(i, 37) * spread),
    palette, [0.25, 1.3], 0.08, { opacity: 0.85, maxPx: 3.5 });
  grp.add(pts);
  const mats = [pts.material];
  /* Emission nebulae are painted (lib/deepsky.js) in their own palette: a few
   * large billows, each turned differently, rather than many small tinted
   * blobs. Dark dust clouds keep the plain soft sprites, drawn darkening. */
  const tex = dark ? null : nebulaTexture({ size: 512, seed, palette: palette.map((c) => "#" + new THREE.Color(c).getHexString()) });
  const sets = dark ? nebulaTex.map((t) => [t, Math.ceil(sprites / nebulaTex.length)]) : [[tex, Math.max(4, Math.ceil(sprites / 3))]];
  const white = new THREE.Color(1, 1, 1);
  sets.forEach(([t, count], bi) => {
    const b = makeSpriteBatch({ count, map: t, additive: !dark, renderOrder: dark ? FX_ORDER + 1 : FX_ORDER, nearFade: [0.25, 0.8] });
    for (let i = 0; i < b.count; i++) {
      const k = bi * 100 + i;
      const c = new THREE.Color(palette[k % palette.length]);
      if (dark) c.setRGB(0.035, 0.022, 0.016); else c.lerp(white, 0.6);
      b.set(i, center[0] + g3(k, 41) * spread * 0.8, center[1] + g3(k, 44) * spread * flat * 0.7, center[2] + g3(k, 47) * spread * 0.8,
        spread * (dark ? 0.45 + rand(k, 50) * 0.75 : 0.9 + rand(k, 50) * 0.8), rand(k, 51) * 6.3, c.r, c.g, c.b, spriteAlpha * (dark ? 0.6 + rand(k, 52) * 0.6 : 0.9 + rand(k, 52) * 0.5));
    }
    b.upload(); grp.add(b.mesh); mats.push(b.mesh.material);
  });
  const impostor = dark ? null : { n: 3, colors: [0xffffff], size: spread * 2.6, spread: spread * 0.45, alpha: Math.min(0.7, spriteAlpha * 1.8), map: tex };
  return addField(grp, vis, mats, { center, dFull, dGhost, impostor });
}
/* Other galaxies, painted (lib/deepsky.js) and hung at infinity like the star
 * map: they ride with the camera, so they keep their place in the sky however
 * far the ship goes - which is what something millions of light-years off
 * does. A face-on painting on a tilted quad gives each its inclination. */
const deepSky = [];
function makeDeepSky() {
  const R = 4800;
  const items = [
    { tex: spiralGalaxyTexture({ size: 1024, seed: 7, arms: 2, palette: "milky" }), dir: [-0.46, 0.34, -0.82], deg: 26, roll: 0.5, incl: 0.95 },
    { tex: edgeOnGalaxyTexture({ size: 1024, seed: 2 }), dir: [0.64, 0.1, -0.76], deg: 14, roll: -0.32, incl: 0 },
    { tex: ellipticalGalaxyTexture({ size: 512, seed: 3 }), dir: [-0.12, -0.36, -0.92], deg: 5, roll: 0.9, incl: 0 },
    { tex: spiralGalaxyTexture({ size: 512, seed: 11, arms: 3, palette: "cool" }), dir: [0.34, 0.56, -0.75], deg: 8, roll: 1.2, incl: 0.55 },
    { tex: spiralGalaxyTexture({ size: 512, seed: 5, arms: 4, palette: "milky" }), dir: [0.84, -0.22, 0.48], deg: 10, roll: 0.3, incl: 1.05 },
    { tex: spiralGalaxyTexture({ size: 512, seed: 19, arms: 2, palette: "cool" }), dir: [-0.8, -0.1, 0.55], deg: 7, roll: 2.1, incl: 0.7 },
  ];
  for (const it of items) {
    const m = new THREE.MeshBasicMaterial({ map: it.tex, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, opacity: 0, fog: false });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    const d = new THREE.Vector3(...it.dir).normalize();
    q.position.copy(d).multiplyScalar(R);
    q.lookAt(0, 0, 0); q.rotateZ(it.roll); q.rotateX(it.incl);
    q.scale.setScalar(2 * R * Math.tan(THREE.MathUtils.degToRad(it.deg) / 2));
    q.renderOrder = -9.7; q.frustumCulled = false;
    starSphere.add(q);
    deepSky.push(q);
  }
}
/* Waymarks of the outer route, from the route audit: the heliopause (where the
 * solar wind meets interstellar gas, ~120 AU) with Voyager 1 and 2 just past
 * it; then nearby stars on the way toward Cygnus - 61 Cygni (a K-dwarf
 * binary, 11 ly), Vega (25 ly), Albireo (a gold and blue double, ~430 ly) -
 * and, far beyond Kepler-452, the Cygnus star fields with Deneb. */
function makeLandmarks() {
  const glow = spriteTexture("glow", 41, 128), glint = spriteTexture("glint", 43, 128);
  const group = (vis, center, dFull, dGhost, items, map = glint) => {
    const b = makeSpriteBatch({ count: items.length, map, additive: true, renderOrder: FX_ORDER, nearFade: [0.15, 0.5] });
    items.forEach(([x, y, z, s, hex, al], i) => { const c = new THREE.Color(hex); b.set(i, x, y, z, s, rand(i, 77) * 6.3, c.r, c.g, c.b, al); });
    b.upload();
    addField(b.mesh, vis, [b.mesh.material], { center, dFull, dGhost });
  };
  // heliopause: a faint blue sheet across the route
  const hp = [];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; hp.push([Math.cos(a) * 150, 5 + Math.sin(a) * 110, -1520 + (rand(i, 7) - 0.5) * 30, 300, 0x7fb0ff, 0.1]); }
  group([0.57, 0.66], [0, 5, -1520], 120, 520, hp, glow);
  group([0.57, 0.66], [0, 0, -1570], 80, 400, [[-42, 14, -1585, 3, 0xfff0d0, 0.9], [36, -22, -1555, 3, 0xfff0d0, 0.9]]);
  group([0.64, 0.73], [10, 25, -1930], 120, 500, [[-60, 10, -1900, 9, 0xffb070, 1], [-57.5, 9, -1900, 7, 0xff9a60, 0.9], [80, 40, -1965, 14, 0xcfe0ff, 1]]);
  group([0.73, 0.83], [-70, 15, -2450], 120, 520, [[-70, 15, -2450, 11, 0xffc860, 1], [-66, 17.5, -2450, 8, 0x7fa8ff, 1]]);
  group([0.86, 1.01], [340, 90, -4200], 400, 2600, [[420, 120, -4300, 60, 0xd8e8ff, 1]], glow);
  makeNebula({ seed: 17, center: [260, 60, -4150], spread: 300, points: 1500, palette: [0xff4f9d, 0xff7ab8, 0x8fa8ff], sprites: 10, spriteAlpha: 0.22, vis: [0.86, 1.01], dFull: 400, dGhost: 2600 });
}
/* A deep local starfield around the whole route, for parallax: the star map is
 * at infinity, so without near stars the voyage has no sense of motion. */
let localStars = null;
function makeLocalStars() {
  localStars = makePointCloud(9000, (i, out) => {
    const z = 300 - rand(i, 71) * 4200, a = rand(i, 72) * Math.PI * 2, r = 120 + Math.pow(rand(i, 73), 0.6) * 1500;
    out.set(Math.cos(a) * r, Math.sin(a) * r * 0.75, z);
  }, [0xffffff, 0xcfe0ff, 0xffe7c4, 0xaecbff, 0xffd2a8], [1.0, 4.5], 0.05, { opacity: 0, maxPx: 3.5 });
  scene.add(localStars);
}

/* --- Launch effects: exhaust ground cloud, exhaust column ------------------ */
let smoke = null, trail = null, engineGlow = null;
const SMOKE_N = 230, TRAIL_N = 230;
/* The exhaust is a particle system driven by mission time (from the scroll, so
 * it plays backward as well), with each particle's launch state fixed when it
 * is created: where the nozzles were and which way they pointed at the moment
 * it left them. GROUND: the exhaust shoots down at speed, slowed by drag; if it
 * reaches the ground it is turned along the flame trench (north and south) -
 * fanning out over the pad once the vehicle is higher - and keeps billowing
 * outward and up as a cloud of steam and smoke. COLUMN: from the nozzles along
 * the real flight path, so it trails exactly behind the plumes; it carries a
 * little of the exhaust's momentum, then widens and drifts on the wind. */
const EXH = { v0: 40, k: 1.6, wind: new THREE.Vector3(0.05, 0.004, 0.03) };
const exG = [], exC = [];
function makeLaunchFx() {
  smoke = makeSpriteBatch({ count: SMOKE_N, map: spriteTexture("smoke", 9), lit: true, renderOrder: 1, nearFade: [0.3, 0.9] });
  trail = makeSpriteBatch({ count: TRAIL_N, map: spriteTexture("smoke", 13), lit: true, renderOrder: 1, nearFade: [0.4, 1.2] });
  engineGlow = makeSpriteBatch({ count: 5, map: spriteTexture("glow", 7, 128), additive: true, renderOrder: FX_ORDER + 1 });
  for (const b of [smoke, trail, engineGlow]) scene.add(b.mesh);
  const tailOff = tailY - ANCHORS[0].y;              // the nozzles, relative to the vehicle origin (negative: below it)
  const t = new THREE.Vector3(), side = new THREE.Vector3(), up2 = new THREE.Vector3();
  const launchState = (pe, k, jit) => {
    const E = path.getPoint(shipP(pe), new THREE.Vector3());
    safeTangent(Math.max(shipP(pe), 1e-4), t);
    E.addScaledVector(t, tailOff);
    // spread across the cluster of nozzles (the boosters sit either side of the tank)
    rightOf(t, side); up2.crossVectors(side, t).normalize();
    E.addScaledVector(side, (rand(k, 1) - 0.5) * 2 * jit).addScaledVector(up2, (rand(k, 2) - 0.5) * jit);
    return { pe, E, D: t.clone().negate(), tE: missionTime(pe) };
  };
  for (let i = 0; i < SMOKE_N; i++) {
    const pe = 0.0028 + 0.034 * Math.pow(i / SMOKE_N, 1.7);
    const s = launchState(pe, i + 500, 1.0);
    s.side = i % 2 ? 1 : -1; s.ang = rand(i, 93) * Math.PI * 2; s.r1 = rand(i, 94); s.r2 = rand(i, 95); s.rot = rand(i, 96) * 6.3;
    exG.push(s);
  }
  for (let i = 0; i < TRAIL_N; i++) {
    const pe = LIFTOFF + 0.001 + (P.boostA + 0.002 - LIFTOFF - 0.001) * Math.pow(i / (TRAIL_N - 1), 1.15);
    const s = launchState(pe, i + 900, 0.7);
    s.r1 = rand(i, 101); s.r2 = rand(i, 102); s.rot = rand(i, 103) * 6.3;
    exC.push(s);
  }
}
const _sp = new THREE.Vector3(), _hd = new THREE.Vector3();
function updateLaunchFx(p) {
  // the exhaust: ground cloud
  const tNow = missionTime(p);
  const ground = Y_G + 0.45;
  const nozzleH = vehicle.position.y + (tailY - ANCHORS[0].y) - ground;   // how high the engines are now: the glow they cast on the cloud
  const flameK = p < P.boostA ? Math.exp(-Math.max(0, nozzleH) / 14) * smooth(seg(p, 0.0027, 0.006)) : 0;
  const groundFade = 1 - seg(p, 0.085, 0.11);
  smoke.mesh.visible = p > 0.0028 && groundFade > 0.01;
  if (smoke.mesh.visible) {
    for (let i = 0; i < SMOKE_N; i++) {
      const g = exG[i];
      if (p <= g.pe) { smoke.set(i, 0, 0, 0, 0, 0, 0, 0, 0, 0); continue; }
      const te = tNow - g.tE;
      const s = (EXH.v0 / EXH.k) * (1 - Math.exp(-EXH.k * te));       // distance travelled, with drag
      const h = g.E.y - ground;
      let x, y, z, size, al;
      if (h * EXH.k < EXH.v0 * 0.98 && s >= h) {
        // reached the ground: along the trench, or fanned over the pad when high
        const ts = -Math.log(1 - (h * EXH.k) / EXH.v0) / EXH.k, tg = Math.max(0, te - ts);
        const fan = smooth(seg(h, 5, 14));
        _hd.set((g.r1 - 0.5) * 0.7, 0, g.side).normalize();
        _hd.lerp(_sp.set(Math.cos(g.ang), 0, Math.sin(g.ang)), fan).normalize();
        // shot out of the trench mouth, braked hard by the air, then a slow billowing spread
        const r = (12 + 7 * g.r2) * (1 - Math.exp(-tg / 1.6)) + 1.3 * Math.sqrt(tg) * (0.6 + g.r1 * 0.8);
        size = Math.min(16, 1.8 + 1.2 * Math.sqrt(tg + 0.3) * (0.7 + g.r2 * 0.7) + r * 0.06);
        x = g.E.x + g.D.x * h + _hd.x * r; z = g.E.z + g.D.z * h + _hd.z * r;
        y = ground + size * 0.3 + 1.1 * Math.pow(tg, 0.6) * (0.3 + g.r1 * 0.9);   // sitting on the ground, rising as it cools
        al = 0.85 * smooth(seg(tg, 0.0, 0.5)) * (1 - smooth(seg(te, 80, 150)));
      } else {
        // never reached the ground: it hangs where the jet ran out and spreads
        x = g.E.x + g.D.x * s; y = g.E.y + g.D.y * s + 0.04 * te; z = g.E.z + g.D.z * s;
        size = Math.min(12, 1.2 + 1.1 * Math.sqrt(te));
        al = 0.6 * smooth(seg(te, 0.2, 1.0)) * (1 - smooth(seg(te, 80, 150)));
      }
      x += EXH.wind.x * te + Math.sin(elapsed * 0.21 + i * 1.7) * size * 0.04;
      z += EXH.wind.z * te + Math.cos(elapsed * 0.19 + i * 1.3) * size * 0.04;
      y += Math.sin(elapsed * 0.17 + i) * size * 0.02;
      // fresh exhaust is lit orange from below by the engines
      const dx = x - vehicle.position.x, dz = z - vehicle.position.z;
      const warm = flameK * Math.exp(-(dx * dx + dz * dz) / 260) * 0.75 + Math.exp(-te * 2.5) * 0.3;
      smoke.set(i, x, y, z, size, g.rot + elapsed * 0.015 * (i % 2 ? 1 : -1), 0.84 + warm * 0.5, 0.83 + warm * 0.12, 0.81 - warm * 0.2, al * groundFade);
    }
    smoke.upload();
  }
  // the exhaust: column along the climb, from the solids until they separate
  const trailOn = 1 - seg(p, 0.16, 0.24);
  trail.mesh.visible = trailOn > 0.01 && p > LIFTOFF;
  if (trail.mesh.visible) {
    for (let i = 0; i < TRAIL_N; i++) {
      const c = exC[i];
      if (p <= c.pe + 0.0004) { trail.set(i, 0, 0, 0, 0, 0, 0, 0, 0, 0); continue; }
      const te = tNow - c.tE;
      const s = 3.5 + 7 * (1 - Math.exp(-1.2 * te));                    // past the flame, still moving with the jet
      const size = Math.min(12, 1.7 + 1.25 * Math.sqrt(te) * (0.8 + c.r1 * 0.4));
      const x = c.E.x + c.D.x * s + EXH.wind.x * te + (c.r1 - 0.5) * size * 0.25;
      const y = c.E.y + c.D.y * s + EXH.wind.y * te;
      const z = c.E.z + c.D.z * s + EXH.wind.z * te + (c.r2 - 0.5) * size * 0.25;
      const fresh = Math.exp(-te * 1.6);
      const al = 0.62 * smooth(seg(te, 0.15, 0.9)) * (1 - smooth(seg(te, 90, 200))) * trailOn * (0.75 + 0.25 * c.r2);
      trail.set(i, x, y, z, size, c.rot, 0.8 + fresh * 0.4, 0.79 + fresh * 0.15, 0.78 - fresh * 0.1, al);
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
const ORB_MID = new THREE.Vector3();   // the orbiter's centre in vehicle space (the stack's is the origin)
const P = { boostA: 0.105, boostB: 0.155, tankA: 0.165, tankB: 0.225 };
const plumes = [];
const debris = [];   // { obj, booster, kick:Vector3 (vehicle-local), c:Vector3 (centre, vehicle-local), axis, spin }

/* Engine exhaust: nose is +Z, so each flame trails along -Z from its nozzle.
 * forceSinglePass: a transparent DoubleSide material otherwise renders in two
 * passes and sets needsUpdate around each, invalidating its shader program every
 * frame; additive blending gains nothing from the ordering. */
function makePlume(rad, len) {
  const g = new THREE.Group();
  const flame = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: false });
  const core = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.55, len * 0.62, 20, 1, true), flame(0xcfe8ff, 0.9));
  const outer = new THREE.Mesh(new THREE.ConeGeometry(rad, len, 20, 1, true), flame(0xff8a3c, 0.42));
  core.rotation.x = -Math.PI / 2; core.position.z = -len * 0.31;
  outer.rotation.x = -Math.PI / 2; outer.position.z = -len / 2;
  const bead = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.62, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
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
  ORB_MID.copy(oMid);
  orbiterRoot = orbiter; vehicle.add(orbiterRoot);
  // both are made transparent once, here, so the crossfade never recompiles a shader
  rememberOpacity(stackRoot); rememberOpacity(orbiterRoot);
  orbiter.visible = false;
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
  // the cruise's speed at the hand-over (units per unit of p): the orbit eases up from it
  KF.v0 = path.getPoint(FINALE_START + 0.001, new THREE.Vector3()).distanceTo(path.getPoint(FINALE_START - 0.001, new THREE.Vector3())) / 0.002;
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
  makeBaseProps();
  scene.add(base);
}
/* Everything else on the Base One pad, built from primitives: landing-pad
 * floodlights and approach lamps, a radio mast with a blinking beacon, fuel
 * tanks and their manifold, a field of solar panels, supply crates, boulders
 * round the edge, and a line of ridges on the horizon. In the base frame: x
 * along the approach, z to the side, y up; 1 unit ~ 11 m. */
let beacon = null, baseDust = null;
function makeBaseProps() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xdfe0dc, roughness: 0.5, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x7b828a, roughness: 0.55, metalness: 0.65 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.7, metalness: 0.4 });
  const glowY = new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false }), glowR = new THREE.MeshBasicMaterial({ color: 0xff4a3a, fog: false });
  // lamp posts along the track, with a warm lamp head
  for (let i = 0; i < 9; i++) {
    const x = 7 + i * 2.6, z = 0.35 * x + (i % 2 ? 1.4 : -1.4);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.5, 6), steel); post.position.set(x, 0.75, z); g.add(post);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glowY); head.position.set(x, 1.52, z); g.add(head);
  }
  // radio mast with guy wires and a blinking beacon
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 8, 6), steel); mast.position.set(2, 4, -16); g.add(mast);
  for (let k = 0; k < 3; k++) {
    const a0 = (k / 3) * Math.PI * 2, wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 6.4, 3), steel);
    wire.position.set(2 + Math.cos(a0) * 2.4, 3.6, -16 + Math.sin(a0) * 2.4); wire.lookAt(2, 7.4, -16); wire.rotateX(Math.PI / 2); g.add(wire);
  }
  for (let k = 0; k < 3; k++) { const dish = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8, 0, Math.PI), white); dish.position.set(2.1, 5.5 + k * 0.9, -16); dish.rotation.y = k * 1.2 + 0.4; g.add(dish); }
  beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glowR); beacon.position.set(2, 8.1, -16); g.add(beacon);
  // fuel tanks: a row of white spheres on legs, joined by a pipe
  for (let k = 0; k < 3; k++) {
    const x = 14 + k * 3.1, z = 12.5;
    const t = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16), white); t.position.set(x, 1.8, z); g.add(t);
    for (let l = 0; l < 4; l++) { const aa = l * Math.PI / 2 + Math.PI / 4, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.2, 6), steel); leg.position.set(x + Math.cos(aa) * 0.8, 0.6, z + Math.sin(aa) * 0.8); g.add(leg); }
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9.5, 8), steel); pipe.rotation.z = Math.PI / 2; pipe.position.set(17.1, 0.3, 10.5); g.add(pipe);
  // a field of solar panels on stands, tilted toward the star
  const panelTex = (() => {
    const c = document.createElement("canvas"); c.width = 128; c.height = 128; const x = c.getContext("2d");
    x.fillStyle = "#14213b"; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = "#5b79b4"; x.lineWidth = 2;
    for (let i = 0; i <= 128; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  })();
  const pm = new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.3, metalness: 0.6 });
  for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
    const x = -9 + k * 2.3, z = -24 - r * 3.4;
    const p = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 1.5), pm); p.position.set(x, 1.05, z); p.rotation.x = -0.55; g.add(p);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 5), steel); s.position.set(x, 0.5, z); g.add(s);
  }
  // crates and drums beside the habitat
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.85 }), drumMat = new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.5, metalness: 0.3 });
  for (let k = 0; k < 7; k++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.7 + 0.3 * rand(k, 5), 0.6 + 0.3 * rand(k, 6), 0.7), crateMat);
    c.position.set(9 + (k % 4) * 0.9, 0.35 + (k > 3 ? 0.65 : 0), 5.2 + Math.floor(k / 4) * 0.2); c.rotation.y = rand(k, 7) * 0.5; g.add(c);
  }
  for (let k = 0; k < 5; k++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 12), drumMat); d.position.set(11.5 + k * 0.5, 0.3, 6.2); g.add(d); }
  // two storage silos with domed caps and a ladder, beyond the pad
  for (const [x, z] of [[19, -12], [21.6, -13.2]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 2.3, 24), white); s.position.set(x, 1.15, z); g.add(s);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel); cap.position.set(x, 2.3, z); g.add(cap);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.12, 24), dark); band.position.set(x, 1.0, z); g.add(band);
    const lad = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.1), steel); lad.position.set(x + 0.98, 1.1, z); g.add(lad);
  }
  // boulders in a loose ring round the apron (instanced, from the asteroid rock shape)
  const rg = rockGeometry(5.3), rm = new THREE.MeshStandardMaterial({ color: 0x7a6552, vertexColors: true, roughness: 0.95 });
  const rocks = new THREE.InstancedMesh(rg, rm, 60), dm = new THREE.Object3D();
  for (let k = 0; k < 60; k++) {
    const aa = rand(k, 1) * Math.PI * 2, rr = 10 + Math.pow(rand(k, 2), 0.7) * 26, sc = 0.12 + Math.pow(rand(k, 3), 3) * 1.1;
    dm.position.set(Math.cos(aa) * rr, sc * 0.35, Math.sin(aa) * rr); dm.rotation.set(rand(k, 4) * 6, rand(k, 5) * 6, rand(k, 6) * 6); dm.scale.set(sc, sc * 0.7, sc); dm.updateMatrix(); rocks.setMatrixAt(k, dm.matrix);
  }
  g.add(rocks);
  // ridges: two rings of eroded mesas and spurs on the horizon, the far one paler
  // with distance (planet curvature hides their feet)
  for (const [R0, hs, far, seed] of [[150, 0.95, 0, 3.1], [205, 1.35, 1, 8.7]]) {
    const N = 240, pos = [], col = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, ang = t * Math.PI * 2;
      const hgt = (1.5 + 34 * Math.pow(Math.max(0, fbmP(t * 7 + seed, 1.7, 7, 4) - 0.28), 1.7) + (fbmP(t * 45, 4.2, 45, 3) - 0.5) * 4 + 22 * Math.pow(Math.max(0, fbmP(t * 3 + seed + 4, 0.5, 3, 3) - 0.5), 1.3)) * hs;
      const mesa = Math.floor(hgt / 2.6) * 2.6 * 0.55 + hgt * 0.45;       // terraced, like eroded strata
      const R = R0 + 30 * fbmP(t * 6, 9.1, 6, 3);
      for (const [y, f] of [[-8, 0], [mesa, 1]]) {
        pos.push(Math.cos(ang) * R, y, Math.sin(ang) * R);
        const haze = far ? 0.5 : 0.22, lo = f ? [0.2, 0.12, 0.09] : [0.4, 0.3, 0.25], hz = [0.62, 0.52, 0.46];
        col.push(...lo.map((v, k) => lerp(v, hz[k], haze + (f ? 0 : 0.2))));
      }
      if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const rgm = new THREE.BufferGeometry();
    rgm.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); rgm.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    rgm.setIndex(idx); rgm.computeVertexNormals();
    g.add(new THREE.Mesh(rgm, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })));
  }
  g.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = true; });
  rememberOpacity(g);
  base.add(g);
  // landing dust: blown outward from the pad as the engines come in low
  baseDust = makeSpriteBatch({ count: 90, map: spriteTexture("smoke", 17), lit: true, renderOrder: 1, nearFade: [0.3, 0.9] });
  baseDust.mesh.frustumCulled = false; baseDust.mesh.visible = false; scene.add(baseDust.mesh);
}
const _bd = new THREE.Vector3();
function updateBaseDust(p) {
  if (!baseDust) return;
  const s = seg(p, F_DESC_END, 1);
  // engine height above the pad drives it: nothing until ~25 units up, a full ring by touchdown
  const h = Math.max(0, vehicle.position.clone().sub(KF.B).dot(KF.nB));
  const on = (1 - smooth(seg(h, 5, 28))) * smooth(seg(s, 0.45, 0.8));
  baseDust.mesh.visible = on > 0.01 && p >= F_DESC_END;
  if (!baseDust.mesh.visible) return;
  for (let i = 0; i < baseDust.count; i++) {
    const ang = rand(i, 311) * Math.PI * 2, ph = (rand(i, 312) + elapsed * (0.12 + 0.1 * rand(i, 313))) % 1;   // a puff's life: out and away
    const r = 1.2 + ph * (6 + 9 * rand(i, 314)), y = 0.25 + ph * (0.7 + 1.6 * rand(i, 315)) * (1 - 0.4 * ph);
    _bd.copy(KF.B).addScaledVector(KF.fwd, Math.cos(ang) * r).addScaledVector(KF.side, Math.sin(ang) * r).addScaledVector(KF.nB, y);
    const sz = 0.9 + ph * 2.6 * (0.6 + rand(i, 316));
    const al = on * 0.42 * Math.sin(Math.PI * Math.min(1, ph * 1.15)) * (0.6 + 0.4 * rand(i, 317));
    baseDust.set(i, _bd.x, _bd.y, _bd.z, sz, rand(i, 318) * 6.3, 0.82, 0.66, 0.46, al);
  }
  baseDust.upload();
}
/* Base modules arrive in the background after the main load. Placement is in
 * the landing frame: x along the approach, z to the side, y up. */
function placeOnBase(root, size, x, z, rotY, axis = "max") {
  root = bake(root);
  const box = new THREE.Box3().setFromObject(root), s = box.getSize(new THREE.Vector3());
  const k = size / (axis === "max" ? Math.max(s.x, s.y, s.z) : s[axis]);
  root.scale.setScalar(k);
  const b2 = new THREE.Box3().setFromObject(root), c2 = b2.getCenter(new THREE.Vector3());
  const holder = new THREE.Group(); holder.add(root);
  root.position.set(-c2.x, -b2.min.y, -c2.z);
  holder.position.set(x, 0, z); holder.rotation.y = rotY;
  base.add(holder);
  rememberOpacity(holder);
  return holder;
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
const loadTex = (url) => new Promise((res, rej) => texLoader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping; res(t); }, undefined, rej));
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
  makeKSC();
  Object.assign(textures, { moon, mars, jupiter, saturn, neptune, pluto, uranus: uranusTexture() });
  makeEarth(earth);
  BODY_DEFS.forEach((d) => makeBody(d));
  MINOR_DEFS.forEach((d) => makeBody(d, true));
  glints = makeSpriteBatch({ count: 40, map: spriteTexture("glint", 5, 128), additive: true, renderOrder: FX_ORDER });
  scene.add(glints.mesh);
  makeStar();
  buildKeplerFrame();
  makeKepler();
  bodies.star.pos.copy(KF.starPos); bodies.star.group.position.copy(KF.starPos);
  FEATURES.find((f) => f.key === "star").pos = KF.starPos;
  FEATURES.find((f) => f.key === "kepler").pos.copy(KF.K);
  placeBodies();
  const sat = bodies.saturn;
  sat.group.updateMatrixWorld(true);
  const ringN = sat.ring.getWorldDirection(new THREE.Vector3());
  for (const u of [sat.mat.uniforms, sat.ring.material.uniforms]) { u.uCenter.value.copy(sat.pos); u.uRingN.value.copy(ringN); }
  nebulaTex = [spriteTexture("nebula", 3), spriteTexture("nebula", 11), spriteTexture("nebula", 23), spriteTexture("nebula", 37)];
  /* The main belt lies beyond Mars (2.2-3.2 AU) and short of Jupiter; the
   * Kuiper belt beyond Neptune. Windows and reveal distances per the route
   * audit, so each is a faint patch ahead well before the ship is in it. */
  makeBelt({ center: [16, 6, -425], rIn: 22, rOut: 150, thick: 34, rocks: 540, dust: 2600, rockColor: 0x8a7f72, dustColor: [0x9a8a78, 0x7d7468], vis: [0.19, 0.5], rockSize: 1.3 });
  makeBelt({ center: [4, 8, -1410], rIn: 40, rOut: 260, thick: 60, rocks: 360, dust: 3200, rockColor: 0xb8c6d8, dustColor: [0xb8c8e0, 0x9fb4d0], vis: [0.48, 0.7], rockSize: 1.6, glow: 0.12 });
  // the Oort cloud: a vast, thin shell of icy bodies, a pale haze ahead long before the ship is inside it
  const oort = makePointCloud(6000, (i, out) => {
    const u = rand(i, 1) * 2 - 1, th = rand(i, 2) * Math.PI * 2, rr = 360 * (0.82 + rand(i, 3) * 0.18), s = Math.sqrt(1 - u * u);
    out.set(Math.cos(th) * s * rr, 2 + u * rr, -1700 + Math.sin(th) * s * rr);
  }, [0xd6e4f4, 0xbfd2ea], [0.8, 2.6], 0.04, { opacity: 0.9, maxPx: 6 });
  addField(oort, [0.5, 0.76], [oort.material], { center: [0, 2, -1700], dFull: 300, dGhost: 800,
    impostor: { n: 4, colors: [0x9fb6d8, 0xb8c8e8], size: 520, spread: 260, alpha: 0.22, map: spriteTexture("glow", 31, 128) } });
  makeNebula({ seed: 24, center: [0, 0, -1980], spread: 140, points: 2600, palette: [0x5a7dff, 0x9a6bff, 0x4fc3ff], sprites: 20, spriteAlpha: 0.32, vis: [0.6, 0.8], dFull: 220, dGhost: 620 });
  makeNebula({ seed: 31, center: [0, 10, -2330], spread: 200, points: 3000, palette: [0xbfe6ff, 0x7fd6ff, 0xffffff, 0xffb6e0], sprites: 20, spriteAlpha: 0.22, vis: [0.64, 0.87], dFull: 300, dGhost: 800 });
  makeNebula({ seed: 38, center: [0, -10, -2760], spread: 230, flat: 0.3, points: 7000, palette: [0xffe2b0, 0xfff3d8, 0xffc78a, 0xffb07a], sprites: 16, spriteAlpha: 0.3, vis: [0.72, 0.92], dFull: 260, dGhost: 700 });
  makeNebula({ seed: 45, center: [0, 0, -2700], spread: 170, flat: 0.25, points: 10, palette: [0x000000], sprites: 22, spriteAlpha: 0.85, vis: [0.73, 0.9], dark: true, dFull: 260, dGhost: 700 });
  makeNebula({ seed: 52, center: [-10, 0, -3050], spread: 220, points: 3400, palette: [0xff4f9d, 0xff7ac0, 0x7a5cff, 0xff9b5c], sprites: 24, spriteAlpha: 0.36, vis: [0.78, 0.98], dFull: 270, dGhost: 720 });
  makeNebula({ seed: 59, center: [60, 30, -3080], spread: 170, points: 2000, palette: [0x21d4ff, 0x4f8bff, 0x9ff0ff], sprites: 14, spriteAlpha: 0.3, vis: [0.79, 0.98], dFull: 270, dGhost: 720 });
  makeLandmarks();
  makeDeepSky();
  makeLocalStars();
  makeLaunchFx();
  measureScroll();
  applySize();
  updatePath(0);
  warmup();
  loaderEl.classList.add("is-hidden");
  loadBase();
  loadMoons();
  loadExtras();
}).catch((err) => {
  console.error("Asset load failed:", err);
  if (pctEl) pctEl.parentElement.textContent = "Could not load assets - serve over http (see README).";
});

/* --- Library models: craft, asteroids, astronauts, a rocket ------------------ *
 * Added from the NASA model library after a cost/benefit pass: each is loaded
 * after the opening is up, baked into a handful of draw calls (merged by
 * material), and only drawn inside its own window of the voyage. Far off, each
 * is small and grows as the ship closes, like the planets (bodyScale). */
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m4 = new THREE.Matrix4();
  const groups = new Map(), kept = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    for (let n = o; n && n !== root.parent; n = n.parent) if (!n.visible) return;     // helper meshes stay hidden
    if (Array.isArray(o.material)) {            // multi-material meshes are kept whole
      const keepMesh = new THREE.Mesh(o.geometry, o.material);
      m4.multiplyMatrices(inv, o.matrixWorld); keepMesh.applyMatrix4(m4); kept.push(keepMesh); return;
    }
    let g = o.geometry.clone();
    m4.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(m4);
    const keep = ["position", "normal", "uv"];
    if (o.material.vertexColors && g.attributes.color) keep.push("color");
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    const k = o.material.uuid;
    if (!groups.has(k)) groups.set(k, { mat: o.material, geos: [] });
    groups.get(k).geos.push(g);
  });
  const out = new THREE.Group();
  for (const { mat, geos } of groups.values()) {
    const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (!merged) { for (const g of geos) out.add(new THREE.Mesh(g, mat)); continue; }
    merged.computeBoundingSphere();
    out.add(new THREE.Mesh(merged, mat));
  }
  for (const k of kept) out.add(k);
  return out;
}
/* Normalise: centred (or standing on its base), longest side == size. */
function fitModel(root, size, stand = false) {
  const box = new THREE.Box3().setFromObject(root), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = size / Math.max(s.x, s.y, s.z);
  const holder = new THREE.Group(), inner = new THREE.Group();
  inner.add(root); inner.scale.setScalar(k);
  inner.position.set(-c.x * k, stand ? -box.min.y * k : -c.y * k, -c.z * k);
  holder.add(inner);
  return holder;
}
const extras = [];
const _xv = new THREE.Vector3(), _xr = new THREE.Vector3(), _xt = new THREE.Vector3();
/* A craft the ship passes: fixed in space beside the path, seen small from afar and
 * growing on approach, drifting slowly. (ahead, side, up) are measured from the
 * ship's position at p0, along its heading, to its right and upward. */
function addFlyby(key, root, { size, p0, w = 0.03, ahead, side, up, spin = 0.15, phase = 0 }) {
  const holder = fitModel(bake(root), size);
  const P = path.getPoint(p0, new THREE.Vector3()); safeTangent(p0, _xt); rightOf(_xt, _xr);
  holder.position.copy(P).addScaledVector(_xt, ahead).addScaledVector(_xr, side).addScaledVector(UP, up);
  holder.rotation.set(phase * 0.7, phase, phase * 0.4);
  holder.visible = false; scene.add(holder);
  extras.push({ key, holder, p0, w, dClose: Math.hypot(side, up) + 10, spin, phase });
}
/* An Earth-orbit craft: it hangs at a fixed height over Earth as the planet shrinks. It is
 * placed where the climbing ship rises through that height (at p0), a little to one side,
 * so the ship passes it close by and then leaves it behind and below. */
function addOrbiter(key, root, { size, p0, side, up = 0, w = 0.032, spin }) {
  const holder = fitModel(bake(root), size);
  earthAt(p0);
  const S = path.getPoint(p0, new THREE.Vector3()), C = earthC.clone(), R = earthR;
  const alt = (S.distanceTo(C) - R) / R + up / R;
  const dir = S.sub(C).normalize(); safeTangent(p0, _xt);
  dir.applyAxisAngle(_xt, side / (R * (1 + alt)));                    // slide it sideways, round the planet
  holder.visible = false; scene.add(holder);
  extras.push({ key, holder, p0, w, dClose: Math.abs(side) + 12, earth: true, dir, alt, spin });
}
function updateExtras(p) {
  for (const e of extras) {
    let win = Math.min(seg(p, e.p0 - e.w, e.p0 - e.w * 0.4), 1 - seg(p, e.p0 + e.w * 0.4, e.p0 + e.w));
    if (e.earth) win *= smooth(seg(shipAlt, 0.9, 1.6));          // not until the ship is out of the blue sky
    if (win <= 0.005) { e.holder.visible = false; continue; }
    if (e.earth) {
      e.holder.position.copy(e.dir).multiplyScalar(earthR * (1 + e.alt)).add(earthC);
      e.holder.quaternion.setFromUnitVectors(UP, e.dir);
      e.holder.rotateY(elapsed * e.spin);
    } else {
      e.holder.rotation.y = e.phase + elapsed * e.spin;
    }
    const sc = bodyScale(camera.position.distanceTo(e.holder.position) / e.dClose) * smooth(win);
    e.holder.visible = sc > 0.03;
    e.holder.scale.setScalar(sc);
  }
  if (ares) {
    // Ares 1 stands on the next pad, 39B, a few kilometres up the coast; the ground
    // curves away beneath it as the planet shrinks, like the buildings
    const on = p < 0.11;
    ares.visible = on;
    if (on) ares.position.y = Y_G - (ares.position.x * ares.position.x + ares.position.z * ares.position.z) / (2 * earthR);
  }
}
let ares = null;
function loadExtras() {
  const L = (u) => loadGlb(u, lateLoader);
  Promise.all([L(MODEL.iss), L(MODEL.hubble), L(MODEL.lm), L(MODEL.bennu), L(MODEL.dawn), L(MODEL.galileo), L(MODEL.cassini), L(MODEL.astro), L(MODEL.dish70), L(MODEL.ares)])
    .then(([iss, hubble, lm, bennu, dawn, galileo, cassini, astro, dish70, aresG]) => {
      // low Earth orbit: the ISS and Hubble, below and to the side of the climb
      addOrbiter("iss", iss.scene, { size: 8, p0: 0.152, side: -26, up: 3, spin: 0.05 });
      addOrbiter("hubble", hubble.scene, { size: 4.5, p0: 0.166, side: -30, up: -2, spin: 0.08 });
      // the Moon: an Apollo lunar module on the surface, on the side that faces the approach
      const moon = bodies.moon, mcam = path.getPoint(0.29, new THREE.Vector3()).add(new THREE.Vector3(0, 6, 22));
      const nrm = mcam.sub(moon.pos).normalize(), lmH = fitModel(bake(lm.scene), 2.4, true);
      lmH.position.copy(nrm).multiplyScalar(moon.r - 0.1);
      lmH.quaternion.setFromUnitVectors(UP, nrm);
      moon.mesh.add(lmH); moon.lm = lmH;
      // the asteroid belt: Bennu, three times over, and Dawn, which really orbited Vesta and Ceres
      const bennuBase = bake(bennu.scene);
      [[0.352, 5, 80, 18, 8, 0.4], [0.366, 3.4, 80, -14, -4, 1.7], [0.378, 4.2, 80, -22, -1, 3.1]].forEach(([p0, size, ahead, side, up, ph], i) => {
        const r = new THREE.Group(); r.add(bennuBase.clone());
        addFlyby("bennu" + i, r, { size, p0, w: 0.04, ahead, side, up, spin: 0.09 + i * 0.03, phase: ph });
      });
      addFlyby("dawn", dawn.scene, { size: 6.5, p0: 0.364, w: 0.04, ahead: 80, side: 14, up: 2, spin: 0.12, phase: 0.6 });
      addFlyby("galileo", galileo.scene, { size: 6, p0: 0.412, w: 0.04, ahead: 70, side: -24, up: 2, spin: 0.1, phase: 2.0 });
      addFlyby("cassini", cassini.scene, { size: 5.5, p0: 0.462, w: 0.034, ahead: 50, side: -7, up: 3, spin: 0.1, phase: 1.1 });
      // Ares 1 on pad 39B
      ares = fitModel(bake(aresG.scene), 10, true);
      ares.position.set(-42, Y_G, -118); scene.add(ares);   // pad 39B, pulled in from its real 2.6 km to frame the opening
      // Base One: two astronauts for scale and the big 70 m dish behind the 34 m one
      if (base) {
        placeOnBase(bake(astro.scene), 0.56, 8.2, 6.3, 2.6);
        placeOnBase(bake(astro.scene), 0.56, 3.0, 6.9, 3.4);
        placeOnBase(bake(dish70.scene), 9.5, -15, -30, 0.5, "y");
            }
      renderer.compile(scene, camera);          // every new shader, now, while nothing is moving
    }).catch((e) => console.warn("Library models failed to load:", e));
}

const lateTex = new THREE.TextureLoader();
function loadMoons() {
  for (const [key, file] of Object.entries(MOONURL)) {
    lateTex.load(U(TEX + file), (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      const b = bodies[key]; if (!b) return;
      b.mat.uniforms.uMap.value = t; b.mat.uniforms.uHasMap.value = 1;
    });
  }
}
function loadBase() {
  Promise.all([loadGlb(MODEL.habitat, lateLoader), loadGlb(MODEL.dish, lateLoader), loadGlb(MODEL.ship2, lateLoader), loadGlb(MODEL.hq, lateLoader)]).then(([hab, dish, ship2, hq]) => {
    placeOnBase(hab.scene, 4.4, 6.5, 9.5, -0.6);
    placeOnBase(dish.scene, 4.2, -4.5, -12.5, 0.9, "y");
    placeOnBase(ship2.scene, 3.0, 11, -6.5, 2.4);
    placeOnBase(hq.scene, 7.5, 24, -3, -1.9, "y");          // the control building, beyond the pad
    for (const o of base.children) o.traverse((m) => { if (m.isMesh && m.material && m.material.color) m.material.envMapIntensity = 0.6; });
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

/* Text: each panel's title is driven from scroll position directly (CSS
 * variables), so it glides in and out with the scene instead of popping when
 * an observer fires. Descriptions are tooltips on the titles (styles.css). */
function updatePanels(y) {
  const vh = Math.max(1, window.innerHeight);
  for (const m of panelMap) {
    const k = (y + vh / 2 - (m.top + m.h / 2)) / vh;          // -1 below .. 0 centred .. +1 above
    const a = Math.abs(k);
    const tv = 1 - smooth(seg(a, 0.22 + Math.max(0, (m.h / vh - 1) * 0.5), 0.58 + Math.max(0, (m.h / vh - 1) * 0.5)));
    const key = tv.toFixed(3) + "|" + clamp(k, -1, 1).toFixed(3);
    if (key === m.last) continue;
    m.last = key;
    m.el.style.setProperty("--tv", tv.toFixed(3));
    m.el.style.setProperty("--k", clamp(k, -1, 1).toFixed(3));
  }
}

/* Hover notes open on whichever side of their title has room: below by default,
 * above when the title is low on the screen (or the note would run into the HUD
 * line at the bottom). Re-checked as the pointer moves, since the page scrolls
 * under it. */
const HUD_SAFE = 72;
function placeTip(tip) {
  const note = tip.querySelector(".desc"), title = tip.querySelector(".title");
  if (!note || !title) return;
  const t = title.getBoundingClientRect(), h = note.offsetHeight + 28;
  const below = window.innerHeight - HUD_SAFE - t.bottom, above = t.top - 12;
  tip.classList.toggle("tip--up", below < h && above > below);
}
[...document.querySelectorAll(".tip")].forEach((tip, i) => {
  // tie each note to its title for screen readers (the note is hidden until hover or focus)
  const note = tip.querySelector(".desc"), title = tip.querySelector(".title");
  if (note && title) { note.id = "tip-" + i; title.setAttribute("aria-describedby", note.id); }
});
for (const tip of document.querySelectorAll(".tip")) {
  for (const ev of ["pointerenter", "pointermove", "focusin"]) tip.addEventListener(ev, () => placeTip(tip), { passive: true });
}

/* --- HUD ------------------------------------------------------------------- */
const hud = document.getElementById("hud-label");
const PHASES = [
  [0.25, "TRANS-LUNAR INJECTION"], [0.29, "LUNAR SLINGSHOT - GRAVITY ASSIST"], [0.325, "PAST MARS"],
  [0.35, "THE ASTEROID BELT"], [0.392, "JUPITER - GRAVITY ASSIST"], [0.46, "OVER SATURN'S RINGS"],
  [0.52, "THE ICE GIANTS - URANUS AND NEPTUNE"], [0.575, "THE KUIPER BELT"], [0.612, "THE HELIOPAUSE - VOYAGERS 1 AND 2"],
  [0.635, "THE OORT CLOUD - TO 1.6 LY"], [0.695, "LOCAL INTERSTELLAR CLOUD - 30 LY ACROSS"], [0.755, "THE LOCAL BUBBLE - 300 LY"],
  [0.815, "THE GREAT RIFT - 700 LY"], [0.87, "THE ORION-CYGNUS ARM"], [0.915, "KEPLER-452 - G2V - 1,800 LY"], [0.95, "ORBITING KEPLER-452b"],
  [F_ORBIT_END, "DE-ORBIT BURN - ENTRY INTERFACE"], [F_DESC_END, "DESCENT THROUGH THE ATMOSPHERE"], [0.996, "TOUCHDOWN - BASE ONE"],
];
let shipAlt = 0;   // ship altitude above Earth, in atmosphere thicknesses
function hudText(p) {
  if (p < 0.0027) return "ON THE PAD - LC-39A, KENNEDY SPACE CENTER";
  if (p < LIFTOFF) return "MAIN ENGINE START";
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
const _away = new THREE.Vector3(), _cd = new THREE.Vector3(), _swing = new THREE.Vector3(), _sw1 = new THREE.Vector3();
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

/* Keep the vehicle the centre of the frame: whatever the aim is biased toward
 * (a planet being passed, the horizon), the view direction is pulled back to
 * within `maxDeg` of the ship's visual centre. */
const _vc = new THREE.Vector3(), _ad = new THREE.Vector3(), _sd = new THREE.Vector3(), _cq = new THREE.Quaternion();
/* The point the camera keeps centred: the middle of the whole stack on the pad, sliding to the
 * orbiter's own middle as the boosters and tank fall away (by progress: switching on which model
 * happens to be showing jumped the target at the model swap). */
let curP = 0;
function shipCentre(out) { return out.copy(_zero3).lerp(ORB_MID, smooth(seg(curP, P.tankA - 0.02, P.tankA + 0.02))).applyMatrix4(vehicle.matrixWorld); }
const _zero3 = new THREE.Vector3();
function centreOnShip(look, maxDeg) {
  shipCentre(_vc);
  _ad.subVectors(look, camera.position); const len = _ad.length(); if (len < 1e-6) return;
  _ad.multiplyScalar(1 / len);
  _sd.subVectors(_vc, camera.position).normalize();
  const ang = Math.acos(clamp(_ad.dot(_sd), -1, 1)), max = THREE.MathUtils.degToRad(maxDeg);
  if (ang <= max) return;
  _cq.setFromUnitVectors(_sd, _ad);
  _cq.slerp(new THREE.Quaternion(), 1 - max / ang);          // rotate only max of the way from the ship
  look.copy(camera.position).addScaledVector(_sd.applyQuaternion(_cq), len);
}

/* Thrust, flame and the ignition flash, shared by the cruise and the finale. */
function engines(p, thrust) {
  const flick = 0.94 + 0.06 * Math.sin(elapsed * 21) + 0.03 * Math.sin(elapsed * 47.3);
  setPlumes(thrust, flick);
  escort.position.copy(vehicle.position).addScaledVector(tmp.set(0, 0, -1).applyQuaternion(vehicle.quaternion), 3.4);
  escort.intensity = 2.2 + 22 * Math.exp(-Math.pow((p - LIFTOFF - 0.002) / 0.004, 2)) + 5 * thrust;
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

/* Bodies being passed: the camera swings round the ship to the side away
 * from them, so the planet sits behind the ship in the frame while the ship
 * stays centred (aiming at the planet instead pushed the ship off-centre).
 * Never ahead of the ship: the forward part of the swing is dropped. Shared by
 * the cruise and the finale, so the hand-over between them has no seam.
 * Returns the total weight of the bodies in play (featPos is their centroid). */
const satW = (w) => Math.tanh(w * 1.3) / Math.tanh(1.3);   // smooth stand-in for min(w, 1): no kink in the camera's speed
function swingChase(p, shipPos, tan, camPos) {
  let totalW = 0; featPos.set(0, 0, 0); _swing.set(0, 0, 0);
  for (const f of FEATURES) {
    if (!f.pos) continue;
    const d = Math.abs(p - f.pAt); if (d >= f.w) continue;
    const wgt = f.strength * smooth(1 - d / f.w);
    featPos.addScaledVector(f.pos, wgt); totalW += wgt;
    // each body contributes its own "away" direction (blended by weight): taking the direction
    // away from the weighted centroid instead made the camera whip round when two bodies
    // overlapped (the centroid sweeps across the sky as one fades out and the next fades in)
    _sw1.subVectors(shipPos, f.pos).normalize(); _sw1.addScaledVector(tan, -Math.max(0, _sw1.dot(tan)));
    _swing.addScaledVector(_sw1, wgt);
  }
  if (totalW > 0) {
    featPos.multiplyScalar(1 / totalW);
    const k = satW(totalW) * 0.8;
    const al = _swing.length() / totalW;                      // ~0 if the bodies are dead astern or cancel out: no side to swing to
    _cd.subVectors(camPos, shipPos); const dist = _cd.length(); _cd.multiplyScalar(1 / dist);
    if (al > 1e-3) {
      const wk = k * smooth(clamp(al / 0.8, 0, 1));
      _cd.multiplyScalar(1 - wk).addScaledVector(_swing.multiplyScalar(1 / (al * totalW)), wk).normalize();
    }
    const fw = _cd.dot(tan); if (fw > -0.3) _cd.addScaledVector(tan, -0.3 - fw).normalize();
    camPos.copy(shipPos).addScaledVector(_cd, dist);
  }
  return totalW;
}
/* ...and a touch of aim toward them, within the centring limit applied later. */
function aimBias(look, shipPos, totalW, camPos = camera.position) {
  if (totalW <= 0) return;
  _bias.copy(featPos).sub(look).multiplyScalar(satW(totalW));
  const maxBias = camPos.distanceTo(shipPos) * 0.22;
  if (_bias.length() > maxBias) _bias.setLength(maxBias);
  look.add(_bias);
}

/* The Earth feature the camera glances back at must be where Earth is for THIS p. It was
 * being updated at the end of the frame, after the camera used it, so the camera lagged a
 * frame behind and its position depended on the path taken to reach a point. */
function syncEarthFeature(p) {
  earthAt(Math.min(p, 0.3));
  EARTH_FEATURE.pos.copy(earthC);
}
function updatePath(p) {
  if (!stackRoot) return;
  curP = p;
  syncEarthFeature(p);
  if (p >= FINALE_START && kepler) { finale(p); commonUpdates(p); return; }
  vehicle.scale.setScalar(1);
  const sp = shipP(clamp(p, 0, 1));
  path.getPoint(sp, pos);
  safeTangent(Math.max(sp, 1e-4), tangent);
  vehicle.position.copy(pos);
  orientShip(tangent);
  vehicle.updateMatrixWorld(true);

  /* Thrusters: cold on the pad; scrolling lights them. `ignite` snaps up over
   * the first 1.8% of scroll, `climb` holds the burn then eases to a cruise
   * glow, and a low-passed scroll speed makes the flame swell with the scroll.
   * The solids cut out at separation; the mains throttle back once the tank
   * goes. */
  const ignite = smooth(seg(p, 0.0027, 0.009));      // main engines at T-6.6 s, full thrust with the solids at T-0
  const climb = 1 - smooth(seg(p, 0.075, 0.3));
  const thrust = ignite * lerp(0.3, 1.25, climb) * (1 + 0.22 * Math.min(scrollVel * 9, 1));
  for (const q of plumes) q.live = q.kind === "srb" ? seg(p, LIFTOFF - 0.0006, LIFTOFF + 0.0004) * (1 - seg(p, P.boostA, P.boostA + 0.012)) : lerp(1, 0.3, seg(p, P.tankA, P.tankB));
  engines(p, thrust);
  // the stack's orbiter hands over to the standalone one by a crossfade, not a pop
  const sw = smooth(seg(p, P.tankB - 0.012, P.tankB + 0.008));
  fadeGroup(stackRoot, 1 - sw); fadeGroup(orbiterRoot, sw);

  /* Camera. Launch rig: starts low beside the pad looking up at the stack with
   * the tower behind it, then rises past the ship so that from the cloud deck
   * up it looks down on the vehicle with the ground and the curving horizon
   * beyond. Chase rig from p=0.13: behind/above/beside, aligned to the path.
   * At toChase == 1 the lerp is exactly the chase position: no snap. */
  const toChase = smooth(seg(p, 0.13, 0.26));
  rightOf(tangent, right);
  chaseFrom(p, pos, tangent, right, chasePos);
  const totalW = swingChase(p, pos, tangent, chasePos);
  // Low beside the pad, then rising with the stack (a little below it at
  // first so it climbs up the frame), ending a few units above it looking down.
  const rise = smooth(seg(p, 0.008, 0.05));
  const over = smooth(seg(p, 0.04, 0.1));
  // and pulling back as it goes, so the exhaust column and the ground cloud stay in the shot
  const pull = 1 + 1.0 * smooth(seg(p, 0.01, 0.055)) - 0.4 * smooth(seg(p, 0.07, 0.13));
  _launch.set(pos.x + 14 * pull, lerp(Y_G + 7.2, pos.y - 3 * pull + 9 * over, rise), pos.z + 17 * pull);
  camera.position.copy(_launch).lerp(chasePos, toChase);
  lookAt.copy(pos).addScaledVector(tangent, 6 * toChase);
  aimBias(lookAt, pos, totalW);
  // During the climb, keep the horizon in the frame below the ship.
  lookAt.y -= 3.5 * smooth(seg(p, 0.06, 0.11)) * (1 - toChase);
  centreOnShip(lookAt, 2.5);
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
const _du = new THREE.Vector3(), _arcT = new THREE.Vector3(), _arcP = new THREE.Vector3(), _arcU = new THREE.Vector3(), _camUp = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qd = new THREE.Quaternion();
const _camC = new THREE.Vector3(), _lookC = new THREE.Vector3(), _landT = new THREE.Vector3();
/* The cruise's attitude reference, so the finale can blend away from it (see shipQuat). */
function defaultUp(fwd, out) {
  const vert = clamp((Math.abs(fwd.y) - 0.72) / 0.2, 0, 1);
  return out.set(0, 1, 0).lerp(ALT_UP, vert).normalize();
}
/* Everything in the finale hands over to the next phase by blending, never by
 * switching: the cruise's camera, attitude and thrust into the orbit's; the
 * orbit's into the descent arc's; the arc's into the landing's. (They were
 * separate branches, and each seam was a single-frame snap: the camera rolling
 * 59 degrees onto the orbit, the ship turning 47 degrees onto the glide slope.) */
function finale(p) {
  fadeGroup(stackRoot, 0); fadeGroup(orbiterRoot, 1);
  for (const q of plumes) q.live = q.kind === "srb" ? 0 : 0.3;
  let thrust = 0, kIn = smooth(seg(p, FINALE_START, FINALE_START + 0.012));
  thrust = 0.3 * (1 - seg(p, FINALE_START, FINALE_START + 0.008));      // the cruise glow dies away as the orbit is entered
  if (p < F_ORBIT_END) {
    // one full orbit, at constant speed, engines off
    // the angular rate starts at the cruise's own speed and eases up to a
    // steady one, so the ship does not leap forward as it enters the orbit
    const x = p - FINALE_START, L = F_ORBIT_END - FINALE_START, xr = 0.009;
    const w0 = KF.v0 / KEP_ORBIT, w1 = (Math.PI * 2 - w0 * xr / 2) / (L - xr / 2);
    const th = w0 * x + (w1 - w0) * (x < xr ? x * x / (2 * xr) : x - xr / 2);
    orbitPoint(th, KEP_ORBIT, pos, tangent);
    _fu.copy(pos).sub(KF.K).normalize();
  } else if (p < F_DESC_END) {
    // de-orbit: a descending arc, the mains burning harder
    const s = seg(p, F_ORBIT_END, F_DESC_END);
    // angle along the arc as a Hermite curve: it leaves the orbit at the orbit's
    // own rate and slows toward the landing's, instead of changing speed at the seam
    const w0 = KF.v0 / KEP_ORBIT, L = F_ORBIT_END - FINALE_START, xr = 0.009;
    const w1 = (Math.PI * 2 - w0 * xr / 2) / (L - xr / 2);
    const m0 = w1 * (F_DESC_END - F_ORBIT_END), m1 = 0.6;
    const th = Math.PI * 2 + (s * s * s - 2 * s * s + s) * m0 + (-2 * s * s * s + 3 * s * s) * DESC_ANGLE + (s * s * s - s * s) * m1;
    const rho = lerp(KEP_ORBIT, KEP_R0 + 5, smooth(s));
    orbitPoint(th, rho, pos, tangent);
    _fu.copy(pos).sub(KF.K).normalize();
    tangent.addScaledVector(_fu, -0.6 * (KEP_ORBIT - KEP_R0 - 5) / KEP_ORBIT * Math.sin(Math.PI * s)).normalize();
    thrust = 0.34 * smooth(seg(s, 0, 0.15)) + 0.7 * Math.sin(Math.PI * s);
  } else {
    // landing: the planet grows around the fixed landing point B
    const s = seg(p, F_DESC_END, 1);
    const e = 1 - Math.pow(1 - s, 2.2);
    const h = lerp(KF.h0, 0.06, e), d = lerp(KF.d0, 0, 1 - Math.pow(1 - s, 1.6));   // belly is ~0.08 above the vehicle origin
    pos.copy(KF.B).addScaledVector(KF.nB, h).addScaledVector(KF.fwd, -d);
    // nose along the approach with a glide slope that flattens into a flare...
    const glide = lerp(0.32, -0.12, smooth(seg(s, 0.4, 0.86))) + 0.12 * smooth(seg(s, 0.88, 1));
    _landT.copy(KF.fwd).multiplyScalar(Math.cos(glide)).addScaledVector(KF.nB, -Math.sin(glide)).normalize();
    // ...turned onto it from the heading the descent arc ended on, not snapped
    orbitPoint(Math.PI * 2 + DESC_ANGLE, KEP_R0 + 5, _arcP, _arcT);
    _arcU.copy(_arcP).sub(KF.K).normalize();
    const kL = smooth(seg(s, 0, 0.5));
    tangent.copy(_arcT).lerp(_landT, kL).normalize();
    _fu.copy(_arcU).lerp(KF.nB, kL).normalize();
    thrust = lerp(0.34, 0.14, s) + 0.45 * Math.sin(Math.PI * clamp(s * 1.6, 0, 1));
  }
  vehicle.position.copy(pos); vehicle.scale.setScalar(1);
  // attitude: the cruise's and the planet-relative one, blended as rotations
  // (blending the up vectors passes through nothing when they oppose)
  shipQuat(tangent, null, _qa);
  shipQuat(tangent, _fu, _qb);
  vehicle.quaternion.slerpQuaternions(_qa, _qb, kIn);
  vehicle.updateMatrixWorld(true);
  engines(p, thrust);

  // Camera: the cruise chase (exactly as the cruise computes it) blended into
  // an orbit chase in the planet's radial frame, then into a low three-quarter
  // view of the base for touchdown.
  rightOf(tangent, right);
  chaseFrom(p, pos, tangent, right, _camC);
  const wC = swingChase(p, pos, tangent, _camC);
  _lookC.copy(pos).addScaledVector(tangent, 6);
  aimBias(_lookC, pos, wC, _camC);
  _fr.crossVectors(tangent, _fu).normalize();
  // high over the ship, looking down past it onto the planet: Kepler-452b fills
  // the frame behind a centred ship
  const orbitCam = tmp.copy(pos).addScaledVector(tangent, -11).addScaledVector(_fu, 17).addScaledVector(_fr, -5);
  camera.position.copy(_camC).lerp(orbitCam, kIn);
  const s = seg(p, F_DESC_END, 1), kD = smooth(seg(s, 0, 0.45));
  lookAt.copy(pos).addScaledVector(tangent, 5);
  _bias.copy(KF.K).sub(lookAt).multiplyScalar(0.18 * (1 - kD));
  lookAt.add(_bias);
  lookAt.copy(_lookC).lerp(lookAt, kIn);
  if (p >= F_DESC_END) {
    const hNow = pos.clone().sub(KF.B).dot(KF.nB), dNow = -pos.clone().sub(KF.B).dot(KF.fwd);
    const landCam = _fl.copy(KF.B).addScaledVector(KF.fwd, -(dNow + 11) * (1 - s * 0.6) - 3 * s).addScaledVector(KF.nB, hNow + 3.5 + 1.5 * (1 - s)).addScaledVector(KF.side, 6 + 6 * s);
    camera.position.lerp(landCam, kD);
  }
  centreOnShip(lookAt, p >= F_DESC_END ? lerp(2.5, 9, seg(p, 0.993, 1)) : 2.5);
  // the camera's roll likewise: its orientation with the cruise's up and with the planet's, slerped
  // (in orbit the camera looks steeply down along the planet's "up", where that is a degenerate roll
  // reference: lean it toward the flight direction, so the ship's heading stays up the screen)
  _camUp.copy(_fu).addScaledVector(tangent, 1.4 * (1 - kD)).normalize();
  safeLookAt(lookAt, UP); _qc.copy(camera.quaternion);
  safeLookAt(lookAt, _camUp);
  _qd.copy(camera.quaternion);                          // (a separate buffer: slerpQuaternions overwrites its own output first)
  camera.quaternion.slerpQuaternions(_qc, _qd, kIn);
  camera.up.copy(_camUp);
}

/* Everything that depends on p but not on which branch moved the ship. */
function commonUpdates(p) {
  // Earth
  earthAt(Math.min(p, 0.3));
  if (earthGroup) {
    earthGroup.position.copy(earthC); earthGroup.scale.setScalar(earthR);
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
    kepR = p >= F_DESC_END ? Math.exp(lerp(Math.log(KEP_R0), Math.log(KEP_R_LAND), Math.pow(seg(p, F_DESC_END, 1), 1.1))) : KEP_R0;
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
    if (beacon) beacon.visible = Math.sin(elapsed * 4.2) > 0.2;
    updateBaseDust(p);
  }
  // daylight: how deep in Earth's atmosphere the camera is
  const camAlt = (camera.position.distanceTo(earthC) - earthR) / (ATM_T * earthR);
  const kepAlt = kepler ? (camera.position.distanceTo(kepler.C) - kepler.R) / (0.032 * kepler.R) : 9;
  const day = Math.max(earthGroup && earthGroup.visible ? 1 - smooth(seg(camAlt, 0.1, 1.0)) : 0, kepler && kepler.group.visible ? 1 - smooth(seg(kepAlt, 0.1, 1.0)) : 0);
  hemi.intensity = 0.7 * day;
  fill.intensity = 0.9 * (1 - day) * smooth(seg(p, 0.1, 0.16));
  fill.position.copy(camera.position); fill.target.position.copy(vehicle.position);
  if (starSphere) {
    starSphere.material.uniforms.uColor.value.setScalar(1 - 0.92 * day); skyStars.material.uniforms.uOpacity.value = 1 - 0.95 * day;
    // the galaxies: invisible to the eye from anywhere near the Sun (even Andromeda is a smudge), they come up only as the voyage leaves the solar system
    const gk = (1 - day) * smooth(seg(p, 0.52, 0.72));
    for (const q of deepSky) { q.material.opacity = gk; q.visible = gk > 0.01; }
  }
  ambient.intensity = 0.18 + 0.3 * (1 - day);
  // launch site
  const groundOn = p < 0.11;
  if (gantry) gantry.visible = groundOn;
  if (crawler) crawler.visible = groundOn;
  if (padProps) padProps.visible = groundOn;
  scene.fog.density = groundOn ? 0.0032 * (1 - smooth(seg(p, 0.06, 0.11))) : 0;
  if (kscGroup) {
    kscGroup.visible = groundOn;
    // sit on the curved ground: the planet falls away from the pad as it shrinks
    kscGroup.position.y = Y_G - (140 * 140) / (2 * earthR);
    countdown.visible = groundOn;
    if (groundOn) countdown.userData.setTime(missionTime(p));
  }
  if (smoke) updateLaunchFx(p);
  // bodies
  updateBodies(p);
  if (starGlow && bodies.star) {
    /* Kepler-452 is a point of light for most of the interstellar leg - its
     * disc and glow are held to a fixed small angular size - and only takes on
     * its real size as the ship arrives in its system. */
    const w = VIS.star, v = Math.min(seg(p, w[0], w[1]), 1 - seg(p, w[2], w[3]));
    const st = bodies.star, d = camera.position.distanceTo(st.pos);
    const s = lerp(Math.min(1, 0.007 * d / 42), 1, smooth(seg(p, 0.86, 0.93)));
    st.group.visible = v > 0.01; st.group.scale.setScalar(s);
    st.mat.uniforms.uOpacity.value = v;
    starGlow.mesh.visible = v > 0.01; starGlow.mesh.material.uniforms.uOpacity.value = v;
    starGlow.set(0, st.pos.x, st.pos.y, st.pos.z, 42 * 9 * s, 0, 1.0, 0.93, 0.78, 0.85);
    starGlow.set(1, st.pos.x, st.pos.y, st.pos.z, 42 * 3.2 * s, 0, 1.0, 0.97, 0.9, 1.0);
    starGlow.upload();
  }
  // fields: their chapter window, then distance (see addField)
  for (const f of fields) {
    const win = Math.min(seg(p, f.vis[0], f.vis[0] + 0.05), 1 - seg(p, f.vis[1] - 0.04, f.vis[1]));
    let v = win, far = 0;
    if (f.center) {
      far = smooth(seg(camera.position.distanceTo(f.center), f.dFull, f.dGhost));   // 0 inside .. 1 far off
      v = win * lerp(1, 0.12, far);
    }
    f.obj.visible = v > 0.01;
    if (f.obj.visible) for (const mm of f.mats) { if (mm.m.uniforms) mm.m.uniforms.uOpacity.value = mm.op0 * v; else mm.m.opacity = mm.op0 * v; }
    if (f.imp) {
      const iv = win * far;
      f.imp.mesh.visible = iv > 0.01; f.imp.mesh.material.uniforms.uOpacity.value = iv;
    }
  }
  if (localStars) { localStars.material.uniforms.uOpacity.value = 0.6 * (1 - day) * (1 - seg(p, 0.985, 1)); localStars.visible = localStars.material.uniforms.uOpacity.value > 0.01; }
  updateExtras(p);
  updateDebris(p);
  updateHud(p);
}

/* --- Render loop ----------------------------------------------------------- */
const clock = new THREE.Clock();
let elapsed = 0, snapped = false;
function renderFrame() { composer.render(); }
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  const y = window.scrollY;
  // window.__pin: dev override that drives the scene from a fixed timeline point.
  rawProgress = window.__pin != null ? clamp(window.__pin, 0, 1) : scrollToT(y);
  if (!snapped && stackRoot) { progress = rawProgress; snapped = true; }   // first frame: be where the page is, don't fly there
  const prev = progress;
  progress += (rawProgress - progress) * (1 - Math.exp(-9 * dt));
  if (Math.abs(rawProgress - progress) < 1e-5) progress = rawProgress;
  scrollVel += (Math.abs(progress - prev) / Math.max(dt, 1e-4) - scrollVel) * (1 - Math.exp(-7 * dt));
  updatePath(progress);
  updatePanels(y);
  if (starSphere) starSphere.position.copy(camera.position);
  skyDome.position.copy(camera.position);
  for (const k in bodies) if (bodies[k].spin) bodies[k].mesh.rotation.y = elapsed * bodies[k].spin;
  if (earthCloudMat) { earthCloudMat.uniforms.uTime.value = elapsed; earthSurfMat.uniforms.uTime.value = elapsed; }
  if (kepler) kepler.cloudMat.uniforms.uTime.value = elapsed;
  if (bodies.star) bodies.star.mat.uniforms.uTime.value = elapsed;
  renderFrame();
  adaptResolution(dt);
}
applySize();
tick();
window.addEventListener("resize", onResize);

/* --- Dev hooks ------------------------------------------------------------- */
window.__three = { renderer, scene, camera, composer, bloom, vehicle, plumes, fields, bodies, debris, extras, get ares() { return ares; },
  get kepler() { return kepler; }, get earth() { return { group: earthGroup, R: earthR, C: earthC, surf: earthSurfMat, clouds: earthCloudMat }; }, KF };
window.__renderAt = (p) => {
  progress = clamp(p, 0, 1); updatePath(progress); renderFrame();
  const ndc = vehicle.position.clone().project(camera);
  return { p: progress, hud: hud.textContent, onScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1,
    finite: [vehicle.position.x, vehicle.position.y, vehicle.position.z, camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite),
    shipNDC: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)], earthR: +earthR.toFixed(1), shipAlt: +shipAlt.toFixed(2), kepR: +kepR.toFixed(1) };
};
