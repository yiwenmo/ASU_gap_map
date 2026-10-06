"""
ASU events -> CSV / GeoJSON / Leaflet map.
Geocodes venue addresses with Nominatim, falls back to campus center if no address.

Run: .venv/bin/python test_WebGIS.py
"""

import html
import json
import re
import shutil
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

FEED_URL = "https://asuevents.asu.edu/feed-json"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim needs a User-Agent (could add an email here)
USER_AGENT = "ASU-CICI-WebGIS-research/0.1"

OUT_DIR = Path(__file__).parent / "asu_events_output"
GEOCODE_CACHE = OUT_DIR / "geocode_cache.json"

# campus center points for events with no address (only in csv/geojson, not shown on the map)
CAMPUS_CENTROIDS = {
    "Tempe campus": (33.4242, -111.9281),
    "Downtown Phoenix campus": (33.4530, -112.0730),
    "Polytechnic campus": (33.3062, -111.6781),
    "West Valley campus": (33.6076, -112.1617),
    "ASU at Mesa City Center": (33.4152, -111.8315),
    "California, Los Angeles": (34.0407, -118.2577),
    "Lake Havasu": (34.4722, -114.3224),
}

KEEP_FIELDS = [
    "nid", "title", "subtitle", "start_date", "end_date",
    "very_start_date", "very_end_date", "campus", "locations",
    "venue_address", "venue_city", "venue_state", "venue_zip",
    "college_unit", "department", "event_types", "event_topics",
    "interests", "audiences", "event_price_level", "alias",
    "image_url", "event_map_url", "recurring",
]


def http_get_json(url, params=None):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def strip_html(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def fetch_events():
    nodes = http_get_json(FEED_URL)["nodes"]
    rows = []
    for item in nodes:
        n = item["node"]
        row = {k: n.get(k, "") for k in KEEP_FIELDS}
        row["summary"] = strip_html(n.get("body_summary"))
        # feed has stuff like "&amp;" in titles
        for k in ["title", "locations", "venue_address"]:
            row[k] = html.unescape(row[k] or "")
        rows.append(row)
    df = pd.DataFrame(rows)
    # e.g. "Oct 5 2026 - 8:00am" -> "2026-10-05", used for sorting / date filter on the map
    start = pd.to_datetime(df["start_date"], format="%b %d %Y - %I:%M%p", errors="coerce")
    df["date"] = start.dt.strftime("%Y-%m-%d")
    df["start"] = start.dt.strftime("%Y-%m-%dT%H:%M")
    print(f"Fetched {len(df)} event occurrences ({df['nid'].nunique()} unique events)")
    return df


def load_cache():
    if GEOCODE_CACHE.exists():
        return json.loads(GEOCODE_CACHE.read_text())
    return {}


def geocode(query, cache):
    # Nominatim allows 1 request/sec, so sleep after each call
    if query in cache:
        return cache[query]
    try:
        res = http_get_json(NOMINATIM_URL, {"q": query, "format": "json", "limit": 1})
        result = [float(res[0]["lat"]), float(res[0]["lon"])] if res else None
    except Exception as e:
        print(f"  geocode error for {query!r}: {e}")
        result = None
    cache[query] = result
    time.sleep(1.1)
    return result


UNIT_RE = re.compile(r"\b(suite|ste|room|rm|unit|bldg|building)\b\.?\s*[\w-]+|#\s*\w+", re.I)


def simplify_address(address, city, state, zip_code):
    # drop suite/room numbers etc. so Nominatim can find it
    parts = [p.strip() for p in html.unescape(address).split(",")]
    street = next((p for p in parts if re.match(r"^\d+\s", p)), parts[0])
    street = UNIT_RE.sub("", street).strip(" ,")
    return ", ".join(x for x in [street, city, state, zip_code] if x)


def first_campus_centroid(campus_str):
    for part in (campus_str or "").split(","):
        part = part.strip()
        if part in CAMPUS_CENTROIDS:
            return CAMPUS_CENTROIDS[part]
    # "California, Los Angeles" has a comma in it
    for name, xy in CAMPUS_CENTROIDS.items():
        if name in (campus_str or ""):
            return xy
    return None


def add_coordinates(df):
    cache = load_cache()
    lats, lons, sources = [], [], []
    for _, r in df.iterrows():
        latlon, source = None, None
        if r["venue_address"]:
            q = ", ".join(x for x in [r["venue_address"], r["venue_city"],
                                      r["venue_state"], r["venue_zip"]] if x)
            latlon = geocode(q, cache)
            if latlon is None:
                q2 = simplify_address(r["venue_address"], r["venue_city"],
                                      r["venue_state"], r["venue_zip"])
                if q2 != q:
                    latlon = geocode(q2, cache)
            source = "address" if latlon else None
        if latlon is None:
            latlon = first_campus_centroid(r["campus"])
            source = "campus" if latlon else None
        lats.append(latlon[0] if latlon else None)
        lons.append(latlon[1] if latlon else None)
        sources.append(source or "none")  # none = usually online events
    GEOCODE_CACHE.write_text(json.dumps(cache, indent=1))
    df["lat"], df["lon"], df["geo_source"] = lats, lons, sources
    df["is_online"] = df["campus"].str.contains("Online event", na=False)
    print(df["geo_source"].value_counts().to_string())
    return df


def to_geojson(df):
    features = []
    for rec in df.dropna(subset=["lat", "lon"]).to_dict("records"):
        lat, lon = rec.pop("lat"), rec.pop("lon")
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": rec,
        })
    return {"type": "FeatureCollection", "features": features}


# page files (html/css/js) live in web/, they get copied next to the data
WEB_DIR = Path(__file__).parent / "web"


def write_map(df, out_dir):
    # everything goes in the list; only events with a real address get a point
    cols = ["nid", "title", "alias", "start_date", "start", "date", "locations",
            "venue_address", "venue_city", "campus", "event_topics", "is_online",
            "geo_source", "lat", "lon"]
    recs = df[cols].astype(object).where(df[cols].notna(), None).to_dict("records")
    for r in recs:
        if r.pop("geo_source") != "address":
            r["lat"] = r["lon"] = None
    for f in WEB_DIR.iterdir():
        shutil.copy(f, out_dir)
    # data as a .js file (not .json) so it still works when opening the html from file://
    (out_dir / "events_data.js").write_text(f"const EVENTS = {json.dumps(recs)};\n", encoding="utf-8")


def main():
    OUT_DIR.mkdir(exist_ok=True)
    df = fetch_events()
    df = add_coordinates(df)

    df.to_csv(OUT_DIR / "asu_events.csv", index=False)
    geojson = to_geojson(df)
    (OUT_DIR / "asu_events.geojson").write_text(json.dumps(geojson, indent=1), encoding="utf-8")
    write_map(df, OUT_DIR)
    print(f"Wrote {len(geojson['features'])} features to {OUT_DIR}")


if __name__ == "__main__":
    main()
