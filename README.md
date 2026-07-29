# Scroll-driven Space Shuttle

A scroll-controlled 3D space-shuttle site. Independent re-implementation of
[this CodePen by Steve Gardner (ste-vg)](https://codepen.io/ste-vg/pen/GRooLza),
built with Three.js and GSAP ScrollTrigger.

**One change from the original:** the 3D model is the supplied
`Space Shuttle (1).glb`, auto-centred and auto-scaled at runtime. This is noted
in the header comments of `index.html` and `app.js`.

## Run

The `.glb` is loaded over `fetch`, so it must be served over HTTP. Opening
`index.html` via `file://` will fail. From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

- `index.html` - markup, scroll sections, import map
- `styles.css` - layout and type
- `app.js` - Three.js scene and GSAP scroll timeline
- `Space Shuttle (1).glb` - the model used
- `Space Shuttle Orbiter.glb` - second model, used by the multi-component branch

## Branches

| Branch | Head | Last commit | Relative to `main` | What it contains |
| --- | --- | --- | --- | --- |
| `main` (default) | `ca79cdb2` | 2026-06-16 08:30 | baseline | Single-commit baseline. One shuttle model flying through the scroll timeline. |
| `multi-spaceship-components` | `e6e03873` | 2026-06-16 13:45 | 1 ahead, 0 behind | Latest. The shuttle dismantles into two separate parts on atmospheric entry. 3 files changed, 372 insertions, 244 deletions, with `app.js` rewritten heavily (507 lines touched) and the scroll sections in `index.html` restructured (95 lines). Commit: "Spaceship dismantles into 2 seperate parts upon entering the atmosphere". |

**Latest branch: `multi-spaceship-components`**, 2026-06-16 13:45, about 5 hours
after `main`.

It is 1 commit ahead of `main` and 0 behind, so it is a clean superset. The
dismantling animation exists only there. Merging it into `main` is a
fast-forward, with no conflicts to resolve.
