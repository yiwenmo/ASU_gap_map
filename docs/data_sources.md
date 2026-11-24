# Data sources

Where each dataset comes from, what it is used for, and what we know about its terms. Checked against the code on 2026-11-23.

| Data | Source | Used for | Made by | Fetched |
|---|---|---|---|---|
| Events | ASU events feed, `https://asuevents.asu.edu/feed-json` | Title, time, place, poster | `test_WebGIS.py` | Two downloads merged: 10/25 (events to 11/19) and 11/23 (events from 11/23 to 2027-02-21). 11/20 to 11/22 are missing. The feed only lists upcoming events |
| Geocoding | Nominatim, `https://nominatim.openstreetmap.org/search` | Event address to a point | `test_WebGIS.py` | Cached in `asu_events_output/geocode_cache.json` |
| Buildings (261) | ASU Facilities, University Facilities layer, `https://gis.m.asu.edu/server/rest/services/FDM/UniversityFacilities/MapServer/1` | Building codes (`building_id`), names, centroids | `pipeline/buildings.py` | First fetched 10/10 |
| Entrance points (216) | ASU Facilities, Campus Accessibility layer, `https://gis.m.asu.edu/server/rest/services/Campus/CampusAccessibility/MapServer/0` | Where a walk starts at a building (surveyed 2020) | `pipeline/asu_entrances.py` | 2026-11-14 |
| Building outlines (245) | ASU Facilities, Campus Building layer, `https://gis.m.asu.edu/server/rest/services/Campus/CampusBuilding/MapServer/0` | Entrance fallback: closest outline point to a path | `pipeline/asu_outlines.py` | 2026-11-14 |
| Walking network | OpenStreetMap, Overpass API (`overpass-api.de`) | Graph for walking times and routes; some entrances (18 doors) and outlines (27) | `pipeline/network.py`, `pipeline/entrances.py` | Cached in `pipeline/cache/`, date not recorded |
| Dining places and hours | ASU Dining (Sun Devil Hospitality), `https://sundevilhospitality.asu.edu/hours-locations/tempe` | Food and coffee on the way | By hand: `data/source/campus_dining.csv`, `campus_dining_hours.txt` | Hours checked by hand in November 2026 |
| Base map tiles | Esri (street map and World Imagery) | Map and satellite views | Loaded by the browser | At page load |

## Terms

- **OpenStreetMap data** is © OpenStreetMap contributors, under the Open Database License (ODbL). Keep the credit on the page.
- **ASU Facilities layers** (buildings, entrances, outlines) come from a public ArcGIS map service of ASU. We found no license or terms of use for it (see CHANGELOG, 10/12). We use it for this course, we name the source, and we do not claim it is official. If the project is shared or kept beyond the course, ask ASU Facilities first.
- **ASU events feed and dining information** are public ASU web content. Same approach: name the source, no claim of being official. The dining hours change with the term.
- **Esri tiles** are used under Esri's terms for the service. The page keeps the attribution that Leaflet shows.
- This is a student project, not an official ASU product.
