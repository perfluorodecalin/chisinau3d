"""Resample the acquired INDS DTM into the game and refresh dependants."""
import hashlib
import json
import math
import pathlib
import subprocess
import sys

import numpy as np
import rasterio
from pyproj import Transformer

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "dist" / "data"
LOCAL = ROOT / ".local" / "inds-terrain"
MOSAIC = LOCAL / "dtm-2020-mosaic.tif"
STEP = 20
LAT0, LON0 = 47.0245, 28.8323
R = 111320.0
SCALE = R * math.cos(math.radians(LAT0))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bilinear(source, east, north):
    data = source.read(1, masked=True).filled(np.nan).astype(np.float64)
    inverse = ~source.transform
    column, row = inverse * (east, north)
    column, row = np.asarray(column) - .5, np.asarray(row) - .5
    if (np.any(column < -.5) or np.any(row < -.5) or
            np.any(column > source.width - .5) or np.any(row > source.height - .5)):
        raise RuntimeError("Target grid extends beyond acquired DTM coverage")
    # At the outer half-pixel only one center exists; clamp those few samples.
    column = np.clip(column, 0, source.width - 1)
    row = np.clip(row, 0, source.height - 1)
    i = np.clip(np.floor(column).astype(int), 0, source.width - 2)
    j = np.clip(np.floor(row).astype(int), 0, source.height - 2)
    a, b = column - i, row - j
    values = ((data[j, i] * (1 - a) + data[j, i + 1] * a) * (1 - b) +
              (data[j + 1, i] * (1 - a) + data[j + 1, i + 1] * a) * b)
    if not np.isfinite(values).all():
        raise RuntimeError("Target grid contains missing or invalid DTM elevations")
    return values


def main():
    if not MOSAIC.exists():
        raise SystemExit("Run fetch_inds_terrain.py download and mosaic first")
    old = json.loads((DATA / "terrain.json").read_text("utf-8"))
    xmax = old["xmin"] + (old["nx"] - 1) * old["step"]
    zmax = old["zmin"] + (old["nz"] - 1) * old["step"]
    nx = round((xmax - old["xmin"]) / STEP) + 1
    nz = round((zmax - old["zmin"]) / STEP) + 1
    xs = old["xmin"] + np.arange(nx) * STEP
    zs = old["zmin"] + np.arange(nz) * STEP
    xx, zz = np.meshgrid(xs, zs)
    lon, lat = LON0 + xx / SCALE, LAT0 - zz / R
    transform = Transformer.from_crs("EPSG:4326", "EPSG:4026", always_xy=True)
    east, north = transform.transform(lon, lat)
    with rasterio.open(MOSAIC) as source:
        if source.crs.to_epsg() != 4026 or source.res != (5.0, 5.0):
            raise RuntimeError(f"Unexpected source grid: {source.crs}, {source.res}")
        absolute = bilinear(source, east, north)
        origin_east, origin_north = transform.transform(LON0, LAT0)
        offset = float(bilinear(source, origin_east, origin_north))
    relative = (absolute - offset).astype("<f4")
    base = LOCAL / "integrated-base.bin"
    base.write_bytes(relative.tobytes())
    (DATA / "terrain.bin").write_bytes(relative.tobytes())
    meta = {
        "nx": nx, "nz": nz, "step": STEP, "xmin": old["xmin"], "zmin": old["zmin"],
        "offset": offset, "minElevation": float(absolute.min()),
        "maxElevation": float(absolute.max()),
        "source": "Geoportal INDS / Geodata DTM 2020, Centru",
        "url": "https://geodata.gov.md/geoserver/DTM/wcs",
        "catalogue": "https://geoportalinds.gov.md/geonetwork/srv/eng/catalog.search#/metadata/bd7eb6a4-9d80-4319-8b0f-268379fe46e3",
        "attribution": "Agenția Geodezie, Cartografie și Cadastru, DTM 2020 Centru",
        "horizontalCrs": "MOLDREF99 / Moldova TM (EPSG:4026)",
        "verticalUnit": "metre (inferred)",
        "verticalDatum": "Baltic 1977 normal height (inferred)",
        "verticalInference": [
            "Provider map identifies DTM values as elevation in metres.",
            "Moldovan geodetic literature identifies Baltic 1977 normal heights as the adopted national system.",
            "Mean difference from the previous EGM96-derived orthometric terrain is 0.59 m; ellipsoidal heights would differ by tens of metres.",
            "WCS band unit W.m-2.Sr-1 is treated as erroneous metadata."
        ],
        "sourceResolution": 5, "runtimeResolution": STEP,
        "resampling": "bilinear from the saved native GeoTIFF mosaic",
        "mosaicSha256": digest(MOSAIC),
        "savedSource": ".local/inds-terrain/dtm-2020-mosaic.tif",
        "estimated": False,
    }
    (DATA / "terrain.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")), "utf-8")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "flatten_water.py")], check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts" / "prepare_bridges.py")], check=True)
    print(f"Prepared {nx} x {nz} terrain at {STEP} m; origin elevation {offset:.3f} m")


if __name__ == "__main__":
    main()
