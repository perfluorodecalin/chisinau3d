# Geoportal INDS investigation

Inspected 12–13 September 2026 through [Geoportal INDS](https://geoportalinds.gov.md/geonetwork/srv/eng/catalog.search) and the [road authority map](https://harta.asd.md/). Provider: S.A. Administrația Națională a Drumurilor, Republica Moldova.

Downloaded snapshots are in **`.local/inds/`**, ignored by Git and outside published `dist/`. They have **not been matched to OSM or applied to the game**. No OSM/Overpass requests or uploads were made.

## Obtained data

Requests use the game bounds: west 28.740, south 46.975, east 28.980, north 47.100, explicitly specified as CRS84. GeoJSON output uses longitude/latitude.

| Local file | Retained features | Attributes |
| --- | ---: | --- |
| `surfaces.geojson` | 14 | Road reference, name, surface code |
| `roughness.geojson` | 287 | Road reference, IRI, condition description, segment length |
| `road-links.geojson` | 134 | RoadLink ID, current status, geometry |
| `traffic-monitoring.geojson` | 4 | Road reference, kilometre position, year, monthly traffic values |
| `railway-crossings.geojson` | 0 | No records returned in this area |
| `parking.geojson` | 0 | No records returned in this area |

Surface features cover M1, M2, M5, R1 and R6. Nine have `ba` (Beton asfaltic, asphalt concrete), five `bc` (Beton ciment, cement concrete), confirmed against the provider's [legend](https://data.asd.md/geoserver/public/wms?service=WMS&version=1.1.1&request=GetLegendGraphic&layer=public:26559a1a-278c-11ed-9927-931557eabfd2&format=application/json), saved locally as `surface-legend.json`. These are whole, sometimes long/multipart source geometries, not 14 individual city streets. Municipal street coverage is not established.

Retained IRI values range from 0.98 to 14.42. No survey dates are supplied, so these are not established as current conditions. Traffic records concern M1, M5, R1 and R6 and are labelled 2026; monthly completeness is not established. Empty crossing/parking responses do not establish absence of those facilities in reality.

## Lane counts and widths

INDS lists [Numărul de benzi](https://geoportalinds.gov.md/geonetwork/srv/eng/catalog.search#/metadata/8f9a93b8-b468-4d9b-9420-2d9bec19061d) and [Lățimea drumului](https://geoportalinds.gov.md/geonetwork/srv/eng/catalog.search#/metadata/81c8d06f-e19b-48d2-9887-b4d9e3b1be13) as attribute tables related to RoadLinks. Neither record supplies a download link. Neither table is advertised by the inspected `public` or `public_wfs` WFS capabilities. The public RoadLink schema and retrieved features contain only ID, geometry and status: **no lane counts or widths were obtained**.

Both metadata records contain explicit third-party transfer restrictions. A provider export with RoadLink join keys, directional/total lane semantics, dates and redistribution permission is needed before bundling them into the game. Public provider contacts are in the saved metadata; no message was sent.

## Surface reuse conflict

The [older surface record](https://geoportalinds.gov.md/geonetwork/srv/eng/catalog.search#/metadata/0bffdbe2-470e-4792-8348-16a2806b095d) states no access/use conditions. The [RoadLink-related surface table](https://geoportalinds.gov.md/geonetwork/srv/eng/catalog.search#/metadata/db8f1ab6-3443-4131-8803-71505da2489d) has third-party transfer restrictions. Both link to the road authority service; which terms govern this WFS layer is unresolved. Keep samples local pending clarification. Roughness and traffic reuse terms also need verification before publishing. RoadLink metadata states no access/use conditions, but its geometry has not been conflated with OSM.

## Terrain lead

[DTM 2020](https://geoportalinds.gov.md/geonetwork/srv/eng/catalog.search#/metadata/bd7eb6a4-9d80-4319-8b0f-268379fe46e3) describes central Moldova photogrammetric terrain in 2.5 × 2.5 km sheets, with no access/use conditions. Reported positioning accuracy is 0.5 m in built/rural areas and 2 m in forest; this is not a verified raster resolution or vertical-accuracy guarantee. The public WCS exposes the numeric 5 m `DTM__DTM_2020_centru` GeoTIFF coverage. The [terrain workflow](../inds-terrain/README.md) downloads, assesses and integrates a bounded 20 m derivative. Its metre unit and Baltic 1977 normal-height datum are recorded as evidence-based inferences.

## Reproduction and validation

With Node.js 22.12+:

```sh
node scripts/fetch-inds.mjs --download
node scripts/fetch-inds.mjs --verify
```

Download is optional and independent of dev/build/tests. A fresh cache requires at most six sequential feature requests, each capped at 5,000 features with a 30-second timeout, without pagination or automatic retries. Existing `*.response.json` files are reused; remove a specific local response to refresh that layer. Catalogue XML and the legend were acquired separately during discovery.

`manifest.json` records URLs, CRS, request bounds, times, fields, raw/retained counts and SHA-256 hashes. Raw responses are preserved. The server returned 291 roughness features and 135 RoadLinks; geographic bounding-box filtering removed four and one respectively. This removes envelope misses, not exact geometry clipping. Retained geometry may extend outside the city. All six snapshots passed checks for counts, truncation indicators, IDs, finite geographic coordinates, retained bounding-box overlap and raw/processed hashes.

Before integration, clip and match using road references, alignment and grade separation, retaining source IDs and confidence. Proximity alone can confuse parallel carriageways and bridge decks. Apply accepted attributes through the shared road model and regenerate dependent geometry, widths, lamps and physics together. Preserve explicit OSM tags and local corrections unless reviewed evidence supports a change. No rendering or physics changes were made here.
