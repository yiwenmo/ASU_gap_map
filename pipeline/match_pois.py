"""
Build data/pois.geojson, the coffee / food / study places the gap page shows on the way.

Reads   data/source/pois_osm.geojson       places from OpenStreetMap (Cade's extraction, building_id empty)
        data/buildings.geojson
        data/source/campus_dining.csv + data/source/campus_dining_hours.txt   ASU dining checked by hand (pipeline/campus_dining.py)
Writes  data/pois.geojson

0. Only the kinds in OSM_KEEP are used from OSM (none for now). Off-campus coffee and food, and the libraries, are left out.
1. Each OSM place gets the nearest building as `building_id` (`building_dist_m` says how far). The walking
   matrix only knows buildings, so a shop is attached to a building point. Most are next to a building, not
   inside it, so the page says "near". A place farther than NEAREST_MAX_M from every building gets null.
2. ASU dining from the hand-checked list is added. Its building comes from the list, not from a guess, and it
   has weekly opening hours. Its point on the map is the building's point.
3. An OSM place is dropped when the official list already has the same venue in the same building (same first
   word of the name, e.g. OSM "Spitz - ASU" and official "Spitz Mediterranean" in Vista Del Sol K).
   Exact duplicates inside the OSM data (same name, same spot) are dropped too, and the list in DROP.

Opening hours: only the ASU dining list has them (`hours`, format in pipeline/campus_dining.py). OSM places have
`hours: null`, the page treats that as "not known".

Safe to run again: it always starts from data/source/pois_osm.geojson.

Run: python3 pipeline/match_pois.py
"""

import json
import re
import unicodedata
from pathlib import Path

import campus_dining
from match_events import dist_m, load_buildings   # same helpers the event matching uses

ROOT = Path(__file__).parent.parent
POIS_IN = ROOT / "data" / "source" / "pois_osm.geojson"
POIS_OUT = ROOT / "data" / "pois.geojson"

# Which kinds of OSM places go on the page. Off-campus coffee and food (Mill Ave, the Brickyard, ...) are left out:
# they have no opening hours and their building is a guess, while ASU dining has both. The study places (libraries)
# are left out until they have official opening hours. Add "study", "coffee" or "food" here to bring them back.
OSM_KEEP = set()

NEAREST_MAX_M = 150   # farther than this from every building: no building_id
REVIEW_M = 60         # a person should look at guesses farther than this

# Utility buildings that nobody walks to for a coffee. "Nearest building" must not pick them, otherwise
# a shop next to a solar canopy or a pump house is reported as "near Cady Malls Solar".
SKIP_BUILDINGS = re.compile(
    r"solar|storage|pump|utility|antenna|infrastructure|restroom|substation|chiller|canister|maintenance|support|parking|garage",
    re.I)

# Hand-checked fixes: key is the place id from data/source/pois_osm.geojson, value is a building_id.
# Empty for now. Add a line here when a guess is wrong (see the review list this script prints).
MANUAL = {}

# Places a person decided to leave out. Key: place id, value: why.
DROP = {
    "osm_node_8420775350": "OG Taco Shop is the same place as OG Taco (22 m apart, same cuisine); kept the one checked in 2026",
    "osm_node_798622870": "Starbucks at the ASU Bookstore: the 2026 ASU dining list has Cartel Coffee in the Bookstore, not Starbucks",
}

SAME_SPOT_M = 3       # same name and this close: the same place mapped twice, keep the first
LOOKALIKE_M = 40      # different name, same kind, this close: list it, a person decides


def squash(name):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode())


def first_word(name):
    """'The Crêpe Club' -> 'crepe', 'Spitz - ASU' -> 'spitz'"""
    words = [squash(w) for w in name.split()]
    words = [w for w in words if w and w not in ("the", "a")]
    return words[0] if words else ""


def main():
    buildings = load_buildings()
    usable = {i: b for i, b in buildings.items() if not SKIP_BUILDINGS.search(b["name"])}
    data = json.loads(POIS_IN.read_text())
    left_out = [f["properties"]["name"] for f in data["features"] if f["properties"]["category"] not in OSM_KEEP]
    data["features"] = [f for f in data["features"] if f["properties"]["category"] in OSM_KEEP]

    # 1. OSM places
    kept, dropped = [], []
    for f in data["features"]:
        if f["properties"]["id"] in DROP:
            dropped.append(f"{f['properties']['name']} (listed in DROP)")
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        twin = next((k for k in kept if squash(k["properties"]["name"]) == squash(f["properties"]["name"])
                     and dist_m(lon, lat, *k["geometry"]["coordinates"][:2]) <= SAME_SPOT_M), None)
        if twin:
            dropped.append(f"{f['properties']['name']} (exact duplicate)")
        else:
            kept.append(f)

    review, none = [], []
    for f in kept:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        if p["id"] in MANUAL:
            bid = MANUAL[p["id"]]
            d = round(dist_m(lon, lat, buildings[bid]["lon"], buildings[bid]["lat"]))
        else:
            d, bid = min((dist_m(lon, lat, b["lon"], b["lat"]), i) for i, b in usable.items())
            d = round(d)
            if d > NEAREST_MAX_M:
                bid = None
        p["building_id"] = bid
        p["building_dist_m"] = d
        p["hours"] = None
        p["source"] = "osm"
        if bid is None:
            none.append(p["name"])
        elif d > REVIEW_M and p["id"] not in MANUAL:
            review.append((d, p["name"], buildings[bid]["name"]))

    # 2. ASU dining from the hand-checked list
    official = campus_dining.load()
    known = {(o["building_id"], first_word(o["name"])) for o in official}
    is_dup = lambda f: (f["properties"]["building_id"], first_word(f["properties"]["name"])) in known
    replaced = [f["properties"]["name"] for f in kept if is_dup(f)]
    kept = [f for f in kept if not is_dup(f)]
    features = list(kept)
    for n, o in enumerate(official):
        b = buildings[o["building_id"]]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [b["lon"], b["lat"]]},
            "properties": {"id": f"dining_{n:03d}_{squash(o['name'])}", "name": o["name"], "category": o["category"],
                           "building_id": o["building_id"], "building_dist_m": 0, "hours": o["hours"], "source": "asu_dining"},
        })
    data["features"] = features
    POIS_OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")

    print(f"{len(features)} places: {len(kept)} from OpenStreetMap, {len(official)} ASU dining")
    print(f"Wrote {POIS_OUT}")
    if left_out:
        print(f"\nOSM places not used because their kind is not in OSM_KEEP: {len(left_out)}")
    if dropped:
        print(f"\nLeft out of the OSM data ({len(dropped)}): {', '.join(dropped)}")
    if replaced:
        print(f"OSM places replaced by the official list ({len(replaced)}): {', '.join(replaced)}")
    todo = campus_dining.without_building()
    if todo:
        print(f"\nASU dining without a building yet, not on the page ({len(todo)}): {', '.join(todo)}")
    like = [(a["properties"]["name"], b["properties"]["name"], round(dist_m(*a["geometry"]["coordinates"][:2], *b["geometry"]["coordinates"][:2])))
            for i, a in enumerate(kept) for b in kept[i + 1:]
            if a["properties"]["category"] == b["properties"]["category"]
            and squash(a["properties"]["name"]) != squash(b["properties"]["name"])
            and (squash(a["properties"]["name"]) in squash(b["properties"]["name"])
                 or squash(b["properties"]["name"]) in squash(a["properties"]["name"]))
            and dist_m(*a["geometry"]["coordinates"][:2], *b["geometry"]["coordinates"][:2]) <= LOOKALIKE_M]
    if like:
        print("\nLook alike, maybe the same place:")
        for a, b, d in like:
            print(f"  {a} / {b} ({d} m)")
    if review:
        print(f"\nOSM places farther than {REVIEW_M} m from the building, worth a look:")
        for d, name, bname in sorted(review, reverse=True):
            print(f"  {d:>3} m  {name}  ->  {bname}")


if __name__ == "__main__":
    main()
