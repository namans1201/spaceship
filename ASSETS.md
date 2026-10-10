# Assets used by the voyage

Every file below is loaded by the site and is committed to the repository, so a plain `git clone` is a complete working copy.
NASA models and textures are public domain. The folders `3D Models/` and `Images and Textures/` are listed in `.gitignore` (the full local NASA library is about 1.4 GB), so only the files below are force-added.
To add another asset from the library: `git add -f "3D Models/<folder>/<file>.glb"`.
Total: 40 files, 30.4 MB.

## 3D models (18)

| File | Size | Used for |
|---|---|---|
| `Space Shuttle (1).glb` | 0.20 MB | Shuttle stack (orbiter, tank, boosters) on the pad and through ascent |
| `Space Shuttle Orbiter.glb` | 0.10 MB | Standalone orbiter for the cruise and landing (crossfaded in after tank separation) |
| `models/Gantry.glb` | 1.39 MB | Launch tower and mobile launcher at LC-39A |
| `models/Spaceship.glb` | 0.02 MB | Parked craft at Base One |
| `3D Models/Crawler/Crawler.glb` | 1.63 MB | Crawler-transporter beside the pad |
| `3D Models/Habitat Demonstration Unit/Habitat Demonstration Unit (part 1).glb` | 0.52 MB | Habitat at Base One |
| `3D Models/Deep Space Network 34-meter/Deep Space Network 34-meter.glb` | 2.90 MB | Radio dish at Base One |
| `3D Models/Deep Space Network 70-meter/Deep Space Network 70-meter.glb` | 1.87 MB | Large radio dish at Base One |
| `3D Models/Headquarters Building/Headquarters Building.glb` | 0.21 MB | Control building at Base One |
| `3D Models/Astronaut/Astronaut.glb` | 0.76 MB | Two astronauts at Base One |
| `3D Models/International Space Station (ISS) (A)/International Space Station (ISS) (A).glb` | 0.04 MB | ISS in low Earth orbit (light 6.6k-triangle version) |
| `3D Models/Hubble Space Telescope (A)/Hubble Space Telescope (A).glb` | 1.69 MB | Hubble in low Earth orbit |
| `3D Models/Apollo Lunar Module/Apollo Lunar Module.glb` | 0.72 MB | Lander on the Moon |
| `3D Models/1999 RQ36 asteroid/1999 RQ36 asteroid.glb` | 0.33 MB | Bennu, three copies in the asteroid belt |
| `3D Models/Dawn/Dawn.glb` | 0.93 MB | Dawn probe in the asteroid belt |
| `3D Models/Galileo/Galileo.glb` | 0.25 MB | Galileo probe at Jupiter |
| `3D Models/Cassini-Huygens (A)/Cassini-Huygens (A).glb` | 1.66 MB | Cassini at Saturn |
| `3D Models/Ares 1 (A)/Ares 1 (A).glb` | 0.10 MB | Ares 1 on pad 39B at the opening |

## Textures (22)

| File | Size | Used for |
|---|---|---|
| `Images and Textures/Tycho Star Map/Tycho Star Map.jpg` | 4.15 MB | Star background; its stars are redrawn as smooth points |
| `Images and Textures/Earth (A)/Earth (A).jpg` | 1.40 MB | Earth surface |
| `Images and Textures/Saturn - Rhea/Saturn - Rhea.jpg` | 0.46 MB | Stand-in surface for the Moon, and the moon Rhea |
| `Images and Textures/Mars/Mars.jpg` | 0.97 MB | Mars |
| `Images and Textures/Jupiter/Jupiter.jpg` | 0.23 MB | Jupiter |
| `Images and Textures/Saturn/Saturn.jpg` | 0.28 MB | Saturn |
| `Images and Textures/Neptune/Neptune.jpg` | 0.21 MB | Neptune |
| `Images and Textures/Pluto/Pluto.jpg` | 0.35 MB | Pluto |
| `Images and Textures/Mars - Phobos/Mars - Phobos.jpg` | 0.60 MB | Phobos |
| `Images and Textures/Mars - Deimos/Mars - Deimos.jpg` | 0.48 MB | Deimos |
| `Images and Textures/Jupiter - Io (A)/Jupiter - Io (A).jpg` | 0.70 MB | Io |
| `Images and Textures/Jupiter - Europa/Jupiter - Europa.jpg` | 0.61 MB | Europa |
| `Images and Textures/Jupiter - Ganymede/Jupiter - Ganymede.jpg` | 0.71 MB | Ganymede |
| `Images and Textures/Jupiter - Callisto/Jupiter - Callisto.jpg` | 0.78 MB | Callisto |
| `Images and Textures/Saturn - Titan/Saturn - Titan.jpg` | 0.05 MB | Titan |
| `Images and Textures/Saturn - Enceladus/Saturn - Enceladus.jpg` | 0.47 MB | Enceladus |
| `Images and Textures/Saturn - Dione/Saturn - Dione.jpg` | 0.57 MB | Dione |
| `Images and Textures/Saturn - Tethys/Saturn - Tethys.jpg` | 0.60 MB | Tethys |
| `Images and Textures/Saturn - Mimas/Saturn - Mimas.jpg` | 0.51 MB | Mimas |
| `Images and Textures/Saturn - Iapetus/Saturn - Iapetus.jpg` | 0.38 MB | Iapetus |
| `Images and Textures/Neptune - Triton/Neptune - Triton.jpg` | 0.24 MB | Triton |
| `Images and Textures/Pluto - Charon/Pluto - Charon.jpg` | 0.27 MB | Charon |

## Draco-compressed models

14 of the 18 models are Draco-compressed (the format NASA ships them in): Gantry, Crawler, Habitat, both Deep Space Network dishes, Headquarters, Astronaut, ISS, Hubble, Apollo lander, Dawn, Galileo, Cassini and Ares 1. The site decodes them with `DRACOLoader`. Viewers without Draco support (Finder preview, Windows 3D Viewer, some online viewers) cannot open them and report an error; this is not file corruption. Plain copies can be made with `npx @gltf-transform/cli copy <in.glb> <out.glb>`.

## Generated in code (no files)

- Clouds, night-side city lights, Kepler-452b surface, Uranus bands, soft sprites (glow, smoke, nebula): painted on canvases at load.
- Spiral, edge-on and elliptical galaxies, emission nebulae, Milky Way band: `lib/deepsky.js`.
- Kennedy Space Center buildings (VAB with flag and insignia, Launch Control Center, hangar) and the countdown clock: `lib/ksc.js`.
- Launch-pad props (water tower, storage spheres), Base One props (masts, tanks, solar field, silos, ridges): built from primitives in `app.js`.
- Atmospheres, ground terrain, planets' surface detail, rings: GLSL shaders in `app.js`.

## In the working folder but not used

- `models/Space Shuttle.glb` (untracked, unused).
- Everything else in the local NASA library (about 100 more models and 45 more textures), deliberately left out of the repo.
