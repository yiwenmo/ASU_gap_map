"""
ASU Tempe campus buildings -> data/buildings.geojson

Source: ASU Facilities "University Facilities Center" layer (building centroids).
building_id is BLDG_CODE (e.g. MU, COOR), the code students see on their schedule.
BLDG_CODE is not unique in the source (wings, outdoor rooms), so records that share
a code are merged into one building.

Run: .venv/bin/python pipeline/buildings.py
"""

import json
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

LAYER_URL = "https://gis.m.asu.edu/server/rest/services/FDM/UniversityFacilities/MapServer/1/query"
USER_AGENT = "ASU-CICI-WebGIS-research/0.1"
TEMPE_CAMPUS_CODE = "MC"  # Main Campus (Tempe)

# Student-friendly display names for buildings whose Facilities names
# differ from the names commonly used on campus.
NAME_OVERRIDES = {
    "GGMA": "ASU Gammage",
    "WCPH": "Walton Center for Planetary Health",
}

SEARCH_ALIASES = {
    "GGMA": [
        "ASU Gammage",
        "Grady Gammage",
        "Grady Gammage Memorial Auditorium",
    ],
    "WCPH": [
        "Walton Center for Planetary Health",
        "Robert and Melani Walton Center for Planetary Health",
    ],
}

OUT_FILE = Path(__file__).parent.parent / "data" / "buildings.geojson"


def fetch_features():
    params = {
        "where": f"BLDG_CAMPUS_CODE='{TEMPE_CAMPUS_CODE}'",
        "outFields": "BLDG_NUMBER,BLDG_NAME,BLDG_CODE,BLDG_ADDRESS,BLDG_HISTORICAL",
        "outSR": 4326,
        "f": "geojson",
    }
    req = urllib.request.Request(f"{LAYER_URL}?{urllib.parse.urlencode(params)}",
                                 headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)["features"]


def build(features):
    groups = defaultdict(list)
    for f in features:
        p = f["properties"]
        if not p["BLDG_CODE"] or p["BLDG_NAME"].upper().startswith("PARKING"):
            continue
        # some records have no location (comes back as 0,0)
        coords = (f.get("geometry") or {}).get("coordinates")
        if not coords or abs(coords[0]) < 1 or abs(coords[1]) < 1:
            print(f"  skipped (no location): {p['BLDG_CODE']} {p['BLDG_NAME']}")
            continue
        groups[p["BLDG_CODE"]].append(f)

    out = []
    for code, fs in sorted(groups.items()):
        # main record = first one that isn't an "X..." outdoor room, by building number
        fs.sort(key=lambda f: (f["properties"]["BLDG_NUMBER"].startswith("X"), f["properties"]["BLDG_NUMBER"]))
        main = fs[0]["properties"]
        lons = [f["geometry"]["coordinates"][0] for f in fs]
        lats = [f["geometry"]["coordinates"][1] for f in fs]
        names = []
        for f in fs:
            n = f["properties"]["BLDG_NAME"].title()
            if n not in names:
                names.append(n)
        aliases = (
            names
            + SEARCH_ALIASES.get(code, [])
            + [code]
            + [f["properties"]["BLDG_NUMBER"] for f in fs]
        )
        aliases = list(dict.fromkeys(aliases))
        
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [sum(lons) / len(lons), sum(lats) / len(lats)]},
            "properties": {
                "building_id": code,
                "name": NAME_OVERRIDES.get(code, main["BLDG_NAME"].title()),
                "aliases": aliases,
                "address": (main["BLDG_ADDRESS"] or "").title(),
                "bldg_numbers": [f["properties"]["BLDG_NUMBER"] for f in fs],
                "campus": TEMPE_CAMPUS_CODE,
            },
        })
    return out


def main():
    feats = build(fetch_features())
    OUT_FILE.parent.mkdir(exist_ok=True)
    OUT_FILE.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, indent=1), encoding="utf-8")
    print(f"Wrote {len(feats)} buildings to {OUT_FILE}")


if __name__ == "__main__":
    main()
