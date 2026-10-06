# Changelog
### Yi-Wen Mo



## Where we are (as of 2026-10-05)

Goal: a "gap time" map. You pick where you are, where your next class is, and when it starts. The map shows the events and places you can walk to and still get to class on time.

### Progress

| Part | Status | Notes |
|---|---|---|
| Get events | Done | From the ASU Events feed (`asuevents.asu.edu/feed-json`). Right now: 500 event times (374 different events) |
| Geocode addresses | Done | Nominatim, with a cache so reruns are fast. 378 of 500 have a real location |
| CSV / GeoJSON output | Done | GeoJSON opens in QGIS/ArcGIS |
| Web map | Done | Event list + map, one marker per building, filters (category / date / free), search |
| End times | Partly | The feed has `end_date`, but the map doesn't use it yet. Needed to know if an event is still going when you get there |
| Address fixes | Partly | 6 addresses can't be found, e.g. ones that start with a building name + room number |
| Walking network | Not yet | The main piece. Most of the rows below need it |
| "Can I make it?" check | Not yet | Walk there + time spent there + walk to class has to fit before class starts |
| User input | Not yet | Where am I / next class / class time |
| Buildings | Not yet | Need a building layer so people can pick "my next class is in Coor Hall" |
| Places | Not yet | Coffee / food / study spots. Only events are on the map now |
| Walking routes | Not yet | Draw the route on the map |
| Other sources | Not yet | Sun Devil Central, Instagram |
| Auto update | On hold | Have to rerun the script for new events. GitHub Actions + Pages pushed to later |

### Next up

| # | Step | Tools / idea |
|---|---|---|
| 1 | Download the Tempe campus walking network | OSM + `osmnx` |
| 2 | Get campus buildings, match each event to a building | OSM or ASU GIS data |
| 3 | Work out walking times between buildings and events/places ahead of time | `networkx`, save as a data file the map can read (like `events_data.js`) |
| 4 | Add the "where am I / next class / what time" inputs, only show spots you can make it to | `web/map.js` |



## 2026-10-05

### Busy buildings looked like a spider web on the map
- Problem: every event was its own point. A building like Coor Hall has 5-10 events at the same coordinates, so clicking it spread them out into a "spider web".
- Fix: one marker per building with the number of events on it. Clicking it opens a list of the events there.

### Added categories and filters
- Used `event_topics` from the feed as categories (Arts and entertainment, Academic events, Sports, ...).
- "Free" and "Open to the public" are on almost every event, so they aren't categories. "Free" is its own filter.
- Added a date filter (all / today / next 7 days) and a search box.

### Redesigned the page
- Why: the first version was just a map with a small filter box and didn't look good.
- Event list on the left, map on the right (map on top on phones). Clicking an event in the list jumps to its building.

### Removed "campus center" points from the map
- Problem: 28 events had no address, only a campus name, so they were put in the middle of the campus. Those locations weren't real. For example, a Zoom workshop showed up in the middle of Polytechnic.
- Fix: these events and the online events are in the list but not on the map. The CSV/GeoJSON still keep the campus coordinates.

### Not done yet
- The data doesn't update on its own. You have to rerun `test_WebGIS.py` to get new events.
- Auto update (GitHub Actions + GitHub Pages) is pushed to later.
