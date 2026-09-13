"""Read the checked-in OSM snapshot without making network requests."""
import json
from pathlib import Path


def load_elements(root: Path):
    data = root / "dist" / "data"
    sections = json.loads((data / "manifest.json").read_text("utf-8"))
    files = ["center.json", *(f"{section['id']}.json" for section in sections)]
    elements = {}
    for name in files:
        for element in json.loads((data / name).read_text("utf-8"))["elements"]:
            elements.setdefault((element["type"], element["id"]), element)
    return list(elements.values())
