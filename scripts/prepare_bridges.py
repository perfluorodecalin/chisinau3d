"""Project the saved terrain-independent bridge model onto the active DEM."""
import json
import math
import pathlib
import subprocess

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "data"
MODEL = OUT / "bridge-model.json"


def committed(path):
    result = subprocess.run(
        ["git", "show", f"HEAD:{path}"], cwd=ROOT, capture_output=True, check=True)
    return result.stdout


def sampler(meta, grid):
    def height(x, z):
        u = max(0, min(meta["nx"] - 1.001, (x - meta["xmin"]) / meta["step"]))
        v = max(0, min(meta["nz"] - 1.001, (z - meta["zmin"]) / meta["step"]))
        i, j = int(u), int(v)
        a, b = u - i, v - j
        return float((grid[j, i] * (1 - a) + grid[j, i + 1] * a) * (1 - b) +
                     (grid[j + 1, i] * (1 - a) + grid[j + 1, i + 1] * a) * b)
    return height


def make_model():
    """One-time extraction from the original committed profiles and terrain."""
    old_meta = json.loads(committed("dist/data/terrain.json"))
    old_grid = np.frombuffer(committed("dist/data/terrain.bin"), dtype="<f4").reshape(
        old_meta["nz"], old_meta["nx"])
    old_height = sampler(old_meta, old_grid)
    old = json.loads(committed("dist/data/bridges.json"))
    profiles = {}
    for identifier, profile in old["profiles"].items():
        if profile["bridge"]:
            points = [[point[0], point[1]] for point in profile["points"]]
        else:
            points = [[point[0], point[1], round(point[2] - old_height(point[0], point[1]), 4)]
                      for point in profile["points"]]
        profiles[identifier] = {
            "points": points, "bridge": profile["bridge"], "width": profile["width"],
            "name": profile["name"], "highway": profile["highway"]}
    model = {"profiles": profiles,
             "clearanceAssumption": old["clearanceAssumption"],
             "approachGrade": old["approachGrade"],
             "source": "Saved OSM bridge geometry, classifications and shared-node topology; terrain-independent offsets extracted from the original profiles"}
    MODEL.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return model


def main():
    model = json.loads(MODEL.read_text("utf-8")) if MODEL.exists() else make_model()
    meta = json.loads((OUT / "terrain.json").read_text("utf-8"))
    grid = np.fromfile(OUT / "terrain.bin", dtype="<f4").reshape(meta["nz"], meta["nx"])
    height = sampler(meta, grid)
    profiles = {}
    bridges = approaches = 0
    for identifier, source in model["profiles"].items():
        raw = source["points"]
        if source["bridge"]:
            bridges += 1
            distances = [0.0]
            for a, b in zip(raw, raw[1:]):
                distances.append(distances[-1] + math.dist(a[:2], b[:2]))
            total = distances[-1]
            start = height(*raw[0][:2]) + model["clearanceAssumption"]
            end = height(*raw[-1][:2]) + model["clearanceAssumption"]
            points = [[point[0], point[1], round(start + (end - start) *
                      (distance / total if total else 0), 3)]
                      for point, distance in zip(raw, distances)]
        else:
            approaches += 1
            points = [[point[0], point[1], round(height(*point[:2]) + point[2], 3)]
                      for point in raw]
        profiles[identifier] = {**source, "points": points}
    result = {"profiles": profiles,
              "clearanceAssumption": model["clearanceAssumption"],
              "approachGrade": model["approachGrade"],
              "source": model["source"] + "; heights projected onto " + meta["source"]}
    (OUT / "bridges.json").write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print({"bridges": bridges, "approaches": approaches})


if __name__ == "__main__":
    main()
