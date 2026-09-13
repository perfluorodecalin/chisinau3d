# INDS DTM 2020 acquisition

The optional `scripts/fetch_inds_terrain.py` workflow acquires numeric terrain from the public Geoportal/Geodata WCS and assesses it against the game's former 40 m terrain. Acquisition writes only to ignored `.local/inds-terrain/`. The separate `scripts/prepare_inds_terrain.py` command creates the checked-in 5 m derivative and regenerates water and bridge heights.

The selected coverage is `DTM__DTM_2020_centru`: a native 5 m GeoTIFF grid in EPSG:4026 that covers Chișinău. The acquisition boundary is derived from the existing buffered game terrain extent and transformed with a densified perimeter. Requests account for the coverage's declared `Y X` axis labels and GeoServer's mapping of them to conventional GeoTIFF X/Y bounds; the probe verifies the returned transform before full acquisition.

Create an isolated environment and run:

```powershell
py -3.14 -m venv .local/venv-inds-terrain
.local/venv-inds-terrain/Scripts/python -m pip install -r requirements-inds-terrain.txt
.local/venv-inds-terrain/Scripts/python scripts/fetch_inds_terrain.py self-test
.local/venv-inds-terrain/Scripts/python scripts/fetch_inds_terrain.py probe
.local/venv-inds-terrain/Scripts/python scripts/fetch_inds_terrain.py download
.local/venv-inds-terrain/Scripts/python scripts/fetch_inds_terrain.py mosaic
.local/venv-inds-terrain/Scripts/python scripts/fetch_inds_terrain.py assess
.local/venv-inds-terrain/Scripts/python scripts/fetch_inds_terrain.py verify
.local/venv-inds-terrain/Scripts/python scripts/prepare_inds_terrain.py
```

The probe requests only 1 km² around the game origin. Full acquisition divides the game extent into at-most-5 km square requests and sends them sequentially, with no retry loop. Valid cached tiles are reused. Downloads are written to partial files, checked for TIFF signatures and atomically renamed. The manifest retains request URLs, bounds, CRS, source metadata and SHA-256 hashes.

Assessment restores the current terrain's stored origin offset before comparing both datasets at the same coordinates. It reports coverage, distributions, differences and slopes, and generates elevation, hillshade and difference previews. Differences do not establish which source is more accurate.

The integrated metadata identifies the elevation unit as metres and the vertical datum as Baltic 1977 normal height, both explicitly marked as inferred. The catalogue does not identify either and WCS advertises the nonsensical band unit `W.m-2.Sr-1`. The inference is supported by the provider map's metre label, Moldova's documented adoption of Baltic 1977 normal heights, and the small difference from EGM96-derived orthometric terrain. Provider confirmation would still improve provenance. Also confirm void filling and the exact acquisition date within 2020.

## Local assessment on 13 September 2026

The completed bounded acquisition contains 20 validated source tiles and a 31.8 MB compressed mosaic. It covers 100% of the current game terrain grid. Assuming raster values are metres, comparison with the current absolute elevations produced a mean difference of +0.59 m and RMSE of 3.31 m; the 5th–95th percentile interval is −4.96 to +5.11 m. Six representative city, water, hillside and approach-road points differ by −4.99 to +0.09 m.

The 95th-percentile elevation change across tile boundaries is 0.87 units, versus 0.89 between all adjacent raster pixels, so acquisition introduced no obvious seams. Values range from −10.45 to 244.68; the minimum lies near Humulești beside mapped streams, ditches and roads and is retained as source evidence rather than silently corrected. These checks show that the raster is coherent and substantially finer, but they do not prove better vertical accuracy. The generated `.local/inds-terrain/ASSESSMENT.md` and previews retain the full result.

## Game integration

Run `scripts/prepare_inds_terrain.py` after acquisition. It bilinearly resamples the native mosaic to 5 m over the exact former terrain extent, stores elevations relative to the 85.62 m origin value, relevels all 584 saved OSM water polygons, and projects the terrain-independent model of 282 bridges and 1,920 approaches onto the new ground. The bridge model preserves source topology and shared endpoints while keeping the 6 m clearance and 6.5% approach-grade assumptions distinct from measured terrain.

The 5 m grid contains 4065 × 3417 samples (55,560,420 bytes as Float32). Terrain patch dimensions adapt to retain roughly 1.28 km culling bounds, preserving 224 render patches. The complete near-detail terrain contains about 27.77 million triangles; distance-based visual variants reduce the rendered detail farther away. The source GeoTIFF stays outside the published site; the resampled 5 m grid is bundled for offline height queries.

## Vertical-reference inference

- The road authority's public map presents the DTM field as `Cotă (metri)`—elevation in metres.
- The Technical University of Moldova's [height-reference study](https://repository.utm.md/handle/5014/18301) explains that high-resolution national DEM data are converted from ellipsoidal heights to Baltic Sea 1977.
- The International Service for the Geoid records [Baltic 1977 as Moldova's adopted system](https://www.isgeoid.polimi.it/Geoid/Europe/Moldova/moldova04_g.html) and identifies the results as normal heights.
- [EPSG:5705](https://epsg.org/crs/wkt/id/5705) defines Baltic 1977 as gravity-related heights in metres.
- The raster's +0.59 m mean difference from the old EGM96-derived orthometric heights is consistent with another physical-height datum; unconverted ellipsoidal heights would differ by the local geoid/quasigeoid separation, on the order of tens of metres.

This establishes a strong operational inference, not confirmation of this particular GeoTIFF's undocumented vertical CRS. `terrain.json`, UI/world attribution and this report retain that distinction.
