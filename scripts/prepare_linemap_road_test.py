"""Match a bounded saved LineMap road sample to the saved OSM road snapshot.

Network acquisition is intentionally separate. This script never requests OSM
or LineMap data; place bounded GeoJSON exports under research/line-map-2017.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "research" / "line-map-2017"
OUT = ROOT / "dist" / "linemap-road-test.json"
BBOX = (28.84, 47.018, 28.85, 47.025)
ORIGIN_LON, ORIGIN_LAT = 28.8323, 47.0245
M = 111320.0
SX, SY = M * math.cos(math.radians(ORIGIN_LAT)), M


def project(p):
    return ((p[0] - ORIGIN_LON) * SX, -(p[1] - ORIGIN_LAT) * SY)


def dist_point_seg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = dx * dx + dy * dy
    t = 0 if not den else max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy)/den))
    return math.hypot(p[0] - a[0] - t*dx, p[1] - a[1] - t*dy)


def line_length(line):
    return sum(math.hypot(b[0]-a[0], b[1]-a[1]) for a, b in zip(line, line[1:]))


def sample_line(line, step=12):
    """Evenly spaced samples along a polyline, including both endpoints."""
    if len(line) < 2:
        return line[:]
    out = [line[0]]
    for a, b in zip(line, line[1:]):
        d = math.hypot(b[0]-a[0], b[1]-a[1])
        n = max(1, math.ceil(d / step))
        out.extend((a[0] + (b[0]-a[0])*i/n, a[1] + (b[1]-a[1])*i/n) for i in range(1, n+1))
    return out


def nearest(p, line):
    best = (float("inf"), None)
    for a, b in zip(line, line[1:]):
        d = dist_point_seg(p, a, b)
        if d < best[0]:
            best = d, (b[0]-a[0], b[1]-a[1])
    return best


def eligible(tags):
    if not tags.get("highway") or tags.get("area") == "yes":
        return False
    if tags.get("proposed") or tags.get("construction") or tags.get("tunnel") not in (None, "no"):
        return False
    return True


def load_roads():
    road_model = json.loads((ROOT / "dist/data/road-model.json").read_text(encoding="utf-8"))
    roads = {}
    for path in sorted((ROOT / "dist/data").glob("[0-9]-[0-9].json")):
        for e in json.loads(path.read_text(encoding="utf-8")).get("elements", []):
            if e.get("type") != "way" or not eligible(e.get("tags", {})):
                continue
            geom = e.get("geometry", [])
            if len(geom) < 2:
                continue
            wid = str(e["id"])
            item = roads.setdefault(wid, {"id": wid, "tags": e.get("tags", {}), "line": [project((p["lon"], p["lat"])) for p in geom]})
            # Prefer a complete geometry where chunked snapshots duplicate a way.
            if len(geom) > len(item["line"]):
                item["line"] = [project((p["lon"], p["lat"])) for p in geom]
    for wid, road in roads.items():
        profile = road_model.get("profiles", {}).get(wid, {})
        road["width"] = profile.get("width")
        road["bridge"] = road["tags"].get("bridge") not in (None, "no")
        xs, ys = zip(*road["line"])
        road["bounds"] = (min(xs), max(xs), min(ys), max(ys))
    return list(roads.values())


def candidate_metrics(source, road, kind):
    points = sample_line(source)
    # Ignore geometry far from the requested district and short degenerate lines.
    closest = [nearest(p, road["line"]) for p in points]
    distances = [x[0] for x in closest]
    threshold = 9.0 if kind == "centre" else max(9.0, (road.get("width") or 8.0) * .5 + 4.0)
    coverage = sum(d <= threshold for d in distances) / max(1, len(distances))
    med = sorted(distances)[len(distances)//2]
    # A centre line follows the OSM centre; edge lines should be near the OSM
    # carriageway boundary. Penalize expected half-width offset, but tolerate
    # mapping and width errors. Edge direction is not directional evidence.
    target = 0.0 if kind == "centre" else max(1.5, (road.get("width") or 8.0) * .5)
    offset_error = abs(med - target)
    src_len, road_len = line_length(source), line_length(road["line"])
    source_vec = (source[-1][0]-source[0][0], source[-1][1]-source[0][1])
    road_vec = (road["line"][-1][0]-road["line"][0][0], road["line"][-1][1]-road["line"][0][1])
    denom = math.hypot(*source_vec) * math.hypot(*road_vec)
    local_alignments = []
    for i, (_, tangent) in enumerate(closest):
        if not tangent:
            continue
        a, b = points[max(0, i-1)], points[min(len(points)-1, i+1)]
        sv = (b[0]-a[0], b[1]-a[1])
        sd, rd = math.hypot(*sv), math.hypot(*tangent)
        if sd and rd:
            local_alignments.append(abs((sv[0]*tangent[0]+sv[1]*tangent[1])/(sd*rd)))
    alignment = sum(local_alignments)/len(local_alignments) if local_alignments else (abs((source_vec[0]*road_vec[0] + source_vec[1]*road_vec[1]) / denom) if denom else 0)
    # For centre lines on explicitly one-way OSM ways, retain orientation as a
    # diagnostic and penalize a reversed line; edges may naturally run either way.
    direction_mismatch = bool(kind == "centre" and road["tags"].get("oneway") in ("yes", "1", "true")
                              and source_vec[0]*road_vec[0] + source_vec[1]*road_vec[1] < 0)
    score = offset_error + max(0, 1-alignment) * 8
    return {"distanceM": round(med, 2), "coverage": round(coverage, 3), "alignment": round(alignment, 3),
            "offsetErrorM": round(offset_error, 2), "directionMismatch": direction_mismatch,
            "score": round(score, 2), "lengthRatio": round(src_len/max(road_len, 1), 3)}


def match(source, roads, kind):
    scored = []
    sx0, sx1 = min(p[0] for p in source)-30, max(p[0] for p in source)+30
    sy0, sy1 = min(p[1] for p in source)-30, max(p[1] for p in source)+30
    for road in roads:
        rx0, rx1, ry0, ry1 = road["bounds"]
        if rx1 < sx0 or rx0 > sx1 or ry1 < sy0 or ry0 > sy1:
            continue
        metrics = candidate_metrics(source, road, kind)
        if metrics["coverage"] >= .75 and metrics["alignment"] >= .72:
            scored.append((metrics["score"], road, metrics))
    scored.sort(key=lambda x: x[0])
    if not scored:
        return None, "rejected", None
    best = scored[0]
    # Ambiguity means a geometrically plausible near-tie to a distinct OSM way.
    if len(scored) > 1 and scored[1][0] - best[0] < 1.5:
        return None, "ambiguous", {"best": best[2], "runnerUpScore": round(scored[1][0], 2)}
    if best[2]["score"] > (10 if kind == "centre" else 8) or best[2]["distanceM"] > (9 if kind == "centre" else 12):
        return None, "rejected", best[2]
    return best, "matched", None


def geometry_parts(geometry):
    if not geometry:
        return []
    if geometry["type"] == "LineString":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiLineString":
        return geometry["coordinates"]
    return []


def clip_segment(a, b):
    """Liang-Barsky clip in lon/lat; return endpoints or None."""
    x0, y0 = a[:2]
    dx, dy = b[0]-x0, b[1]-y0
    w, s, e, n = BBOX
    lo, hi = 0.0, 1.0
    for p, q in ((-dx, x0-w), (dx, e-x0), (-dy, y0-s), (dy, n-y0)):
        if abs(p) < 1e-15:
            if q < 0: return None
            continue
        t = q/p
        if p < 0: lo = max(lo, t)
        else: hi = min(hi, t)
        if lo > hi: return None
    def at(t):
        return [round(x0+dx*t, 9), round(y0+dy*t, 9)]
    return at(lo), at(hi)


def clip_line(line):
    pieces, current = [], []
    for a, b in zip(line, line[1:]):
        clipped = clip_segment(a, b)
        if clipped is None:
            if len(current) >= 2: pieces.append(current)
            current = []
            continue
        ca, cb = clipped
        if current and math.hypot((current[-1][0]-ca[0])*SX, (current[-1][1]-ca[1])*SY) > .02:
            if len(current) >= 2: pieces.append(current)
            current = []
        if not current: current.append(ca)
        if math.hypot((current[-1][0]-cb[0])*SX, (current[-1][1]-cb[1])*SY) > .02:
            current.append(cb)
    if len(current) >= 2: pieces.append(current)
    return pieces


def source_features():
    inputs = [("centre", RESEARCH / "lm17_line_road_centre_line.geojson"),
              ("edge", RESEARCH / "lm17_line_road_edge-pilot.geojson")]
    found, source_counts = [], {}
    for kind, path in inputs:
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        returned = data.get("numberReturned", len(data.get("features", [])))
        if returned != len(data.get("features", [])):
            raise ValueError(f"{path.name}: numberReturned disagrees with saved features")
        source_counts[kind] = {"numberMatched": data.get("numberMatched"),
                               "numberReturned": returned, "countLimit": 500}
        for f in data.get("features", []):
            for part_no, raw in enumerate(geometry_parts(f.get("geometry"))):
                if len(raw) < 2:
                    continue
                clipped = clip_line(raw)
                for clip_no, fragment in enumerate(clipped):
                    found.append((kind, f.get("id", "unknown") + (f"#{part_no}" if len(geometry_parts(f.get("geometry"))) > 1 else "") + (f"@{clip_no}" if len(clipped) > 1 else ""), fragment))
    return found, source_counts


def prepare():
    roads = load_roads()
    inputs, source_counts = source_features()
    features = []
    counts = {"centre": 0, "edge": 0}
    matched = {"centre": 0, "edge": 0}
    ambiguous = rejected = 0
    issues = []
    for kind, source_id, raw in inputs:
        counts[kind] += 1
        source = [project(p[:2]) for p in raw]
        chosen, status, diagnostic = match(source, roads, kind)
        if status != "matched":
            if status == "ambiguous": ambiguous += 1
            else: rejected += 1
            issues.append({"sourceId": source_id, "kind": kind, "status": status, "diagnostic": diagnostic})
            continue
        _, road, metrics = chosen
        matched[kind] += 1
        features.append({"osmId": road["id"], "osmTags": road["tags"], "width": road["width"],
                         "bridge": road["bridge"], "sourceId": source_id, "kind": kind,
                         "coordinates": [[round(x, 2), round(z, 2)] for x, z in source],
                         "match": metrics})
    result = {"version": 1, "bbox": list(BBOX), "features": features,
              "stats": {"scope": {"west": BBOX[0], "south": BBOX[1], "east": BBOX[2], "north": BBOX[3]},
                        "coordinateSystem": "local metres from origin 28.8323E, 47.0245N; x east, z south",
                        "inputCount": len(inputs), "inputByKind": counts, "matchedCount": len(features),
                        "matchedByKind": matched, "ambiguousCount": ambiguous, "rejectedCount": rejected,
                        "unmatched": issues,
                        "uniqueOsmIds": len({f["osmId"] for f in features}),
                        "sourceCompleteness": source_counts,
                        "availableRoads": len(roads), "completeness": "complete for returned LineMap features in bbox; only plausible OSM matches are emitted",
                        "caveat": "LineMap 2017 coverage may differ from 2026 OSM; geometry alignment does not establish survey date, vertical datum, or reuse license."}}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    return result


def self_test():
    def road(i, y, one="no"):
        return {"id": str(i), "tags": {"highway": "residential", "oneway": one}, "line": [(0, y), (100, y)], "width": 8, "bridge": False, "bounds": (0, 100, y, y)}
    roads = [road(1, 0, "yes"), road(2, 10)]
    edge, status, _ = match([(10, 4), (90, 4)], roads, "edge")
    assert status == "matched" and edge[1]["id"] == "1", (status, edge)
    _, status, _ = match([(10, 5), (90, 5)], [road(3, 0), road(4, 10)], "centre")
    assert status == "ambiguous", status
    reversed_match, status, _ = match([(90, 0), (10, 0)], [road(5, 0, "yes")], "centre")
    assert status == "matched" and reversed_match[2]["directionMismatch"], status
    print("synthetic matching checks passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        result = prepare()
        print(json.dumps(result["stats"], indent=2))
