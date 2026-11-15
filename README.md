# ASU Events WebGIS

ASU Gap Map: a student enters where they are, where their next class is and when it starts, and the page lists the ASU events they can walk to and still make class, with food and coffee on the way. Tempe campus only.

Gets events from the ASU events feed, geocodes the addresses, matches them to campus buildings, computes walking times between buildings, and shows it all on a Leaflet map. Everything heavy is done ahead of time by Python scripts and saved as static files, so the page needs no server logic.

## Run

```
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python test_WebGIS.py
```

## Where things are

- `web/gap.html` (+ `gap.js`, `gap.css`, `route.js`, `asu-logo.png`) - **the main page**: enter where you are, your next class, and the time, and it lists the events you can walk to and still make class. Under each event it names the buildings with food or coffee on the way (select the event to see the places and a link to walking directions in Google Maps). A switch in the map corner shows the street map or the satellite image. Needs a local server because it uses `fetch`: run `python3 -m http.server` in this folder, then open `http://localhost:8000/web/gap.html`
- `web/asu_events_map.html` (+ `style.css`, `map.js`) - the first map: all events on a map with a list and filters. Open it in a browser. It reads `../data/events_data.js`, so keep the `web/` and `data/` folders next to each other.
- `web/qa_walk.html` - a check page for the walking network: click two buildings to see the walking time, the straight-line distance and where each walk starts (entrance and path), and which buildings sit far from a path. Needs the local server too. For developers, not linked from the main page.
- `data/events_data.js` - the event data the map reads. Made by `test_WebGIS.py`
- `data/buildings.geojson` - Tempe campus buildings with `building_id`. Made by `pipeline/buildings.py`
- `data/event_buildings.csv` - which building each event is in. Made by `pipeline/match_events.py`
- `data/walk_matrix.json` - walking time in seconds between every pair of buildings. Made by `pipeline/network.py` (also makes `building_snaps.json` and `walk_network.geojson`). If the OSM download fails with an SSL error (macOS system Python 3.9), use a newer Python for the venv, see the CHANGELOG
- `data/building_entrances.json` - where a walk starts at each building. Made by `pipeline/entrances.py`, run it before `network.py`
- `data/pois.geojson` - the coffee and food places the gap page shows on the way, with their building and weekly opening hours. Made by `pipeline/match_pois.py`, **do not edit it by hand**. Run `python3 pipeline/match_pois.py` after changing a file in `data/source/`
- `data/source/` - inputs that people make or keep by hand, read by the scripts and never by the page: `asu_accessible_entrances.json` (ASU's entrance points, saved by `pipeline/asu_entrances.py`), `campus_dining.csv` (ASU dining venues and their building), `campus_dining_hours.txt` (weekly opening hours), `pois_osm.geojson` and `osm_amenities_raw.geojson` (Cade's OpenStreetMap extraction, not used on the page for now)
- `asu_events_output/` - the full event data from `test_WebGIS.py`:
  - `asu_events.csv` - all events with lat/lon and `geo_source` (`address` / `campus` / `none`)
  - `asu_events.geojson` - can open in QGIS or ArcGIS
  - `geocode_cache.json` - saved geocoding results so it doesn't look them up again
- `docs/` - project plan, architecture, data contract, team conventions, the review sheet for event-building matches (`14check.xlsx`) and Cade's first wireframe (`wireframe/`)
- `CHANGELOG.md` - what changed and why, newest at the bottom. Add an entry when you finish something

The first map shows one marker per building on the right, and a list (search + filters) on the left. Events with no real address (online, or only a campus name) are in the list but not on the map.

## Changing the page

Edit the files in `web/`. There is only one copy now, nothing gets copied or overwritten when the script runs.
