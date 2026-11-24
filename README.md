# ASU Events WebGIS

ASU Gap Map: a student enters where they are, where their next class is and when it starts, and the page lists the ASU events they can walk to and still make class, with food and coffee on the way. Tempe campus only.

Gets events from the ASU events feed, geocodes the addresses, matches them to campus buildings, computes walking times between buildings, and shows it all on a Leaflet map. Everything heavy is done ahead of time by Python scripts and saved as static files, so the page needs no server logic.

## Walking network

Walking times in the Gap Map are based on the pedestrian network from OpenStreetMap (OSM). The routing work is done ahead of time in Python rather than in the browser, so the web page can look up precomputed walking times quickly.

The process is:

1. `pipeline/buildings.py` prepares the Tempe campus buildings and keeps the ASU building code as `building_id`.
2. `pipeline/entrances.py` selects where a walk should start or end for each building. Entrance information is taken from the available ASU/OSM building and entrance data, with fallback logic when a usable entrance is not available.
3. `pipeline/network.py` builds the OSM pedestrian network, connects each building entrance to the network, and calculates walking times between campus buildings.
4. The outputs are saved as `building_entrances.json`, `building_snaps.json`, `walk_network.geojson`, and `walk_matrix.json`.
5. `web/gap.html` uses the precomputed walking matrix to determine whether a student can visit an event and still reach the next class in time.

`building_snaps.json` records where each building connects to the walking network. The snap distance is useful for QA because a large distance can indicate that an entrance or nearby pedestrian connection needs to be checked. `web/qa_walk.html` provides a visual way to inspect routes, entrance locations, network connections and walking times.

The walking network was checked against a sample of routes in Google Maps, including short, medium and longer trips and buildings with multiple possible entrances. Differences were investigated by checking the selected entrance, its connection to the pedestrian network and the available OSM paths. Google Maps was used only as a comparison for validation; Google route coordinates and routing data are not stored in the project.

## Run

Set up the Python environment and install the required packages:

```
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

To refresh the ASU event data:

```
.venv/bin/python test_WebGIS.py
```

The main page uses `fetch`, so run it through a local HTTP server. From the repository root:

```
python3 -m http.server 8000
```

Then open:

```
http://localhost:8000/web/gap.html
```

If the building entrance or walking-network inputs change, rebuild the routing files in this order:

```
.venv/bin/python pipeline/entrances.py
.venv/bin/python pipeline/network.py
```

Run `entrances.py` first because `network.py` uses the building entrance locations when connecting buildings to the walking network.

The walking-network QA page is available at:

```
http://localhost:8000/web/qa_walk.html
```

On Windows, use the equivalent virtual-environment commands or `uv` if it is installed.

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
- `data/source/` - inputs that people make or keep by hand, read by the scripts and never by the page: `asu_accessible_entrances.json` and `asu_building_outlines.json` (ASU's entrance points and building outlines, saved by `pipeline/asu_entrances.py` and `asu_outlines.py`), `campus_dining.csv` (ASU dining venues and their building), `campus_dining_hours.txt` (weekly opening hours), `pois_osm.geojson` and `osm_amenities_raw.geojson` (Cade's OpenStreetMap extraction, not used on the page for now)
- `asu_events_output/` - the full event data from `test_WebGIS.py`:
  - `asu_events.csv` - all events with lat/lon and `geo_source` (`address` / `campus` / `none`)
  - `asu_events.geojson` - can open in QGIS or ArcGIS
  - `geocode_cache.json` - saved geocoding results so it doesn't look them up again
- `docs/` - project plan, architecture, data contract, team conventions, the review sheet for event-building matches (`14check.xlsx`) and Cade's first wireframe (`wireframe/`)
- `CHANGELOG.md` - what changed and why, newest at the bottom. Add an entry when you finish something

The first map shows one marker per building on the right, and a list (search + filters) on the left. Events with no real address (online, or only a campus name) are in the list but not on the map.

## Data sources

The project combines ASU and OpenStreetMap data to connect campus events, buildings, pedestrian routes and nearby amenities.

- **ASU Events:** Event information is collected by `test_WebGIS.py` and saved in `asu_events_output/` and `data/events_data.js`. The event-building matching pipeline connects event locations to campus buildings.
- **ASU Facilities:** Campus building information provides building names, locations and ASU building codes. The project keeps these codes as `building_id` values so buildings can be referenced consistently across the event and routing data.
- **ASU entrance and building-outline data:** ASU building outlines and entrance points are stored under data/source/ and are prepared by pipeline/asu_outlines.py and pipeline/asu_entrances.py. These data help connect campus buildings to the walking-network workflow.
- **OpenStreetMap:**  OpenStreetMap (OSM) provides the pedestrian network used for walking-route analysis. pipeline/network.py downloads walkable OSM ways through the Overpass API and uses them to build the routing graph. OpenStreetMap data are © OpenStreetMap contributors and are available under the Open Database License (ODbL).
- **Campus dining and amenities:** Dining locations and weekly opening hours are stored under data/source/. pipeline/match_pois.py processes the source data and creates data/pois.geojson, which is used to show food and coffee options along a student's route.

Google Maps was used during development only as an external reference for comparing a sample of walking routes and times. Google Maps coordinates and routing results are not stored as project data.

## Changing the page

Edit the files in `web/`. There is only one copy now, nothing gets copied or overwritten when the script runs.

## AI use

Generative AI tools were used during development to support tasks such as explaining code, troubleshooting errors, debugging, discussing implementation approaches, improving documentation, and assisting with Git and GitHub workflows.

AI-generated suggestions were reviewed and tested by team members before being incorporated into the project. The team made the final decisions about the project design, data processing, validation, and implementation.
