/* ----------------------------------------------------------------------------
 * Scroll-driven Space Shuttle — launch + interstellar voyage
 *
 * Independent re-implementation of the scroll-controlled 3D shuttle demo by
 * Steve Gardner (ste-vg): https://codepen.io/ste-vg/pen/GRooLza
 *
 * The whole experience is one scroll-driven flight path:
 *   IGNITION -> ASCENT -> BOOSTER SEPARATION -> TANK JETTISON (model swap)
 *   -> LEAVE EARTH -> NEBULA -> GALAXY -> APPROACH -> LAND on Kepler-452b
 *
 * MODELS (user-supplied):
 *   "Space Shuttle (1).glb"      — full launch stack. Its meshes are split by
 *                                   MATERIAL into orbiter vs tank/boosters; the
 *                                   non-orbiter parts are jettisoned in code.
 *   "Space Shuttle Orbiter.glb"  — orbiter only. Scaled to overlay the stack's
 *                                   orbiter portion, revealed at jettison, then
 *                                   flies the rest of the voyage.
 *
 * Neither GLB has baked animation — liftoff, separation, the swap and the path
 * are all animated procedurally with Three.js transforms.
 * -------------------------------------------------------------------------- */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const STACK_URL = encodeURI("Space Shuttle (1).glb");
const ORBITER_URL = encodeURI("Space Shuttle Orbiter.glb");
// Materials that belong to the orbiter (shared by both GLBs). Everything else
// in the full stack is tank + boosters and gets jettisoned.
const ORBITER_MATS = new Set(["mat5", "mat14", "mat21", "mat23"]);

/* --- Math helpers --------------------------------------------------------- */
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);

/* --- Phase boundaries (scroll progress 0..1) ------------------------------ */
const P = {
  ascentEnd: 0.12,   // full stack climbs
  boostA: 0.12, boostB: 0.18,   // booster separation window
  tankA: 0.18, tankB: 0.26,     // external tank jettison window (swap at end)
  departEnd: 0.40,   // orbiter pulls away from Earth
  landA: 0.88, landB: 1.0,
};

/* --- Renderer / scene / camera ------------------------------------------- */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05070f, 0.0028);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 3000);

/* --- Flight path layout (along -Z) ---------------------------------------- */
const PATH = {
  startZ: 30,
  endZ: -560,
  earth: { center: new THREE.Vector3(0, -52, 46), radius: 44 },
  nebulaZ: -235,
  galaxyZ: -370,
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

const escort = new THREE.PointLight(0xbfd4ff, 2.0, 140);
scene.add(escort);

// Sun for the destination planet.
const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
sun.position.set(120, 60, -480);
scene.add(sun);

// Sun lighting Earth at the start.
const earthSun = new THREE.DirectionalLight(0xfff0d8, 2.2);
earthSun.position.set(80, 30, 160);
scene.add(earthSun);

/* --- Starfield ------------------------------------------------------------ */
function makeStars(count, spread, depth, size, color) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996323;
    const r = (i % 97) / 97;
    pos[i * 3] = Math.cos(a) * (0.3 + r) * spread;
    pos[i * 3 + 1] = Math.sin(a * 1.7) * (0.3 + r) * spread;
    pos[i * 3 + 2] = 60 - ((i / count) * depth);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.85, depthWrite: false });
  scene.add(new THREE.Points(geo, mat));
}
makeStars(2600, 240, 1500, 0.7, 0xaecbff);
makeStars(1300, 130, 1000, 0.45, 0xffffff);

/* --- A textured-looking planet (used for Earth and Kepler-452b) ----------- */
function makePlanet({ center, radius, color, emissive, atmo }) {
  const g = new THREE.Group();
  g.position.copy(center);
  g.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 96),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, emissive, emissiveIntensity: 0.55 })
  ));
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.015, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 1 })
  );
  g.add(clouds);
  g.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.13, 64, 64),
    new THREE.MeshBasicMaterial({ color: atmo, transparent: true, opacity: 0.18, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })
  ));
  scene.add(g);
  return { group: g, clouds };
}

const earth = makePlanet({ center: PATH.earth.center, radius: PATH.earth.radius, color: 0x2a5a9e, emissive: 0x0a1830, atmo: 0x6fb0ff });
const kepler = makePlanet({ center: PATH.planet.center, radius: PATH.planet.radius, color: 0x3f7d6e, emissive: 0x09241f, atmo: 0x6fc0ff });

/* --- Nebula --------------------------------------------------------------- */
const nebula = new THREE.Group();
nebula.position.z = PATH.nebulaZ;
scene.add(nebula);
function makeCloud(color, c, spread, count, size) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 1.61803, b = i * 2.39996;
    const r = Math.pow((i % 113) / 113, 0.6);
    pos[i * 3] = c.x + Math.cos(a) * r * spread;
    pos[i * 3 + 1] = c.y + Math.sin(b) * r * spread * 0.7;
    pos[i * 3 + 2] = c.z + Math.cos(b * 1.3) * r * spread;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  nebula.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color, size, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
  })));
}
makeCloud(0xff4f9d, new THREE.Vector3(-14, 6, 0), 34, 1400, 2.2);
makeCloud(0x7a5cff, new THREE.Vector3(12, -4, -20), 40, 1600, 2.6);
makeCloud(0x21d4ff, new THREE.Vector3(2, 10, -45), 36, 1500, 2.0);
makeCloud(0xff9b5c, new THREE.Vector3(-6, -10, -70), 30, 1100, 2.4);

/* --- Galaxy --------------------------------------------------------------- */
const galaxy = new THREE.Group();
galaxy.position.z = PATH.galaxyZ;
galaxy.rotation.set(-0.9, 0, 0.3);
scene.add(galaxy);
(function buildGalaxy() {
  const count = 9000, arms = 4;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const core = new THREE.Color(0xfff2cf), edge = new THREE.Color(0x4a6bff);
  for (let i = 0; i < count; i++) {
    const t = i / count, radius = Math.pow(t, 0.6) * 130;
    const angle = radius * 0.05 + ((i % arms) / arms) * Math.PI * 2;
    const sc = (((i * 9301 + 49297) % 233280) / 233280 - 0.5), spread = (1 - t) * 6 + 2;
    pos[i * 3] = Math.cos(angle) * radius + sc * spread * 4;
    pos[i * 3 + 1] = sc * spread * (1 - t) * 3;
    pos[i * 3 + 2] = Math.sin(angle) * radius + ((i % 7) - 3) * spread;
    const c = core.clone().lerp(edge, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  galaxy.add(new THREE.Points(geo, new THREE.PointsMaterial({
    size: 1.4, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  })));
})();

/* --- Vehicle: full stack + orbiter, both loaded up front ------------------ */
const loaderEl = document.getElementById("loader");
const fillEl = document.getElementById("loader-fill");
const pctEl = document.getElementById("loader-pct");
const manager = new THREE.LoadingManager();
manager.onProgress = (_u, loaded, total) => {
  const pct = total ? Math.round((loaded / total) * 100) : 0;
  fillEl.style.width = pct + "%";
  pctEl.textContent = pct;
};

const TARGET = 3.4;        // world-space height of the full stack
const vehicle = new THREE.Group();   // flies the whole path
scene.add(vehicle);

let stackRoot = null;      // full stack scene (visible during launch)
let orbiterRoot = null;    // orbiter-only scene (visible after jettison)
const discards = [];       // {mesh, basePos, baseRot, dir, spin, booster}
let sepDist = 3;           // jettison travel distance (asset-local units)

function load(url) {
  return new Promise((res, rej) => new GLTFLoader(manager).load(url, res, undefined, rej));
}

Promise.all([load(STACK_URL), load(ORBITER_URL)])
  .then(([stackGltf, orbiterGltf]) => { setupVehicle(stackGltf.scene, orbiterGltf.scene); finishLoading(); })
  .catch((err) => {
    console.error("Failed to load models:", err);
    pctEl.parentElement.textContent = "Could not load models — serve over http (see README).";
  });

function setupVehicle(stack, orbiter) {
  // Local size of the raw stack (before transforms) -> jettison distance.
  const localBox = new THREE.Box3().setFromObject(stack);
  const localSize = localBox.getSize(new THREE.Vector3());
  sepDist = Math.max(localSize.x, localSize.y, localSize.z) * 1.25;

  // Normalise the stack: nose along -Z, centred at the vehicle origin.
  stack.rotation.x = Math.PI / 2;               // stand-up (+Y) -> forward (-Z)
  const box = new THREE.Box3().setFromObject(stack);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = TARGET / Math.max(size.x, size.y, size.z);
  stack.scale.setScalar(scale);
  stack.position.sub(center.multiplyScalar(scale));
  stackRoot = stack;
  vehicle.add(stackRoot);

  // Classify meshes by material: orbiter vs tank/boosters.
  const orbiterParts = [];
  stack.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const isOrbiter = mats.some((m) => ORBITER_MATS.has(m && m.name));
    if (isOrbiter) { orbiterParts.push(o); return; }
    discards.push(o); // tank or booster
  });

  // Side parts (boosters) vs central part (tank), by local X of geometry.
  let maxAbsX = 0;
  discards.forEach((m) => {
    m.geometry.computeBoundingBox();
    const c = m.geometry.boundingBox.getCenter(new THREE.Vector3());
    m.userData.cx = c.x; m.userData.cz = c.z;
    maxAbsX = Math.max(maxAbsX, Math.abs(c.x));
  });
  const xThresh = maxAbsX * 0.35;
  discards.forEach((m, i) => {
    const booster = Math.abs(m.userData.cx) > xThresh;
    // Jettison direction in asset-local space (+Y = forward/nose, so -Y = aft).
    const dir = new THREE.Vector3(
      booster ? Math.sign(m.userData.cx || 1) * 1.3 : 0,
      -1.0,
      booster ? 0.1 : Math.sign(m.userData.cz || 1) * 0.2
    ).normalize();
    // Independent material so fading one part doesn't fade the orbiter.
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => { mm.transparent = true; });
    m.userData.entry = {
      basePos: m.position.clone(),
      baseRot: m.rotation.clone(),
      dir,
      spin: new THREE.Vector3((i % 3) - 1, ((i + 1) % 3) - 1, ((i + 2) % 3) - 1).multiplyScalar(3.2),
      booster,
    };
  });

  // Measure the orbiter portion of the stack (world/vehicle space) so the
  // standalone orbiter model can be made to overlay it for a seamless swap.
  const obox = new THREE.Box3();
  orbiterParts.forEach((m) => obox.expandByObject(m));
  const oCenter = obox.getCenter(new THREE.Vector3());
  const oSize = obox.getSize(new THREE.Vector3());

  // Normalise the orbiter model to match that portion.
  orbiter.rotation.x = Math.PI / 2;
  const ob0 = new THREE.Box3().setFromObject(orbiter);
  const obSize = ob0.getSize(new THREE.Vector3());
  const oScale = Math.max(oSize.x, oSize.y, oSize.z) / Math.max(obSize.x, obSize.y, obSize.z);
  orbiter.scale.setScalar(oScale);
  const ob1 = new THREE.Box3().setFromObject(orbiter);
  const ob1Center = ob1.getCenter(new THREE.Vector3());
  orbiter.position.add(oCenter.sub(ob1Center));
  orbiter.visible = false;
  orbiterRoot = orbiter;
  vehicle.add(orbiterRoot);

  updatePath(0);
}

function finishLoading() { loaderEl.classList.add("is-hidden"); }

/* --- Scroll progress ------------------------------------------------------ */
let progress = 0;
function scrollProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
}
function onScroll() {
  progress = scrollProgress();
  if (stackRoot) { updatePath(progress); renderer.render(scene, camera); }
}
window.addEventListener("scroll", onScroll, { passive: true });

const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("is-in"); });
}, { threshold: 0.3 });
document.querySelectorAll(".panel").forEach((p) => io.observe(p));
window.addEventListener("load", () => document.querySelector(".panel")?.classList.add("is-in"));

/* --- HUD ------------------------------------------------------------------ */
const hud = document.getElementById("hud-label");
const PHASES = [
  [0.00, "IGNITION — LAUNCH PAD"],
  [0.05, "ASCENT — MAX-Q"],
  [0.12, "BOOSTER SEPARATION"],
  [0.18, "EXTERNAL TANK JETTISON"],
  [0.26, "ORBITAL INSERTION — LEAVING EARTH"],
  [0.42, "TRANSIT — EMISSION NEBULA"],
  [0.58, "CROSSING — GALACTIC DISC"],
  [0.74, "APPROACH — KEPLER-452b"],
  [0.90, "FINAL DESCENT — TOUCHDOWN"],
];
function updateHud(p) {
  let label = PHASES[0][1];
  for (const [at, text] of PHASES) if (p >= at) label = text;
  if (hud && hud.textContent !== label) hud.textContent = label;
}

/* --- Path evaluation ------------------------------------------------------ */
const camTarget = new THREE.Vector3();
const v1 = new THREE.Vector3();

function updatePath(p) {
  if (!stackRoot) return;

  const launch = seg(p, 0, P.ascentEnd);          // 0..1 over ascent
  const boost = seg(p, P.boostA, P.boostB);        // booster separation
  const tank = seg(p, P.tankA, P.tankB);           // tank jettison
  const land = seg(p, P.landA, P.landB);
  const launchLook = clamp(1 - p / P.tankB, 0, 1); // strong at the pad, gone by jettison
  const cruiseAmt = seg(p, 0.30, 0.85);            // lateral weave envelope

  // Continuous forward travel.
  const z = lerp(PATH.startZ, PATH.endZ, smooth(p));

  // Position: launch arc + cruise weave + landing settle.
  const x = Math.sin(p * Math.PI * 3.0) * 9 * cruiseAmt;
  const yLaunch = Math.sin(launch * Math.PI) * 4;  // gentle pitch-over arc
  const yWeave = Math.cos(p * Math.PI * 2.3) * 5 * cruiseAmt;
  const yLand = land * -4;
  vehicle.position.set(x, yLaunch + yWeave + yLand, z);

  // Attitude: bank/pitch while cruising; nose-up flare on landing.
  const bank = Math.cos(p * Math.PI * 3.0) * 0.5 * cruiseAmt;
  const pitch = Math.sin(p * Math.PI * 2.3) * 0.18 * cruiseAmt + land * 0.9
    + (1 - launch) * 0.0; // (placeholder for any launch pitch)
  vehicle.rotation.set(pitch, lerp(0, -0.25, land), bank);

  // --- Model swap + separation -------------------------------------------
  const swapped = p >= P.tankB;     // orbiter-only after jettison completes
  stackRoot.visible = !swapped;
  if (orbiterRoot) orbiterRoot.visible = swapped;

  if (!swapped) {
    discards.forEach((m) => {
      const e = m.userData.entry;
      const t = e.booster ? boost : tank;
      const k = smooth(t);
      m.position.copy(e.basePos).addScaledVector(e.dir, k * sepDist);
      m.rotation.set(e.baseRot.x + e.spin.x * k, e.baseRot.y + e.spin.y * k, e.baseRot.z + e.spin.z * k);
      const op = 1 - smooth(clamp((t - 0.6) / 0.4, 0, 1));   // fade over last 40%
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mm) => { mm.opacity = op; });
      m.visible = t < 1;
    });
  }

  // --- Escort light & camera ---------------------------------------------
  escort.position.set(x, vehicle.position.y + 3, z + 6);

  // Chase from behind/above; pull down/back at the pad to frame Earth; swing
  // to a side view against Kepler-452b on landing.
  const chase = v1.set(x, vehicle.position.y + 3.2, z + 13);
  const launchCam = new THREE.Vector3(x + 5, vehicle.position.y + 1.5, z + 22);
  const sideView = new THREE.Vector3(
    PATH.planet.center.x + 26,
    PATH.planet.center.y + PATH.planet.radius + 20,
    z + 30
  );
  camera.position.copy(chase).lerp(launchCam, launchLook).lerp(sideView, smooth(land));

  // Look target: down toward Earth at launch, ahead while cruising, at the
  // orbiter on landing.
  const ahead = camTarget.set(x, vehicle.position.y, z - 30);
  const earthward = new THREE.Vector3(x, vehicle.position.y - 9, z - 8);
  ahead.lerp(earthward, launchLook).lerp(vehicle.position, smooth(land));
  camera.lookAt(ahead);

  updateHud(p);
}

/* --- Render loop ---------------------------------------------------------- */
const clock = new THREE.Clock();
function tick() {
  const t = clock.getElapsedTime();
  progress = scrollProgress();
  updatePath(progress);

  nebula.children.forEach((c, i) => { c.rotation.z = t * 0.02 * (i % 2 ? 1 : -1); });
  galaxy.rotation.y = t * 0.04;
  earth.group.rotation.y = t * 0.03;
  earth.clouds.rotation.y = t * 0.04;
  kepler.group.rotation.y = t * 0.02;
  kepler.clouds.rotation.y = t * 0.028;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

/* --- Resize --------------------------------------------------------------- */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);
});

/* Dev hook: force a synchronous render at a given progress (verification). */
window.__renderAt = (p) => {
  progress = clamp(p, 0, 1);
  updatePath(progress);
  renderer.render(scene, camera);
  return { progress, hud: hud.textContent, swapped: !!(orbiterRoot && orbiterRoot.visible) };
};
