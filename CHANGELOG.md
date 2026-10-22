# Changelog
### Yi-Wen Mo

## Where we are (as of 10/12)

Goal: a "gap time" map. Pick where you are, where your next class is, and when it starts. The map shows events and places you can walk to and still make it to class.

| Part | Status | Notes |
|---|---|---|
| Get events | Done | ASU Events feed (`asuevents.asu.edu/feed-json`). 500 event times (374 different events) |
| Geocode addresses | Done | Nominatim + cache. 378 of 500 have a location |
| CSV / GeoJSON output | Done | GeoJSON opens in QGIS/ArcGIS |
| Web map | Done | List + map, one marker per building, filters (category / date / free), search |
| End times | Partly | Feed has `end_date`, map doesn't use it yet |
| Address fixes | Partly | 6 addresses still can't be found |
| Buildings | Done | 261 Tempe buildings in `data/buildings.geojson`, keyed by `building_id` (ASU code like `MU`, `COOR`) |
| Events → building_id | Done, not in map yet | `data/event_buildings.csv`. 240 of 241 Tempe events matched, 13 rows need a manual check |
| Walking network | Done (10/18) | OSM walkways → `data/walk_matrix.json`, 261 × 261 buildings, all pairs reachable |
| "Can I make it?" check | Not yet | Walk there + time at event + walk to class must fit before class |
| User input | Not yet | Where I am / next class / class time |
| Places | Not yet | Coffee, food, study spots |
| Walking routes | Not yet | Draw the route |
| Other sources | Not yet | Sun Devil Central, Instagram |
| Auto update | On hold | Rerun the script by hand for now |

### Next up
1. ~~Download the Tempe walking network~~ and ~~precompute walking times~~: done 10/18, see below
2. Put `building_id` into `events_data.js` and the map, check the flagged rows
3. Add the input boxes and only show spots you can make it to (`web/map.js`), using `data/walk_matrix.json`

## 10/18

### Built the walking network and the building-to-building matrix
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

### Building entrances
- `pipeline/entrances.py` → `data/building_entrances.json`. Matches OSM building outlines to `building_id` (outline that contains the centroid, else the nearest within 60 m), then picks the start point: a real OSM door (`entrance=main`, then `yes`), else the point on the outline closest to a path, else the centroid. `network.py` now snaps from this point. Run `entrances.py` before `network.py`.
- Result for 261 buildings: 4 `osm_main`, 16 `osm_entrance`, 223 `outline`, 18 `centroid`. OSM only has 55 usable entrance nodes on campus, so most buildings use the outline estimate.
- Effect: median distance from the start point to a path went from 21 m to 2 m. Walking times changed by -0.5 min on average (5th to 95th percentile: -2.3 to +1.2 min). Example: MU → LIB 2.5 → 1.6 min, COOR → MU 5.5 → 6.3 min.
- Known limits:
  - The `outline` point is the edge closest to a path, not a real door, so it tends to make times a bit shorter than reality.
  - 18 buildings have no matched outline and still use the centroid: `183`, `HHW`, `IRISH`, `L04`, `L05`, `L28`, `L34`, `L35`, `L36`, `L37`, `MAS`, `MB`, `PSHED`, `SDBVF`, `SDFCTF`, `STADS`, `STADTN`, `X88`. Most are fields and utility buildings. `IRISH`, `MB`, `MAS`, `HHW`, `183` are probably merged multi-wing buildings whose averaged centroid falls outside any outline.
  - One outline per building. A building made of several wings only uses the one that matched.
  - Overpass was busy (HTTP 502) on the first try, so the download now retries each mirror, three rounds.

## 10/10-10/12

### Added a Tempe building layer
- Source: ASU Facilities ArcGIS layer (building centroids), `gis.m.asu.edu/server/rest/services/FDM/UniversityFacilities/MapServer/1`. I didn't find a license, so ask ASU before sharing outside class.
- `pipeline/buildings.py` → `data/buildings.geojson`. `building_id` = `BLDG_CODE`, since that's what students see on their schedule. Tempe = `BLDG_CAMPUS_CODE = 'MC'`.
- Issues in the data:
  - `BLDG_CODE` isn't unique (wings share a code, e.g. `IRISH`). Merged same-code records into one building and kept all names in `aliases`.
  - Dropped parking solar structures.
  - Skipped 2 records with no location (`184`, `FSYARD`).
  - Used the centroid layer (1206) instead of the roofline polygons (1029), which has fewer buildings.
- Checked: 261 unique IDs, all inside Tempe campus. `MU` and `COOR` match the ASU list.

### Matched events to a `building_id`
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
- Not done yet: `test_WebGIS.py` and the map still show all campuses. Next: filter by non-empty `building_id`.

### Stopped copying `web/` into `asu_events_output/`
- The script copied the page into the output folder every run, so everything existed twice and edits to the copy got overwritten.
- Now the page lives only in `web/` and loads `../data/events_data.js`. The script writes `events_data.js` to `data/`. Removed the old copies.
- Checked in headless Chrome: list and markers load (374 events, 282 on map).
- Not checked: `test_WebGIS.py` rerun (needs pandas, not installed here), only syntax-checked.

### Docs
- Added `docs/PROJECT_PLAN.md` and `docs/data_contract.md` (`building_id` is the join key).

## 10/5

### Spider web on busy buildings
- Every event was its own point, so Coor Hall with 5-10 events spread out into a spider web.
- Now one marker per building with an event count. Click to see the list.

### Categories and filters
- Categories come from `event_topics`. "Free" and "Open to the public" are on almost everything, so "Free" is a separate filter.
- Added date filter (all / today / next 7 days) and search.

### Redesigned the page
- First version looked bad. Now list on the left, map on the right (map on top on phones). Clicking an event jumps to its building.

### Removed "campus center" points
- 28 events only had a campus name, so they got put in the middle of campus (a Zoom workshop showed up in the middle of Polytechnic).
- These and online events stay in the list but not on the map. CSV/GeoJSON keep the coordinates.
