"""
ASU's building outlines -> data/source/asu_building_outlines.json

From the "Building" layer of ASU Facilities' public map service. One polygon per building, with the building
number (BLDG_NUMBER, the same as `bldg_numbers` in buildings.geojson), so no guessing which outline is which.
It has buildings that OpenStreetMap does not have yet (the Walton Center).
pipeline/entrances.py reads the saved file. Run this only to refresh it:  python3 pipeline/asu_outlines.py
"""

import json
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT_FILE = ROOT / "data" / "source" / "asu_building_outlines.json"
LAYER_URL = "https://gis.m.asu.edu/server/rest/services/Campus/CampusBuilding/MapServer/0/query"
USER_AGENT = "ASU-WebGIS-Project/0.1"
TEMPE_BOX = "-111.95,33.40,-111.91,33.44"   # lon_min,lat_min,lon_max,lat_max, the Tempe campus
PAGE = 500


def fetch_page(offset):
    params = {"where": "1=1", "geometry": TEMPE_BOX, "geometryType": "esriGeometryEnvelope", "inSR": "4326",
              "outSR": "4326", "outFields": "BLDG_NUMBER,BLDG_NAME", "returnGeometry": "true",
              "resultOffset": offset, "resultRecordCount": PAGE, "f": "json"}
    req = urllib.request.Request(f"{LAYER_URL}?{urllib.parse.urlencode(params)}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def main():
    feats, offset = [], 0
    while True:
        page = fetch_page(offset)
        feats += page["features"]
        if not page.get("exceededTransferLimit"):
            break
        offset += PAGE

    buildings = []
    for f in sorted(feats, key=lambda f: (f["attributes"]["BLDG_NUMBER"] or "", f["attributes"]["BLDG_NAME"] or "")):
        rings = (f.get("geometry") or {}).get("rings") or []
        if not rings:
            continue
        # the largest ring is the outline (the others are holes or separate parts, which a walk does not need)
        ring = max(rings, key=lambda r: len(r))
        buildings.append({
            "bldg_number": (f["attributes"]["BLDG_NUMBER"] or "").strip(),
            "name": f["attributes"]["BLDG_NAME"],
            "ring": [[round(x, 6), round(y, 6)] for x, y in ring],
        })
    out = {"source": LAYER_URL, "fetched": date.today().isoformat(), "buildings": buildings}
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(buildings)} outlines to {OUT_FILE}")


if __name__ == "__main__":
    main()
