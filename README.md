# Scroll-driven Space Shuttle - branch `multi-spaceship-components`

**This is the latest branch** (2026-06-16 13:45). The shuttle dismantles into two
separate components as it enters the atmosphere, rather than remaining a single
model through the whole scroll timeline.

For the project overview, attribution and run instructions, see the README on
`main`.

## What this branch changes

- 1 commit ahead, 0 commits behind `main`
- 3 files changed, 372 insertions, 244 deletions
- Commit: "Spaceship dismantles into 2 seperate parts upon entering the atmosphere"

| File | Lines changed | Change |
| --- | --- | --- |
| `app.js` | 507 | Scene and scroll timeline rewritten to load, position and animate two independent model components, splitting them at the atmospheric-entry point in the timeline |
| `index.html` | 95 | Scroll sections restructured for the new sequence |
| `styles.css` | 14 | Layout adjustments |

Both `Space Shuttle (1).glb` and `Space Shuttle Orbiter.glb` are used here, where
`main` uses only the first.

## Status

**Clean superset of `main`.** This branch is 1 commit ahead and 0 behind, so
merging it into `main` is a fast-forward with no conflicts. The dismantling
animation exists only here.

## Run

The `.glb` files are loaded over `fetch`, so serving over HTTP is required.
Opening `index.html` through `file://` will fail.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```
