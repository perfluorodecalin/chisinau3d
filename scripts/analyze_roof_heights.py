"""Assess Harta liniara 2017 roof Z values against saved OSM buildings and DTM.

This is a bounded research tool. It reads only checked-in/saved inputs and never
makes network requests. See research/line-map-2017/README.md for acquisition.
"""

from __future__ import annotations

import array
import csv
import json
import math
import pathlib
import re
import statistics


ROOT = pathlib.Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "research" / "line-map-2017"
ROOFS = RESEARCH / "roof-height-pilot.geojson"
TERRAIN_META = ROOT / "dist" / "data" / "terrain.json"
TERRAIN_BIN = ROOT / "dist" / "data" / "terrain.bin"
ORIGIN_LAT, ORIGIN_LON = 47.0245, 28.8323
METRES_PER_DEGREE = 111320.0
LON_SCALE = METRES_PER_DEGREE * math.cos(math.radians(ORIGIN_LAT))


def project(coord):
    return ((coord[0] - ORIGIN_LON) * LON_SCALE,
            -(coord[1] - ORIGIN_LAT) * METRES_PER_DEGREE)


def percentile(values, fraction):
    values = sorted(values)
    if not values:
        return None
    position = (len(values) - 1) * fraction
    lo, hi = math.floor(position), math.ceil(position)
    if lo == hi:
        return values[lo]
    return values[lo] * (hi - position) + values[hi] * (position - lo)


def summary(values):
    values = [v for v in values if math.isfinite(v)]
    if not values:
        return {"count": 0}
    return {
        "count": len(values),
        "min": round(min(values), 3),
        "p05": round(percentile(values, .05), 3),
        "p25": round(percentile(values, .25), 3),
        "median": round(statistics.median(values), 3),
        "p75": round(percentile(values, .75), 3),
        "p95": round(percentile(values, .95), 3),
        "max": round(max(values), 3),
        "mean": round(statistics.fmean(values), 3),
    }


def point_in_ring(point, ring):
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y):
            at_x = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < at_x:
                inside = not inside
        j = i
    return inside


def segment_distance(point, a, b):
    px, py = point
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    t = 0 if denom == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / denom))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def inside_or_near(point, ring, tolerance=2.0):
    if point_in_ring(point, ring):
        return True
    return min(segment_distance(point, ring[i - 1], ring[i]) for i in range(len(ring))) <= tolerance


def polygon_area(ring):
    return abs(sum(ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]
                   for i in range(len(ring))) / 2)


def bbox(ring):
    xs, ys = zip(*ring)
    return min(xs), min(ys), max(xs), max(ys)


def stitch_outer_members(members):
    segments = [[project((p["lon"], p["lat"])) for p in m.get("geometry", [])]
                for m in members if m.get("role") == "outer" and len(m.get("geometry", [])) >= 2]
    rings = []
    while segments:
        ring = segments.pop(0)
        changed = True
        while changed and segments and ring[0] != ring[-1]:
            changed = False
            for i, segment in enumerate(segments):
                if ring[-1] == segment[0]:
                    ring.extend(segment[1:])
                elif ring[-1] == segment[-1]:
                    ring.extend(reversed(segment[:-1]))
                elif ring[0] == segment[-1]:
                    ring = segment[:-1] + ring
                elif ring[0] == segment[0]:
                    ring = list(reversed(segment[1:])) + ring
                else:
                    continue
                segments.pop(i)
                changed = True
                break
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def load_buildings():
    buildings = {}
    for path in sorted((ROOT / "dist" / "data").glob("[0-9]-[0-9].json")):
        for element in json.loads(path.read_text(encoding="utf-8"))["elements"]:
            tags = element.get("tags", {})
            if not tags.get("building"):
                continue
            key = f'{element["type"]}/{element["id"]}'
            if key in buildings:
                continue
            if element["type"] == "way":
                raw_rings = [[project((p["lon"], p["lat"])) for p in element.get("geometry", [])]]
            elif element["type"] == "relation":
                raw_rings = stitch_outer_members(element.get("members", []))
            else:
                continue
            for part, ring in enumerate(raw_rings):
                if len(ring) < 4 or polygon_area(ring) < 4:
                    continue
                part_key = key if len(raw_rings) == 1 else f"{key}#{part}"
                buildings[part_key] = {
                    "osm_key": key, "ring": ring, "bbox": bbox(ring),
                    "area": polygon_area(ring), "tags": tags,
                }
    return list(buildings.values())


def load_terrain():
    meta = json.loads(TERRAIN_META.read_text(encoding="utf-8"))
    values = array.array("f")
    with TERRAIN_BIN.open("rb") as stream:
        values.fromfile(stream, meta["nx"] * meta["nz"])
    expected = meta["nx"] * meta["nz"]
    if len(values) != expected:
        raise ValueError(f"terrain.bin has {len(values)} floats; expected {expected}")
    return meta, values


def terrain_height(x, z, meta, values):
    u = max(0, min(meta["nx"] - 1.000001, (x - meta["xmin"]) / meta["step"]))
    v = max(0, min(meta["nz"] - 1.000001, (z - meta["zmin"]) / meta["step"]))
    i, j = math.floor(u), math.floor(v)
    a, b = u - i, v - j
    k = j * meta["nx"] + i
    relative = ((values[k] * (1 - a) + values[k + 1] * a) * (1 - b)
                + (values[k + meta["nx"]] * (1 - a) + values[k + meta["nx"] + 1] * a) * b)
    # terrain.bin is deliberately stored relative to the game origin; LineMap Z
    # is an absolute elevation, so restore the source DTM offset before comparing.
    return relative + meta["offset"]


def parse_metres(value):
    if value is None:
        return None
    match = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?\s*$", str(value), re.I)
    if match:
        return float(match.group(1))
    feet = re.match(r"^\s*(\d+)\s*'\s*(?:(\d+)\s*\")?\s*$", str(value))
    return (float(feet.group(1)) + float(feet.group(2) or 0) / 12) * .3048 if feet else None


def expected_osm_height(tags):
    explicit = parse_metres(tags.get("height"))
    if explicit and 0 < explicit < 600:
        return explicit, "height"
    levels = parse_metres(tags.get("building:levels"))
    if levels and 0 < levels < 150:
        roof = parse_metres(tags.get("roof:height"))
        roof_levels = parse_metres(tags.get("roof:levels"))
        return levels * 3 + (roof or ((roof_levels * 3) if roof_levels else 1.5)), "levels"
    return None, None


def roof_parts(feature):
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates", [])
    polygons = coordinates if geometry.get("type") == "MultiPolygon" else [coordinates]
    parts = []
    for polygon in polygons:
        if not polygon or len(polygon[0]) < 4:
            continue
        xyz = polygon[0]
        ring = [project(p) for p in xyz]
        zs = [p[2] for p in xyz if len(p) >= 3 and math.isfinite(p[2])]
        if zs:
            parts.append((ring, zs))
    return parts


def main():
    if not ROOFS.exists():
        raise SystemExit(f"Missing {ROOFS}; follow the bounded acquisition documented in the research README")
    roof_data = json.loads(ROOFS.read_text(encoding="utf-8"))
    buildings = load_buildings()
    terrain_meta, terrain = load_terrain()

    cell_size = 100
    index = {}
    for building in buildings:
        x0, y0, x1, y1 = building["bbox"]
        for ix in range(math.floor(x0 / cell_size), math.floor(x1 / cell_size) + 1):
            for iy in range(math.floor(y0 / cell_size), math.floor(y1 / cell_size) + 1):
                index.setdefault((ix, iy), []).append(building)

    matched_parts = []
    rejected_ambiguous = 0
    rejected_geometry = 0
    for feature in roof_data["features"]:
        for ring, zs in roof_parts(feature):
            cx = statistics.fmean(p[0] for p in ring[:-1] or ring)
            cy = statistics.fmean(p[1] for p in ring[:-1] or ring)
            candidates = index.get((math.floor(cx / cell_size), math.floor(cy / cell_size)), [])
            scored = []
            unique = set()
            for building in candidates:
                if building["osm_key"] in unique:
                    continue
                x0, y0, x1, y1 = building["bbox"]
                if not (x0 - 2 <= cx <= x1 + 2 and y0 - 2 <= cy <= y1 + 2):
                    continue
                fraction = sum(inside_or_near(p, building["ring"]) for p in ring[:-1] or ring) / max(1, len(ring) - 1)
                if fraction >= .7 and inside_or_near((cx, cy), building["ring"]):
                    scored.append((fraction, -building["area"], building))
                    unique.add(building["osm_key"])
            if not scored:
                rejected_geometry += 1
                continue
            scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
            if len(scored) > 1 and scored[0][0] == scored[1][0] and scored[0][2]["osm_key"] != scored[1][2]["osm_key"]:
                rejected_ambiguous += 1
                continue
            building = scored[0][2]
            ground_vertex = max(terrain_height(x, y, terrain_meta, terrain) for x, y in building["ring"])
            ground_centroid = terrain_height(cx, cy, terrain_meta, terrain)
            matched_parts.append({
                "roof_id": feature.get("id"), "building": building,
                "roof_z": statistics.median(zs), "roof_z_spread": max(zs) - min(zs),
                "roof_z_values": zs,
                "ground_vertex": ground_vertex, "ground_centroid": ground_centroid,
                "match_fraction": scored[0][0], "roof_area": polygon_area(ring),
            })

    grouped = {}
    for part in matched_parts:
        grouped.setdefault(part["building"]["osm_key"], []).append(part)

    rows = []
    for osm_key, parts in grouped.items():
        building = parts[0]["building"]
        all_roof_z = [z for part in parts for z in part["roof_z_values"]]
        roof_z = statistics.median(all_roof_z)
        roof_z_p75 = percentile(all_roof_z, .75)
        roof_z_max = max(all_roof_z)
        ground_vertex = parts[0]["ground_vertex"]
        ground_centroid = statistics.median([part["ground_centroid"] for part in parts])
        derived = roof_z - ground_vertex
        derived_centroid = roof_z - ground_centroid
        osm_height, osm_method = expected_osm_height(building["tags"])
        rows.append({
            "osm_building": osm_key,
            "roof_features": len(parts),
            "roof_to_osm_area_ratio": round(sum(p["roof_area"] for p in parts) / building["area"], 3),
            "match_fraction_min": round(min(p["match_fraction"] for p in parts), 3),
            "roof_z_m": round(roof_z, 3),
            "roof_z_p75_m": round(roof_z_p75, 3),
            "roof_z_max_m": round(roof_z_max, 3),
            "roof_z_spread_max_m": round(max(p["roof_z_spread"] for p in parts), 3),
            "dtm_ground_max_vertex_m": round(ground_vertex, 3),
            "dtm_ground_roof_centroid_m": round(ground_centroid, 3),
            "derived_height_m": round(derived, 3),
            "derived_height_p75_roof_z_m": round(roof_z_p75 - ground_vertex, 3),
            "derived_height_max_roof_z_m": round(roof_z_max - ground_vertex, 3),
            "derived_height_centroid_ground_m": round(derived_centroid, 3),
            "osm_reference_height_m": round(osm_height, 3) if osm_height is not None else "",
            "osm_reference_method": osm_method or "",
            "difference_from_osm_m": round(derived - osm_height, 3) if osm_height is not None else "",
            "building_type": building["tags"].get("building", ""),
            "building_levels": building["tags"].get("building:levels", ""),
            "osm_height_tag": building["tags"].get("height", ""),
            "name": building["tags"].get("name", ""),
            "footprint_area_m2": round(building["area"], 1),
        })

    rows.sort(key=lambda row: row["osm_building"])
    csv_path = RESEARCH / "roof-height-pilot-matches.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[0].keys() if rows else [])
        writer.writeheader()
        writer.writerows(rows)

    plausible = [row for row in rows if 2 <= row["derived_height_m"] <= 120]
    referenced = [row for row in rows if row["osm_reference_height_m"] != ""]
    direct = [row for row in referenced if row["osm_reference_method"] == "height"]
    level_based = [row for row in referenced if row["osm_reference_method"] == "levels"]
    errors = [abs(row["difference_from_osm_m"]) for row in referenced]
    signed_errors = [row["difference_from_osm_m"] for row in referenced]
    high_confidence = [
        row for row in rows
        if row["match_fraction_min"] >= .9
        and .5 <= row["roof_to_osm_area_ratio"] <= 1.5
        and row["roof_z_spread_max_m"] <= 12
        and 2 <= row["derived_height_p75_roof_z_m"] <= 120
    ]
    high_confidence_referenced = [row for row in high_confidence if row["osm_reference_height_m"] != ""]

    def estimator_validation(field, sample=referenced):
        signed = [row[field] - float(row["osm_reference_height_m"]) for row in sample]
        absolute = [abs(value) for value in signed]
        return {
            "signed_error_m": summary(signed),
            "absolute_error_m": summary(absolute),
            "within_2_m": sum(value <= 2 for value in absolute),
            "within_4_m": sum(value <= 4 for value in absolute),
        }

    result = {
        "input": {
            "roof_features_reported_matched": roof_data.get("numberMatched"),
            "roof_features_downloaded": len(roof_data["features"]),
            "bbox_wgs84": [28.825, 47.015, 28.845, 47.030],
            "osm_snapshot": "2026-09-08",
            "terrain": terrain_meta["source"],
        },
        "matching": {
            "matched_roof_parts": len(matched_parts),
            "matched_unique_osm_buildings": len(rows),
            "unmatched_roof_parts": rejected_geometry,
            "ambiguous_roof_parts": rejected_ambiguous,
            "rule": "roof centroid in/within 2 m of footprint and >=70% of exterior vertices in/within 2 m",
        },
        "derived_height_m_using_max_footprint_vertex_ground": summary([r["derived_height_m"] for r in rows]),
        "derived_height_m_using_roof_centroid_ground": summary([r["derived_height_centroid_ground_m"] for r in rows]),
        "plausibility": {
            "2_to_120_m": len(plausible),
            "below_2_m": sum(r["derived_height_m"] < 2 for r in rows),
            "above_120_m": sum(r["derived_height_m"] > 120 for r in rows),
        },
        "high_confidence_filter": {
            "rule": "match >=90%, roof/OSM area 0.5-1.5, roof Z spread <=12 m, p75-derived height 2-120 m",
            "building_count": len(high_confidence),
            "without_osm_height_or_levels": len(high_confidence) - len(high_confidence_referenced),
            "reference_count": len(high_confidence_referenced),
            "derived_p75_height_m": summary([r["derived_height_p75_roof_z_m"] for r in high_confidence]),
            "p75_vertex_z_validation": estimator_validation(
                "derived_height_p75_roof_z_m", high_confidence_referenced),
        },
        "osm_validation": {
            "reference_count": len(referenced),
            "explicit_height_count": len(direct),
            "level_derived_count": len(level_based),
            "signed_error_m": summary(signed_errors),
            "absolute_error_m": summary(errors),
            "within_2_m": sum(error <= 2 for error in errors),
            "within_4_m": sum(error <= 4 for error in errors),
            "explicit_height_absolute_error_m": summary([abs(r["difference_from_osm_m"]) for r in direct]),
            "level_derived_absolute_error_m": summary([abs(r["difference_from_osm_m"]) for r in level_based]),
            "candidate_roof_z_estimators": {
                "median_vertex_z": estimator_validation("derived_height_m"),
                "p75_vertex_z": estimator_validation("derived_height_p75_roof_z_m"),
                "max_vertex_z": estimator_validation("derived_height_max_roof_z_m"),
            },
        },
        "roof_vertex_z_spread_m": summary([r["roof_z_spread_max_m"] for r in rows]),
        "ground_rule_sensitivity_m": summary([
            r["derived_height_centroid_ground_m"] - r["derived_height_m"] for r in rows
        ]),
    }
    json_path = RESEARCH / "roof-height-pilot-results.json"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"Wrote {csv_path.relative_to(ROOT)} and {json_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
