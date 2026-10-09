# Voyage - Earth to Kepler-452b

A scroll-driven 3D journey built with Three.js. The Space Shuttle stands on its
launcher at Launch Complex 39A on the Florida coast; scrolling lights the
engines, and the stack climbs through the clouds and the layers of the
atmosphere into space, shedding its boosters and tank. From there the orbiter
flies past the Moon, Mars, Jupiter, Saturn and the ice giants, through the
Kuiper belt and the Oort cloud, across the interstellar nebulae, and finally
makes one full orbit of Kepler-452b before descending through its atmosphere
to a surface base.

## Run

Models and textures are loaded over `fetch`, so the folder must be served over
HTTP (opening `index.html` via `file://` will not work):

```bash
python3 -m http.server 8123
# then open http://localhost:8123
```

## Files

- `index.html` - the scroll panels; each declares the point of the voyage it narrates (`data-t`)
- `styles.css` - layout, gradient titles, scroll-driven text reveals
- `app.js` - the whole scene: atmosphere scattering, the launch site, planets, nebulae, the flight and the landing
- `lib/ksc.js` - the Kennedy Space Center buildings (VAB, Launch Control Center, hangar, countdown clock)
- `lib/deepsky.js` - painted galaxies and nebulae for the deep-space backdrop
- `models/` - the gantry and the spaceship
- `3D Models/`, `Images and Textures/` - NASA public-domain models and textures

## How the launch works

A planet of radius R seen from altitude h looks the same as one of radius kR
seen from kh. So Earth is a sphere whose radius shrinks as the ship climbs,
pinned under the launch site: at ground scale the pad and coast read as flat
land, and by orbit it is the globe the rest of the voyage uses. The sky and the
glowing limb come from one physically based scattering model, so the blue
daytime sky, the darkening through the layers and the thin blue line seen
from space are the same atmosphere at different altitudes. Kepler-452b uses
the same idea in reverse for the landing.

## Branches

- `main` - the original single-model version.
- `multi-spaceship-components` - the multi-component launch and landing.
- `refinements` - this version: detailed launch site and exhaust, distance-revealed planets, moons and waymarks, painted deep sky.
