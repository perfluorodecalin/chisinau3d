# Performance checks

## Offline compiler update

The game now loads prebuilt binary geometry. See [ARCHITECTURE.md](ARCHITECTURE.md)
for the current pipeline and streaming limits; the earlier optimization notes below
describe the algorithms reused by the compiler.

The full saved world produces 3,843 spatial files (about 126 MiB compressed),
60,663 building records and 107,382 prepared driving road segments. The initial
centre view loaded 52 chunks with 3,153 buildings in the local Chrome check. No
`data/` snapshot requests or JavaScript errors occurred in atlas/day/night driving.
An initial instance-attribute serialization bug was found through screenshot
inspection, corrected and covered by the binary-format regression tests.

Chrome used Microsoft Basic Render Driver at 1280 × 720: this is software rendering,
not a hardware GPU benchmark. The corrected check measured approximately 7 FPS
in the atlas, 13–15 FPS driving by day and 7 FPS at night. These figures do not
establish a speedup against the previous version; the loaded extent also differs.
Audio was not listening-tested during this refactor.

Run `npm run build` before the static benchmark. Add `--world-smoke` to check
building picking, color modes, district loading and distant-chunk disposal.

The September 2026 optimization pass keeps Three.js 0.180.0 and the saved world. It changes how geometry is prepared and submitted, without changing mapped footprints, road widths, terrain heights, bridge connections or collision rules.

## Changes

- City ingestion yields to a browser task instead of waiting for the next animation frame. A slow renderer no longer limits geometry preparation to one short work slice per frame. Browsers without `scheduler.yield()` use a timer fallback.
- Terrain draping reuses vertex and midpoint buffers, writes into growing typed arrays, and reuses sampled heights within each subdivided triangle. Subdivision order, interpolation, normals and the depth limit match the previous implementation.
- Roads, lane markings, parks, water, vegetation ground surfaces, sidewalks and crossings are partitioned into 500 m cells. Frustum culling can skip distant sections of a large surface instead of submitting a citywide mesh. This can increase draw calls while reducing submitted triangles; hardware-specific profiling still matters.
- Daylight excludes the eight local lamp lights and inactive headlights from the renderer's light lists. Transparent lamp glows are also skipped during daylight. Night restores the existing light pool and glow behavior.
- Procedural vegetation instances beyond roughly 2 km are hidden at street level, using each batch's bounds and the existing periodic visibility update. The overhead atlas retains the wider vegetation view. Collision geometry is retained.
- Bench orientation uses nearby indexed road segments. Equal-distance ties preserve source order, and isolated locations fall back to the original full search.

The earlier pass generated the city at runtime. The offline compiler now replaces
that path and unloads distant geometry during driving. Explicitly loading the
entire city in atlas mode can still consume substantial memory.

## Reproduce

```sh
npm ci
npm test
npm run build
npm run benchmark -- --output .local/perf --profile
```

The optional benchmark needs a local Chrome/Chromium executable. On Windows it defaults to `C:/Program Files/Google/Chrome/Application/chrome.exe`; set `CHROME_PATH` for another installation or operating system. No browser automation package is required.

It starts a loopback static server under `/chisinau3d/`, opens an isolated headless browser at 1280 × 720 and device pixel ratio 1, waits for the initial city and street details, then measures ten seconds each of atlas, stationary driving, forward driving and night driving. It saves `report.json`, `scene.png`, and, with `--profile`, `startup.cpuprofile`. Reports and local tools in `.local/` are ignored by Git.

To check the development server, start `npm run dev` and pass its URL:

```sh
npm run benchmark -- --url http://localhost:5173/ --output .local/perf-dev
```

Use `--root PATH_TO_SAVED_DIST` to benchmark a previous snapshot. Use `--timeout 600` for a slow baseline. Run comparisons with the same browser, viewport, graphics setting and hardware. Startup is observed by polling every five seconds, so the reported ready time is an upper bound. Moving phases can cover different distances on very slow renderers because physics catch-up is bounded; compare the stationary phases for a matching camera position.

## Validation and limitations

Observed on 11 September 2026, with headless Chrome 152, Balanced graphics and the software driver described below:

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial city and street details ready (observed) | 187.7 s | 15.2 s |
| Stationary atlas FPS | 1.58 | 3.17 |
| Stationary driving FPS | 2.18 | 4.65 |
| Stationary driving p95 frame time | 483 ms | 250 ms |
| Submitted triangles, stationary driving | 2,762,814 | 1,706,127 |
| Draw calls, stationary driving | 1,061 | 1,304 |

These are individual local runs, not statistical guarantees or hardware-GPU results. A preliminary baseline timed out after 246 seconds; the table uses the subsequent completed baseline with matching city coverage. Both completed runs had zero captured JavaScript exceptions, console errors or failed network transports. The browser's automatic favicon request returned 404; all application modules and requested map assets loaded successfully. The focused subdivision test measured roughly 4–8× faster geometry processing across local runs.

A separate run through `npm run dev` also completed city loading and all four rendering/driving phases with zero captured errors; initial readiness was observed at 17.5 seconds.

`npm test` covers the original physics/road/terrain/light checks and additional regressions: 70 exact draping cases, preservation of every attribute on 2,972 sampled road triangles after batching, indexed water geometry, and all 573 saved bench/crossing queries that need a nearest-road fallback. The subdivision benchmark reports timings but does not use machine-dependent speed thresholds as CI assertions.

The available headless Chrome uses **Microsoft Basic Render Driver**, a software renderer. It can validate WebGL startup, screenshots and runtime errors, but its FPS is not representative of an ordinary GPU. Browser validation covered the initial 12,414 buildings, 27,839 mapped/row trees and 1,246 benches. The saved snapshots and vendored Three.js files were unchanged. Sound remained opt-in; no audible verification is claimed.
