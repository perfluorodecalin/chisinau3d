"""Acquire and assess INDS DTM 2020 without changing the game terrain."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".local" / "inds-terrain"
TILES = OUT / "tiles"
WCS = "https://geodata.gov.md/geoserver/DTM/wcs"
COVERAGE = "DTM__DTM_2020_centru"
SOURCE_CRS = "EPSG:4026"
SOURCE_STEP = 5.0
NODATA = -32767.0
ORIGIN_LAT, ORIGIN_LON = 47.0245, 28.8323
METRES_PER_DEGREE = 111320.0
MAX_TILE_METRES = 5000.0
TIMEOUT_SECONDS = 60
CAPABILITIES_URL = WCS + "?" + urllib.parse.urlencode({
    "service": "WCS", "version": "2.0.1", "request": "GetCapabilities"})
DESCRIPTION_URL = WCS + "?" + urllib.parse.urlencode({
    "service": "WCS", "version": "2.0.1", "request": "DescribeCoverage",
    "coverageId": COVERAGE})


def modules():
    try:
        import numpy as np
        import rasterio
        from PIL import Image
        from pyproj import Transformer
        from rasterio.merge import merge
    except ImportError as error:
        raise SystemExit("Install the optional requirements in an isolated environment: "
                         "pip install -r requirements-inds-terrain.txt") from error
    return np, rasterio, Image, Transformer, merge


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def game_bounds():
    meta = json.loads((ROOT / "dist/data/terrain.json").read_text("utf-8"))
    xmax = meta["xmin"] + (meta["nx"] - 1) * meta["step"]
    zmax = meta["zmin"] + (meta["nz"] - 1) * meta["step"]
    scale = METRES_PER_DEGREE * math.cos(math.radians(ORIGIN_LAT))
    return (ORIGIN_LON + meta["xmin"] / scale,
            ORIGIN_LAT - zmax / METRES_PER_DEGREE,
            ORIGIN_LON + xmax / scale,
            ORIGIN_LAT - meta["zmin"] / METRES_PER_DEGREE)


def densified_bounds(transformer, bounds, segments=32):
    west, south, east, north = bounds
    points = []
    for index in range(segments + 1):
        fraction = index / segments
        lon = west + (east - west) * fraction
        lat = south + (north - south) * fraction
        points.extend(((lon, south), (lon, north), (west, lat), (east, lat)))
    projected = [transformer.transform(*point) for point in points]
    xs, ys = zip(*projected)
    return min(xs), min(ys), max(xs), max(ys)


def align(bounds, step=SOURCE_STEP):
    xmin, ymin, xmax, ymax = bounds
    return (math.floor(xmin / step) * step, math.floor(ymin / step) * step,
            math.ceil(xmax / step) * step, math.ceil(ymax / step) * step)


def tiles(bounds, size=MAX_TILE_METRES):
    xmin, ymin, xmax, ymax = bounds
    y0 = ymin
    while y0 < ymax:
        x0 = xmin
        while x0 < xmax:
            yield x0, y0, min(x0 + size, xmax), min(y0 + size, ymax)
            x0 += size
        y0 += size


def coverage_url(bounds):
    xmin, ymin, xmax, ymax = bounds
    # DescribeCoverage declares native axis labels Y X. GeoServer maps the
    # first-labelled Y subset to the GeoTIFF X/easting bounds and X to Y/northing.
    # A probe verifies the returned transform before the larger acquisition.
    query = [("service", "WCS"), ("version", "2.0.1"),
             ("request", "GetCoverage"), ("coverageId", COVERAGE),
             ("format", "image/tiff"),
             ("subset", f"Y({xmin:.3f},{xmax:.3f})"),
             ("subset", f"X({ymin:.3f},{ymax:.3f})")]
    return WCS + "?" + urllib.parse.urlencode(query)


def fetch(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    request = urllib.request.Request(url, headers={
        "User-Agent": "chisinau3d-terrain-research/1"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            content_type = response.headers.get_content_type()
            with partial.open("wb") as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
        prefix = partial.read_bytes()[:4]
        if destination.suffix.lower() in {".tif", ".tiff"} and prefix not in {
                b"II*\x00", b"MM\x00*"}:
            detail = partial.read_text("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Expected GeoTIFF; received {content_type}: {detail}")
        os.replace(partial, destination)
    finally:
        partial.unlink(missing_ok=True)


def fetch_xml(url, path):
    if not path.exists():
        fetch(url, path)
    ET.parse(path)


def inspect(path, expected=None):
    np, rasterio, _, _, _ = modules()
    with rasterio.open(path) as source:
        errors = []
        if source.crs is None or source.crs.to_epsg() != 4026:
            errors.append(f"unexpected CRS {source.crs}")
        if source.count != 1:
            errors.append(f"expected one band, got {source.count}")
        if any(not math.isclose(abs(value), SOURCE_STEP, abs_tol=.01)
               for value in source.res):
            errors.append(f"unexpected resolution {source.res}")
        if expected and any(abs(actual - requested) > SOURCE_STEP * 1.1
                            for actual, requested in zip(source.bounds, expected)):
            errors.append(f"bounds {tuple(source.bounds)} differ from {expected}")
        band = source.read(1, masked=True)
        valid = band.compressed()
        if not valid.size:
            errors.append("no valid samples")
        elif not np.isfinite(valid).all():
            errors.append("non-finite samples")
        if errors:
            raise RuntimeError(f"{path.name}: " + "; ".join(errors))
        return {"width": source.width, "height": source.height,
                "crs": str(source.crs), "resolution": list(source.res),
                "bounds": list(source.bounds), "nodata": source.nodata,
                "dtype": source.dtypes[0], "validPixels": int(valid.size),
                "totalPixels": int(band.size), "min": float(valid.min()),
                "max": float(valid.max()), "mean": float(valid.mean()),
                "tags": source.tags()}


def context():
    _, _, _, Transformer, _ = modules()
    OUT.mkdir(parents=True, exist_ok=True)
    fetch_xml(CAPABILITIES_URL, OUT / "wcs-capabilities.xml")
    fetch_xml(DESCRIPTION_URL, OUT / "coverage-description.xml")
    forward = Transformer.from_crs("EPSG:4326", SOURCE_CRS, always_xy=True)
    geographic = game_bounds()
    native = align(densified_bounds(forward, geographic))
    return forward, geographic, native


def probe():
    forward, geographic, native = context()
    x, y = forward.transform(ORIGIN_LON, ORIGIN_LAT)
    bounds = align((x - 500, y - 500, x + 500, y + 500))
    path = OUT / "probe.tif"
    if not path.exists():
        fetch(coverage_url(bounds), path)
    result = {"coverage": COVERAGE, "gameBoundsWgs84": geographic,
              "downloadBoundsEpsg4026": native,
              "probeBoundsEpsg4026": bounds,
              "probe": {**inspect(path, bounds), "sha256": sha256(path)}}
    (OUT / "probe.json").write_text(json.dumps(result, indent=2) + "\n", "utf-8")
    print(json.dumps(result, indent=2))


def download():
    _, geographic, native = context()
    requests = list(tiles(native))
    records = []
    print(f"Downloading/reusing {len(requests)} bounded tiles sequentially")
    for index, bounds in enumerate(requests):
        path = TILES / f"dtm-2020-{index:02d}.tif"
        if not path.exists():
            print(f"[{index + 1}/{len(requests)}] {bounds}", flush=True)
            fetch(coverage_url(bounds), path)
        details = inspect(path, bounds)
        records.append({"file": str(path.relative_to(OUT)).replace("\\", "/"),
                        "requestUrl": coverage_url(bounds),
                        "requestedBounds": bounds, "sha256": sha256(path),
                        "bytes": path.stat().st_size,
                        "fetchedAt": datetime.fromtimestamp(
                            path.stat().st_mtime, timezone.utc).isoformat(),
                        **details})
    manifest = {"retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "provider": "Agenția Geodezie, Cartografie și Cadastru / geodata.gov.md",
                "catalogueRecord": "bd7eb6a4-9d80-4319-8b0f-268379fe46e3",
                "service": WCS, "coverage": COVERAGE,
                "sourceCrs": SOURCE_CRS, "gameBoundsWgs84": geographic,
                "downloadBoundsEpsg4026": native,
                "sourceResolutionMetres": SOURCE_STEP,
                "advertisedNoData": NODATA,
                "redistribution": "Local research pending attribution and vertical-datum verification",
                "tiles": records}
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", "utf-8")
    print(f"Validated {len(records)} tiles; manifest saved")


def mosaic():
    _, rasterio, _, _, merge = modules()
    manifest = json.loads((OUT / "manifest.json").read_text("utf-8"))
    sources = [rasterio.open(OUT / item["file"]) for item in manifest["tiles"]]
    try:
        data, transform = merge(sources, nodata=NODATA)
        profile = sources[0].profile.copy()
        profile.update(driver="GTiff", height=data.shape[1], width=data.shape[2],
                       transform=transform, nodata=NODATA, compress="deflate",
                       predictor=3, tiled=True, bigtiff="IF_SAFER")
        partial = OUT / "dtm-2020-mosaic.partial.tif"
        with rasterio.open(partial, "w", **profile) as output:
            output.write(data)
        os.replace(partial, OUT / "dtm-2020-mosaic.tif")
    finally:
        for source in sources:
            source.close()
    inspect(OUT / "dtm-2020-mosaic.tif")
    print("Created validated native-resolution mosaic")


def percentiles(np, values):
    return {str(p): float(np.percentile(values, p))
            for p in (1, 5, 25, 50, 75, 95, 99)}


def preview(np, Image, values, path, valid=None, low=None, high=None):
    valid = np.isfinite(values) if valid is None else valid
    samples = values[valid]
    low = float(np.percentile(samples, 2)) if low is None else low
    high = float(np.percentile(samples, 98)) if high is None else high
    pixels = np.zeros(values.shape, dtype=np.uint8)
    pixels[valid] = np.clip((values[valid] - low) /
                            max(high - low, 1e-9) * 255, 0, 255).astype(np.uint8)
    image = Image.fromarray(pixels, "L")
    image.thumbnail((1600, 1600))
    image.save(path)


def assess():
    np, rasterio, Image, Transformer, _ = modules()
    mosaic_path = OUT / "dtm-2020-mosaic.tif"
    if not mosaic_path.exists():
        mosaic()
    meta = json.loads((ROOT / "dist/data/terrain.json").read_text("utf-8"))
    current = np.fromfile(ROOT / "dist/data/terrain.bin", dtype="<f4").reshape(
        meta["nz"], meta["nx"]) + meta["offset"]
    xs = meta["xmin"] + np.arange(meta["nx"]) * meta["step"]
    zs = meta["zmin"] + np.arange(meta["nz"]) * meta["step"]
    xx, zz = np.meshgrid(xs, zs)
    scale = METRES_PER_DEGREE * math.cos(math.radians(ORIGIN_LAT))
    lon, lat = ORIGIN_LON + xx / scale, ORIGIN_LAT - zz / METRES_PER_DEGREE
    transformer = Transformer.from_crs("EPSG:4326", SOURCE_CRS, always_xy=True)
    east, north = transformer.transform(lon, lat)
    representative = {
        "city centre": (28.8323, 47.0245),
        "Valea Morilor": (28.8069, 47.0186),
        "Bîc corridor": (28.8420, 47.0270),
        "Telecentru hillside": (28.8145, 47.0015),
        "M1 western approach": (28.7540, 47.0120),
        "M5 northern approach": (28.8330, 47.0800),
    }
    rep_lonlat = list(representative.values())
    rep_east, rep_north = transformer.transform(
        [point[0] for point in rep_lonlat], [point[1] for point in rep_lonlat])
    with rasterio.open(mosaic_path) as source:
        sampled = np.ma.vstack(list(source.sample(
            zip(east.ravel(), north.ravel()), masked=True)))[:, 0]
        sampled = sampled.reshape(current.shape).filled(np.nan)
        elevations = source.read(1, masked=True).filled(np.nan).astype(float)
        rep_new = [float(value[0]) for value in source.sample(zip(rep_east, rep_north))]
        mosaic_bounds = source.bounds
    valid = np.isfinite(sampled)
    delta = sampled - current
    differences = delta[valid]
    if not differences.size:
        raise RuntimeError("No overlapping valid samples")
    dy, dx = np.gradient(np.nan_to_num(
        elevations, nan=np.nanmedian(elevations)), SOURCE_STEP)
    slope = np.degrees(np.arctan(np.sqrt(dx * dx + dy * dy)))
    manifest = json.loads((OUT / "manifest.json").read_text("utf-8"))
    full_bounds = manifest["downloadBoundsEpsg4026"]
    x_seams = sorted({item["requestedBounds"][0] for item in manifest["tiles"]
                      if item["requestedBounds"][0] > full_bounds[0]})
    y_seams = sorted({item["requestedBounds"][1] for item in manifest["tiles"]
                      if item["requestedBounds"][1] > full_bounds[1]})
    seam_steps = []
    for x_value in x_seams:
        column = round((x_value - mosaic_bounds.left) / SOURCE_STEP)
        values = np.abs(elevations[:, column] - elevations[:, column - 1])
        seam_steps.extend(values[np.isfinite(values)])
    for y_value in y_seams:
        row = round((mosaic_bounds.top - y_value) / SOURCE_STEP)
        values = np.abs(elevations[row] - elevations[row - 1])
        seam_steps.extend(values[np.isfinite(values)])
    seam_steps = np.asarray(seam_steps)
    all_steps = np.concatenate((np.abs(np.diff(elevations, axis=0)).ravel(),
                                np.abs(np.diff(elevations, axis=1)).ravel()))
    all_steps = all_steps[np.isfinite(all_steps)]

    def current_at(lon_value, lat_value):
        x_value = (lon_value - ORIGIN_LON) * scale
        z_value = -(lat_value - ORIGIN_LAT) * METRES_PER_DEGREE
        u = np.clip((x_value - meta["xmin"]) / meta["step"], 0, meta["nx"] - 1.000001)
        v = np.clip((z_value - meta["zmin"]) / meta["step"], 0, meta["nz"] - 1.000001)
        i, j = int(u), int(v)
        a, b = u - i, v - j
        return float((current[j, i] * (1 - a) + current[j, i + 1] * a) * (1 - b) +
                     (current[j + 1, i] * (1 - a) + current[j + 1, i + 1] * a) * b)

    rep_rows = []
    for (name, (lon_value, lat_value)), new_value in zip(representative.items(), rep_new):
        old_value = current_at(lon_value, lat_value)
        rep_rows.append({"name": name, "longitude": lon_value, "latitude": lat_value,
                         "new": new_value, "current": old_value,
                         "newMinusCurrent": new_value - old_value})
    stats = {"status": "not ready for integration",
             "reason": "Elevation unit and vertical datum are not established; WCS advertises W.m-2.Sr-1.",
             "coveragePercentAtCurrentGrid": float(valid.mean() * 100),
             "newElevation": {"min": float(np.nanmin(elevations)),
                              "max": float(np.nanmax(elevations)),
                              "percentiles": percentiles(np, elevations[np.isfinite(elevations)])},
             "newMinusCurrentAssumingMetres": {
                 "mean": float(differences.mean()),
                 "rmse": float(np.sqrt(np.mean(differences ** 2))),
                 "min": float(differences.min()), "max": float(differences.max()),
                 "percentiles": percentiles(np, differences)},
             "slopeDegrees": {"percentiles": percentiles(np, slope.ravel())},
             "tileBoundaryDiagnostic": {
                 "boundaryCount": len(x_seams) + len(y_seams),
                 "sampleCount": int(seam_steps.size),
                 "maximumAdjacentStep": float(seam_steps.max()),
                 "percentiles": percentiles(np, seam_steps),
                 "allRasterAdjacentStepPercentiles": percentiles(np, all_steps)},
             "representativeLocationsAssumingMetres": rep_rows,
             "limitations": ["Differences do not establish which source is correct.",
                             "Boundary steps are compared with ordinary adjacent pixels; this is a seam diagnostic, not a continuity proof.",
                             "No surveyed checkpoints were available."]}
    (OUT / "assessment.json").write_text(
        json.dumps(stats, indent=2) + "\n", "utf-8")
    preview(np, Image, elevations, OUT / "elevation-preview.png")
    hillshade = 255 * np.clip(.55 - .35 * dx + .35 * dy, 0, 1)
    preview(np, Image, hillshade, OUT / "hillshade-preview.png",
            np.isfinite(elevations), 0, 255)
    preview(np, Image, delta, OUT / "difference-preview.png", valid)
    comparison = stats["newMinusCurrentAssumingMetres"]
    report = f"""# DTM 2020 assessment

Status: **{stats['status']}**.

The numeric 5 m GeoTIFF covers {stats['coveragePercentAtCurrentGrid']:.3f}% of the current grid. Values range from {stats['newElevation']['min']:.2f} to {stats['newElevation']['max']:.2f}. If treated as metres, difference from current absolute elevations has mean {comparison['mean']:.2f} m and RMSE {comparison['rmse']:.2f} m. This measures disagreement, not accuracy. Tile-boundary adjacent steps have a 95th percentile of {stats['tileBoundaryDiagnostic']['percentiles']['95']:.2f}, compared with {stats['tileBoundaryDiagnostic']['allRasterAdjacentStepPercentiles']['95']:.2f} across the raster.

Integration is blocked because neither the catalogue nor WCS establishes the vertical datum or a valid elevation unit; WCS advertises `W.m-2.Sr-1`. Ask the provider to confirm elevation unit, vertical datum/geoid, void filling, acquisition date within 2020, and redistribution/attribution terms for GeoTIFF subsets.

Generated files include the mosaic, JSON assessment, and elevation, hillshade and difference previews. The game terrain was not changed.
"""
    (OUT / "ASSESSMENT.md").write_text(report, "utf-8")
    print(report)


def verify():
    manifest = json.loads((OUT / "manifest.json").read_text("utf-8"))
    for item in manifest["tiles"]:
        path = OUT / item["file"]
        if sha256(path) != item["sha256"] or path.stat().st_size != item["bytes"]:
            raise RuntimeError(f"Checksum/size mismatch: {path}")
        details = inspect(path, item["requestedBounds"])
        for key in ("width", "height", "crs", "dtype", "validPixels"):
            if details[key] != item[key]:
                raise RuntimeError(f"Metadata mismatch: {path}: {key}")
    if (OUT / "dtm-2020-mosaic.tif").exists():
        inspect(OUT / "dtm-2020-mosaic.tif")
    print(f"Verified {len(manifest['tiles'])} source tiles and available mosaic")


def self_test():
    assert align((1.2, -3.1, 12.2, 9.01)) == (0, -5, 15, 10)
    parts = list(tiles((0, 0, 10000, 7500)))
    assert len(parts) == 4 and parts[-1] == (5000, 5000, 10000, 7500)
    parsed = urllib.parse.parse_qs(urllib.parse.urlparse(
        coverage_url((1, 2, 3, 4))).query)
    assert parsed["subset"] == ["Y(1.000,3.000)", "X(2.000,4.000)"]
    west, south, east, north = game_bounds()
    assert 28.7 < west < east < 29.1 and 46.9 < south < north < 47.2
    print("Terrain acquisition helper tests passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=(
        "probe", "download", "mosaic", "assess", "verify", "self-test"))
    command = parser.parse_args().command
    {"probe": probe, "download": download, "mosaic": mosaic,
     "assess": assess, "verify": verify, "self-test": self_test}[command]()


if __name__ == "__main__":
    main()
