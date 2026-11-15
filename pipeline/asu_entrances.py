"""
ASU's own entrance points -> data/source/asu_accessible_entrances.json

From the "Accessible Entrance" layer of ASU Facilities' public map service (surveyed in 2020, so new buildings
are missing). Each point has a building number (BLDG_NUMBER) and a main-entrance flag.
pipeline/entrances.py reads the saved file. Run this only to refresh it:  python3 pipeline/asu_entrances.py
"""

import json
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT_FILE = ROOT / "data" / "source" / "asu_accessible_entrances.json"
LAYER_URL = "https://gis.m.asu.edu/server/rest/services/Campus/CampusAccessibility/MapServer/0/query"
USER_AGENT = "ASU-CICI-WebGIS-research/0.1"
TEMPE_BOX = "-111.95,33.40,-111.91,33.44"   # lon_min,lat_min,lon_max,lat_max, the Tempe campus


def main():
    params = {"where": "1=1", "geometry": TEMPE_BOX, "geometryType": "esriGeometryEnvelope", "inSR": "4326",
              "outSR": "4326", "outFields": "*", "returnGeometry": "true", "resultRecordCount": 2000, "f": "json"}
    req = urllib.request.Request(f"{LAYER_URL}?{urllib.parse.urlencode(params)}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    if data.get("exceededTransferLimit"):
        raise RuntimeError("More points than one request returns, ask for them in pages")

    points = []
    for f in sorted(data["features"], key=lambda f: f["attributes"]["OBJECTID"]):
        a = f["attributes"]
        if not f.get("geometry"):
            continue
        points.append({
            "bldg_number": (a.get("BLDG_NUMBER") or "").strip(),
            "building_name": a.get("buildingname"),
            "main": a.get("mainentrance") == "Y",
            "accessible": a.get("accessibleentrance") == "Y",
            "notes": a.get("notes") or a.get("description"),
            "lon": round(f["geometry"]["x"], 6),
            "lat": round(f["geometry"]["y"], 6),
        })
    out = {"source": LAYER_URL, "fetched": date.today().isoformat(), "points": points}
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(points)} entrance points to {OUT_FILE}")


if __name__ == "__main__":
    main()
