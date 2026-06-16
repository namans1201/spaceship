# Scroll-driven Space Shuttle

A scroll-controlled 3D space-shuttle site. Independent re-implementation of
[this CodePen by Steve Gardner (ste-vg)](https://codepen.io/ste-vg/pen/GRooLza),
built with **Three.js + GSAP ScrollTrigger**.

**One change from the original:** the 3D model is the supplied
`Space Shuttle (1).glb` (auto-centered and auto-scaled at runtime), noted in the
header comments of `index.html` and `app.js`.

## Run

The `.glb` is loaded over `fetch`, so you must serve over HTTP (opening
`index.html` via `file://` will fail). From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files
- `index.html` — markup, scroll sections, import map
- `styles.css` — layout & type
- `app.js` — Three.js scene + GSAP scroll timeline
