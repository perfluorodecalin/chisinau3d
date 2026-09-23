# Harta liniara 2017: extraction assessment

Investigated 2026-09-13. Research only; no game sources or runtime data changed.

## Verified access

- Viewer: https://geodata.gov.md/#/viewer/openlayers/184
- Viewer configuration: https://geodata.gov.md/rest/geostore/data/184
- WMS: https://geodata.gov.md/geoserver/maps/wms?service=WMS&version=1.1.1&request=GetCapabilities
- **Working vector service:** https://geodata.gov.md/geoserver/maps/wfs?service=WFS&version=2.0.0&request=GetCapabilities
- The global `/geoserver/wfs` returned `Service WFS is disabled`; this does **not** apply to the working `/geoserver/maps/wfs` endpoint.

The viewer names the composite WMS layer `Linemap_2017`. The maps WFS advertises **90 `maps:lm17_*` feature types**, with native horizontal CRS EPSG:4026, plus EPSG:4326 and EPSG:900913. Advertised exports include GeoJSON, GML, SHAPE-ZIP, KML and CSV; only GeoJSON was tested. Paging is advertised, with default count 5,000. Explicitly bound all future requests.

The official inventory identifies a 1:5,000 line-map series for 2017–2021; the viewer's 2017 label should not be treated as a verified survey date for every feature. Source: https://inds.gov.md/wp-content/uploads/sites/6/2024/10/Monitorizare_INDS_2024_s-I.signed.pdf

## Small central Chisinau sample

Bounding box: longitude 28.82–28.86, latitude 47.01–47.04 (roughly 3 by 3.3 km). Ten requests, each limited to three features, returned **24 features total**. Counts below are server-reported `numberMatched`, not downloaded feature counts, whole-city totals, or completeness estimates. BBOX selects intersecting features and does not clip their geometry.

| Feature suffix (prefix `maps:lm17_`) | Matches | Potential game use |
| --- | ---: | --- |
| `line_road_edge` | 3,003 | Derive local road widths and junction boundaries |
| `line_curb` | 1,483 | Physical curb geometry, road/sidewalk separation |
| `line_sidewalk_outer_edge` | 1,119 | Sidewalk widths and outlines |
| `area_roof_area` | 11,956 | Roof geometry and candidate building elevation estimates |
| `area_bridge_area` | 12 | Bridge outlines and candidate deck elevations |
| `point_lamp_post` | 2,983 | Replace some generated lamp locations with mapped positions |
| `point_traffic_signal_light` | 108 | Place traffic lights; no signal timing or orientation verified |
| `point_spot_height_peak` | 286 | Independent elevation checks after interpreting this feature class |
| `line_pedestrian_crossing` | 0 | No evidence of coverage in this test area |
| `line_traffic_lane_area` | 0 | No evidence of coverage in this test area |

Each response is saved as a `.geojson` file. Schemas for these ten types are saved in `schema.xsd`; the capabilities and viewer configuration are also retained.

### Elevations: unusually valuable, but validate first

Nonempty samples have three-coordinate vertices, including varying Z along road edges and roof boundaries. Example road edge `lm17_line_road_edge.209882` has vertex Z values approximately 56.22–67.06. Roof `lm17_area_roof_area.1374217` has vertex Z values approximately 72.24–73.13. These are candidate absolute elevations, **not building heights above ground**.

The attribute `z` is a separate scalar and must not replace per-vertex elevations. A sampled sidewalk and traffic signal have `z: 0` despite nonzero geometry Z. Schemas provide geometry, `gid`, `layer`, `medium`, `z`, `layer_name`, and for lines `shape_leng`; sampled `gid` and `shape_leng` are null. Use the returned feature ID for provenance. No surveyed building height, floor count, lane count, road width or bridge clearance field appears in these ten schemas. `medium: T` is present but its meaning was not established.

A useful experiment is matching roof areas to OSM buildings, then subtracting the existing DTM ground elevation from roof Z. First validate units, vertical datum, horizontal alignment, outliers and the meaning of roof edges versus wall footprints. Roof polygons may be roof parts and may include overhangs; counts are not building counts. Boundary Z does not establish complete roof surfaces or roof ridges. Pole Z does not establish pole height or whether the point represents the top/base. Bridge Z does not establish clearance.

## Roof-height pilot

The proposed experiment was run over a bounded central-city box (28.825–28.845 E, 47.015–47.030 N). The saved source contains 3,000 of the 3,018 roof features reported by the service. `scripts/analyze_roof_heights.py` matches these against the saved 2026-09-08 OSM snapshot and samples the game's exact 5 m DTM. It makes no network requests.

The first diagnostic confirmed a crucial convention: `terrain.bin` contains elevations relative to the game origin, while LineMap roof Z is absolute. Restoring the DTM metadata offset of 85.620 m produces credible heights.

Results:

- 1,434 roof parts matched 1,174 unique OSM buildings; 1,564 parts did not meet the geometry rule and 3 were ambiguous. The low match rate is itself evidence that the 2017-era map must not be applied indiscriminately to 2026 OSM footprints.
- Median-vertex roof Z minus the maximum DTM elevation along the OSM footprint has a median derived height of 4.82 m, a 5th–95th percentile range of 2.27–16.84 m, and a maximum of 59.99 m. Twenty-five matches are below 2 m.
- 156 matched buildings have an OSM `height` or a height inferred from `building:levels`. Against those references, median-vertex Z has median absolute error 1.83 m; 83/156 are within 2 m and 117/156 within 4 m.
- The 75th-percentile roof vertex Z is the best of the tested median/P75/maximum estimators: median absolute error 1.83 m, 88/156 within 2 m, 122/156 within 4 m, and only +0.39 m median signed error. Maximum Z performs worse and trends +1.02 m high.
- A conservative filter (at least 90% vertex match, roof/OSM area ratio 0.5–1.5, roof Z spread at most 12 m, derived height 2–120 m) retains 685 buildings. Of its 100 OSM references, P75 Z has 1.68 m median absolute error; 59 are within 2 m and 81 within 4 m. It yields 585 candidate heights for buildings lacking OSM height/levels in this box.
- Using roof-centroid ground instead of the game's maximum-footprint-vertex ground raises height by a median 0.35 m. Keeping the game's existing base rule therefore matters for visual and collision consistency.

The comparison is encouraging but not ground truth: only 15 validation buildings have an explicit OSM `height`; 141 use the game's floors × 3 m plus roof allowance, and either source can be stale or wrong. Large errors include likely changed buildings, roof parts inside broad OSM footprints and conflicting OSM tags. The pilot supports using filtered LineMap heights as a provenance-labelled fallback for otherwise untagged buildings. It does not support overriding explicit OSM heights or applying values to weak geometry matches.

Artifacts:

- `roof-height-pilot.geojson`: bounded source sample
- `roof-height-pilot-matches.csv`: auditable per-building matches and all three roof-Z estimators
- `roof-height-pilot-results.json`: aggregate statistics and filter results
- `scripts/analyze_roof_heights.py`: reproducible offline analysis

## Road geometry matching pilot

Acquired two bounded EPSG:4326 GeoJSON exports from the official `maps` WFS on 2026-09-24. Both requests used bbox `28.84,47.018,28.85,47.025,EPSG:4326`, `count=500`, `startIndex=0`, and one requested feature type per request:

| WFS feature type | `numberMatched` | `numberReturned` |
| --- | ---: | ---: |
| `maps:lm17_line_road_centre_line` | 134 | 134 |
| `maps:lm17_line_road_edge` | 262 | 262 |

The count cap exceeds both server match counts, so these responses are complete for the requested bbox. WFS bbox filtering selects intersecting features and does not clip them; the offline preparer clips each line part to the bbox, splits disjoint fragments, and matches those fragments against the bundled OSM snapshot. It makes no network requests. Reproduce the derived overlay with `python scripts/prepare_linemap_road_test.py`; run `python scripts/prepare_linemap_road_test.py --self-test` for synthetic offset, ambiguity and reversed-oneway checks.

The resulting `dist/linemap-road-test.json` contains **391 clipped input fragments** (131 centre, 260 edge), of which **301 matched** (114 centre, 187 edge); 43 were ambiguous and withheld, 47 had no acceptable match, and accepted fragments reference 83 unique OSM ways. Match criteria use local tangent alignment, distance/expected carriageway-edge offset and 75% sampled coverage. Ambiguous candidates with a score gap under 1.5 are withheld. OSM IDs, original tags, normalized road-model width and bridge state are retained; coordinates are local metres (`x` east, `z` south), and runtime should use the existing road-height drape. These counts describe this district and matching rules, not citywide completeness or correctness. Unmatched source IDs and ambiguity diagnostics are in the JSON.

The runtime **Road geometry A/B** control switches between **Old OSM** and **OSM + LineMap**. The latter adds thin diagnostic lines over the unchanged OSM roads; it does not replace road surfaces, driving physics, sidewalks or lamps.

The LineMap source is older than the saved OSM snapshot and may represent changed or differently segmented roads. Geometry association does not establish vertical datum, feature survey date or a distribution license. The service advertised no fees/access constraints, but dataset-specific reuse terms and required attribution remain unresolved; do not treat this as permission for unrestricted redistribution or upload corrections to OSM.

## Other advertised candidates (not sampled)

Driveways, footpaths, walkway centre lines, traffic islands, road/safety barriers, retaining walls, embankment boundaries, stairs, fences, brick/stone walls, railway centre lines/platforms, canals/ditches, rivers/lakes, land-use polygons, power poles and monuments. Layer existence alone does not prove Chisinau coverage or usable attributes. The complete inventory can be read from `maps-wfs.xml`.

## Suggested integration order

1. Pilot lamp posts and traffic lights in one district, deduplicating existing placements and preserving the bounded runtime light pool.
2. Assess roof-derived heights against tagged OSM buildings and the current DTM. Record derived heights separately from surveyed or mapper-tagged heights.
3. Match road/curb/sidewalk edges to the OSM network to derive local widths. Keep OSM routing/shared-node connectivity; update visible roads, collisions, spawn rules, sidewalks, crossings, lamps and bridge widths together.
4. Inspect bridge geometry/elevations and retaining walls. Preserve deck/ground separation and connect approaches explicitly.

All incorporation should use saved, bounded offline snapshots. The map is older than the project's 2026 OSM snapshot; reconcile changed/demolished features instead of wholesale replacement. No OSM requests or uploads were made.

## Reproducible bounded request

Example tested request (three roof features):

```text
https://geodata.gov.md/geoserver/maps/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=maps:lm17_area_roof_area&count=3&outputFormat=application/json&srsName=EPSG:4326&bbox=28.82,47.01,28.86,47.04,EPSG:4326
```

The returned GeoJSON coordinates confirm longitude/latitude ordering for this request. For production extraction prefer native EPSG:4026 and explicit reprojection, preserving original Z and provenance. Do not assume that horizontal reprojection establishes a vertical datum.

## Reuse status

Public unauthenticated vector retrieval works. WFS advertises `Fees: NONE` and `AccessConstraints: NONE`, but also contains obvious default GeoServer contact metadata. This is insufficient to establish an explicit dataset redistribution license. Dataset-specific reuse terms and required AGCC/INGEOCAD attribution remain unresolved; the terrain dataset's terms must not automatically be applied here. No finding of unrestricted redistribution is made.
