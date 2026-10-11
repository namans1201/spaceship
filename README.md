# Stellar Voyager: Earth to Kepler-452b

A scroll-driven 3D journey built with Three.js. The Space Shuttle stands on its
launcher at Launch Complex 39A on the Florida coast; as you scroll, it lights
its engines, climbs through the atmosphere, crosses the solar system and the
interstellar dark, and finally lands at a base on Kepler-452b. There is no
build step: it is plain HTML, CSS and ES modules.

## What you see

- Launch from LC-39A at Kennedy Space Center, with the VAB, Launch Control Center and countdown clock, the crawler and Ares 1 on the next pad
- Liftoff through clouds and the layers of the atmosphere, the sky going from blue to black
- Booster and external tank separation, with the ISS and Hubble passed in Earth orbit
- The Moon, with dark maria and an Apollo lunar module on the surface
- Mars with Phobos and Deimos, then the asteroid belt (Bennu and the Dawn probe)
- Jupiter and Saturn, with their moons and the Galileo and Cassini probes
- Uranus and Neptune, the Kuiper belt and the Oort cloud
- Interstellar nebulae and galaxies painted for the deep-sky backdrop
- One full orbit of Kepler-452b, then entry, descent and touchdown at Base One

Titles in the panels carry a short note that opens on hover or keyboard focus.

## Run it

A plain `git clone` gives a complete working site: every model and texture the
site loads is committed in the repository.

```bash
git clone https://github.com/namans1201/stellar-voyager.git
cd stellar-voyager
python3 -m http.server 8123
```
or
```
python -m http.server 8123

```


Then open http://localhost:8123

The site must be served over HTTP. Models are loaded with `fetch`, so opening
`index.html` through `file://` will not work. If you prefer Node, this does the
same job:

```bash
npx serve -l 8123
```

Node is not otherwise needed: there is no build step and no `npm install`.

Requirements:

- A modern browser with WebGL2
- An internet connection: three.js 0.160.0 (r160) and its Draco decoder are loaded from unpkg through the import map in `index.html`. To work offline, vendor those files and point the import map and the `DRACOLoader` decoder path in `app.js` at your copy

The folder also has a `.claude/launch.json` so Claude Code can start the same
server (`python3 -m http.server 8123`) as a preview.

## Folder layout

```
index.html              panels and import map
styles.css              layout and text reveals
app.js                  the whole scene
lib/
  ksc.js                Kennedy Space Center buildings
  deepsky.js            painted galaxies and nebulae
ASSETS.md               every model and texture the site loads, with sizes and what it is used for
models/                 Gantry.glb, Spaceship.glb
Space Shuttle (1).glb   the launch stack (orbiter, tank, boosters)
Space Shuttle Orbiter.glb   the orbiter alone, for the rest of the flight
3D Models/              NASA models used by the site (one folder per model)
Images and Textures/    NASA planet, moon and star-map textures (one folder per image)
.claude/launch.json     preview server definition
```

Paths are resolved relative to `index.html`, so keep `3D Models/`,
`Images and Textures/` and `models/` beside it. The site loads 40 asset files
(about 30 MB); [ASSETS.md](ASSETS.md) lists each one and what it is for.

## Opening the models in a viewer

14 of the 18 models are Draco-compressed (that is how NASA ships them). The site
decodes them with three.js's `DRACOLoader`, but some viewers (Finder preview,
Windows 3D Viewer, some online viewers) cannot open Draco files and report an
error. Blender, the three.js editor and the Don McCurdy glTF viewer open them
fine. To get plain copies, run for example:

```bash
npx @gltf-transform/cli copy "models/Gantry.glb" "Gantry-plain.glb"
```

## Using more of the NASA library

`3D Models/` and `Images and Textures/` are listed in `.gitignore`, because the
full NASA library is far larger than the site needs. The repository force-adds
only the files the site actually loads, so a stray `git add .` cannot stage the
whole library. If you add a new asset from the full library, you must add it
explicitly:

```bash
git add -f "3D Models/Some Model/Some Model.glb"
```

## How it works

**Scroll is a timeline.** Every `<section class="panel">` in `index.html`
declares a `data-t` between 0 and 1: the point of the voyage it narrates.
`app.js` measures where each panel sits centred in the page and interpolates
between those scroll positions, so panels can have different heights (the
finale gets more scroll room) without throwing the scene out of sync with the
text. The result is eased with a frame-rate-independent exponential so
trackpad and momentum scrolling stay smooth, and one function places the ship
and camera for any point on the timeline.

**The shrinking Earth.** A planet of radius R seen from altitude h looks the
same as one of radius kR seen from kh. So Earth is a sphere whose radius
shrinks as the ship climbs, pinned under the launch site: at the pad it is
12,000 units across, so the coast reads as flat land, and by orbit it has
become the 112-unit globe the rest of the voyage uses. The radius follows a
monotone cubic curve so the apparent climb rate never jumps. Kepler-452b uses
the same idea in reverse for the landing.

**One atmosphere model.** The sky and the glowing limb come from a single
physically based scattering shader (Rayleigh and Mie, integrated along the view
ray), so the blue daytime sky, the darkening through the layers and the thin
blue line seen from space are the same atmosphere at different altitudes.
Kepler-452b gets its own coefficients for a thicker, greener-scattering sky.

**Instanced sprite effects.** Rocket exhaust and pad smoke (a particle system
driven by mission time, so it plays backward as you scroll up), engine glow,
nebulae and star glints are batches of camera-facing quads, one instanced draw
per batch, with positions, sizes and colours held in instance attributes. Star
fields and distant dust are soft point sprites that stay anti-aliased at every
size. Clouds are not sprites: they are a shaded cloud layer on the planet itself.

**Distance-scaled planets.** Planets and moons are not simply placed at scale.
Each body's size is a function of how close the camera is relative to its
closest approach, so a far-off world is a small disc that grows as you close in
rather than a blur that fades in. Moons and probes use the same schedule as
the giants they orbit.

**Baked and merged models.** The library models are loaded after the opening is
up and merged by material into a handful of draw calls, and each is drawn only
inside its own window of the voyage. Where several draws would otherwise
exist (the gantry's struts, the KSC buildings), they are baked to a few.

**Hover notes on titles.** Each panel's description is a tooltip on its title,
shown on hover or keyboard focus and tied to the title with `aria-describedby`
for screen readers. A little script flips the note above the title when there
is not enough room below it.

## Performance and quality

- Adaptive resolution: the pixel ratio starts at the device ratio capped at 1.5, steps down (to a floor of 0.85) when the frame budget is blown for a sustained stretch, and back up when there is headroom. It never changes mid-scroll, since a resize is itself a dropped frame
- Shader warm-up: while the loader is up, the app renders real frames across the timeline so every shader is compiled before you start scrolling, rather than stalling when something first appears. The late-loaded models are compiled as they arrive
- Late loading: moon textures, the library craft and the Base One modules load after the opening is already usable
- Draw calls: measured at roughly 55 to 190 per frame across the voyage (112 at the opening, 187 at touchdown), using merged geometry and instancing. Frame time averaged under 6 ms in testing, with the worst frame near 20 ms at touchdown
- Post-processing: bloom runs at quarter resolution, and the composer uses 4x MSAA when the GPU can multisample a half-float buffer

## Troubleshooting

- Blank page or "Could not load assets - serve over http": you opened `index.html` through `file://`. Serve the folder over HTTP (see Run it)
- 404s on models or textures in the browser console: a folder is missing or was moved. `3D Models/`, `Images and Textures/` and `models/` must sit beside `index.html`, and the two shuttle `.glb` files must be in the project root. Restore them from git (`git checkout -- .`) or re-clone
- Black screen with a network error for three.js: unpkg is unreachable. Check your connection, or vendor three.js as described above
- Slow or choppy on a weak GPU: close other tabs and heavy apps, or make the browser window smaller. Fewer pixels is the biggest saving, and the adaptive resolution will also lower the render scale for you

## Credits

- NASA public-domain models and textures
- [three.js](https://threejs.org) (r160)

## License

Code license: TODO - to be decided by the owner.

NASA media (models and textures) is public domain.

## Branches

`main` is the current version and the one you get from a plain clone. The two
earlier stages are kept as branches (and tags) so the history stays browsable:

| Branch | Tag | What it is |
|---|---|---|
| `main` | `v3` | Stellar Voyager: detailed launch site and exhaust, distance-scaled planets, moons and probes, painted deep sky, the library models, a smooth finale |
| `v2-multi-components` | `v2` | The second stage: launch from LC-39A, layered atmosphere, the spaceship separating into parts, Kepler-452b landing |
| `v1-initial-draft` | `v1` | The first draft: the original single-model version |

To look at an earlier stage: `git clone -b v1-initial-draft https://github.com/namans1201/stellar-voyager.git`
