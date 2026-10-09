/*
 * deepsky.js - procedural deep-sky textures (galaxies, nebulae, Milky Way).
 *
 * Every texture is painted on a 2D canvas for ADDITIVE blending: the canvas is
 * opaque black, colour is emitted light, and everything falls smoothly to pure
 * black well before the border so a billboard never shows its square outline.
 *
 * Recipe shared by all generators:
 *   1. a low-resolution per-pixel field (noise, spiral arms, dust) that holds
 *      the large-scale structure; it is cheap because it is small,
 *   2. upscaled with smoothing plus a light blur, so no blocks or banding,
 *   3. full-resolution detail drawn with soft sprites: anti-aliased fine stars,
 *      star-forming knots, crisp dust ("multiply" sprites darken),
 *   4. a little dither to break 8-bit contours, then a soft vignette.
 * All randomness comes from a seeded PRNG, so the sky is identical every load.
 */
import * as THREE from "three";

const TAU = Math.PI * 2;

/* --- Small math helpers ---------------------------------------------------- */

// mulberry32: tiny, fast, good enough for art, and seedable.
function rng(seed) {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
// Works with e0 > e1 too, which gives a falling edge.
function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
// Soft highlight knee for field values: keeps galaxy cores from clipping
// once the sharp nucleus and stars are added on top (bloom does the rest).
const knee = (v) => (v < 150 ? v : 210 - 60 * Math.exp((150 - v) / 60));
const hex = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Seeded 2D gradient noise plus fBm. Octaves are rotated so no grid shows.
// Plain module-level functions (not per-seed closures) so V8 optimises them
// once and every generator after the first runs at full speed.
function makeNoise(rand) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rand() * TAU;
    gx[i] = Math.cos(a); gy[i] = Math.sin(a);
  }
  return { perm, gx, gy };
}

function noise2(T, x, y) {
  const perm = T.perm, gx = T.gx, gy = T.gy;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const X = x0 & 255, Y = y0 & 255;
  const a = perm[X + perm[Y]], b = perm[X + 1 + perm[Y]];
  const c = perm[X + perm[Y + 1]], d = perm[X + 1 + perm[Y + 1]];
  const va = gx[a] * fx + gy[a] * fy;
  const vb = gx[b] * (fx - 1) + gy[b] * fy;
  const vc = gx[c] * fx + gy[c] * (fy - 1);
  const vd = gx[d] * (fx - 1) + gy[d] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const top = va + u * (vb - va);
  return (top + v * (vc + u * (vd - vc) - top)) * 1.45;
}

function fbm(T, x, y, oct) {
  let s = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * noise2(T, x, y);
    norm += amp;
    const nx = 1.6 * x - 1.2 * y + 17.3;
    y = 1.2 * x + 1.6 * y - 9.1;
    x = nx;
    amp *= 0.5;
  }
  return s / norm;
}

/* --- Canvas helpers -------------------------------------------------------- */

const CAN_FILTER = typeof CanvasRenderingContext2D !== "undefined" &&
  "filter" in CanvasRenderingContext2D.prototype;

function makeCanvas(w, h, black = false) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (black) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); }
  return { c, ctx };
}

function dataCanvas(data, w, h) {
  const { c, ctx } = makeCanvas(w, h);
  ctx.putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}

// Upscale a low-res field softly. Blur hides the bilinear "star" pattern;
// without canvas filters (older Safari) 2x steps give a similar smoothness.
function drawSoft(ctx, src, x, y, w, h, blur) {
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 1;
  if (CAN_FILTER && blur > 0.3) {
    ctx.filter = `blur(${blur.toFixed(2)}px)`;
    ctx.drawImage(src, x, y, w, h);
    ctx.filter = "none";
  } else {
    let cur = src;
    while (cur.width * 2 < w) {
      const n = makeCanvas(cur.width * 2, cur.height * 2);
      n.ctx.drawImage(cur, 0, 0, n.c.width, n.c.height);
      cur = n.c;
    }
    ctx.drawImage(cur, x, y, w, h);
  }
}

// Gaussian-ish radial profile that reaches exactly zero at the rim.
const profile = (t) => Math.exp(-t * t * 5) * (1 - t * t) * (1 - t * t);

// Cached soft sprites: "glow" adds light, "shade" (white outside) multiplies.
const sprites = new Map();
function glow(rgb) {
  const key = "g" + rgb;
  if (sprites.has(key)) return sprites.get(key);
  const { c, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    g.addColorStop(t, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${profile(t).toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}
function shade(rgb) {
  const key = "s" + rgb;
  if (sprites.has(key)) return sprites.get(key);
  const { c, ctx } = makeCanvas(64, 64);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    g.addColorStop(t, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${profile(t).toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}

// Sprite centred at (x, y); rad is roughly the visible radius in px.
function blob(ctx, spr, x, y, rad, alpha) {
  const d = rad * 4;
  ctx.globalAlpha = alpha;
  ctx.drawImage(spr, x - d / 2, y - d / 2, d, d);
}
// Elongated sprite (dust streaks, diffraction spikes), angle in radians.
function streak(ctx, spr, x, y, len, wid, ang, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  ctx.drawImage(spr, -len, -wid, len * 2, wid * 2);
  ctx.restore();
}

// Bright young star: soft coloured halo, white core, 4-point spikes.
function brightStar(ctx, x, y, s, rgb, alpha, spikeAng, k) {
  const g = glow(rgb), w = glow([255, 255, 255]);
  blob(ctx, g, x, y, s * 5, alpha * 0.22);
  blob(ctx, g, x, y, s * 2, alpha * 0.5);
  blob(ctx, w, x, y, s * 0.8, alpha);
  for (let i = 0; i < 2; i++) {
    const a = spikeAng + i * Math.PI / 2;
    streak(ctx, g, x, y, s * 16, 0.55 * k + s * 0.05, a, alpha * 0.35);
    streak(ctx, w, x, y, s * 6, 0.45 * k + s * 0.04, a, alpha * 0.45);
  }
}

// Samples points with probability proportional to a weight grid (via CDF).
function makeSampler(weights, w, h, rand) {
  const cdf = new Float64Array(weights.length);
  let s = 0;
  for (let i = 0; i < weights.length; i++) { s += weights[i]; cdf[i] = s; }
  return () => {
    const t = rand() * s;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cdf[m] < t) lo = m + 1; else hi = m;
    }
    return [((lo % w) + rand()) / w, (((lo / w) | 0) + rand()) / h, lo];
  };
}

// Faint per-channel noise breaks 8-bit contours in smooth gradients.
function dither(ctx, w, h, rand) {
  const T = 128;
  const data = new Uint8ClampedArray(T * T * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rand() * 3; data[i + 1] = rand() * 3; data[i + 2] = rand() * 3;
    data[i + 3] = 255;
  }
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 1;
  ctx.fillStyle = ctx.createPattern(dataCanvas(data, T, T), "repeat");
  ctx.fillRect(0, 0, w, h);
}

// Multiply by a smooth radial mask: guarantees pure black at the border.
function vignette(ctx, w, h, inner, outer) {
  const r = Math.min(w, h) / 2;
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(w / 2, h / 2, inner * r, w / 2, h / 2, outer * r);
  for (let i = 0; i <= 12; i++) {
    const v = Math.round(255 * smooth(1, 0, i / 12));
    g.addColorStop(i / 12, `rgb(${v},${v},${v})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
}

function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const STAR_TINTS = [[255, 255, 255], [215, 228, 255], [255, 236, 210], [255, 210, 170]];

/* --- 1. Face-on spiral galaxy --------------------------------------------- */

const SPIRAL_PALETTES = {
  milky: {
    core: [255, 240, 210], bulge: [255, 204, 140], arm: [150, 182, 255],
    disc: [215, 200, 195], knot: [255, 92, 178], cluster: [175, 205, 255],
    dust: [70, 44, 28], dustK: [0.86, 0.9, 0.95],
  },
  cool: {
    core: [235, 238, 255], bulge: [220, 205, 185], arm: [110, 196, 255],
    disc: [180, 200, 230], knot: [186, 118, 255], cluster: [150, 225, 255],
    dust: [52, 44, 60], dustK: [0.88, 0.9, 0.93],
  },
};

export function spiralGalaxyTexture({ size = 1024, seed = 1, arms = 2, palette = "milky" } = {}) {
  const rand = rng(seed * 101 + 7);
  const T = makeNoise(rand);
  const P = SPIRAL_PALETTES[palette] || SPIRAL_PALETTES.milky;
  arms = Math.max(2, Math.min(4, Math.round(arms)));
  const k = size / 1024;

  // Shape parameters: pitch opens up with more arms, half of seeds get a bar.
  const tanP = 0.3 + rand() * 0.1 + (arms - 2) * 0.06;
  const pitch = Math.atan(tanP);
  const phase0 = rand() * TAU;
  const barred = rand() < 0.5;
  const barLen = barred ? 0.13 + rand() * 0.05 : 0;
  const barAng = rand() * Math.PI;
  const rIn = barred ? barLen * 0.95 : 0.07;
  const lag = 0.62; // dust sits on the inner (concave) edge of each arm
  const cb = Math.cos(barAng), sb = Math.sin(barAng);

  // Low-res field: arms, disc, bulge, bar and dust lanes.
  const N = Math.round(size * 0.32);
  const data = new Uint8ClampedArray(N * N * 4);
  const armW = new Float32Array(N * N), dustW = new Float32Array(N * N), lumW = new Float32Array(N * N);
  const bulgeC = P.bulge, armC = P.arm, discC = P.disc, dk = P.dustK;
  for (let j = 0; j < N; j++) {
    const v = ((j + 0.5) / N) * 2 - 1;
    for (let i = 0; i < N; i++) {
      const u = ((i + 0.5) / N) * 2 - 1;
      const idx = j * N + i, o = idx * 4;
      data[o + 3] = 255;
      const r = Math.hypot(u, v);
      if (r > 0.97) continue;
      const th = Math.atan2(v, u);
      const warp = fbm(T, u * 2.2 + 11, v * 2.2 + 7, 3);
      const psi = arms * (th - Math.log(r + 0.02) / tanP) + phase0 + warp * 1.7;
      const c = 0.5 + 0.5 * Math.cos(psi);
      const taper = smooth(0.9, 0.52, r);
      const armEnv = smooth(rIn * 0.7, rIn + 0.12, r) * Math.exp(-r / 0.36) * taper;
      const mott = clamp(0.72 + 1.0 * fbm(T, u * 8 + 3, v * 8 - 5, 4), 0.2, 1.7);
      const c2 = c * c;
      // Broad arm light plus a sharper crest where the young stars sit.
      const arm = (0.55 * c2 + 0.75 * c2 * c2 * c2) * armEnv * mott * 1.2;
      const disc = Math.exp(-r / 0.21) * taper * (0.75 + 0.5 * fbm(T, u * 5 - 2, v * 5 + 4, 2)) * 0.36;
      // Bulge (slightly oval along the bar) and an optional stellar bar.
      const bx = u * cb + v * sb, by = -u * sb + v * cb;
      const rb = Math.hypot(bx, by / 0.82);
      const bulge = 0.34 * Math.exp(-rb / 0.03) + 0.27 * Math.exp(-rb / 0.085);
      const bar = barred ? 0.26 * Math.exp(-Math.pow(bx / barLen, 4) - (by / 0.03) * (by / 0.03)) : 0;
      // Dust: narrow lane on the arm's inner edge, broken up by noise, plus
      // faint inter-arm feathers from ridged noise.
      const cd = 0.5 + 0.5 * Math.cos(psi - lag);
      const cd2 = cd * cd, cd4 = cd2 * cd2, cd8 = cd4 * cd4, cd16 = cd8 * cd8;
      const dn = fbm(T, u * 10 - 4, v * 10 + 2, 4);
      const ridge = 1 - Math.abs(fbm(T, u * 13 + 6, v * 13 - 8, 3));
      const r4 = ridge * ridge * ridge * ridge;
      let dust = (cd16 * cd16 * smooth(-0.45, 0.15, dn) * 0.85 + r4 * r4 * 0.25) *
        smooth(0.04, 0.12, r) * smooth(0.8, 0.4, r);
      dust = Math.min(0.92, dust);
      // Arms shade from bulge colour near the centre to blue-white outside.
      const ta = smooth(0.08, 0.42, r);
      const lr = mix(bulgeC[0], armC[0], ta), lg = mix(bulgeC[1], armC[1], ta), lb = mix(bulgeC[2], armC[2], ta);
      const bl = bulge + bar, cdk = 1 - dust * 0.55;
      data[o] = knee((arm * lr + disc * discC[0]) * (1 - dust * dk[0]) + bl * bulgeC[0] * cdk);
      data[o + 1] = knee((arm * lg + disc * discC[1]) * (1 - dust * dk[1]) + bl * bulgeC[1] * cdk);
      data[o + 2] = knee((arm * lb + disc * discC[2]) * (1 - dust * dk[2]) + bl * bulgeC[2] * cdk);
      armW[idx] = arm * arm * (1 - dust) * smooth(0.12, 0.2, r);
      dustW[idx] = dust * dust;
      lumW[idx] = (arm + disc + bl * 0.25) * (1 - dust * 0.8);
    }
  }

  const { c, ctx } = makeCanvas(size, size, true);
  drawSoft(ctx, dataCanvas(data, N, N), 0, 0, size, size, 1.1 * k * (size / N) / 2.8);

  // Unresolved star light: thousands of faint sub-pixel stars make the
  // granular texture of a real disc without any visible dots.
  ctx.globalCompositeOperation = "lighter";
  const half = size / 2;
  const sLum = makeSampler(lumW, N, N, rand);
  const tints = STAR_TINTS.map(glow);
  for (let n = Math.round(9000 * k * k); n > 0; n--) {
    const [x, y] = sLum();
    const dr = Math.hypot(x - 0.5, y - 0.5);
    const spr = tints[dr < 0.08 ? 2 + (rand() < 0.5 ? 1 : 0) : (rand() * 3) | 0];
    blob(ctx, spr, x * size, y * size, (0.45 + rand() * 0.5) * k, 0.05 + rand() * 0.16);
  }

  // Crisp dust filaments along the inner arm edges, laid along the arm.
  ctx.globalCompositeOperation = "multiply";
  const sDust = makeSampler(dustW, N, N, rand), dSpr = shade(P.dust);
  for (let n = Math.round(1500 * k * k); n > 0; n--) {
    const [x, y] = sDust();
    const ang = Math.atan2(y - 0.5, x - 0.5) + Math.PI / 2 - pitch + (rand() - 0.5) * 0.3;
    streak(ctx, dSpr, x * size, y * size, (10 + rand() * 24) * k, (0.5 + rand() * 0.8) * k, ang, 0.08 + rand() * 0.16);
  }

  // Star-forming regions: blue clusters and pink HII knots on the arm crests.
  ctx.globalCompositeOperation = "lighter";
  const sArm = makeSampler(armW, N, N, rand);
  const cl = glow(P.cluster), kn = glow(P.knot), wh = glow([255, 250, 255]);
  for (let n = Math.round(220 * arms * k * k); n > 0; n--) {
    const [x, y] = sArm();
    blob(ctx, cl, x * size, y * size, (0.8 + rand() * 2) * k, 0.12 + rand() * 0.25);
  }
  for (let n = Math.round(85 * arms * k * k); n > 0; n--) {
    const [x, y] = sArm();
    const m = 1 + ((rand() * 4) | 0); // knots come in small groups
    for (let q = 0; q < m; q++) {
      const px = x * size + (rand() - 0.5) * 7 * k, py = y * size + (rand() - 0.5) * 7 * k;
      const rad = (0.6 + rand() * 1.2) * k;
      blob(ctx, kn, px, py, rad * 2.2, 0.08 + rand() * 0.12);
      blob(ctx, kn, px, py, rad, 0.25 + rand() * 0.3);
      if (rand() < 0.3) blob(ctx, wh, px, py, rad * 0.45, 0.45);
    }
  }

  // Bright nucleus on top of the field's bulge.
  const core = P.core;
  const g = ctx.createRadialGradient(half, half, 0, half, half, 0.05 * size);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    g.addColorStop(t, `rgba(${core[0]},${core[1]},${core[2]},${(0.24 * profile(t)).toFixed(4)})`);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  dither(ctx, size, size, rand);
  vignette(ctx, size, size, 0.82, 0.99);
  return toTexture(c);
}

/* --- 2. Edge-on spiral galaxy --------------------------------------------- */

export function edgeOnGalaxyTexture({ size = 1024, seed = 2 } = {}) {
  const rand = rng(seed * 131 + 3);
  const T = makeNoise(rand);
  const k = size / 1024, half = size / 2;

  const y0 = 0.006 + rand() * 0.006; // lane a touch below centre: slight tilt
  const bq = 0.62 + rand() * 0.12;   // bulge flattening
  const bs = 0.028 + rand() * 0.012; // bulge scale (bigger = Sombrero-like)
  const zd = 0.03 + rand() * 0.008;  // disc thickness

  // Field covers the central horizontal strip (|y| < 0.5 of the half-size).
  const W = Math.round(size * 0.5), H = Math.round(W / 2);
  const data = new Uint8ClampedArray(W * H * 4);
  const discW = new Float32Array(W * H), dustW = new Float32Array(W * H), knotW = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const y = ((j + 0.5) / H) - 0.5;
    for (let i = 0; i < W; i++) {
      const x = ((i + 0.5) / W) * 2 - 1;
      const idx = j * W + i, o = idx * 4;
      data[o + 3] = 255;
      const ax = Math.abs(x);
      const taper = smooth(0.92, 0.5, ax);
      const rb = Math.hypot(x, y / bq);
      const bulge = (0.5 * Math.exp(-rb / bs) + 0.36 * Math.exp(-rb / (bs * 3.2))) * smooth(0.5, 0.3, rb);
      const ch = Math.cosh(y / zd);
      const mott = clamp(0.7 + 0.9 * fbm(T, x * 9 + 2, y * 30, 4), 0.2, 1.6);
      const disc = Math.exp(-ax / 0.34) * taper * mott / (ch * ch) * 1.45;
      const thick = 0.2 * Math.exp(-ax / 0.34) * Math.exp(-Math.abs(y) / 0.07) * taper;
      // Dust lane: wobbling, variable width, patchy; plus filaments that
      // climb out of the plane (as in NGC 891).
      const wob = 0.004 * fbm(T, x * 5, 3.3, 2);
      const lw = 0.013 * (1 + 0.45 * fbm(T, x * 7 + 9, 1.1, 2));
      const dy = (y - y0 - wob) / lw;
      const lane = Math.exp(-dy * dy) * smooth(0.95, 0.55, ax) * clamp(0.65 + 1.3 * fbm(T, x * 16 + 4, y * 50, 3));
      const rd = 1 - Math.abs(fbm(T, x * 10 - 3, y * 24 + 5, 3));
      const fil = rd * rd * rd * rd * rd * rd * Math.exp(-Math.abs(y - y0) / 0.035) * taper;
      const dust = Math.min(0.95, lane * 1.05 + fil * 0.45);
      const t = smooth(0.08, 0.6, ax);
      const dr = mix(255, 200, t), dg = mix(228, 215, t), db = mix(195, 255, t);
      // Brownish dust: blue is absorbed a little more than red.
      const dl = disc + thick;
      data[o] = knee((bulge * 255 + dl * dr) * (1 - dust * 0.88));
      data[o + 1] = knee((bulge * 205 + dl * dg) * (1 - dust * 0.91));
      data[o + 2] = knee((bulge * 150 + dl * db) * (1 - dust * 0.95));
      discW[idx] = (disc + thick * 0.5 + bulge * 0.4) * (1 - dust);
      dustW[idx] = lane * lane;
      knotW[idx] = disc * (1 - dust) * smooth(0.18, 0.3, ax);
    }
  }

  const { c, ctx } = makeCanvas(size, size, true);
  // Soft outer halo of the bulge, drawn at full res as an ellipse.
  ctx.save();
  ctx.translate(half, half);
  ctx.scale(1, bq * 0.9);
  const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.42 * size);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    hg.addColorStop(t, `rgba(255,214,165,${(0.2 * Math.exp(-t * 5) * smooth(1, 0.6, t)).toFixed(4)})`);
  }
  ctx.fillStyle = hg;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillRect(-half, -half / bq, size, size / bq);
  ctx.restore();

  const sy = size / 4;
  drawSoft(ctx, dataCanvas(data, W, H), 0, sy, size, half, 0.9 * k);

  // Map field coords (0..1 within the strip) to canvas px.
  const fx = (x) => x * size, fy = (y) => sy + y * half;
  ctx.globalCompositeOperation = "lighter";
  const sDisc = makeSampler(discW, W, H, rand), tints = STAR_TINTS.map(glow);
  for (let n = Math.round(5000 * k * k); n > 0; n--) {
    const [x, y] = sDisc();
    blob(ctx, tints[(rand() * 4) | 0], fx(x), fy(y), (0.4 + rand() * 0.45) * k, 0.04 + rand() * 0.12);
  }
  // Blue clusters and pink knots close to the plane, mostly on the near side.
  const sKnot = makeSampler(knotW, W, H, rand), cl = glow([175, 205, 255]), kn = glow([255, 110, 180]);
  for (let n = Math.round(140 * k * k); n > 0; n--) {
    const [x, y] = sKnot();
    blob(ctx, rand() < 0.7 ? cl : kn, fx(x), fy(y), (0.7 + rand() * 1.4) * k, 0.12 + rand() * 0.2);
  }
  // Crisp dust along the lane, drawn as long thin dark streaks.
  ctx.globalCompositeOperation = "multiply";
  const sDust = makeSampler(dustW, W, H, rand), dSpr = shade([60, 40, 28]);
  for (let n = Math.round(700 * k * k); n > 0; n--) {
    const [x, y] = sDust();
    streak(ctx, dSpr, fx(x), fy(y), (6 + rand() * 18) * k, (1 + rand() * 1.8) * k, (rand() - 0.5) * 0.12, 0.2 + rand() * 0.35);
  }
  // Nucleus glow peeking over the lane.
  ctx.globalCompositeOperation = "lighter";
  blob(ctx, glow([255, 236, 205]), half, half - 0.006 * size, 0.02 * size, 0.4);

  dither(ctx, size, size, rand);
  vignette(ctx, size, size, 0.84, 0.99);
  return toTexture(c);
}

/* --- 3. Elliptical / lenticular galaxy ------------------------------------ */

export function ellipticalGalaxyTexture({ size = 512, seed = 3 } = {}) {
  const rand = rng(seed * 173 + 11);
  const k = size / 512, half = size / 2;
  const q = 0.66 + rand() * 0.18;
  const ang = rand() * Math.PI;
  const lens = rand() < 0.5; // half the seeds get a faint lenticular disc

  const { c, ctx } = makeCanvas(size, size, true);
  ctx.globalCompositeOperation = "lighter";
  // Softened de Vaucouleurs (Sersic n = 4) profile as a many-stop gradient,
  // stops packed toward the centre where the profile is steep. The profile
  // is linear light, so it is gamma-encoded to sRGB for a natural falloff.
  const R = 0.9 * half, re = 0.24, rc = 0.035;
  const I0 = Math.exp(-7.67 * (Math.pow(rc / re, 0.25) - 1));
  const layer = (sq, amp, warm) => {
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(ang);
    ctx.scale(1, sq);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * (i / 40);
      const rr = Math.hypot(t, rc);
      const I = Math.pow(Math.exp(-7.67 * (Math.pow(rr / re, 0.25) - 1)) / I0, 1 / 2.2) * smooth(0.95, 0.3, t) * amp;
      const cr = mix(255, 255, t), cg = mix(238, 196 - warm, t), cb = mix(208, 140 - warm, t);
      g.addColorStop(t, `rgba(${cr | 0},${cg | 0},${cb | 0},${clamp(I).toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(-R, -R, 2 * R, 2 * R);
    ctx.restore();
  };
  layer(q, 0.8, 0);
  if (lens) layer(q * 0.38, 0.18, 20);

  // Faint granularity and a sprinkling of globular clusters.
  const tints = [glow([255, 235, 205]), glow([255, 215, 175])];
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(TAU * rand());
  for (let n = Math.round(1500 * k * k); n > 0; n--) {
    const a = gauss() * 0.12 * size, b = gauss() * 0.16 * size * q;
    blob(ctx, tints[n & 1], half + a * ca - b * sa, half + a * sa + b * ca, (0.4 + rand() * 0.4) * k, 0.03 + rand() * 0.07);
  }
  for (let n = 40; n > 0; n--) {
    const a = gauss() * 0.2 * size, b = gauss() * 0.2 * size * q;
    blob(ctx, tints[0], half + a * ca - b * sa, half + a * sa + b * ca, (0.6 + rand() * 0.5) * k, 0.25 + rand() * 0.3);
  }

  dither(ctx, size, size, rand);
  vignette(ctx, size, size, 0.75, 0.98);
  return toTexture(c);
}

/* --- 4. Emission nebula --------------------------------------------------- */

export function nebulaTexture({ size = 1024, seed = 4, palette = ["#ff4f9d", "#7a5cff", "#21d4ff", "#ff9b5c"] } = {}) {
  const rand = rng(seed * 197 + 5);
  const T = makeNoise(rand);
  const k = size / 1024;
  const pal = palette.map(hex);
  while (pal.length < 4) pal.push(pal[pal.length - 1]);
  const [p0, p1, p2, p3] = pal;

  // Random offsets make each seed a different cloud; the hot spot is where
  // the ionising cluster sits.
  const ox = rand() * 50, oy = rand() * 50;
  const hx = (rand() - 0.5) * 0.35, hy = (rand() - 0.5) * 0.35;
  const elong = 0.8 + rand() * 0.4, rot = rand() * Math.PI;
  const cr = Math.cos(rot), sr = Math.sin(rot);

  const N = Math.round(size * 0.28);
  const data = new Uint8ClampedArray(N * N * 4);
  const densW = new Float32Array(N * N), dustW = new Float32Array(N * N), hotW = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const v = ((j + 0.5) / N) * 2 - 1;
    for (let i = 0; i < N; i++) {
      const u = ((i + 0.5) / N) * 2 - 1;
      const idx = j * N + i, o = idx * 4;
      data[o + 3] = 255;
      const rr0 = Math.hypot(u, v);
      if (rr0 > 0.97) continue;
      const X = u * 1.3 + ox, Y = v * 1.3 + oy;
      // One gentle domain warp: billowing clouds without a marbled swirl.
      const wx = fbm(T, X + 1.7, Y + 9.2, 3), wy = fbm(T, X + 8.3, Y + 2.8, 3);
      const Xw = X + 0.85 * wx, Yw = Y + 0.85 * wy;
      // Irregular envelope, always zero well inside the border.
      const eu = (u * cr + v * sr) / elong, ev = (-u * sr + v * cr) * elong;
      const fa = fbm(T, Xw * 1.2, Yw * 1.2, 5);
      const rr = Math.hypot(eu + 0.3 * wx, ev + 0.3 * wy) + 0.28 * fa;
      const env = smooth(0.85, 0.2, rr) * smooth(0.95, 0.7, rr0);
      if (env <= 0) continue;
      const hd = (u - hx) * (u - hx) + (v - hy) * (v - hy);
      const hot = Math.exp(-hd / 0.06);
      // Overlapping cloud layers, one per palette colour, like the separate
      // emission lines of a Hubble-palette image. The third colour (OIII-like)
      // concentrates around the hot ionising cluster.
      const fb = fbm(T, Xw * 1.6 + 31, Yw * 1.6 - 17, 5);
      const fc = fbm(T, Xw * 2.1 - 13, Yw * 2.1 + 23, 4);
      let A = smooth(-0.3, 0.45, fa); A *= A * env;
      let B = smooth(-0.2, 0.5, fb); B *= B * env;
      const C = smooth(-0.15, 0.45, fc) * env * (0.25 + 0.9 * hot);
      // Thin bright filaments: ridged noise, only where there is gas.
      const rg = 1 - Math.abs(fbm(T, Xw * 2.4 - 4, Yw * 2.4 + 3, 4));
      const rg2 = rg * rg * rg;
      const ridge = rg2 * rg2 * env * (0.25 + A + B);
      // Dark lanes and pillars, with a bright ionisation rim on their edge.
      const dn = fbm(T, X * 1.7 + 0.7 * wy + 5, Y * 1.7 + 0.7 * wx - 3, 5);
      const dust = smooth(0.14, 0.34, dn);
      const rim = smooth(-0.04, 0.12, dn) * smooth(0.22, 0.12, dn) * env;
      const D = rim * 0.38 + ridge * 0.2;
      const m = (1 - 0.88 * dust) * 0.82;
      // Faint diffuse glow fills the gaps between the bright clouds.
      const G = env * env * 0.14;
      const hw = hot * env * 0.22;
      data[o] = ((A + G) * p0[0] + (B + G) * p1[0] + C * p2[0] + D * p3[0] + ridge * 70 + hw * 255) * m;
      data[o + 1] = ((A + G) * p0[1] + (B + G) * p1[1] + C * p2[1] + D * p3[1] + ridge * 60 + hw * 238) * m;
      data[o + 2] = ((A + G) * p0[2] + (B + G) * p1[2] + C * p2[2] + D * p3[2] + ridge * 60 + hw * 220) * m;
      const em = (A + B + C + D + G) * m;
      densW[idx] = em;
      dustW[idx] = dust * dust * env * smooth(0.05, 0.3, A + B);
      hotW[idx] = em * em * (0.2 + hot);
    }
  }

  const { c, ctx } = makeCanvas(size, size, true);
  drawSoft(ctx, dataCanvas(data, N, N), 0, 0, size, size, 1.3 * k);

  // Soft wisps in the palette add mid-scale billows on top of the field.
  ctx.globalCompositeOperation = "lighter";
  const sD = makeSampler(densW, N, N, rand), pg = pal.map(glow);
  for (let n = Math.round(700 * k * k); n > 0; n--) {
    const [x, y] = sD();
    blob(ctx, pg[(rand() * 4) | 0], x * size, y * size, (4 + rand() * 14) * k, 0.03 + rand() * 0.06);
  }
  // Fine dust fingers, so the dark lanes have crisp structure up close.
  ctx.globalCompositeOperation = "multiply";
  const sDust = makeSampler(dustW, N, N, rand), dSpr = shade([25, 15, 20]);
  for (let n = Math.round(650 * k * k); n > 0; n--) {
    const [x, y] = sDust();
    streak(ctx, dSpr, x * size, y * size, (4 + rand() * 12) * k, (1.5 + rand() * 4) * k, rand() * Math.PI, 0.15 + rand() * 0.3);
  }
  // Field stars: faint and sub-pixel, dense where the cloud is bright.
  ctx.globalCompositeOperation = "lighter";
  const tints = STAR_TINTS.map(glow);
  for (let n = Math.round(1800 * k * k); n > 0; n--) {
    const [x, y] = sD();
    blob(ctx, tints[(rand() * 4) | 0], x * size, y * size, (0.5 + rand() * 0.7) * k, 0.15 + rand() * 0.4);
  }
  // A few bright young stars with halos and diffraction spikes.
  const sH = makeSampler(hotW, N, N, rand), spike = rand() * 0.3;
  for (let n = 7 + ((rand() * 6) | 0); n > 0; n--) {
    const [x, y] = sH();
    const s = (1.5 + rand() * rand() * 3.2) * k;
    brightStar(ctx, x * size, y * size, s, rand() < 0.6 ? [190, 215, 255] : [255, 235, 215], 0.6 + rand() * 0.35, spike, k);
  }

  dither(ctx, size, size, rand);
  vignette(ctx, size, size, 0.8, 0.98);
  return toTexture(c);
}

/* --- 5. Milky Way band ---------------------------------------------------- */

export function milkyWayBandTexture({ width = 2048, height = 512, seed = 5 } = {}) {
  const rand = rng(seed * 211 + 13);
  const T = makeNoise(rand);
  const k = height / 512;
  const asp = height / width;
  const ox = rand() * 40;

  const FW = Math.round(width * 0.3), FH = Math.round(height * 0.3);
  const data = new Uint8ClampedArray(FW * FH * 4);
  const lumW = new Float32Array(FW * FH), dustW = new Float32Array(FW * FH);
  for (let j = 0; j < FH; j++) {
    const yy = (((j + 0.5) / FH) * 2 - 1) * asp; // same units as x
    for (let i = 0; i < FW; i++) {
      const x = ((i + 0.5) / FW) * 2 - 1;
      const idx = j * FW + i, o = idx * 4;
      data[o + 3] = 255;
      const ax = Math.abs(x);
      const X = x + ox;
      const bul = Math.exp(-(x / 0.22) * (x / 0.22)); // galactic centre bulge
      const cy = 0.025 * fbm(T, X * 1.5, 0.5, 2);
      const w = (0.07 + 0.045 * bul + 0.015 * fbm(T, X * 3 + 5, 1.5, 2)) * asp * 4;
      const dy = (yy - cy) / w;
      const band = Math.exp(-dy * dy);
      const ends = smooth(0.97, 0.5, ax);
      // Star clouds: mottled, a bit elongated along the band.
      const cl = fbm(T, X * 7, yy * 11, 5);
      const mott = clamp(0.45 + 1.4 * cl, 0.08, 1.9);
      const lum = (band * mott * (0.42 + 0.6 * bul) + 0.2 * Math.exp(-dy * dy / 5)) * ends;
      // Great Rift: dark lanes meandering along the midline, long and thin.
      const ry = cy + 0.01 * asp * 4 + 0.012 * fbm(T, X * 2.5, 7.7, 2);
      const ld = (yy - ry) / (w * 0.42);
      const dn = fbm(T, X * 9 + 3, yy * 26 - 1, 4);
      const rift = Math.exp(-ld * ld) * smooth(-0.3, 0.15, dn) * smooth(0.85, 0.4, ax);
      const pat = smooth(0.2, 0.5, fbm(T, X * 6 - 7, yy * 14 + 4, 4)) * band;
      const dust = Math.min(0.9, rift * 0.85 + pat * 0.35);
      // Warm toward the centre, blue-white toward the ends.
      const t = smooth(0.05, 0.65, ax);
      const cR = mix(255, 190, t), cG = mix(224, 210, t), cB = mix(178, 255, t);
      const L = lum * 0.92;
      data[o] = cR * L * (1 - dust * 0.88);
      data[o + 1] = cG * L * (1 - dust * 0.91);
      data[o + 2] = cB * L * (1 - dust * 0.95);
      lumW[idx] = lum * (1 - dust * 0.9) + 0.02 * ends * smooth(1, 0.3, Math.abs(dy) / 4);
      dustW[idx] = rift * rift * band;
    }
  }

  const { c, ctx } = makeCanvas(width, height, true);
  drawSoft(ctx, dataCanvas(data, FW, FH), 0, 0, width, height, 1.2 * k);

  // Unresolved and resolved stars following the band.
  ctx.globalCompositeOperation = "lighter";
  const sL = makeSampler(lumW, FW, FH, rand), tints = STAR_TINTS.map(glow);
  const area = (width * height) / (2048 * 512);
  for (let n = Math.round(17000 * area); n > 0; n--) {
    const [x, y] = sL();
    const warm = Math.abs(x - 0.5) < 0.15 && rand() < 0.5;
    const b = rand();
    blob(ctx, tints[warm ? 2 + (n & 1) : (rand() * 3) | 0], x * width, y * height, (0.4 + b * 0.6) * k, 0.06 + b * b * 0.4);
  }
  for (let n = Math.round(70 * area); n > 0; n--) {
    const [x, y] = sL();
    const spr = tints[(rand() * 4) | 0];
    blob(ctx, spr, x * width, y * height, 3.5 * k, 0.12);
    blob(ctx, spr, x * width, y * height, (0.9 + rand() * 0.7) * k, 0.8);
  }
  // Crisp dust streaks along the rift.
  ctx.globalCompositeOperation = "multiply";
  const sDust = makeSampler(dustW, FW, FH, rand), dSpr = shade([40, 28, 22]);
  for (let n = Math.round(900 * area); n > 0; n--) {
    const [x, y] = sDust();
    streak(ctx, dSpr, x * width, y * height, (10 + rand() * 26) * k, (0.8 + rand() * 1.6) * k, (rand() - 0.5) * 0.3, 0.1 + rand() * 0.18);
  }
  // A few pink emission knots in the plane.
  ctx.globalCompositeOperation = "lighter";
  const kn = glow([255, 105, 160]);
  for (let n = Math.round(14 * area); n > 0; n--) {
    const [x, y] = sL();
    blob(ctx, kn, x * width, y * height, (1.2 + rand() * 2) * k, 0.1 + rand() * 0.12);
  }

  dither(ctx, width, height, rand);
  // Separable vignette: fade all four edges to black.
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 1;
  const gx = ctx.createLinearGradient(0, 0, width, 0);
  const gy = ctx.createLinearGradient(0, 0, 0, height);
  for (let i = 0; i <= 20; i++) {
    const t = i / 20, e = Math.min(t, 1 - t);
    const vx = Math.round(255 * smooth(0, 0.14, e)), vy = Math.round(255 * smooth(0.02, 0.2, e));
    gx.addColorStop(t, `rgb(${vx},${vx},${vx})`);
    gy.addColorStop(t, `rgb(${vy},${vy},${vy})`);
  }
  ctx.fillStyle = gx; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = gy; ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  return toTexture(c);
}
