/* ----------------------------------------------------------------------------
 * Kennedy Space Center landmarks for the LC-39A opening: the Vehicle Assembly
 * Building, the Launch Control Center, an Orbiter Processing Facility hangar
 * and the press-site countdown clock with its flagpole.
 *
 * Scale 1 unit = 11.2 m, +Y up. Geometry is a handful of boxes (a few hundred
 * triangles in all); the detail - cladding panels, doors, window bands, roof
 * grime - is painted into small seeded CanvasTextures, so the result is
 * identical on every load.
 *
 * Every part is a Group whose origin is the centre of its footprint at ground
 * level, front facade toward local +Z. makeKSCBuildings() returns them in one
 * group (placed at groundY) in a compact default layout whose frame matches
 * the site: +X east (toward the pad), +Z south, origin at the VAB:
 *   vab    at (0, 0), turned so its doors, flag and logo face +X (the pad);
 *          its low-bay annex then sits on the south side
 *   lcc    south-east of the VAB, firing-room windows facing +X
 *   opf    west of the VAB, hangar door facing +Z
 *   clock  press site east of the VAB, display facing -X (toward the stands)
 * Pass layout: "origin" to get every part at (0, 0, 0) unrotated instead.
 * Either way the caller may move, rotate or reparent any part.
 *
 * clock.userData.setTime(t) redraws the display for t seconds from liftoff
 * (negative counts down); clock.userData.setText(s) shows any string built
 * from 0-9, T, +, -, : and space.
 * -------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/* --- Helpers -------------------------------------------------------------- */
// mulberry32: tiny seeded PRNG so every texture is the same on every load.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);     // mipmaps + trilinear by default
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.84, metalness: 0.08, ...o });
const texMat = (w, h, draw, o) => std({ map: canvasTex(w, h, draw), ...o });
// Decals sit 1 cm proud of the wall and are pulled forward in depth as well.
const decalMat = (map, o) => std({ map, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...o });
// Box resting on y (not centred on it); mat may be a 6-entry array [+x, -x, +y, -y, +z, -z].
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}
// Many same-material boxes as one draw call: list of [w, h, d, x, y, z].
const boxes = (list, mat) => new THREE.Mesh(mergeGeometries(list.map(([w, h, d, x, y, z]) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z))), mat);
// Seeded rooftop plant (AC units, vents) scattered inside a w x d roof at
// height y, each at most hs tall.
function roofUnits(r, n, w, d, y, hs, x0 = 0, z0 = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = 0.1 + r() * 0.08 * w, b = 0.1 + r() * 0.08 * d;
    out.push([a, hs * (0.4 + 0.6 * r()), b, x0 + (r() - 0.5) * (w - a - 0.6), y, z0 + (r() - 0.5) * (d - b - 0.6)]);
  }
  return out;
}

/* --- Painters ------------------------------------------------------------- */
// Corrugated metal cladding: per-column tint runs (panels replaced in different
// years weather differently), ribs, seams, rain streaks, base grime.
function paintPanels(g, w, h, r, { base, pw = 18, ph = 24, rib = 4, vary = 0.07, streaks = 60, grime = 0.2 }) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += pw) {
    const col = (r() - 0.5) * vary;
    for (let y = 0; y < h; y += ph) {
      const v = col + (r() - 0.5) * vary * 0.5;
      g.fillStyle = v > 0 ? `rgba(255,255,250,${v})` : `rgba(55,57,55,${-v})`;
      g.fillRect(x, y, pw, ph);
    }
  }
  if (rib) for (let x = 0; x < w; x += rib) {
    g.fillStyle = "rgba(0,0,0,0.07)"; g.fillRect(x, 0, 1, h);
    g.fillStyle = "rgba(255,255,255,0.05)"; g.fillRect(x + 1, 0, 1, h);
  }
  g.fillStyle = "rgba(40,40,38,0.13)";
  for (let y = ph; y < h; y += ph) g.fillRect(0, y, w, 1);
  g.fillStyle = "rgba(40,40,38,0.04)";
  for (let x = pw; x < w; x += pw) g.fillRect(x, 0, 1, h);
  for (let i = 0; i < streaks; i++) {
    const x = r() * w, y = r() < 0.4 ? 0 : Math.floor(r() * h / ph) * ph, len = (0.08 + r() * 0.4) * h;
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, `rgba(72,68,60,${0.06 + r() * 0.1})`); gr.addColorStop(1, "rgba(72,68,60,0)");
    g.fillStyle = gr; g.fillRect(x, y, 1 + r() * 3, len);
  }
  let gr = g.createLinearGradient(0, h, 0, h * 0.82);
  gr.addColorStop(0, `rgba(78,72,58,${grime})`); gr.addColorStop(1, "rgba(78,72,58,0)");
  g.fillStyle = gr; g.fillRect(0, h * 0.82, w, h * 0.18);
  gr = g.createLinearGradient(0, 0, 0, h * 0.05);
  gr.addColorStop(0, "rgba(60,60,55,0.16)"); gr.addColorStop(1, "rgba(60,60,55,0)");
  g.fillStyle = gr; g.fillRect(0, 0, w, h * 0.05);
}
// Recessed door: dark reveal, leaves split by seams, shadow under the head.
function paintDoor(g, x, y, w, h, leaves, vertical, fill = "#bdc0bc") {
  g.fillStyle = "rgba(50,52,52,0.6)"; g.fillRect(x - 3, y - 3, w + 6, h + 3);
  g.fillStyle = fill; g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(0,0,0,0.05)";
  for (let i = x; i < x + w; i += 3) g.fillRect(i, y, 1, h);
  g.fillStyle = "rgba(35,36,36,0.45)";
  for (let i = 1; i < leaves; i++) {
    if (vertical) g.fillRect(x + w * i / leaves - 1, y, 2, h);
    else g.fillRect(x, y + h * i / leaves - 1, w, 2);
  }
  const gr = g.createLinearGradient(0, y, 0, y + 12);
  gr.addColorStop(0, "rgba(0,0,0,0.3)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(x, y, w, 12);
}
// Ribbon window: tinted glass catching a little sky at the top, mullions, sill shadow.
function paintWindows(g, x0, x1, y, h, pitch) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, "#3d4957"); gr.addColorStop(1, "#141a21");
  g.fillStyle = gr; g.fillRect(x0, y, x1 - x0, h);
  g.fillStyle = "rgba(205,208,206,0.6)";
  for (let x = x0; x <= x1; x += pitch) g.fillRect(x, y, Math.max(1, pitch * 0.12), h);
  g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(x0, y + h, x1 - x0, 2);
}
// Flat membrane roof: ponding stains and patch repairs, seams, dirt along the parapet.
function paintRoof(g, w, h, r, base) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = r() * h, s = 6 + r() * w * 0.12, dark = r() < 0.65;
    const gr = g.createRadialGradient(x, y, 0, x, y, s);
    gr.addColorStop(0, dark ? `rgba(30,30,26,${0.05 + r() * 0.12})` : `rgba(235,235,225,${0.03 + r() * 0.05})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(x - s, y - s, 2 * s, 2 * s);
  }
  g.fillStyle = "rgba(255,255,255,0.06)";
  for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 1, h);
  g.strokeStyle = "rgba(25,25,22,0.3)"; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
}
function star5(g, x, y, R) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? R * 0.382 : R;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}
// US flag to spec proportions. vertical: stripes run up/down with the canton at
// top-left, as painted on the VAB - a reflection across the diagonal, so the
// field is drawn transposed but the stars are drawn upright afterwards.
function paintFlag(g, w, h, vertical, white = "#e2e2dd") {
  const L = vertical ? h : w, H = vertical ? w : h;           // fly length, hoist
  if (vertical) g.setTransform(0, 1, 1, 0, 0, 0);
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? white : "#b22234";
    g.fillRect(0, i * H / 13, L, H / 13 + 0.5);
  }
  const uw = 0.4 * L, uh = 7 * H / 13;
  g.fillStyle = "#3c3b6e"; g.fillRect(0, 0, uw, uh);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = white;
  for (let j = 0; j < 9; j++) for (let k = 0; k < (j % 2 ? 5 : 6); k++) {
    const fx = uw / 12 * (j % 2 ? 2 + 2 * k : 1 + 2 * k), fy = uh / 10 * (j + 1);
    star5(g, vertical ? fy : fx, vertical ? fx : fy, 0.0308 * H);
  }
}
// Paint follows the cladding: seam lines at the facade's seam heights, faint ribs.
function paintedOn(g, w, h, y0, hu, seam, top) {
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = "rgba(200,200,190,0.08)"; g.fillRect(0, 0, w, h);        // sun-faded
  g.fillStyle = "rgba(0,0,0,0.05)";
  for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
  g.fillStyle = "rgba(30,30,28,0.16)";
  for (let y = top; y > y0; y -= seam) if (y < y0 + hu) g.fillRect(0, (y0 + hu - y) / hu * h, w, 1.5);
  g.globalCompositeOperation = "source-over";
}
// NASA insignia, simplified and without lettering: blue disc, stars, white
// orbit, red vector. Transparent outside so the vector can overhang the disc.
function paintMeatball(g, w, h, r) {
  const c = w / 2, R = 0.45 * w;
  g.fillStyle = "#1f4b98"; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#f0f0ec";
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * 0.92, s = 1.5 + r() * r() * 5;
    g.beginPath(); g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, s, 0, Math.PI * 2); g.fill();
  }
  g.save(); g.translate(c, c); g.rotate(-0.42);
  g.strokeStyle = "#f0f0ec"; g.lineWidth = w * 0.018;
  g.beginPath(); g.ellipse(0, 0, R * 0.84, R * 0.3, 0, 0, Math.PI * 2); g.stroke();
  g.restore();
  const p = (x, y) => [x * w, y * h];                                       // unit-square coords
  g.fillStyle = "#cf2a2a"; g.beginPath();
  g.moveTo(...p(0.06, 0.8));
  g.quadraticCurveTo(...p(0.5, 0.56), ...p(0.98, 0.18));                    // leading edge to the tip
  g.lineTo(...p(0.76, 0.43));                                              // notch
  g.lineTo(...p(0.92, 0.5));                                               // trailing barb
  g.quadraticCurveTo(...p(0.5, 0.62), ...p(0.06, 0.8));
  g.fill();
}

/* --- LED countdown display ------------------------------------------------ */
const FONT = {
  "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
  "T": "11111 00100 00100 00100 00100 00100 00100", "-": "00000 00000 00000 11111 00000 00000 00000",
  "+": "00000 00100 00100 11111 00100 00100 00000", ":": "0 0 1 0 1 0 0",
  " ": "00000 00000 00000 00000 00000 00000 00000",
};
// Amber dot matrix on black: unlit dots faintly visible, lit ones with a halo.
function paintLED(g, w, h, text) {
  g.fillStyle = "#050505"; g.fillRect(0, 0, w, h);
  const glyphs = [...text].map((ch) => (FONT[ch] || FONT[" "]).split(" "));
  const cols = glyphs.reduce((n, gl) => n + gl[0].length + 1, -1);
  const p = Math.min(w / (cols + 2), h / 8.5);
  let x = (w - cols * p) / 2 + p / 2;
  const y0 = (h - 7 * p) / 2 + p / 2;
  const dot = (cx, cy, rad, col) => { g.fillStyle = col; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill(); };
  for (const gl of glyphs) {
    for (let row = 0; row < 7; row++) for (let c = 0; c < gl[0].length; c++) {
      const cx = x + c * p, cy = y0 + row * p;
      if (gl[row][c] === "1") {
        dot(cx, cy, p * 0.6, "rgba(255,110,10,0.3)");
        dot(cx, cy, p * 0.38, "#ff9420");
        dot(cx, cy, p * 0.18, "#ffc060");
      } else dot(cx, cy, p * 0.34, "rgba(255,140,40,0.07)");
    }
    x += (gl[0].length + 1) * p;
  }
}
const pad2 = (n) => String(n).padStart(2, "0");
function countdownText(t) {
  const a = t < 0 ? Math.ceil(-t) : Math.floor(t);
  return `T${t < 0 ? "-" : "+"}${pad2(Math.min(99, Math.floor(a / 3600)))}:${pad2(Math.floor(a / 60) % 60)}:${pad2(a % 60)}`;
}

/* --- Buildings ------------------------------------------------------------ */
// Vehicle Assembly Building: high bay plus the low-bay annex on local -X. The
// group origin is the centre of the combined footprint, so the high bay itself
// sits at x = +2.5.
function makeVAB(r, mats) {
  const W = 19.5, H = 14.3, D = 14.1, AW = 5, AH = 5.7, AD = 11.9;
  const hx = AW / 2, ax = hx - W / 2 - AW / 2, az = -(D - AD) / 2;        // annex flush with the back
  const base = "#cfd1cd", ph = 24, seam = H * ph / 752;                    // ~0.62 linear albedo
  const DX = 2.6;                                                          // door bay centres
  const front = texMat(1024, 752, (g, w, h) => {
    paintPanels(g, w, h, r, { base, ph });
    const sx = w / W, sy = h / H, px = (x) => (x + W / 2) * sx, py = (y) => (H - y) * sy;
    for (const cx of [-DX, DX]) {
      // Inverted T: 7 vertical-lift leaves for the tall slot, 4 sliding leaves below.
      paintDoor(g, px(cx - 1.035), py(12.4), 2.07 * sx, 9.3 * sy, 7, false);
      paintDoor(g, px(cx - 2.05), py(3.1), 4.1 * sx, 3.1 * sy, 4, true);
    }
  });
  const side = texMat(768, 768, (g, w, h) => paintPanels(g, w, h, r, { base, ph: 24 * 768 / 752 }));
  const annexFront = texMat(448, 512, (g, w, h) => {
    paintPanels(g, w, h, r, { base, ph: 22, grime: 0.25 });
    const sx = w / AW, sy = h / AH;
    for (const y of [2.1, 4.2]) paintWindows(g, 0.3 * sx, (AW - 0.3) * sx, (AH - y) * sy, 0.4 * sy, 12);
    paintDoor(g, 1.4 * sx, (AH - 1.3) * sy, 2.2 * sx, 1.3 * sy, 6, false, "#b8bbb7");
  });
  const annexSide = texMat(1024, 490, (g, w, h) => {
    paintPanels(g, w, h, r, { base, ph: 22, grime: 0.25 });
    const sx = w / AD, sy = h / AH;
    for (const y of [2.1, 4.2]) paintWindows(g, 0.4 * sx, (AD - 0.4) * sx, (AH - y) * sy, 0.4 * sy, 12);
  });
  const roof = texMat(512, 512, (g, w, h) => paintRoof(g, w, h, r, "#a6a7a2"), { roughness: 0.92 });
  const plain = std({ color: 0xbcbeba });

  const vab = new THREE.Group(); vab.name = "VAB";
  vab.add(box(W, H, D, [side, side, roof, mats.under, front, front], hx, 0, 0));
  vab.add(box(AW, AH, AD, [plain, annexSide, roof, mats.under, annexFront, annexFront], ax, 0, az));
  // Parapet and rooftop plant: one merged mesh each.
  const t = 0.12, ph2 = 0.2;
  vab.add(boxes([[W, ph2, t, hx, H, D / 2 - t / 2], [W, ph2, t, hx, H, -D / 2 + t / 2],
    [t, ph2, D, hx + W / 2 - t / 2, H, 0], [t, ph2, D, hx - W / 2 + t / 2, H, 0]], plain));
  vab.add(boxes([...roofUnits(r, 7, W, D, H, 0.8, hx), [1.4, 0.7, 1.4, hx - 4, H, -3],
    ...roofUnits(r, 3, AW, AD, AH, 0.4, ax, az)], mats.plant));
  // Flag (stripes vertical, canton top-left) near the -X end, insignia near +X.
  const fz = D / 2 + 0.01, fx = hx - 7.8, fy = 7.65, fh = 5.7;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, fh), decalMat(canvasTex(256, 512, (g, w, h) => {
    paintFlag(g, w, h, true); paintedOn(g, w, h, fy, fh, seam, H);
  })));
  flag.position.set(fx, fy + fh / 2, fz);
  const ls = 4.9 / 0.9, ly = 10.6;                                         // disc is 0.9 of the plane
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(ls, ls), decalMat(canvasTex(512, 512, (g, w, h) => {
    paintMeatball(g, w, h, r); paintedOn(g, w, h, ly - ls / 2, ls, seam, H);
  }), { transparent: true, depthWrite: false, alphaTest: 0.02 }));
  logo.position.set(hx + 9.75 - ls / 2 - 0.1, ly, fz);
  vab.add(flag, logo);
  return vab;
}

// Launch Control Center: four storeys of white precast with dark window bands
// and the firing rooms' outward-leaning glass wall on the front.
function makeLCC(r, mats) {
  const W = 10.3, H = 2.1, D = 4.9, st = H / 4, base = "#d6d8d3";
  const facade = (len) => (g, w, h) => {
    paintPanels(g, w, h, r, { base, pw: 40, ph: h / 4, rib: 0, vary: 0.05, streaks: 30, grime: 0.15 });
    const sx = w / len, sy = h / H;
    for (let i = 0; i < 4; i++) paintWindows(g, 0.15 * sx, (len - 0.15) * sx, (H - (i + 0.82) * st) * sy, 0.42 * st * sy, 10);
  };
  const front = texMat(1024, 224, facade(W), { roughness: 0.75 });
  const side = texMat(512, 224, facade(D), { roughness: 0.75 });
  const roof = mats.roof;
  const lcc = new THREE.Group(); lcc.name = "LCC";
  lcc.add(box(W, H, D, [side, side, roof, mats.under, front, front]));
  lcc.add(boxes([[2.4, 0.35, 1.6, -1.5, H, -0.6], ...roofUnits(r, 5, W, D, H, 0.25)], mats.plant));
  // Firing-room window wall: a glass plane leaning out by p over storey 3, end
  // caps and a soffit-roof slab. Built from planes so each part gets its own material.
  const L = 8, y0 = 2 * st, y1 = 3 * st + 0.03, p = 0.42, zf = D / 2;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(L, Math.hypot(p, y1 - y0)),
    std({ map: canvasTex(512, 64, (g, w, h) => paintWindows(g, 0, w, 0, h, 16)), roughness: 0.35, metalness: 0.3 }));
  glass.rotation.x = Math.atan2(p, y1 - y0);                              // top leans out toward +Z
  glass.position.set(0, (y0 + y1) / 2, zf + p / 2);
  const capGeo = new THREE.BufferGeometry();
  const tri = (x) => [x, y0, zf, x, y1, zf + p, x, y1, zf];
  capGeo.setAttribute("position", new THREE.Float32BufferAttribute([...tri(L / 2), ...tri(-L / 2)], 3));
  capGeo.computeVertexNormals();
  const white = std({ color: 0xd2d4cf, side: THREE.DoubleSide });
  lcc.add(glass, new THREE.Mesh(capGeo, white), box(L + 0.1, 0.07, p + 0.06, white, 0, y1, zf + p / 2 - 0.02));
  return lcc;
}

// Orbiter Processing Facility: high bay with the wide hangar door and the tail
// slot above it, low shop annexes either side.
function makeOPF(r, mats) {
  const W = 5.4, H = 2.6, D = 4.5, AW = 1.4, AH = 1.15, AD = 3.8, base = "#d3d0c7";
  const front = texMat(512, 256, (g, w, h) => {
    paintPanels(g, w, h, r, { base, pw: 12, ph: 20, streaks: 30 });
    const sx = w / W, sy = h / H;
    paintDoor(g, (W / 2 - 0.35) * sx, (H - 2.35) * sy, 0.7 * sx, 0.8 * sy, 4, false);     // tail slot
    paintDoor(g, (W / 2 - 2.1) * sx, (H - 1.55) * sy, 4.2 * sx, 1.55 * sy, 6, true);     // main door
  });
  const side = texMat(512, 256, (g, w, h) => {
    paintPanels(g, w, h, r, { base, pw: 12, ph: 20, streaks: 30 });
    paintWindows(g, w * 0.1, w * 0.9, h * 0.18, h * 0.06, 12);
  });
  const annex = texMat(512, 160, (g, w, h) => {
    paintPanels(g, w, h, r, { base, pw: 12, ph: 20, streaks: 20 });
    paintWindows(g, w * 0.05, w * 0.95, h * 0.35, h * 0.18, 10);
  });
  const am = [annex, annex, mats.roof, mats.under, annex, annex];
  const opf = new THREE.Group(); opf.name = "OPF";
  opf.add(box(W, H, D, [side, side, mats.roof, mats.under, front, front]));
  for (const s of [-1, 1]) opf.add(box(AW, AH, AD, am, s * (W + AW) / 2, 0, -(D - AD) / 2));
  opf.add(boxes(roofUnits(r, 4, W, D, H, 0.22), mats.plant));
  return opf;
}

// Press-site countdown clock: black sign on two short posts, glowing amber dot
// matrix (MeshBasicMaterial, colour pushed past 1 so the lit dots reach bloom),
// and a flagpole with a small US flag. Sign centred at x = -0.2 so the sign
// plus pole footprint is centred on the origin.
function makeClock(ledIntensity, mats) {
  const clock = new THREE.Group(); clock.name = "CountdownClock";
  const SW = 1.8, SH = 0.5, SD = 0.08, sx = -0.2, sy = 0.22;
  const black = std({ color: 0x0e0e0f, roughness: 0.6 });
  clock.add(box(SW, SH, SD, black, sx, sy, 0));
  clock.add(boxes([[0.06, sy, 0.06, sx - 0.6, 0, 0], [0.06, sy, 0.06, sx + 0.6, 0, 0]], mats.steel));
  const tex = canvasTex(1024, 256, (g, w, h) => paintLED(g, w, h, "T-00:00:10"));
  const led = new THREE.Mesh(new THREE.PlaneGeometry(SW - 0.08, SH - 0.08), new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color().setScalar(ledIntensity), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  led.position.set(sx, sy + SH / 2, SD / 2 + 0.005);
  clock.add(led);
  let shown = "T-00:00:10";
  clock.userData.ledMaterial = led.material;
  clock.userData.setText = (s) => {
    if (s === shown) return;                                              // redraw only on change
    shown = s; paintLED(tex.image.getContext("2d"), tex.image.width, tex.image.height, s); tex.needsUpdate = true;
  };
  clock.userData.setTime = (t) => clock.userData.setText(countdownText(t));
  // Flagpole and a static wave in the flag (amplitude grows toward the fly end).
  const px = 1.1, ph = 1.5;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, ph, 6, 1, true).translate(px, ph / 2, 0), mats.steel);
  const fg = new THREE.PlaneGeometry(0.5, 0.27, 10, 1).translate(0.25, 0, 0);
  const pos = fg.attributes.position;
  for (let i = 0; i < pos.count; i++) { const u = pos.getX(i); pos.setZ(i, Math.sin(u * 14) * 0.05 * u); }
  fg.computeVertexNormals();
  const flag = new THREE.Mesh(fg, std({ map: canvasTex(384, 202, (g, w, h) => paintFlag(g, w, h, false, "#e8e8e4")), roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  flag.position.set(px + 0.015, ph - 0.17, 0);
  clock.add(pole, flag);
  return clock;
}

/* --- Entry ---------------------------------------------------------------- */
// Compact default layout: [x, z, rotationY] in the group's site frame (+X east, +Z south).
const LAYOUT = {
  vab: [0, 0, Math.PI / 2],
  lcc: [13, 13, Math.PI / 2],
  opf: [-16, -2, 0],
  clock: [24, 8, -Math.PI / 2],
};

export function makeKSCBuildings({ groundY = 0, layout = "compact", ledIntensity = 2.4, seed = 1969 } = {}) {
  const r = rng(seed);
  const mats = {
    under: std({ color: 0x3a3a38 }),
    plant: std({ color: 0x9fa29e, roughness: 0.7, metalness: 0.2 }),
    steel: std({ color: 0x8d9093, roughness: 0.5, metalness: 0.6 }),
    roof: texMat(512, 512, (g, w, h) => paintRoof(g, w, h, r, "#8e8f8a"), { roughness: 0.92 }),
  };
  const parts = { vab: makeVAB(r, mats), lcc: makeLCC(r, mats), opf: makeOPF(r, mats), clock: makeClock(ledIntensity, mats) };
  const group = new THREE.Group(); group.name = "KSCBuildings";
  group.position.y = groundY;
  for (const [k, part] of Object.entries(parts)) {
    if (layout === "compact") { const [x, z, ry] = LAYOUT[k]; part.position.set(x, 0, z); part.rotation.y = ry; }
    part.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    group.add(part);
  }
  return { group, parts };
}
