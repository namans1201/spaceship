/* ----------------------------------------------------------------------------
 * Scroll-driven Space Shuttle — flight path edition
 *
 * Independent re-implementation of the scroll-controlled 3D shuttle demo by
 * Steve Gardner (ste-vg): https://codepen.io/ste-vg/pen/GRooLza
 *
 * CHANGES FROM THE ORIGINAL:
 *  1. The model is the user-supplied asset "Space Shuttle (1).glb"
 *     (loaded, auto-centered and auto-scaled at runtime).
 *  2. The camera no longer orbits a static model — the shuttle flies along a
 *     scroll-driven PATH: departure -> nebula -> galaxy -> landing on the
 *     exoplanet Kepler-452b.
 *
 * Stack: Three.js (WebGL) + GSAP ScrollTrigger.
 * -------------------------------------------------------------------------- */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { gsap } from "https://unpkg.com/gsap@3.12.5/index.js";
import { ScrollTrigger } from "https://unpkg.com/gsap@3.12.5/ScrollTrigger.js";

gsap.registerPlugin(ScrollTrigger);

const MODEL_URL = encodeURI("Space Shuttle (1).glb");

/* --- Small math helpers --------------------------------------------------- */
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t); // smoothstep
// Remap p from [a,b] -> [0,1], clamped.
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);

/* --- Renderer / scene / camera ------------------------------------------- */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05070f, 0.0035);

const camera = new THREE.PerspectiveCamera(
  50, window.innerWidth / window.innerHeight, 0.1, 2000
);

/* --- The flight path ------------------------------------------------------ *
 * Everything lives along -Z. The shuttle flies from z=0 deep into the scene;
 * the camera chases it. Region centres are placed along the route. */
const PATH = {
  startZ: 0,
  endZ: -560,            // shuttle's final resting z (just above the planet)
  nebulaZ: -150,
  galaxyZ: -340,
  planet: { center: new THREE.Vector3(0, -60, -600), radius: 55 },
};

/* --- Lighting ------------------------------------------------------------- */
scene.add(new THREE.AmbientLight(0x5566aa, 0.7));

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(6, 8, 6);
scene.add(key);

const rim = new THREE.DirectionalLight(0x5fd0ff, 1.4);
rim.position.set(-6, 2, -4);
scene.add(rim);

// Light that travels with the shuttle so it stays lit inside the nebula.
const escort = new THREE.PointLight(0xbfd4ff, 2.0, 120);
scene.add(escort);

/* --- Starfield ------------------------------------------------------------ */
function makeStars(count, spread, depth, size, color) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996323; // golden angle — deterministic spread
    const r = (i % 97) / 97;
    pos[i * 3] = (Math.cos(a) * (0.3 + r)) * spread;
    pos[i * 3 + 1] = (Math.sin(a * 1.7) * (0.3 + r)) * spread;
    pos[i * 3 + 2] = -((i / count) * depth);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.85, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return pts;
}
makeStars(2500, 220, 1400, 0.7, 0xaecbff);
makeStars(1200, 120, 900, 0.45, 0xffffff);

/* --- Nebula: drifting clouds of additive points --------------------------- */
const nebula = new THREE.Group();
nebula.position.z = PATH.nebulaZ;
scene.add(nebula);

function makeCloud(color, center, spread, count, size) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 1.61803;
    const b = i * 2.39996;
    const r = Math.pow((i % 113) / 113, 0.6);
    pos[i * 3]     = center.x + Math.cos(a) * r * spread;
    pos[i * 3 + 1] = center.y + Math.sin(b) * r * spread * 0.7;
    pos[i * 3 + 2] = center.z + Math.cos(b * 1.3) * r * spread;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  nebula.add(new THREE.Points(geo, mat));
}
makeCloud(0xff4f9d, new THREE.Vector3(-14, 6, 0),  34, 1400, 2.2); // magenta
makeCloud(0x7a5cff, new THREE.Vector3(12, -4, -20), 40, 1600, 2.6); // violet
makeCloud(0x21d4ff, new THREE.Vector3(2, 10, -45),  36, 1500, 2.0); // cyan
makeCloud(0xff9b5c, new THREE.Vector3(-6, -10, -70), 30, 1100, 2.4); // amber

/* --- Galaxy: tilted spiral of points -------------------------------------- */
const galaxy = new THREE.Group();
galaxy.position.z = PATH.galaxyZ;
galaxy.rotation.x = -0.9;
galaxy.rotation.z = 0.3;
scene.add(galaxy);

(function buildGalaxy() {
  const count = 9000;
  const arms = 4;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const core = new THREE.Color(0xfff2cf);
  const edge = new THREE.Color(0x4a6bff);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const radius = Math.pow(t, 0.6) * 130;
    const arm = (i % arms) / arms;
    const angle = radius * 0.05 + arm * Math.PI * 2;
    const scatter = (((i * 9301 + 49297) % 233280) / 233280 - 0.5);
    const spread = (1 - t) * 6 + 2;
    pos[i * 3]     = Math.cos(angle) * radius + scatter * spread * 4;
    pos[i * 3 + 1] = scatter * spread * (1 - t) * 3;
    pos[i * 3 + 2] = Math.sin(angle) * radius + ((i % 7) - 3) * spread;
    const c = core.clone().lerp(edge, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.4, vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  galaxy.add(new THREE.Points(geo, mat));
})();

/* --- Kepler-452b: an earth-like super-Earth -------------------------------- */
const planetGroup = new THREE.Group();
planetGroup.position.copy(PATH.planet.center);
scene.add(planetGroup);

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(PATH.planet.radius, 96, 96),
  new THREE.MeshStandardMaterial({
    color: 0x3f7d6e, roughness: 0.95, metalness: 0.0,
    emissive: 0x09241f, emissiveIntensity: 0.6,
  })
);
planetGroup.add(planet);

// Cloud shell.
const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(PATH.planet.radius * 1.015, 64, 64),
  new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 1 })
);
planetGroup.add(clouds);

// Atmosphere rim (backside-rendered glow).
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(PATH.planet.radius * 1.12, 64, 64),
  new THREE.MeshBasicMaterial({
    color: 0x6fc0ff, transparent: true, opacity: 0.18,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  })
);
planetGroup.add(atmosphere);

// A sun lighting the planet from the side.
const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
sun.position.set(120, 60, -480);
scene.add(sun);

/* --- Load the model ------------------------------------------------------- */
const loaderEl = document.getElementById("loader");
const fillEl = document.getElementById("loader-fill");
const pctEl = document.getElementById("loader-pct");

const manager = new THREE.LoadingManager();
manager.onProgress = (_u, loaded, total) => {
  const pct = total ? Math.round((loaded / total) * 100) : 0;
  fillEl.style.width = pct + "%";
  pctEl.textContent = pct;
};

let shuttle = null; // outer group: handles path position + flight attitude

console.log("[dbg] starting load", MODEL_URL);
new GLTFLoader(manager).load(
  MODEL_URL,
  (gltf) => {
    console.log("[dbg] onLoad fired");
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.position.sub(center);
    model.scale.setScalar(3.0 / maxDim);
    // The stack stands nose-up (+Y). Rotate so the nose points along -Z (forward).
    model.rotation.x = Math.PI / 2;

    shuttle = new THREE.Group();
    shuttle.add(model);
    scene.add(shuttle);

    try { updatePath(0); } catch (e) { console.error("[dbg] updatePath(0) threw", e); }
    console.log("[dbg] calling finishLoading");
    finishLoading();
  },
  (xhr) => console.log("[dbg] progress", xhr.loaded, xhr.total),
  (err) => {
    console.error("Failed to load model:", err);
    pctEl.parentElement.textContent = "Could not load model — serve over http (see README).";
  }
);

function finishLoading() {
  // CSS handles the fade via the .is-hidden class (transition on .loader).
  loaderEl.classList.add("is-hidden");
}

/* --- Scroll progress ------------------------------------------------------ */
let progress = 0;
ScrollTrigger.create({
  trigger: ".content",
  start: "top top",
  end: "bottom bottom",
  scrub: 1,
  onUpdate: (self) => { progress = self.progress; },
});

// Reveal text panels as they enter view.
gsap.utils.toArray(".panel").forEach((panel) => {
  gsap.from(panel.children, {
    y: 40, opacity: 0, duration: 0.9, stagger: 0.08, ease: "power3.out",
    scrollTrigger: { trigger: panel, start: "top 70%" },
  });
});

/* --- HUD destination label ------------------------------------------------ */
const hud = document.getElementById("hud-label");
const PHASES = [
  [0.00, "DEPARTURE — LOW EARTH ORBIT"],
  [0.20, "TRANSIT — EMISSION NEBULA"],
  [0.45, "CROSSING — GALACTIC DISC"],
  [0.70, "APPROACH — KEPLER-452b"],
  [0.90, "FINAL DESCENT — TOUCHDOWN"],
];
function updateHud(p) {
  let label = PHASES[0][1];
  for (const [at, text] of PHASES) if (p >= at) label = text;
  if (hud && hud.textContent !== label) hud.textContent = label;
}

/* --- Path evaluation ------------------------------------------------------ *
 * Given scroll progress p in [0,1], place the shuttle along the route and put
 * the camera behind it. The last ~15% is the landing: the shuttle pitches up,
 * slows, and settles above the planet while the camera swings to a side view. */
const camTarget = new THREE.Vector3();
const tmp = new THREE.Vector3();

function updatePath(p) {
  if (!shuttle) return;

  const land = seg(p, 0.85, 1.0);          // 0 -> 1 across the landing
  const fly = 1 - land;

  // Forward travel eases to a stop as we land.
  const zT = smooth(clamp(p / 0.85, 0, 1));
  const z = lerp(PATH.startZ, PATH.endZ, zT);

  // Weaving flight; damped to zero during the landing.
  const x = Math.sin(p * Math.PI * 3.0) * 9 * fly;
  const y = Math.cos(p * Math.PI * 2.3) * 5 * fly + lerp(0, -4, land);

  shuttle.position.set(x, y, z);

  // Attitude: bank into the weave while flying, then pitch nose-up to land.
  const bank = Math.cos(p * Math.PI * 3.0) * 0.5 * fly;
  const pitchFlight = Math.sin(p * Math.PI * 2.3) * 0.18 * fly;
  const pitchLand = land * 0.9;            // nose-up flare
  shuttle.rotation.set(pitchFlight + pitchLand, lerp(0, -0.25, land), bank);

  escort.position.set(x, y + 3, z + 6);

  // Camera: chase from behind/above, then swing to a three-quarter side view
  // so we watch the shuttle settle against the planet.
  const chase = new THREE.Vector3(x, y + 3.2, z + 13);
  const sideView = new THREE.Vector3(
    PATH.planet.center.x + 26,
    PATH.planet.center.y + PATH.planet.radius + 20,
    z + 30
  );
  camera.position.copy(chase).lerp(sideView, smooth(land));

  // Look target blends from "ahead of the shuttle" to "the shuttle itself".
  const ahead = tmp.set(x, y, z - 30);
  camTarget.copy(ahead).lerp(shuttle.position, smooth(land));
  camera.lookAt(camTarget);

  updateHud(p);
}

/* --- Render loop ---------------------------------------------------------- */
const clock = new THREE.Clock();
function tick() {
  const t = clock.getElapsedTime();
  updatePath(progress);

  // Ambient life in the environments.
  nebula.children.forEach((c, i) => { c.rotation.z = t * 0.02 * (i % 2 ? 1 : -1); });
  galaxy.rotation.y = t * 0.04;
  planet.rotation.y = t * 0.02;
  clouds.rotation.y = t * 0.028;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

/* --- Resize --------------------------------------------------------------- */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  ScrollTrigger.refresh();
});
