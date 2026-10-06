# ASU Events WebGIS

Gets events from the ASU events feed, geocodes the addresses, and makes a CSV, GeoJSON, and a Leaflet map.

## Run

```
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python test_WebGIS.py
```

## Output (asu_events_output/)

- `asu_events.csv` - all events with lat/lon and `geo_source` (`address` / `campus` / `none`)
- `asu_events.geojson` - can open in QGIS or ArcGIS
- `asu_events_map.html` - the map, just open it in a browser. Event list on the left (search + filters), one marker per building on the right. Events with no real address (online, or only a campus name) are in the list but not on the map
- `style.css`, `map.js` - copied from `web/` every run
- `events_data.js` - the event data the map reads
- `geocode_cache.json` - saved geocoding results so it doesn't look them up again

## Changing the page

Edit the files in `web/` (`asu_events_map.html`, `style.css`, `map.js`), not the ones in `asu_events_output/` - those get overwritten when the script runs.
