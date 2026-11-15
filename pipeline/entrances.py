"""
Building entrances -> data/building_entrances.json

buildings.geojson has one centroid per building. This picks a better point to start and end a walk:
  1. manual: data/manual_entrances.json (checked by hand)
  2. an OSM entrance node (entrance=main, then yes) on the building's outline
  3. ASU's entrance points (data/source/asu_accessible_entrances.json), matched by building number
  4. the point on the outline closest to the walking network
  5. the centroid

Run before network.py:  python pipeline/entrances.py  (uses the cached download, --refresh to download again)
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

import network  # same folder: reuses the walking-network helpers

ROOT = Path(__file__).parent.parent
OUT_FILE = ROOT / "data" / "building_entrances.json"
CACHE_FILE = Path(__file__).parent / "cache" / "overpass_buildings.json"
MANUAL_ENTRANCES_FILE = ROOT / "data" / "manual_entrances.json"
ASU_ENTRANCES_FILE = ROOT / "data" / "source" / "asu_accessible_entrances.json"

ASU_MAX_FROM_BUILDING_M = 150  # an ASU point farther than this from the building point is not used
ASU_MAX_FROM_PATH_M = 40       # nor one farther than this from a walking path

MAX_MATCH_M = 60        # centroid not inside any outline: accept the nearest one within this
ENTRANCE_TO_EDGE_M = 3  # an entrance node counts as part of an outline if it is this close to its edge
SAMPLE_STEP_M = 2       # spacing of candidate points along an outline
ENTRANCE_TYPES = ("main", "yes")  # tried in this order


def fetch_osm(bbox, refresh):
    if CACHE_FILE.exists() and not refresh:
        print(f"Using cached OSM data: {CACHE_FILE}")
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    s, w, n, e = bbox
    data = network.query_overpass(f'[out:json][timeout:120];(way["building"]({s},{w},{n},{e});'
                                  f'node["entrance"]({s},{w},{n},{e}););out geom;')
    CACHE_FILE.parent.mkdir(exist_ok=True)
    CACHE_FILE.write_text(json.dumps(data), encoding="utf-8")
    return data


def point_in_polygon(px, py, poly):
    inside = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def area(poly):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]))) / 2


def dist_to_edges(px, py, poly):
    best = math.inf
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        dx, dy = x2 - x1, y2 - y1
        t = 0 if dx == dy == 0 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(px - x1 - t * dx, py - y1 - t * dy))
    return best


def boundary_points(poly):
    """Points every SAMPLE_STEP_M along the outline."""
    pts = []
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        n = max(1, int(math.hypot(x2 - x1, y2 - y1) / SAMPLE_STEP_M))
        pts += [(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n) for k in range(n)]
    return pts


def main():
    refresh = "--refresh" in sys.argv
    manual_entrances = {}

    if MANUAL_ENTRANCES_FILE.exists():
        manual_entrances = json.loads(
        MANUAL_ENTRANCES_FILE.read_text(encoding="utf-8")
        )
    buildings = json.loads(network.BUILDINGS_FILE.read_text(encoding="utf-8"))["features"]
    bbox = network.building_bbox(buildings)
    lat0, lon0 = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    xy = lambda lon, lat: network.to_xy(lon, lat, lon0, lat0)

    # walking network, to find the outline point closest to a path
    coords, segments = network.build_graph(network.fetch_osm(bbox), lon0, lat0)
    coords, segments = network.largest_component(coords, segments)
    nxy = {n: xy(*c) for n, c in coords.items()}
    ax = np.array([nxy[a][0] for a, _ in segments]); ay = np.array([nxy[a][1] for a, _ in segments])
    dx = np.array([nxy[b][0] for _, b in segments]) - ax
    dy = np.array([nxy[b][1] for _, b in segments]) - ay
    seg_len2 = np.maximum(dx * dx + dy * dy, 1e-9)

    def dist_to_network(px, py):
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / seg_len2, 0, 1)
        return float(np.min(np.hypot(px - (ax + t * dx), py - (ay + t * dy))))

    osm = fetch_osm(bbox, refresh)
    outlines = [([xy(p["lon"], p["lat"]) for p in el["geometry"][:-1]], el)
                for el in osm["elements"] if el["type"] == "way" and len(el.get("geometry", [])) >= 4]
    entrances = [(xy(el["lon"], el["lat"]), el["tags"]["entrance"], el)
                 for el in osm["elements"] if el["type"] == "node" and el["tags"].get("entrance") in ENTRANCE_TYPES]
    print(f"{len(outlines)} building outlines, {len(entrances)} usable entrance nodes")


    
    # ASU's entrance points by building number
    asu_by_number = {}
    if ASU_ENTRANCES_FILE.exists():
        for pt in json.loads(ASU_ENTRANCES_FILE.read_text(encoding="utf-8"))["points"]:
            if pt["bldg_number"]:
                asu_by_number.setdefault(pt["bldg_number"], []).append(pt)
        print(f"{sum(len(v) for v in asu_by_number.values())} ASU entrance points with a building number")

    def asu_entrance(f, cx, cy):
        """ASU's point for this building (main entrances first, else accessible ones), the one closest to a path."""
        pts = [pt for n in f["properties"].get("bldg_numbers", []) for pt in asu_by_number.get(n, [])]
        pts = [pt for pt in pts if pt["main"]] or [pt for pt in pts if pt["accessible"]] or pts
        usable = []
        for pt in pts:
            px, py = xy(pt["lon"], pt["lat"])
            to_path = dist_to_network(px, py)
            if math.hypot(px - cx, py - cy) <= ASU_MAX_FROM_BUILDING_M and to_path <= ASU_MAX_FROM_PATH_M:
                usable.append((to_path, pt))
        return min(usable, key=lambda a: a[0])[1] if usable else None

    result, counts = {}, {
        "manual": 0,
        "asu": 0,
        "osm_main": 0,
        "osm_entrance": 0,
        "outline": 0,
        "centroid": 0,
    }
    for f in buildings:
        bid = f["properties"]["building_id"]
        lon, lat = f["geometry"]["coordinates"]
        if bid in manual_entrances:
            override = manual_entrances[bid]
            entrance_list = override["entrances"]
            primary_index = override.get("primary", 0)
            selected = entrance_list[primary_index]

            result[bid] = {
            "lon": selected["lon"],
            "lat": selected["lat"],
            "source": "manual",
             }

            counts["manual"] += 1
            continue

        cx, cy = xy(lon, lat)

        asu = asu_entrance(f, cx, cy)

        containing = [(area(poly), poly) for poly, _ in outlines if point_in_polygon(cx, cy, poly)]
        if containing:
            poly = min(containing, key=lambda a: a[0])[1]
        else:
            near = min(((dist_to_edges(cx, cy, poly), poly) for poly, _ in outlines), key=lambda a: a[0], default=None)
            poly = near[1] if near and near[0] <= MAX_MATCH_M else None

        if poly is None:
            if asu:
                result[bid] = {"lon": asu["lon"], "lat": asu["lat"], "source": "asu"}
                counts["asu"] += 1
            else:
                result[bid] = {"lon": lon, "lat": lat, "source": "centroid"}
                counts["centroid"] += 1
            continue

        own = [(p, kind) for p, kind, _ in entrances if dist_to_edges(p[0], p[1], poly) <= ENTRANCE_TO_EDGE_M]
        pick, source = None, None
        for kind in ENTRANCE_TYPES:
            cands = [p for p, k in own if k == kind]
            if cands:
                pick, source = min(cands, key=lambda p: dist_to_network(*p)), "osm_main" if kind == "main" else "osm_entrance"
                break
        if pick is None and asu:
            result[bid] = {"lon": asu["lon"], "lat": asu["lat"], "source": "asu"}
            counts["asu"] += 1
            continue
        if pick is None:
            pick, source = min(boundary_points(poly), key=lambda p: dist_to_network(*p)), "outline"
        counts[source] += 1

        # back to lon/lat
        elon = lon0 + pick[0] / (111320 * math.cos(math.radians(lat0)))
        elat = lat0 + pick[1] / 110574
        result[bid] = {"lon": round(elon, 6), "lat": round(elat, 6), "source": source}

    OUT_FILE.write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(f"Wrote {len(result)} entrances to {OUT_FILE}")
    print("Source:", counts)


if __name__ == "__main__":
    main()
