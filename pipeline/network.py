"""
Tempe campus walking network -> data/walk_matrix.json (+ QA outputs)

1. Download walkable OSM ways around the buildings (Overpass API), cached locally.
2. Build a graph (one edge per OSM segment) and keep the largest connected piece.
3. Snap every building onto the nearest segment (splitting the segment there).
   buildings.geojson only has centroids, so the walk from the centroid to the snap
   point is added at walking speed.
4. Run Dijkstra from each building -> building-to-building walking time in seconds.

Outputs (data/):
  walk_matrix.json       {from_id: {to_id: seconds}}, includes from_id -> from_id = 0
  building_snaps.json    {building_id: {lon, lat, snap_m}} where each building sits on the network
  walk_network.geojson   the graph as LineStrings (for QA and drawing on the map)

Run: python pipeline/network.py            (uses the cached download if there is one)
     python pipeline/network.py --refresh  (download OSM again)
"""

import json
import math
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra

ROOT = Path(__file__).parent.parent
BUILDINGS_FILE = ROOT / "data" / "buildings.geojson"
MATRIX_FILE = ROOT / "data" / "walk_matrix.json"
ENTRANCES_FILE = ROOT / "data" / "building_entrances.json"
SNAPS_FILE = ROOT / "data" / "building_snaps.json"
NETWORK_FILE = ROOT / "data" / "walk_network.geojson"
CACHE_FILE = Path(__file__).parent / "cache" / "overpass_walk.json"

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
USER_AGENT = "ASU-CICI-WebGIS-research/0.1"

BBOX_MARGIN_DEG = 0.003  # ~300 m around the buildings, so paths at the edge connect
WALK_SPEED_MPS = 1.34    # ~4.8 km/h, typical adult walking speed
MAX_SNAP_WARN_M = 100    # warn when a building centroid is farther than this from a path

# highway=* values people can walk on. motorway/trunk are left out on purpose.
WALKABLE = ("footway|path|pedestrian|steps|cycleway|track|corridor|living_street|residential|"
            "service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link")


def building_bbox(buildings):
    lons = [f["geometry"]["coordinates"][0] for f in buildings]
    lats = [f["geometry"]["coordinates"][1] for f in buildings]
    return (min(lats) - BBOX_MARGIN_DEG, min(lons) - BBOX_MARGIN_DEG,
            max(lats) + BBOX_MARGIN_DEG, max(lons) + BBOX_MARGIN_DEG)


def query_overpass(query, rounds=3):
    """POST an Overpass query, trying each mirror in turn (the servers are often busy)."""
    body = urllib.parse.urlencode({"data": query}).encode()
    last_err = None
    for attempt in range(rounds):
        for url in OVERPASS_URLS:
            try:
                print(f"Downloading from {url} ...")
                req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=180) as resp:
                    return json.load(resp)
            except Exception as err:  # try the next mirror
                last_err = err
                print(f"  failed: {err}")
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"All Overpass mirrors failed: {last_err}")


def fetch_osm(bbox, refresh=False):
    if CACHE_FILE.exists() and not refresh:
        print(f"Using cached OSM data: {CACHE_FILE}")
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    s, w, n, e = bbox
    data = query_overpass(f'[out:json][timeout:90];way["highway"~"^({WALKABLE})$"]({s},{w},{n},{e});out geom;')
    CACHE_FILE.parent.mkdir(exist_ok=True)
    CACHE_FILE.write_text(json.dumps(data), encoding="utf-8")
    return data


def is_walkable(tags):
    # explicit "no foot" or private access removes a way, unless foot is explicitly allowed
    if tags.get("foot") in ("yes", "designated", "permissive"):
        return True
    if tags.get("foot") == "no" or tags.get("access") in ("no", "private"):
        return False
    return True


def to_xy(lon, lat, lon0, lat0):
    """Local equirectangular projection to meters (fine at campus scale)."""
    return ((lon - lon0) * 111320 * math.cos(math.radians(lat0)), (lat - lat0) * 110574)


def build_graph(osm, lon0, lat0):
    """Return node coords {osm_id: (lon, lat)} and a list of segments (node_a, node_b)."""
    coords, segments = {}, set()
    for way in osm["elements"]:
        if way.get("type") != "way" or not is_walkable(way.get("tags", {})):
            continue
        for nid, pt in zip(way["nodes"], way["geometry"]):
            coords[nid] = (pt["lon"], pt["lat"])
        for a, b in zip(way["nodes"], way["nodes"][1:]):
            if a != b:
                segments.add((min(a, b), max(a, b)))
    return coords, sorted(segments)


def largest_component(coords, segments):
    ids = sorted(coords)
    index = {nid: i for i, nid in enumerate(ids)}
    rows = [index[a] for a, _ in segments]
    cols = [index[b] for _, b in segments]
    g = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(ids), len(ids)))
    n_comp, labels = connected_components(g, directed=False)
    sizes = np.bincount(labels)
    keep = int(np.argmax(sizes))
    print(f"Graph: {len(ids)} nodes, {len(segments)} segments, {n_comp} components; "
          f"keeping the largest ({sizes[keep]} nodes), dropping {len(ids) - sizes[keep]} nodes")
    keep_ids = {nid for nid, i in index.items() if labels[i] == keep}
    return ({n: coords[n] for n in keep_ids},
            [(a, b) for a, b in segments if a in keep_ids and b in keep_ids])


def start_points(buildings):
    """Where each building's walk starts: the entrance from entrances.py if there is one, else the centroid."""
    points = {f["properties"]["building_id"]: tuple(f["geometry"]["coordinates"]) for f in buildings}
    if ENTRANCES_FILE.exists():
        for bid, e in json.loads(ENTRANCES_FILE.read_text(encoding="utf-8")).items():
            points[bid] = (e["lon"], e["lat"])
    else:
        print("No data/building_entrances.json, using building centroids (run pipeline/entrances.py first)")
    return points


def snap_buildings(points, coords, segments, lon0, lat0):
    """Find, for each building start point, the closest point on any segment.
    Returns {building_id: (segment_index, t along segment 0..1, snap_lon, snap_lat, snap_m)}."""
    xy = {n: to_xy(*c, lon0, lat0) for n, c in coords.items()}
    ax = np.array([xy[a][0] for a, _ in segments]); ay = np.array([xy[a][1] for a, _ in segments])
    bx = np.array([xy[b][0] for _, b in segments]); by = np.array([xy[b][1] for _, b in segments])
    dx, dy = bx - ax, by - ay
    seg_len2 = np.maximum(dx * dx + dy * dy, 1e-9)

    snaps = {}
    for bid, (lon, lat) in points.items():
        px, py = to_xy(lon, lat, lon0, lat0)
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / seg_len2, 0, 1)
        cx, cy = ax + t * dx, ay + t * dy
        dist = np.hypot(px - cx, py - cy)
        i = int(np.argmin(dist))
        la, lb = coords[segments[i][0]], coords[segments[i][1]]
        snaps[bid] = (
            i, float(t[i]),
            la[0] + t[i] * (lb[0] - la[0]), la[1] + t[i] * (lb[1] - la[1]),
            float(dist[i]),
        )
    return snaps


def build_final_graph(coords, segments, snaps, lon0, lat0):
    """Split segments at the snap points; return node list, edge list, and building -> node index."""
    node_index = {n: i for i, n in enumerate(sorted(coords))}
    node_lonlat = [coords[n] for n in sorted(coords)]
    xy = [to_xy(*c, lon0, lat0) for c in node_lonlat]

    on_segment = defaultdict(list)  # segment index -> [(t, building_id)]
    for bid, (i, t, *_rest) in snaps.items():
        on_segment[i].append((t, bid))

    edges, building_node = [], {}  # edges: (u, v, meters)

    def add_edge(u, v):
        edges.append((u, v, math.hypot(xy[u][0] - xy[v][0], xy[u][1] - xy[v][1])))

    for i, (a, b) in enumerate(segments):
        u, v = node_index[a], node_index[b]
        if i not in on_segment:
            add_edge(u, v)
            continue
        prev = u
        for t, bid in sorted(on_segment[i]):
            _, _, slon, slat, _ = snaps[bid]
            node_lonlat.append((slon, slat))
            xy.append(to_xy(slon, slat, lon0, lat0))
            new = len(node_lonlat) - 1
            add_edge(prev, new)
            building_node[bid] = new
            prev = new
        add_edge(prev, v)
    return node_lonlat, edges, building_node


def main():
    refresh = "--refresh" in sys.argv
    buildings = json.loads(BUILDINGS_FILE.read_text(encoding="utf-8"))["features"]
    bbox = building_bbox(buildings)
    lat0, lon0 = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2

    osm = fetch_osm(bbox, refresh)
    coords, segments = build_graph(osm, lon0, lat0)
    coords, segments = largest_component(coords, segments)

    snaps = snap_buildings(start_points(buildings), coords, segments, lon0, lat0)
    far = sorted(((s[4], bid) for bid, s in snaps.items() if s[4] > MAX_SNAP_WARN_M), reverse=True)
    for d, bid in far:
        print(f"  warning: {bid} is {d:.0f} m from the nearest path")

    node_lonlat, edges, building_node = build_final_graph(coords, segments, snaps, lon0, lat0)
    n = len(node_lonlat)
    rows = [u for u, v, _ in edges] + [v for u, v, _ in edges]
    cols = [v for u, v, _ in edges] + [u for u, v, _ in edges]
    w = [m for _, _, m in edges] * 2
    graph = coo_matrix((w, (rows, cols)), shape=(n, n)).tocsr()

    ids = sorted(building_node)
    sources = [building_node[b] for b in ids]
    dist_m = dijkstra(graph, directed=False, indices=sources)  # meters along the network

    matrix = {}
    for r, a in enumerate(ids):
        row = {}
        for c, b in enumerate(ids):
            if not math.isfinite(dist_m[r, sources[c]]):
                continue
            # network distance + the two off-network legs (centroid <-> snap point)
            meters = 0 if a == b else dist_m[r, sources[c]] + snaps[a][4] + snaps[b][4]
            row[b] = int(round(meters / WALK_SPEED_MPS))
        matrix[a] = row

    MATRIX_FILE.write_text(json.dumps(matrix, separators=(",", ":")), encoding="utf-8")
    SNAPS_FILE.write_text(json.dumps(
        {b: {"lon": round(snaps[b][2], 6), "lat": round(snaps[b][3], 6), "snap_m": round(snaps[b][4], 1)}
         for b in ids}, indent=1), encoding="utf-8")
    NETWORK_FILE.write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {},
         "geometry": {"type": "LineString",
                      "coordinates": [[round(x, 6) for x in node_lonlat[u]], [round(x, 6) for x in node_lonlat[v]]]}}
        for u, v, _ in edges]}, separators=(",", ":")), encoding="utf-8")

    times = [t for a, row in matrix.items() for b, t in row.items() if a != b]
    print(f"Wrote {len(ids)}x{len(ids)} matrix to {MATRIX_FILE}")
    print(f"Walking time: median {np.median(times) / 60:.1f} min, max {max(times) / 60:.1f} min; "
          f"unreachable pairs: {len(ids) * len(ids) - sum(len(r) for r in matrix.values())}")
    missing = [f["properties"]["building_id"] for f in buildings if f["properties"]["building_id"] not in matrix]
    if missing:
        print(f"  buildings not in matrix: {missing}")


if __name__ == "__main__":
    main()
