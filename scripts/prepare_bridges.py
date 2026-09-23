"""Build the bridge height model from the saved, offline OSM snapshot.

The snapshot deliberately omits OSM node IDs. We therefore use saved road-model
join annotations and coincident saved geometry endpoints to infer topology;
this is useful for local bridge approaches, but is not a reconstruction of the
original OSM node graph. No network access is performed here.
"""
import json
import hashlib
import math
import pathlib
from collections import defaultdict, deque

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "data"
MODEL = OUT / "bridge-model.json"
R = 111320.0
LAT0, LON0 = 47.0245, 28.8323
SCALE = R * math.cos(math.radians(LAT0))
CLEARANCE = 6.0
MAX_GRADE = 0.065
MAX_APPROACH = CLEARANCE / MAX_GRADE


def fingerprint(paths):
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def snapshot_paths():
    tiles = json.loads((OUT / "manifest.json").read_text("utf-8"))
    return [OUT / "manifest.json", OUT / "center.json"] + [OUT / (tile["id"] + ".json") for tile in tiles]
SAMPLE_SPACING = 5.0


def sampler(meta, grid):
    def height(x, z):
        u = max(0, min(meta["nx"] - 1.001, (x - meta["xmin"]) / meta["step"]))
        v = max(0, min(meta["nz"] - 1.001, (z - meta["zmin"]) / meta["step"]))
        i, j = int(u), int(v)
        a, b = u - i, v - j
        return float((grid[j, i] * (1 - a) + grid[j, i + 1] * a) * (1 - b) +
                     (grid[j + 1, i] * (1 - a) + grid[j + 1, i + 1] * a) * b)
    return height


def xy(point):
    return [(point["lon"] - LON0) * SCALE, (LAT0 - point["lat"]) * R]


def resample(points):
    """Return uniformly spaced x/z samples with source vertices retained."""
    if len(points) < 2:
        return points[:], [0.0] * len(points)
    out, distance_at = [points[0]], [0.0]
    distance = 0.0
    for a, b in zip(points, points[1:]):
        length = math.dist(a, b)
        count = max(1, math.ceil(length / SAMPLE_SPACING))
        for i in range(1, count + 1):
            t = i / count
            out.append([a[0] + (b[0] - a[0]) * t,
                        a[1] + (b[1] - a[1]) * t])
            distance_at.append(distance + length * t)
        distance += length
    return out, distance_at


def endpoint(point):
    # Snapshot coordinates are rounded to six decimal places (~0.1 m).
    return round(point["lat"], 6), round(point["lon"], 6)


def road_category(way):
    highway = way["tags"].get("highway", "")
    return "motor" if highway in ("motorway", "trunk", "primary", "secondary",
                                   "tertiary", "residential", "unclassified",
                                   "living_street", "service") or highway.endswith("_link") else "path"


def load_snapshot():
    """Deduplicate saved center/tile ways and merge their saved realism tags."""
    realism = json.loads((OUT / "realism.json").read_text("utf-8"))["extra"]
    ways = {}
    for path in snapshot_paths()[1:]:
        data = json.loads(path.read_text("utf-8"))
        for element in data.get("elements", []):
            if element.get("type") != "way" or not element.get("geometry"):
                continue
            identifier = str(element["id"])
            tags = dict(element.get("tags", {}))
            tags.update(realism.get(identifier, {}))
            if not tags.get("highway"):
                continue
            # Prefer the copy with the most complete geometry/tag data.
            old = ways.get(identifier)
            if old is None or len(element["geometry"]) > len(old["geometry"]):
                ways[identifier] = {"id": identifier, "tags": tags,
                                    "geometry": element["geometry"]}
    return ways


def connected_endpoints(ways, road_model):
    """Return endpoint adjacency using recorded joins, then exact coordinates.

    road-model joins encode shared-node evidence from the original raw extract.
    If a join record is absent (e.g. a path not represented by that model),
    only exact coincident endpoints are used and flagged as inferred.
    """
    profiles = road_model.get("profiles", {})
    by_coord = defaultdict(list)
    for identifier, way in ways.items():
        geom = way["geometry"]
        joins = profiles.get(identifier, {}).get("joins", {})
        indices = {0, len(geom) - 1} | {int(index) for index in joins
                                        if int(index) < len(geom)}
        for index in sorted(indices):
            by_coord[endpoint(geom[index])].append((identifier, index))
    edges = defaultdict(set)
    for coord, entries in by_coord.items():
        entries = list(dict.fromkeys(entries))
        for identifier, index in entries:
            join = profiles.get(identifier, {}).get("joins", {}).get(str(index))
            if join is not None:
                edges[identifier, index].add("recorded")
        for i, (aid, ai) in enumerate(entries):
            for bid, bi in entries[i + 1:]:
                if aid == bid:
                    # Both ends of a closed way are the same physical junction.
                    if ai in (0, len(ways[aid]["geometry"]) - 1) and bi in (0, len(ways[bid]["geometry"]) - 1):
                        edges[aid, ai].add((bid, bi, "closed-way"))
                        edges[bid, bi].add((aid, ai, "closed-way"))
                    continue
                if road_category(ways[aid]) != road_category(ways[bid]):
                    continue
                a_join = profiles.get(aid, {}).get("joins", {}).get(str(ai))
                b_join = profiles.get(bid, {}).get("joins", {}).get(str(bi))
                if a_join and b_join:
                    edges[aid, ai].add((bid, bi, "road-model"))
                    edges[bid, bi].add((aid, ai, "road-model"))
                elif (a_join is None and b_join is None and ai in (0, len(ways[aid]["geometry"]) - 1)
                      and bi in (0, len(ways[bid]["geometry"]) - 1)):
                    edges[aid, ai].add((bid, bi, "coordinate-inferred"))
                    edges[bid, bi].add((aid, ai, "coordinate-inferred"))
    return edges


def make_model():
    ways = load_snapshot()
    road_model = json.loads((OUT / "road-model.json").read_text("utf-8"))
    adjacency = connected_endpoints(ways, road_model)
    is_bridge = {identifier: way["tags"].get("bridge") not in (None, "no", "0", "false")
                 and way["tags"].get("tunnel") not in ("yes", "culvert", "flooded")
                 and not road_model.get("profiles", {}).get(identifier, {}).get("hidden", False)
                 for identifier, way in ways.items()}
    bridge_ids = {i for i, bridge in is_bridge.items() if bridge}

    # Cluster directly connected bridge ways into one logical span. Coordinates
    # can coincide without topology; a graph edge is required before clustering.
    graph = defaultdict(set)
    for (identifier, index), links in adjacency.items():
        if identifier not in bridge_ids:
            continue
        for link in links:
            if isinstance(link, tuple) and link[0] in bridge_ids:
                graph[identifier].add(link[0])
    groups, seen = {}, set()
    for identifier in sorted(bridge_ids):
        if identifier in seen:
            continue
        component, queue = [], deque([identifier]); seen.add(identifier)
        while queue:
            current = queue.popleft(); component.append(current)
            for neighbor in graph[current]:
                if neighbor not in seen:
                    seen.add(neighbor); queue.append(neighbor)
        group = "bridge-" + min(component, key=lambda x: (len(x), x))
        for member in component:
            groups[member] = group

    profiles = {}
    candidate_approaches = defaultdict(dict)
    candidate_services = defaultdict(set)
    queue = deque()
    best = {}
    route_nodes = {}
    route_distances = {}
    for identifier, way in ways.items():
        geometry = way["geometry"]
        joins = road_model.get("profiles", {}).get(identifier, {}).get("joins", {})
        route_nodes[identifier] = sorted({0, len(geometry) - 1} |
                                         {int(i) for i in joins if int(i) < len(geometry)})
        distances = [0.0]
        for a, b in zip(geometry, geometry[1:]):
            distances.append(distances[-1] + math.dist(xy(a), xy(b)))
        route_distances[identifier] = distances
    # Start ramp paths at every saved join on the bridge. Traversal follows
    # each road to its next saved join in either direction, then can continue
    # onto the next connected way until the 6 m ramp has returned to ground.
    for (identifier, index), links in adjacency.items():
        if identifier not in bridge_ids:
            continue
        for link in links:
            if (not isinstance(link, tuple) or link[0] in bridge_ids or
                    road_model.get("profiles", {}).get(link[0], {}).get("hidden", False)):
                continue
            road_id, road_end = link[0], link[1]
            queue.append((road_id, road_end, CLEARANCE, identifier))
    while queue:
        road_id, entry, remaining, bridge_id = queue.popleft()
        if remaining <= 0:
            continue
        state = (road_id, entry)
        candidate_services[road_id].add(bridge_id)
        if best.get(state, -1) >= remaining:
            continue
        best[state] = remaining
        candidate_approaches[road_id][entry] = max(
            remaining, candidate_approaches[road_id].get(entry, 0.0))
        nodes = route_nodes[road_id]
        position = nodes.index(entry)
        for next_index in (position - 1, position + 1):
            if 0 <= next_index < len(nodes):
                next_node = nodes[next_index]
                distance = abs(route_distances[road_id][next_node] - route_distances[road_id][entry])
                if remaining - distance * MAX_GRADE > 0:
                    queue.append((road_id, next_node, remaining - distance * MAX_GRADE, bridge_id))
        for link in adjacency.get((road_id, entry), ()):
            if not isinstance(link, tuple):
                continue
            next_id, next_node = link[0], link[1]
            if (next_id in bridge_ids or
                    road_model.get("profiles", {}).get(next_id, {}).get("hidden", False)):
                continue
            queue.append((next_id, next_node, remaining, bridge_id))
    selected = bridge_ids | set(candidate_approaches)
    for identifier in sorted(selected):
        way = ways[identifier]
        tags, geometry = way["tags"], way["geometry"]
        bridge = identifier in bridge_ids
        highway = tags.get("highway", "")
        category = ("pedestrian" if highway in ("footway", "path", "steps", "pedestrian", "cycleway")
                    else "road")
        points = [xy(p) for p in geometry]
        width = road_model.get("profiles", {}).get(identifier, {}).get("width", 0)
        if not width:
            try:
                width = min(50.0, float(tags.get("width", 0))) if float(tags.get("width", 0)) > 0 else 0
            except (TypeError, ValueError):
                width = 0
        if not width:
            try:
                lanes = float(tags.get("lanes", 0))
            except (TypeError, ValueError):
                lanes = 0
            width = min(40.0, lanes * 3.2) if 0 < lanes <= 12 else {
                "motorway": 20, "trunk": 17, "primary": 14, "secondary": 11,
                "tertiary": 9, "residential": 6, "unclassified": 6,
                "living_street": 5, "service": 4, "footway": 1.8,
                "path": 1.5, "pedestrian": 5, "steps": 2, "cycleway": 2,
            }.get(highway, 5)
        source = {"points": points, "bridge": bridge, "width": width,
                  "name": tags.get("name", "Mapped bridge" if bridge else ""),
                  "highway": highway, "class": category,
                  "bridgeType": tags.get("bridge", "no"), "layer": tags.get("layer", "0"),
                  "source": "saved center/tile geometry + realism tags",
                  "topology": "bridge span" if bridge else "approach inferred from saved road-model joins"}
        if bridge:
            source["group"] = groups[identifier]
        else:
            source["serves"] = sorted({groups[b] for b in candidate_services[identifier]})
            source["connectedBy"] = "road-model join or exact coincident endpoint fallback"
            source["approachLength"] = round(MAX_APPROACH, 2)
            source["attachments"] = [[index, offset]
                                     for index, offset in sorted(candidate_approaches[identifier].items())]
        profiles[identifier] = source
    return {"profiles": profiles, "clearanceAssumption": CLEARANCE,
            "approachGrade": MAX_GRADE,
            "snapshotHash": fingerprint(snapshot_paths() + [OUT / "realism.json", OUT / "road-model.json"]),
            "source": "Offline reconstruction from saved center/tile geometry, realism tags, and road-model join annotations; OSM node IDs are absent, so coordinate fallback topology is inferred.",
            "topology": {"bridgeGroups": len(set(groups.values())),
                         "bridgeWays": len(bridge_ids),
                         "approachWays": len(candidate_approaches),
                         "sharedNodeIdsAvailable": False,
                         "elevationMethod": "estimated 6 m bridge-end anchors sampled from DEM at span landings; straight span interpolation ignores interior DEM; approach offsets taper by 0.065 m per metre"}}


def main():
    model = make_model()
    MODEL.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")), "utf-8")
    meta = json.loads((OUT / "terrain.json").read_text("utf-8"))
    grid = np.fromfile(OUT / "terrain.bin", dtype="<f4").reshape(meta["nz"], meta["nx"])
    height = sampler(meta, grid)
    profiles = {}
    bridge_count = approach_count = 0
    for identifier, source in model["profiles"].items():
        raw = source["points"]
        if source["bridge"]:
            bridge_count += 1
            sampled, distances = resample(raw)
            total = distances[-1]
            start, end = height(*raw[0]) + CLEARANCE, height(*raw[-1]) + CLEARANCE
            points = [[point[0], point[1], round(start + (end - start) *
                      (distance / total if total else 0), 3)]
                      for point, distance in zip(sampled, distances)]
        else:
            approach_count += 1
            # The road is level with terrain except near the attached bridge
            # endpoint, where its deck offset tapers at the declared grade.
            attached = source["attachments"]
            sampled, distances = resample(raw)
            offsets = []
            raw_distances = [0.0]
            for a, b in zip(raw, raw[1:]):
                raw_distances.append(raw_distances[-1] + math.dist(a, b))
            for distance in distances:
                offset = 0.0
                for end_index, clearance in attached:
                    anchor_distance = raw_distances[min(end_index, len(raw_distances) - 1)]
                    walk = abs(distance - anchor_distance)
                    offset = max(offset, clearance - walk * MAX_GRADE)
                offsets.append(max(0.0, offset))
            points = [[p[0], p[1], round(height(*p) + offsets[i], 3)]
                      for i, p in enumerate(sampled)]
        profiles[identifier] = {**source, "points": points}
    result = {"profiles": profiles, "clearanceAssumption": CLEARANCE,
              "approachGrade": MAX_GRADE,
              "snapshotHash": model["snapshotHash"],
              "terrainHash": fingerprint([OUT / "terrain.json", OUT / "terrain.bin"]),
              "source": model["source"] + "; heights projected onto " + meta["source"],
              "topology": model["topology"]}
    (OUT / "bridges.json").write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print({"bridges": bridge_count, "approaches": approach_count,
           "groups": model["topology"]["bridgeGroups"]})

if __name__ == "__main__":
    main()
