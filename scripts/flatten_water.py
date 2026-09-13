"""Level saved OSM water polygons against the unmodified local terrain base."""
import json
import math
import pathlib

import numpy as np

from snapshot_data import load_elements

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "data"
BASE = ROOT / ".local" / "inds-terrain" / "integrated-base.bin"
LAT0, LON0 = 47.0245, 28.8323
R = 111320.0
SCALE = R * math.cos(math.radians(LAT0))


def inside(x, z, ring):
    contained = False
    for p, q in zip(ring, ring[1:] + ring[:1]):
        if (p[1] > z) != (q[1] > z) and x < (q[0] - p[0]) * (z - p[1]) / (q[1] - p[1]) + p[0]:
            contained = not contained
    return contained


def main():
    meta = json.loads((OUT / "terrain.json").read_text("utf-8"))
    if not BASE.exists():
        raise SystemExit("Missing .local/inds-terrain/integrated-base.bin; prepare INDS terrain first")
    base = np.fromfile(BASE, dtype="<f4")
    if base.size != meta["nx"] * meta["nz"]:
        raise RuntimeError("Terrain base dimensions do not match terrain.json")
    base = base.reshape(meta["nz"], meta["nx"])
    result = base.copy()
    step = meta["step"]
    levels = {}
    for element in load_elements(ROOT):
        if element.get("tags", {}).get("natural") != "water" or len(element.get("geometry", [])) < 4:
            continue
        ring = [((point["lon"] - LON0) * SCALE, -(point["lat"] - LAT0) * R)
                for point in element["geometry"]]
        xs, zs = [p[0] for p in ring], [p[1] for p in ring]
        cells = []
        j0 = max(0, math.ceil((min(zs) - meta["zmin"]) / step))
        j1 = min(meta["nz"], math.floor((max(zs) - meta["zmin"]) / step) + 1)
        i0 = max(0, math.ceil((min(xs) - meta["xmin"]) / step))
        i1 = min(meta["nx"], math.floor((max(xs) - meta["xmin"]) / step) + 1)
        for j in range(j0, j1):
            for i in range(i0, i1):
                if inside(meta["xmin"] + i * step, meta["zmin"] + j * step, ring):
                    cells.append((j, i))
        samples = [float(base[j, i]) for j, i in cells]
        if not samples:
            samples = [float(base[
                max(0, min(meta["nz"] - 1, round((z - meta["zmin"]) / step))),
                max(0, min(meta["nx"] - 1, round((x - meta["xmin"]) / step)))])
                for x, z in ring]
        height = float(np.median(samples))
        levels[str(element["id"])] = height
        for j, i in cells:
            result[j, i] = height - .45
    (OUT / "terrain.bin").write_bytes(result.astype("<f4").tobytes())
    (OUT / "water-levels.json").write_text(
        json.dumps(levels, separators=(",", ":")), "utf-8")
    meta["minElevation"] = float(result.min() + meta["offset"])
    meta["maxElevation"] = float(result.max() + meta["offset"])
    meta["waterLeveling"] = "Median source-grid height; terrain under saved OSM water lowered 0.45 m"
    (OUT / "terrain.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print("Levelled water polygons", len(levels))


if __name__ == "__main__":
    main()
