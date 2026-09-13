# LOD implementation plan

Status: staged implementation. The first runtime culling slice is implemented in
`dist/lod.js` and `dist/app.js`; the offline compiler now emits topology-safe
terrain variants. Building and street-detail simplification remain planned work.
No performance claims are made until a capable-browser benchmark.

The current slice culls building, park and small-detail batches by distance. The
existing atmosphere controller still owns vegetation and lamp visibility; those
layers are intentionally reserved for a later coordinated pass.

## Design

Extend the existing compiled spatial chunks with independently loadable visual
levels. Keep rendering detail separate from collision, road-height and spawn data.
Make LOD decisions per spatial batch, preserving instancing and shared materials.
Generate every level offline from the bundled snapshots. The current compiler
emits 40 m and 80 m terrain candidates from each 20 m patch, with exact source
normal and position samples retained on every patch edge. Other layers stay at
canonical geometry until topology-aware simplification is implemented.

Current constraints:

- Most meshes use approximately 500 m cells; terrain uses 1.28 km patches.
  Multiple source/layer files can occupy one cell, and actual bounds cross cells.
- Chunks currently bundle meshes and physics. Ingestion registers both; eviction
  rebuilds resident physics indexes and building inspection records.
- Driving evicts beyond 3.5 km. Atlas “Load wider city” can retain all chunks.
- Graphics presets currently change pixel ratio only. Atmosphere also controls
  vegetation/lamp visibility periodically; it must not override LOD visibility.
- Buildings are already simple extrusions with procedural facades. Terrain,
  repeated street geometry and draw submission are better first targets.

## Initial visual levels

The distances below are tuning seeds for driving, measured to actual batch bounds,
not fixed acceptance criteria. Atlas views should use projected error instead.

| Layer | Near: roughly 0–250 m | Middle: roughly 250–900 m | Far: beyond roughly 900 m |
| --- | --- | --- | --- |
| Terrain | Existing 20 m mesh | 40 m candidate mesh | 80 m, then 160 m candidate mesh |
| Buildings | Current geometry and facades | Same footprints/heights; cheaper facade treatment | Validated simplified extrusions with stable building IDs |
| Road/deck surfaces | Current geometry | Preserve surfaces and connectivity | Preserve road/deck continuity; simplify only within measured error bounds |
| Markings, crossings, sidewalks | Current detail | Fade or omit small paint; retain readable sidewalks | Omit subpixel detail; preserve necessary ground coverage |
| Trees | Existing atmosphere visibility | Lower-poly instanced crowns/trunks | Coarse crowns where visible; cull subpixel trees |
| Benches, lamp poles, railings | Current detail (benches/details are cullable) | Simplified meshes or size-based culling | Cull subpixel furniture; preserve meaningful bridge silhouettes |
| Night lights | Existing eight-light pool | Existing glow behavior | Existing glow fade; no additional real lights |

Preserve mapped versus estimated provenance, building courtyards, vertical openings,
water levels, road widths and bridge shared-node connectivity. Never apply visual
simplification to physics. If safe building simplification gives little reduction,
retain existing geometry and pursue batching/material savings instead.

## Selection and transitions

`dist/lod.js` provides the initial pure policy module. A future
`dist/world-streamer.js` can extend it for independent visual residency.
Use compiler-measured geometric error projected through camera FOV and drawing-buffer
height. Start with error budgets of Low 4 px, Balanced 2 px and High 1 px; validate
these in rendered views. Measure shader/detail culling separately by projected size.

Use conservative camera-to-bound distance with near-plane protection. Consider
height in atlas views so overhead zooming selects appropriate terrain/building
levels. Independently protect a near-car visual area so overhead driving cameras
retain useful road detail.

Evaluate indexed candidates at 5–10 Hz and after teleports or quality changes.
Use about 20% hysteresis and a short minimum dwell time to avoid oscillation.
Frustum tests prioritize visual requests; physics coverage surrounds the car in
all directions. Do not scan every city object each frame.

Keep the current level visible until its replacement is decoded and attachable.
Swap opaque geometry atomically initially; avoid doubling draws with general
crossfades. Add short dither transitions only where browser review shows popping.
One composed visibility policy must combine LOD, layer toggles and day/night state.

## Compiler and format

1. Version the manifest/binary contract together. Give each logical chunk stable
   identity within the build, actual 3D bounds, layer, and separate physics/metadata
   references. Visual variants include file, level, error, triangle/instance counts,
   compressed bytes and estimated decoded/GPU bytes.
2. Emit visual variants independently so distant views do not download full detail.
   Keep canonical building records separate from triangle spans. Each selectable
   variant maps its triangles to those records; export/counts must not duplicate
   buildings or change just because visual levels switch.
3. Generate terrain candidates from the same height field. Measure error against
   the current rendered terrain, including water corrections. Preserve continuous
   normals and shared borders using locked boundary samples for the first version.
   If border overhead warrants it later, add restricted neighbor levels and stitch
   indices. Skirts alone do not prevent terrain/road intersections.
4. Constrain coarse terrain beneath draped roads, sidewalks, water boundaries and
   building bases. Refine locally where needed; do not let coarsening expose gaps
   or bury surfaces. Bridge decks remain separate from underlying ground terrain.
5. Add simplified instance geometry with unchanged placement/transforms. Introduce
   semantic sublayers where existing `details` or `roads` batches mix objects with
   different culling rules.
6. Only then attempt topology-preserving building simplification offline. Validate
   holes, height, foundations and roof silhouette; regenerate picking spans rather
   than reusing spans from the original geometry.

Preserve deterministic output, content-hashed assets, input-hash invalidation and
manifest-last publication. Update compiler input tracking for new source modules.

## Streaming and physics safety

Use independent visual and physics residency maps. A visual swap must never call
`driving.clearCompiled()` or add duplicate obstacles. Retain global DEM and bridge
profiles unchanged. Physics eviction depends on the car and required safety area,
not camera zoom, visibility or selected mesh level.

Prioritize nearby physics and driveable surfaces, then visible coarse coverage,
then refinement. Preload along velocity while retaining coverage for reversing
and turning. Size the safety margin using maximum travel over measured load latency
plus braking distance. If physics coverage is unavailable, hold the car at the last
safe position with a loading indication; starting/resetting requires ready physics.

Keep four concurrent fetches initially, but separate download completion from GPU
attachment. Budget attachment per frame, allowing one oversized item to make
progress, and record stalls. Track request generations so teleports and district
changes discard stale results. Cancel obsolete fetches where possible, retain a
working level on failure, and retry with bounded backoff.

Track bytes as well as chunk counts. Evict unneeded fine levels first; release
buffers and references without disposing shared materials still in use. Allow
brief replacement overlap within an explicit reserve. Choose preset memory caps
after measuring actual assets and a capable browser. Atlas “Load wider city” should
load coarse coverage for the whole city and refine locally; describe this change
in the UI/docs rather than implying it retains every full-resolution mesh.

## Delivery order and verification

1. **Baseline and observability:** add per-layer triangles/draws, resident bytes,
   requested/displayed LOD, queue length, swaps and attachment timings. Extend the
   benchmark with repeatable camera poses and routes. Capture current results.
2. **Residency separation:** implement the new format and independent metadata,
   physics and visuals with one visual level. Verify unchanged gameplay, picking,
   colors, export and disposal before adding simplification.
3. **Terrain LOD:** add error measurements, boundary constraints and selection.
   Inspect mixed-level borders, steep streets, shorelines and bridge approaches.
4. **Street-detail LOD:** simplify instances and cull small detail. Resolve ownership
   of atmosphere visibility; preserve the bounded light pool and night glows.
5. **Building LOD and atlas coverage:** add validated variants where beneficial,
   support picking/highlighting for active geometry, and load coarse distant city.
6. **Tune and document:** connect presets to error/detail/memory budgets; choose
   final thresholds from repeatable day/night driving and atlas measurements.

For each relevant implementation stage run `npm test`, `npm run build` and
`npm run verify:world`. Add focused regressions for deterministic variants, bounds,
error bounds, mixed-level terrain seams, canonical building IDs/picking, hysteresis,
stale requests, failure fallback, buffer disposal and physics invariance on swaps.

Extend `npm run benchmark -- --world-smoke` to exercise rapid district changes,
all driving cameras, zoom extremes, preset changes, slow/failed chunk loads and a
repeated route through eviction boundaries. Inspect real screenshots for popping,
terrain intersections, courtyard loss and night visibility. Confirm no new source
snapshot or external map requests.

Provisional performance gate: at matching camera poses and coverage, reduce
submitted triangles by at least 50% in the far atlas and 30% in driving without
increasing draw calls or regressing p95 frame time. Tune these targets after the
baseline; they are goals, not predicted gains. Resident bytes should plateau on a
repeated driving route, with no accumulating buffers or loss of nearby physics.
Report hardware/browser and distinguish software-renderer smoke checks from GPU
performance validation.
