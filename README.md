For local setup and continued development, see [DEVELOPING.md](DEVELOPING.md). Codex project guidance is in [AGENTS.md](AGENTS.md).

# Chișinău 3D Atlas

A static Three.js r180 city model built from a saved OpenStreetMap / Overpass snapshot dated 2026-09-08. All Three.js modules and geographic data are served locally by the site. Exploring the map makes **no requests to OSM or Overpass**.

The 30 saved source sections cover latitude 46.975–47.100 and longitude 28.740–28.980 (about 14 × 18 km). These are urban-area bounds, not the administrative boundary. `npm run build` compiles these sources into spatial binary chunks. Centre chunks load first; district controls load nearby geometry. Load wider city adds all compiled chunks; Stop finishes the current batch. Driving evicts distant geometry. See [ARCHITECTURE.md](ARCHITECTURE.md). Building CSV export includes height source and OSM IDs.

## Geometry and evidence

- OSM building ways and multipolygon relations; inner rings become courtyard holes.
- Relation-member building ways excluded when preparing the snapshot to avoid double geometry.
- Local metre projection around 47.0245 N, 28.8323 E; a real 40 m terrain grid resampled from a bounded 16-tile Mapzen/AWS Terrarium dataset.
- Explicit height tags take priority. Floor-derived height uses 3 m per floor plus a roof allowance (explicit roof height, roof floors × 3 m, or 1.5 m).
- Otherwise deterministic use / footprint-based defaults: houses 6–9 m; apartments 15–27 m; industry 8 m; small ancillary structures 3 m; religious buildings 18 m; commercial / office / hotel / hospital 15 m; generic buildings 6–12 m.
- Height tags are mapper contributions, not necessarily surveyed. Estimates are heuristic, not learned or satellite-derived. Missing footprints remain absent. Façades and roofs are simplified extrusions. No claim of photogrammetric accuracy.
- Build-time batched building geometries retain triangle spans for picking; parks and streets are also partitioned spatially. No satellite imagery is used.

## GitHub Pages

The included [deployment workflow](.github/workflows/pages.yml) publishes `dist/` directly, including the vendored Three.js modules and saved map/terrain data. The workflow runs the offline city build; no backend, API key or custom secret is required. Asset paths are relative, so the game works at a repository URL such as `https://perfluorodecalin.github.io/chisinau3d/` as well as a domain root.

1. In the GitHub repository, open **Settings → Pages** and select **GitHub Actions** as the build and deployment source.
2. Commit and push the complete project to `main`, including `.github/workflows/pages.yml`, `dist/`, `tests/`, `package.json` and `package-lock.json`. The bundled data and vendor files must be committed too.
3. Open **Actions → Deploy GitHub Pages** to follow deployment. You can also use **Run workflow** on `main` after enabling Pages.
4. Open the URL shown by the deployment's `github-pages` environment. Later pushes to `main` update the website automatically after quality checks and the offline city build pass.

The workflow uploads only `dist/`, with `index.html` at the website root. Keep `dist/` as authored source; do not run `vite build` over it. For GitHub's setup details, see [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Static files

For local play, run `npm ci` and `npm run dev` from the project folder, then open the localhost URL printed in the terminal. Requires Node.js 22.12 or newer. Double-clicking `dist/index.html` does not work: browsers block module and data loading from `file://` URLs.

Serve `dist/` with any static HTTP server. Browser requires WebGL2. Dependencies are vendored and pinned. Run `npm ci` and `npm run build` before static hosting; `npm run dev` builds missing or stale world assets automatically. `scripts/prepare_snapshot.py SNAPSHOT.json` splits an already downloaded Overpass response; it makes no network requests.

## Attribution

Geographic data © OpenStreetMap contributors, licensed under ODbL: https://www.openstreetmap.org/copyright . Original OSM metadata is retained in the JSON files. Three.js is MIT-licensed; see `dist/vendor/LICENSE`.

## Driving and approximate façades

Drive a car starts on the nearest unblocked loaded road. WASD / arrows accelerate, reverse and steer; Space brakes; R resets to a road; C cycles chase / bonnet / overhead cameras; Escape returns to the atlas. Touch buttons support simultaneous steering and throttle. Buildings and mapped water polygons use a spatial collision grid with courtyard holes. Nearby saved sections load automatically during driving. Physics are arcade-style; terrain and estimated bridge decks affect vehicle height and pitch. Traffic and traffic-rule simulation are not modeled. Approximate façades are procedural shader patterns selected from building use and floor tags; they are not photographs. Confidence/height colour modes disable façade patterns to preserve the legend.

## OSM street details

Saved OSM tree nodes, tree rows, bench nodes, sidewalks and crossings are bundled in `data/street-details.json`. Tree/bench appearance and missing dimensions are approximate. Tree rows use estimated 8 m spacing, suppressing generated trees within 4 m of individually mapped trees. Explicit sidewalk ways retain their geometry; road-tag sidewalks are offset by approximate carriageway widths, with `separate` and `no` respected. Zebra stripes require explicit zebra tags. Other positively marked crossings use edge lines; unmarked and unspecified crossings do not get invented paint. Crossing nodes near mapped crossing paths are suppressed to avoid duplicates; remaining nodes use the nearest mapped carriageway to estimate crossing orientation and span. Street furniture is instanced for performance. Tree trunks and benches participate in car collisions. `scripts/prepare_street_details.py CITY.json DETAILS.json` prepares the saved downloads without network calls.

## Realism additions

`realism.json` preserves 15,889 sets of extra tags, 254 named destinations, 2,705 vegetation polygons and road metadata from the existing city snapshot. Road width uses explicit width, then lanes × 3.2 m, then highway defaults. Lane dividers are simplified dashed markings; road surface colour and procedural texture use surface tags. Mapped speed limits appear in the driving HUD. Destination guidance shows direct distance and relative bearing, not a routable itinerary; nearby named destinations have floating labels. Forests/orchards/vineyards are procedurally populated within mapped polygons, not individual surveyed trees. 17,751 estimated lamp placements follow 3,913 mapped paved road segments at 35 m spacing, with road-interior and duplicate positions rejected, with a pool of eight nearby lights and vehicle headlights at dusk. 66 building footprints with supported gabled/hipped/pyramidal roof tags receive approximate pitched geometry; flat/unsupported/untagged roofs preserve the simplified form. Roof profiles preserve polygon boundaries and courtyard holes, with tessellated approximation rather than exact architectural reconstruction.

## Terrain, bridges and time of day

Terrain Tiles from Mapzen / AWS Open Data are sampled at 40 m spacing in local metre coordinates. Terrain coverage spans about 24–243 m above sea level, relative to the 86.17 m local origin datum. The terrain and metadata are bundled in `terrain.bin` and `terrain.json`; no runtime terrain-server calls occur. Water surfaces are levelled to median local DEM elevation; corresponding terrain cells are lowered slightly. Buildings use level bases and foundation extensions, while roads, vegetation and furniture follow the terrain. This is a city-scale model, not a surveyed road surface.

282 existing OSM bridge ways are represented as decks with railings and approximate piers, excluding proposed bridge roads. 1,920 connected approach ways carry elevations tapering through shared OSM nodes, so unrelated roads beneath overpasses are not raised by proximity. Heights are estimates: bridge-node elevations use a 6 m offset and linearly interpolated deck segments; connected approaches taper this offset by 0.065 m per metre. Underlying DEM slope contributes additional grade. Car height selection retains deck/ground separation, follows approach ramps, and checks vertical obstacle intervals so water beneath a bridge does not block driving over it. Tunnels are not reconstructed.

All mapped paved motor-vehicle road classes qualify for generated lighting, regardless of `lit` tags. Positions are placed beside the road edge and tested against other carriageways and nearby generated lamps. The time slider, day/dusk controls, and header night/day toggle work with terrain lighting, nearby lamp lights and vehicle headlights. Lamp positions are inferred, not individually mapped.

Elevation attribution: Mapzen Terrain Tiles; SRTM/GMTED2010 courtesy of the U.S. Geological Survey; European terrain produced using Copernicus data and information funded by the European Union (EU-DEM layers). Source: https://registry.opendata.aws/terrain-tiles/ . Full provider attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md .


## Driving and optimization pass

The latest pass separates loading progress from render frame rate, reduces terrain-subdivision allocations, gives ground surfaces local culling bounds, skips inactive daytime lights/glows, and indexes bench road searches. Saved map geometry and driving rules are preserved. See [PERFORMANCE.md](PERFORMANCE.md) for the benchmark, regression checks and hardware limitations.

Three.js remains the renderer. Simulation advances at fixed 60 Hz with up to 200 ms bounded catch-up, so normal driving speed no longer depends on render frame rate. Reset/start respects reversed OSM one-way direction and offsets into the right-hand half of two-way roads. Street and local-light queries use spatial buckets. Destination HUD nodes are reused. Buildings, vegetation, furniture and lamps are batched by 500 m cells for useful frustum bounds; the full-resolution terrain is split into 224 patches with continuous normals. Ingestion now runs offline; runtime chunk attachment yields between chunks. Low/Balanced/High graphics controls choose resolution caps of 0.85/1.25/1.8; the Performance panels report FPS, p95 frame time, draw calls and triangles.

Roads use continuous miter-limited ribbons with 10 m sampling, caps at shared OSM nodes, and up-to-20 m width transitions at way boundaries. Junction topology separates motor carriageways from pedestrian paths and only connects shared OSM nodes, preserving unrelated grade-separated crossings. Lane dashes stop near junctions. Area highways render filled plazas; proposed/construction and tagged tunnel ways are excluded from surface rendering and driving spawn candidates. Tunnels still have no reconstructed interior. Missing-width one-way ramps and minor one-way streets receive narrower defaults; explicit widths and plausible tagged lane counts remain authoritative.

`road-model.json` records local corrections independently of the OSM snapshot. Strada Salcâmilor way 49802600 changes from 12 to 2 game lanes, supported by connected same-name ways 102660769 and 155121121, both tagged 2 lanes. No OSM upload occurs. Lamps, bridge widths, sidewalks and estimated crossing spans use the same normalized carriageway widths. Reproduce with `prepare_road_model.py` before the dependent bridge, street-detail and lamp scripts, using saved source downloads only.

Night lamps have depth-tested, instanced billboard glows fading between 1.2–1.8 km. The eight-light local pool searches within 180 m, illuminates up to 40 m around each selected lamp and fades assignments instead of teleporting illumination at full brightness. Glows approximate visibility, not physical volumetric scattering.

Validation: `node tests/quality.mjs` after installing the optional development dependencies checks frame-rate-independent driving at 15–144 FPS, collision/reverse behavior, ribbons and short width transitions, all saved road geometry for finite coordinates, terrain triangle preservation, 1,301 shared bridge endpoint heights, and local light activation. The available cloud test browser had WebGL disabled, so no rendered visual acceptance or GPU FPS improvement is claimed. The optional Vite development preview uses the same Three.js 0.180.0 as the vendored static deployment; production uses the offline world compiler described in [ARCHITECTURE.md](ARCHITECTURE.md).


## Basic soundscape

Opt-in Web Audio synthesis adds engine harmonics with speed/throttle and approximate gear changes, filtered tire noise with rough-surface emphasis, soft wind/distant city noise, daytime bird calls and nighttime insect chirps. These are procedural approximations, not Chișinău field recordings. One reusable audio graph, short looping buffers and 10 Hz parameter updates require no audio downloads. Sound starts only after tapping Sound off; a volume slider remains available while driving. Muting and backgrounding suspend audio.
