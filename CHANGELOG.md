# Changelog

Yi-Wen Mo

## Where we are (as of 10/22)

Goal: a "gap time" map. Pick where you are, where your next class is, and when it starts. The map shows events and places you can walk to and still make it to class.

| Area | Part | Status | Notes |
|---|---|---|---|
| Data | Get events | Done | ASU Events feed (`asuevents.asu.edu/feed-json`). 500 event times (374 different events) |
| Data | Geocode addresses | Done | Nominatim + cache. 378 of 500 have a location |
| Data | CSV / GeoJSON output | Done | GeoJSON opens in QGIS/ArcGIS |
| Data | End times, posters | Done (10/22) | `events_data.js` now has `end` and `image_url` for all 500 rows. Used by `web/gap.js` |
| Data | Address fixes | Partly | 6 addresses still can't be found |
| Data | Buildings | Done | 261 Tempe buildings in `data/buildings.geojson`, keyed by `building_id` (ASU code like `MU`, `COOR`) |
| Data | Events → building_id | Done | `data/event_buildings.csv`. 240 of 241 Tempe events matched, 13 rows need a manual check. Used by `web/gap.js`; the old events map (`web/map.js`) doesn't use it yet |
| Data | Places | Not yet | Coffee, food, study spots |
| Data | Other sources | Not yet | Sun Devil Central, Instagram |
| Data | Auto update | On hold | Rerun the script by hand for now |
| Walking network | Building-to-building times | Done (10/18) | OSM walkways → `data/walk_matrix.json`, 261 × 261 buildings, all pairs reachable |
| Walking network | Route geometry | Done (10/22) | `web/route.js` runs shortest path on `walk_network.geojson` in the browser. Matches `walk_matrix.json` within about 0.1 min |
| Front end | Events map | Done | `web/asu_events_map.html`: list + map, one marker per building, filters (category / date / free), search |
| Front end | User input | Done (first version) | `web/gap.html`: where I am / next class building / date / free from / class time. Single class only, no saved schedule yet |
| Front end | "Can I make it?" check | Done | `web/gap.js`: walk there + time at the event + walk to class + buffer must fit before class. Uses real event end times, so events already in progress count |
| Front end | Walking routes | Done (10/22) | Picking an event draws A → event → B on the walkways |

### Next up
1. Places (coffee, food, study spots) with a `building_id` each
2. Saved schedule with several courses, and "next class" from the current time
4. Check the flagged rows in `event_buildings.csv`

## Log (oldest first)

## 10/5

### Spider web on busy buildings (front end)
- Every event was its own point, so Coor Hall with 5-10 events spread out into a spider web.
- Now one marker per building with an event count. Click to see the list.

### Categories and filters (front end)
- Categories come from `event_topics`. "Free" and "Open to the public" are on almost everything, so "Free" is a separate filter.
- Added date filter (all / today / next 7 days) and search.

### Redesigned the page (front end)
- First version looked bad. Now list on the left, map on the right (map on top on phones). Clicking an event jumps to its building.

### Removed "campus center" points (data)
- 28 events only had a campus name, so they got put in the middle of campus (a Zoom workshop showed up in the middle of Polytechnic).
- These and online events stay in the list but not on the map. CSV/GeoJSON keep the coordinates.

## 10/10-10/12

### Added a Tempe building layer (data)
- Source: ASU Facilities ArcGIS layer (building centroids), `gis.m.asu.edu/server/rest/services/FDM/UniversityFacilities/MapServer/1`. I didn't find a license, so ask ASU before sharing outside class.
- `pipeline/buildings.py` → `data/buildings.geojson`. `building_id` = `BLDG_CODE`, since that's what students see on their schedule. Tempe = `BLDG_CAMPUS_CODE = 'MC'`.
- Issues in the data:
  - `BLDG_CODE` isn't unique (wings share a code, e.g. `IRISH`). Merged same-code records into one building and kept all names in `aliases`.
  - Dropped parking solar structures.
  - Skipped 2 records with no location (`184`, `FSYARD`).
  - Used the centroid layer (1206) instead of the roofline polygons (1029), which has fewer buildings.
- Checked: 261 unique IDs, all inside Tempe campus. `MU` and `COOR` match the ASU list.

### Matched events to a `building_id` (data)
- `pipeline/match_events.py` → `data/event_buildings.csv`. Doesn't touch `test_WebGIS.py` or the old outputs.
- Order: **name** in the location text → **address** (one building only, point within 100 m) → **nearest** (within 60 m, always flagged `check`).
- Result on 500 rows: 171 name, 66 address, 6 nearest, 257 unmatched. The unmatched are online, no address, or other campuses/off-campus. That's on purpose.

| Problem | Fix |
|---|---|
| Nearest building alone gave wrong answers ("FAC 133" → power plant) | Name first, distance last |
| "Changing Hands Bookstore" matched ASU `Bookstore` | `EXCLUDE_ALIASES` for generic names |
| Street "Tyler St" matched building code `TYLER` | A code only counts with a room number (`FAC 133`) |
| Address pointed to the wrong building (400 E Tyler Mall) | Drop address match if point is > 100 m away |
| Adelphi Commons wings share one address | Skip addresses used by more than one building |
| Events use other names for buildings | Small hand-made `MANUAL` table |
| Building name was in `venue_address` | Search `locations` and `venue_address` together |
| Short codes like `MU` hit random words | Ignore names under 5 characters |

### Known issues (not fixed)
- **Bad geocoding**: Nominatim sometimes drops the point on a street. 7 `far` rows (`FAC 133`, `Marston Theater`, `Sun Devil Fitness Complex`): the building is right, the point is wrong. Once the map uses `building_id`, place events at the building point.
- **6 `check` rows** are probably wrong: Adelphi Commons A/B, Barrett Student Center, Centerpoint, Cereus Hall.
- **Omni Hotel** is the only Tempe event with no building. Left out on purpose, could be a place later.
- Step Gallery / Northlight Gallery are Downtown Phoenix, so out of scope.
- Only buildings, no rooms.

### Decision: Tempe campus only
- Other campuses, online events and off-campus places stay out of the map (still in the CSV).
- Not done yet: `test_WebGIS.py` and the old events map still show all campuses. The gap page (10/22) already only uses events with a `building_id`.

### Stopped copying `web/` into `asu_events_output/`
- The script copied the page into the output folder every run, so everything existed twice and edits to the copy got overwritten.
- Now the page lives only in `web/` and loads `../data/events_data.js`. The script writes `events_data.js` to `data/`. Removed the old copies.
- Checked in headless Chrome: list and markers load (374 events, 282 on map).
- Not checked: `test_WebGIS.py` rerun (needs pandas, not installed here), only syntax-checked.

### Docs
- Added `docs/PROJECT_PLAN.md` and `docs/data_contract.md` (`building_id` is the join key).

## 10/18

### Built the walking network and the building-to-building matrix (walking network)
- Source: OpenStreetMap walkways from the Overpass API, around the buildings plus about 300 m. `pipeline/network.py` → `data/walk_matrix.json`, `data/building_snaps.json`, `data/walk_network.geojson`. The download is cached in `pipeline/cache/` (not in git); `--refresh` downloads again.
- Didn't use `osmnx`/`geopandas`. The script reads Overpass directly and uses `scipy` for shortest paths, so only `numpy` and `scipy` were added to `requirements.txt`.
- How it works: build a graph from the ways, keep the largest connected piece (dropped 445 small disconnected nodes), snap each building onto the nearest path segment (the segment is split there), then Dijkstra from every building. Speed is 1.34 m/s.
- Buildings only have centroids, so the walk from the centroid to the path is added to the time. Median snap distance is 21 m, 99% are under 95 m.
- Checked: detour ratio (walking distance / straight line) has median 1.37 and 95th percentile 1.80, the matrix is symmetric, and there are no unreachable pairs. Examples: MU → LIB 2.5 min, MU → HAYDN 5.8 min.
- Problems:
  - macOS system Python 3.9 (LibreSSL) can't do the TLS handshake with `overpass-api.de` (`SSLV3_ALERT_HANDSHAKE_FAILURE`), even though `curl` works. Fixed by using a venv built from Homebrew Python 3.11. Two backup Overpass mirrors were returning HTTP 500.
  - Some short pairs have a very high detour ratio (up to 9). These involve utility or field buildings (`X88`, `L35`) and the stadium (`STADIP`, `STADS`), not classroom buildings. Left as is for now.
  - `X88` (165 m) and `L35` (106 m) are far from any path, so their times include a long straight-line leg.
- Not done: stairs/elevation and crossing wait times, route geometry for drawing a path, times from an arbitrary user location.

### Building entrances (walking network)
- `pipeline/entrances.py` → `data/building_entrances.json`. Matches OSM building outlines to `building_id` (outline that contains the centroid, else the nearest within 60 m), then picks the start point: a real OSM door (`entrance=main`, then `yes`), else the point on the outline closest to a path, else the centroid. `network.py` now snaps from this point. Run `entrances.py` before `network.py`.
- Result for 261 buildings: 4 `osm_main`, 16 `osm_entrance`, 223 `outline`, 18 `centroid`. OSM only has 55 usable entrance nodes on campus, so most buildings use the outline estimate.
- Effect: median distance from the start point to a path went from 21 m to 2 m. Walking times changed by -0.5 min on average (5th to 95th percentile: -2.3 to +1.2 min). Example: MU → LIB 2.5 → 1.6 min, COOR → MU 5.5 → 6.3 min.
- Known limits:
  - The `outline` point is the edge closest to a path, not a real door, so it tends to make times a bit shorter than reality.
  - 18 buildings have no matched outline and still use the centroid: `183`, `HHW`, `IRISH`, `L04`, `L05`, `L28`, `L34`, `L35`, `L36`, `L37`, `MAS`, `MB`, `PSHED`, `SDBVF`, `SDFCTF`, `STADS`, `STADTN`, `X88`. Most are fields and utility buildings. `IRISH`, `MB`, `MAS`, `HHW`, `183` are probably merged multi-wing buildings whose averaged centroid falls outside any outline.
  - One outline per building. A building made of several wings only uses the one that matched.
  - Overpass was busy (HTTP 502) on the first try, so the download now retries each mirror, three rounds.

## 10/22

### Front end: ASU Gap Map page (front end)
Merged Cade's wireframe (layout, ASU colors, "plan your gap" idea) into a working page on real data: `web/gap.html`, `gap.js`, `gap.css`, `route.js`. The old `asu_events_map.html` is unchanged. The wireframe prototype stays in `Wireframe/` for reference.

- Replaced the hard-coded 5 buildings and the "minutes available" slider with the real 261 buildings. The gap is computed.
- Form simplified after a first version felt too complicated: only "I'm at", "My next class is in" and "Next class starts" are shown. Day, "I'm free at" (defaults to now), time at the event and spare time are under "More options". You can also click the map to fill the box you used last.
- Event feasibility uses `walk_matrix.json` and `event_buildings.csv`. Check with MU → COOR, free 11:00, class 14:30 on 10/22: 5 of 14 mapped events fit (3 before end times were used, 2 more are events already in progress).
- Data: `test_WebGIS.py` now also writes `end` and `image_url` into `events_data.js`. I rebuilt `events_data.js` from the existing CSV instead of rerunning the script (no new geocoding), same 500 rows in the same order. The script itself was not rerun, only changed.
- Event posters: small thumbnail on each card, the whole poster when the card is picked. The images are loaded from ASU's server (hotlinked), some originals are several MB, so they are lazy loaded.
- Routes: `route.js` builds a graph from `walk_network.geojson` in the browser and runs Dijkstra. The two parts are drawn in different colors (to the event / to class). Falls back to a straight dashed line if loading fails.
- The page uses `fetch`, which does not work from `file://`. Run `python3 -m http.server` in the repo root and open `http://localhost:8000/web/gap.html`.
- Problems: ASU's image server (Cloudflare) returns 403 to headless Chrome, so screenshots only show posters when the user agent is changed. Normal browsers are fine.
- Not done: coffee / food / study places (no data yet), saved multi-course schedule.
