# ASU Events WebGIS

Gets events from the ASU events feed, geocodes the addresses, and makes a CSV, GeoJSON, and a Leaflet map.

## Run

```
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python test_WebGIS.py
```

## Where things are

- `web/` - the map page (`asu_events_map.html`, `style.css`, `map.js`). Open `web/asu_events_map.html` in a browser. It reads `../data/events_data.js`, so keep the `web/` and `data/` folders next to each other.
- `data/events_data.js` - the event data the map reads. Made by `test_WebGIS.py`
- `data/buildings.geojson` - Tempe campus buildings with `building_id`. Made by `pipeline/buildings.py`
- `data/event_buildings.csv` - which building each event is in. Made by `pipeline/match_events.py`
- `asu_events_output/` - the full event data from `test_WebGIS.py`:
  - `asu_events.csv` - all events with lat/lon and `geo_source` (`address` / `campus` / `none`)
  - `asu_events.geojson` - can open in QGIS or ArcGIS
  - `geocode_cache.json` - saved geocoding results so it doesn't look them up again
- `docs/` - project plan, data contract, team conventions

The map shows one marker per building on the right, and a list (search + filters) on the left. Events with no real address (online, or only a campus name) are in the list but not on the map.

## Changing the page

Edit the files in `web/`. There is only one copy now, nothing gets copied or overwritten when the script runs.
