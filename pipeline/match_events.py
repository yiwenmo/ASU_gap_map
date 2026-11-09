"""
Match each event to a building_id.

Reads  asu_events_output/asu_events.csv  and  data/buildings.geojson
Writes data/event_buildings.csv  (one row per event occurrence)

Order of matching (first one that works wins):
  1. name    - a building name/alias (or "CODE room") appears in the location text
  2. address - the street address matches exactly one building, and the geocoded
               point is within ADDRESS_MAX_M of it
  3. nearest - the geocoded point is within NEAREST_MAX_M of a building

`review` is set when a person should look: "check" for every nearest match,
"far" for a name match more than FAR_FLAG_M from the geocoded point.

Run: .venv/bin/python pipeline/match_events.py
"""

import csv
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
EVENTS_CSV = ROOT / "asu_events_output" / "asu_events.csv"
BUILDINGS = ROOT / "data" / "buildings.geojson"
OUT_FILE = ROOT / "data" / "event_buildings.csv"

NEAREST_MAX_M = 60   # "nearest building" only if the point is this close
FAR_FLAG_M = 250     # name/address match this far from the geocoded point -> review
MIN_ALIAS_LEN = 5    # shorter aliases (codes like MU, LSE) are too easy to match by accident

# Tempe campus box, to ignore events at other campuses / off campus
TEMPE_BOX = (33.40, 33.44, -111.95, -111.91)

# Names events use that are not in the ASU building list.
# Hand-checked: key is lowercase text found in `locations`, value is a building_id.
MANUAL = {
    "sun devil soccer stadium": "SLSTDM",   # ASU calls it "Soccer & Lacrosse Stadium"
    "life sciences center e": "LSE",        # ASU calls it "Life Sciences Tower E-Wing"
    "istb 4": "ISTB4",                       # "ISTB-4" / "ISTB 4" in event text
    "marston": "ISTB4",                      # Marston Exploration Theater is in ISTB 4
    # Added 11/9 after Ziyi's review (docs/14check.xlsx). These were "nearest" guesses that picked the
    # building next door. Keyed on the location text, not a CSV row, so it survives a refresh of the events.
    "gold dome": "VDSDM",                    # Vista del Sol Dome; nearest guess was VDSK
    "student pavillion": "STPV",             # feed misspells "Pavilion"; nearest guess was ECA
    "sun devil fitness center": "SDFCT",     # ASU calls it "Sun Devil Fitness Complex"; nearest guess was CHUPA
}

# Too generic: matches off-campus places (e.g. "Changing Hands Bookstore Tempe")
EXCLUDE_ALIASES = {"bookstore"}
ADDRESS_MAX_M = 100  # address match is dropped if the geocoded point is farther than this

STREET_WORDS = {"avenue": "ave", "street": "st", "boulevard": "blvd", "drive": "dr", "road": "rd",
                "south": "s", "north": "n", "east": "e", "west": "w", "parkway": "pkwy", "place": "pl"}


def norm_text(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())).strip()


def norm_addr(s):
    s = norm_text((s or "").split(",")[0])
    return " ".join(STREET_WORDS.get(w, w) for w in s.split())


def dist_m(lon1, lat1, lon2, lat2):
    return math.hypot((lon1 - lon2) * 93000, (lat1 - lat2) * 111000)


def load_buildings():
    feats = json.loads(BUILDINGS.read_text())["features"]
    out = {}
    for f in feats:
        p = f["properties"]
        out[p["building_id"]] = {**p, "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1]}
    return out


def build_indexes(buildings):
    codes = {}
    names = {}   # normalized alias -> building_id (aliases that appear for >1 building are dropped)
    clash = set()
    addrs = {}
    for b in buildings.values():
        for a in b["aliases"]:
            n = norm_text(a)
            if len(n) < MIN_ALIAS_LEN or n.isdigit() or n in EXCLUDE_ALIASES or n == b["building_id"].lower():  # codes are matched separately, with a room number
                continue
            if n in names and names[n] != b["building_id"]:
                clash.add(n)
            names[n] = b["building_id"]
        addrs.setdefault(norm_addr(b["address"]), set()).add(b["building_id"])
        if re.fullmatch(r"[A-Za-z]{3,6}", b["building_id"]):
            codes[b["building_id"].lower()] = b["building_id"]
    for n in clash:
        del names[n]
    return names, addrs, codes


def match_name(location, names, codes):
    text = " " + norm_text(location) + " "
    for key, bid in MANUAL.items():
        if f" {norm_text(key)} " in text:
            return bid
    hits = [(len(n), bid) for n, bid in names.items() if f" {n} " in text]
    if hits:
        return max(hits)[1]   # longest name wins
    # building code followed by a room number, e.g. "FAC 133", "LIB 101"
    m = re.search(r"\b([a-z]{3,6}) ?\d{2,4}\b", text)
    return codes.get(m.group(1)) if m else None


def match_event(row, buildings, names, addrs, codes):
    lon = float(row["lon"]) if row["lon"] else None
    lat = float(row["lat"]) if row["lat"] else None
    has_point = row["geo_source"] == "address" and lon is not None

    # the venue address sometimes holds the building name too (e.g. "University Gateway Building, Room 315, ...")
    bid, method = match_name(row["locations"] + " " + row["venue_address"], names, codes), "name"
    if not bid:
        ids = addrs.get(norm_addr(row["venue_address"]), set())
        if len(ids) == 1:
            cand = next(iter(ids))
            if not has_point or dist_m(lon, lat, buildings[cand]["lon"], buildings[cand]["lat"]) <= ADDRESS_MAX_M:
                bid, method = cand, "address"
    near = None
    if has_point and TEMPE_BOX[0] < lat < TEMPE_BOX[1] and TEMPE_BOX[2] < lon < TEMPE_BOX[3]:
        near = min(((dist_m(lon, lat, b["lon"], b["lat"]), i) for i, b in buildings.items()))
    if not bid and near and near[0] <= NEAREST_MAX_M:
        bid, method = near[1], "nearest"
    if not bid:
        return "", "", "", ""

    b = buildings[bid]
    d = round(dist_m(lon, lat, b["lon"], b["lat"])) if has_point else ""
    review = "far" if d != "" and d > FAR_FLAG_M else ""
    if method == "nearest":
        review = "check"   # only distance to go on, so a person should confirm
    return bid, method, d, review


def main():
    buildings = load_buildings()
    names, addrs, codes = build_indexes(buildings)
    rows = list(csv.DictReader(open(EVENTS_CSV, encoding="utf-8")))
    out, counts = [], {}
    for r in rows:
        bid, method, d, review = match_event(r, buildings, names, addrs, codes)
        counts[method or "unmatched"] = counts.get(method or "unmatched", 0) + 1
        if review:
            counts["review"] = counts.get("review", 0) + 1
        out.append({"nid": r["nid"], "start": r["start"], "building_id": bid, "match": method,
                    "dist_m": d, "review": review, "locations": r["locations"],
                    "venue_address": r["venue_address"], "geo_source": r["geo_source"]})
    OUT_FILE.parent.mkdir(exist_ok=True)
    with open(OUT_FILE, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0]))
        w.writeheader()
        w.writerows(out)
    print(f"{len(rows)} events:", counts)
    print(f"Wrote {OUT_FILE}")


if __name__ == "__main__":
    main()
