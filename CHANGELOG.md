# Changelog

Yi-Wen Mo

## Where we are (as of 10/25)

Goal: a "gap time" map. Pick where you are, where your next class is, and when it starts. The map shows events and places you can walk to and still make it to class.

| Area | Part | Status | Notes |
|---|---|---|---|
| Data | Get events | Done (refreshed 10/25) | ASU Events feed (`asuevents.asu.edu/feed-json`). 500 event times (385 different events), 10/25 to 11/19. The feed only has upcoming events, so rerun about once a week |
| Data | Geocode addresses | Done | Nominatim + cache. 395 of 500 have a location |
| Data | CSV / GeoJSON output | Done | GeoJSON opens in QGIS/ArcGIS |
| Data | End times, posters | Done (10/22) | `events_data.js` now has `end` and `image_url` for all 500 rows. Used by `web/gap.js` |
| Data | Address fixes | Partly | 6 addresses still can't be found |
| Data | Buildings | Done | 261 Tempe buildings in `data/buildings.geojson`, keyed by `building_id` (ASU code like `MU`, `COOR`) |
| Data | Events → building_id | Done | `data/event_buildings.csv`. 244 of 500 matched (the rest are online, on other campuses or off campus, or about 6 on the Tempe campus without a match), 10 rows need a manual check (4 `check`, 6 `far`; was 14 before the 11/9 fixes). Used by `web/gap.js`; the old events map (`web/map.js`) doesn't use it yet |
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

## 10/25

### Refreshed the event data (data)
- The 10/5 data had 364 of 500 events already over, and the rest ended 10/30. Reran `test_WebGIS.py` and `pipeline/match_events.py`.
- New data: 500 event times (385 different events), 10/25 to 11/19, all upcoming. `geo_source`: 376 address, 19 campus, 105 none. Buildings: 244 matched, 256 unmatched, 14 to review.
- Old events are overwritten, not kept. Earlier versions are in git history.
- To update by hand, from the repo root: `.venv/bin/python test_WebGIS.py`, then `.venv/bin/python pipeline/match_events.py`. Run them in this order.

### Gap page: drag A and B (front end)
- Problem: moving A / B was confusing. Clicking the map changed whichever box you focused last, and the pins could not be dragged.
- A and B pins can now be dragged. On release the pin snaps to the nearest building (within 120 m) and the list is recomputed. If no building is near, it goes back.
- Clicking the map now only fills a box that is still empty. After both are set, drag the pins. A hint on the map says so.
- Labels made clearer: "Next class starts (be there by)" and "Free from (earliest I can leave)". The gap message now shows the time range. "Free from" is the lower bound (events over before you arrive are dropped), "class starts" is the upper bound, so in a long gap changing A or B often does not change the list, only the walking times.
- Not done: a warning when the gap is very long, a default day that skips days with no events, a test on touch screens.

## 10/26

### Architecture doc (docs)
- First draft by Mahin (branch `mahin-network-analysis`, not merged). Rewritten by Yi-Wen to match the system as built: static files, no backend, `building_id` as the join key, how the gap check runs in the browser.
- Written together with the gap page work, which builds on Cade's wireframe (see 10/22).
- Mahin's `test_routes.py` (same branch) was not used.

## 11/8

### Arizona time zone fix (front end) — by Ziyi, reviewed by Yi-Wen
- Problem: the pages used the browser's time zone for "now" and "today". Someone outside Arizona got a wrong default "free from" time, a wrong default day, and a wrong "Today / next 7 days" filter.
- `web/gap.js`: new `getAsuTime()` (current date and minutes in `America/Phoenix`). The default day and the default "free from" time now use it.
- `web/gap.js`: new `eventMinutes()` for the event end time. The old `new Date(e.end) - new Date(day + 'T00:00')` used the browser's time zone. The feed times are Arizona wall-clock with no offset, so the new version does plain arithmetic on the numbers.
- `web/map.js`: new `asuToday()`. `dateOk()` now compares `YYYY-MM-DD` strings instead of `Date` objects.
- Checked by Yi-Wen: ran `eventMinutes()` on all 500 events with the machine set to Phoenix, Taipei and New York. Same result in all three, no `NaN`, and it matches the plain-number calculation. No other place in `web/` still uses the local clock. Logic is correct, so only comments and layout were changed (Ziyi's `//Ziyi change this` notes now explain why).
- Known limits: an offset in the feed times ("-07:00" or "Z") would be ignored. `getAsuTime()` (gap.js) and `asuToday()` (map.js) are two copies of the same idea because the pages don't share a script. Not tested on Safari older than 14 (`hourCycle`).

### Review sheet for the 14 flagged building matches (docs) — by Ziyi
- New `docs/14check.xlsx`: one row per flagged row in `data/event_buildings.csv` (8 `check`, 6 `far`), with the change needed. "CSV Row" is the line number in the file, header = line 1. Row numbers checked against the CSV, they match.
- Applied on 11/9, see below. Changes the sheet asks for:
  - Change `building_id`: row 195 `VDSK` → `VDSDM`, row 246 `ECA` → `STPV`, row 469 `CHUPA` → `SDFCT`, row 483 `ECA` → `STPV`.
  - Keep `building_id`, no change: rows 95, 233, 460 (`VDSK`) and 454 (`ADELM`).
  - Keep `building_id`, fix the geocoded coordinates only: rows 47, 202, 340, 448 (`FAC`) and 55, 257 (`ISTB4`). This only affects the old events map (`web/map.js`, uses lat/lon). The gap page uses `building_id`, so it is not affected.
- Still to do: the 6 coordinate fixes (they only affect the old events map).

## 11/9

### Fixed 4 building matches (data) — from Ziyi's review sheet
- `pipeline/match_events.py` rewrites `data/event_buildings.csv` from scratch on every run, and "CSV row" numbers move when the events are refreshed. So the fixes are **not** hand edits in the CSV. They are three new rules in `MANUAL` (keyed on the location text, so they survive a refresh):
  - `gold dome` → `VDSDM` (was `VDSK`)
  - `student pavillion` → `STPV` (was `ECA`; the feed misspells "Pavilion")
  - `sun devil fitness center` → `SDFCT` (was `CHUPA`)
- These 4 events were all `nearest` guesses (`check`) that picked the building next door. They are now `name` matches and no longer flagged.
- Checked before saving: a run with no changes reproduces the committed CSV exactly. With the new rules exactly 4 rows changed (lines 195, 246, 469, 483), and each keyword matches only the events it was meant for. Result: 163 name / 77 address / 4 nearest / 256 unmatched, 10 review rows (was 14).
- `dist_m` for these rows is now 118 to 207 m (distance from the geocoded point to the building). All under the 250 m `far` limit, so none are flagged.
- Still flagged: the 6 `far` rows (`FAC` ×4, `ISTB4` ×2). The building is right, the geocoded point is wrong, so they stay flagged until the coordinates are fixed. Only the old events map (`web/map.js`, uses lat/lon) is affected.
- Rows 95, 233, 460 (`VDSK`) and 454 (`ADELM`) are correct, but they stay `check` because the script cannot tell. Ziyi confirmed them by hand in `docs/14check.xlsx`.

## 11/11

### Search names for ASU Gammage and the Walton Center (data, front end) — by Mahin, reviewed by Yi-Wen
- Problem: in the 10-route check against Google Maps, "ASU Gammage" and the Robert and Walton Planetary Center looked missing. They were not. Both (`GGMA`, `WCPH`) were already in `data/buildings.geojson`, the entrance data and `walk_matrix.json`. They could not be found by the names people use. (The Walton Center footprint is also missing from the basemap. That is a basemap limit, not our data.)
- `pipeline/buildings.py`: new `NAME_OVERRIDES` (display names "ASU Gammage" and "Walton Center for Planetary Health") and `SEARCH_ALIASES` (e.g. "Grady Gammage", "Robert and Melani Walton Center for Planetary Health"). Only these two buildings are affected. The alias list is now de-duplicated, which also removed repeated aliases like `054A` for other buildings.
- `web/gap.js`: the search list now offers every alias of a building, not only its main name. Each one still resolves to the same `building_id`. The list grew from 261 to 766 options because building numbers and codes (e.g. "001 (GGMA)") are searchable too.
- `building_id`, coordinates, entrances and `walk_matrix.json` are unchanged.
- Checked by Yi-Wen: ran the gap page in headless Chrome on `main` and on the branch. "ASU Gammage", "Grady Gammage", the Walton Center names, `GGMA` and `WCPH` all pick the right building on the branch (the first two names and the long Walton name were not found on `main`). Walking times are the same in both (GGMA to Memorial Union 7 min, WCPH 15 min). No JavaScript errors. Typing "Gammage" also lists Dixie Gammage Hall and Gammage Pkwy Solar. They are other buildings, and that was already so before.
- Discovery Hall: our 17 min vs Google 19 min. Its entrance is made from the building outline (OSM has no `entrance=*` there), but the point matches an OSM node where a path meets the building and the network snap is 0 m. Left as is.
- Next (Mahin): a small manual entrance override for Coor Hall (and Memorial Union if needed), as a separate PR.

### Search list cleanup after the alias change (front end) — Yi-Wen
- Problem found when trying the page: the list showed "Walton Center For Planetary Health" and "Walton Center for Planetary Health" as two entries (same name, different capital letters), entries like "001 (GGMA)" or "MU (MU)", and every name ended with its code, e.g. "ASU Gammage (GGMA)". Codes mean nothing to a student. The 766 options in the entry above came from this.
- `web/gap.js`: the list now shows plain names only: the building's name and its other names ("ASU Gammage", "Grady Gammage"). The building code and the Facilities number are left out, and names that differ only in capital letters count as one. Typing a code such as `GGMA` still works (`buildingId()` is unchanged). If two different buildings ever share a name, the code is added after it so they stay apart. Today no two do. The list is 274 options (261 buildings, 13 extra names).
- Checked in headless Chrome: all names resolve to the right building, typed with or without capital letters ("ASU Gammage", "asu gammage", "Grady Gammage", "Walton Center for Planetary Health"), and `GGMA`, `WCPH`, `MU` still work. A name that is not in the list still shows the "Pick your location..." message. Walking times are the same (GGMA to Memorial Union 7 min, WCPH 15 min). No JavaScript errors.

## 11/12-11/14

### Places on the way: Cade's Explore Campus merged, then folded into the gap page — Yi-Wen
- Merged Cade's PR #5 (50 OpenStreetMap places and an Explore Campus tab). A separate tab does not fit what a student asks: which events can I make, and is there food or coffee on the way? The tab and `web/explore.js` are gone, the places now show inside Plan Your Gap.
- `web/gap.js`: each event you can make gets one quiet line, "On the way: Memorial Union, Armstrong Hall +2". Select the event and it opens into a short list, "Before the event" and "After the event", building by building with the names of the places and the detour when there is one. A building is one stop: it counts when going through it adds at most 2 min of walking and fits in the time to spare. Walking is building to building, so times are approximate. The map gets one marker per building, numbered when it holds several places. Chips switch Coffee / Food / Study. Places inside the event's own building are left out.
- Data: `data/source/pois_osm.geojson` is Cade's OSM extraction as he made it (his raw file moved to `data/source/osm_amenities_raw.geojson`). `data/source/` holds the inputs that people make or keep by hand; `data/` holds what the page reads. `pipeline/match_pois.py` builds `data/pois.geojson` from it plus the ASU dining list (do not edit `pois.geojson` by hand). Nothing from OSM is used for now (`OSM_KEEP` in the script): the off-campus coffee and food places have no opening hours and their building is a guess, while ASU dining has both, and the libraries are left out until they have official opening hours. So the page shows ASU dining on the Tempe campus only, 37 places. Cade's OSM places stay in `data/source/` and come back by adding "coffee", "food" or "study" to `OSM_KEEP`. The Study chip hides itself while there are no study places.
- ASU dining: `data/source/campus_dining.csv` (venue and building, from the Sun Devil Hospitality map) and `data/source/campus_dining_hours.txt` (weekly hours, checked by hand on the site), read by `pipeline/campus_dining.py`. 37 venues are on the page, 33 with hours. 18 still need a building, the script lists them. Venezia's Pizza has no building on purpose: the map says College Avenue Commons, which is not in our building list. Pokezona (closed all week) is not in the data. The Panini Cafés are coffee. The page leaves out a place that is known to be closed when you would get there (closing after midnight is handled).
- Look: ASU logo next to the title (`web/asu-logo.png`), title "Gap Map", ASU maroon and gold (colors at the top of `gap.css`).
- Not done: the libraries (official hours are in the ASU Library fall 2026 announcement: Hayden Mon-Thu 7-24, Fri 7-22, Sat 9-22, Sun 10-24), opening hours for 4 dining venues that are not in the hours table, the 18 venues without a building.
- A place is listed under its building, so its name does not repeat the building ("Hayden Library Concourse" in Hayden Library shows as "Concourse", a place with the same name as its building shows as "Study space" or "Coffee"). Matters for the libraries once they are back.
- Checked in headless Chrome: the plan result is unchanged, places show on the cards, chips and map markers work, Starbucks in the Memorial Union is listed at 8:00 but not at 6:00 or 22:00, no JavaScript errors.
- Housekeeping: `Wireframe/` moved to `docs/wireframe/` (nothing read it). README, `docs/architecture.md` and `docs/PROJECT_PLAN.md` brought up to date: the places data and `data/source/`, how "on the way" is computed, what `web/qa_walk.html` is, and a status table in the project plan.

### Map / Satellite switch and Google Maps link (front end) — Yi-Wen
- A switch in the map corner shows the street map or the Esri satellite image (it shows buildings the street map lacks, like the Walton Center).
- The selected event has a "Walking directions in Google Maps" link (plain link, no key, nothing stored).

### Entrances from ASU's own data (data) — Yi-Wen
- Merged PR #6 (manual entrances for Coor Hall and Memorial Union).
- ASU Facilities' public map service has an entrance layer (216 points, surveyed 2020) and a building outline layer. `pipeline/asu_entrances.py` and `pipeline/asu_outlines.py` save them to `data/source/`. Matched by building number, so no guessing. 71 entrance points have no number and are not used.
- `pipeline/entrances.py` tries: manual, OSM door, ASU entrance point, closest point of the outline (ASU's, else OSM's), centroid. Result: manual 2, OSM door 18, ASU point 72, ASU outline 131, OSM outline 27, centroid 11 (was 223 outline guesses and 18 centroids).
- Fixes: the Walton Center had no OSM outline and got the footbridge's, so its entrance was on the bridge and routes went over it. Buildings that shared one entrance point: 35 groups to 6. Mountain America Stadium was at the centroid, 82 m from a path.
- Effect: many pairs change, mostly for large buildings (stadiums, parking structures). 10 routes checked against Google: mean error 1.26 to 1.18 min (1.03 with the ASU points alone). The Walton Center is now 13.8 min from Coor Hall (Google 16): its entrance is the outline point closest to a path, not the real door, which is on University Dr. Needs a hand-checked entrance.
- `web/qa_walk.html` colors each entrance by its source (it showed `manual` and `asu` as red "none found").

## 11/23

### Where the data comes from, written down (docs)
- New `docs/data_sources.md`: one table with the source, use, script and fetch date of every dataset, and what we know about its terms.
- Checked against the code. The 261 buildings, the 216 entrance points and the 245 building outlines all come from ASU Facilities' public ArcGIS map service (`gis.m.asu.edu`), not from OpenStreetMap. OpenStreetMap is used for the walking network, 18 entrance doors and 27 outlines.

### Refreshed the event data (data)
- The 10/25 data ended on 11/19, so the page showed 0 events for today. Reran `test_WebGIS.py` and `pipeline/match_events.py`.
- New download: 500 event times (259 different events), 11/23 to 2027-02-21.
- Then merged with the 10/25 download (from git, 11/1 to 11/19 and the rest of that set), so past dates in the data still work. A one-off merge by `nid` + `start`, the new row wins on a duplicate. Result: 1000 event times (620 different events), 10/25 to 2027-02-21. 11/20 to 11/22 have no events (the feed only lists upcoming events, nobody downloaded those days). `geo_source`: 766 address, 39 campus, 195 none. Buildings: 504 matched (385 name, 105 address, 14 nearest), 496 unmatched, 24 to review. The 4 `MANUAL` rules from 11/9 still apply.
- A rerun of `test_WebGIS.py` overwrites the files with only the upcoming events, so the old rows are lost again (git keeps them). If we want to keep merging, `main()` needs a merge step.
- Checked in headless Chrome: default day is today (11/23) with 4 events that fit MU to COOR 10:00 to 15:00, 11/30 has 3, 12/3 has 6, no JavaScript errors.
- Old events are overwritten, earlier versions are in git history. The numbers in earlier entries (500 / 385 / 244 / 256) are from the 10/25 data.
