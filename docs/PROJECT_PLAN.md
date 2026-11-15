# ASU Gap Time Map: Project Plan (draft for discussion)

Team: Yi-Wen, Mahin, Cade, Ziyi

## Goal

A student enters where they are, where their next class is, and when it starts.
The map shows the events and places (coffee, food, study spots) they can walk to
and still reach class on time, with walking routes. Users can filter by type and
time, and plan ahead by picking a future day.

**Scope: Tempe campus only.** Events and places at other campuses, online events, and off-campus venues are not on the map.

This is a rough plan. Everything here is open to change.

## Status (2026-11-14)

| | State |
|---|---|
| A1 Events | Done. `test_WebGIS.py`, rerun about once a week |
| A2 Buildings | Done. 261 Tempe buildings, entrances estimated from the outline; manual entrances for a few big buildings (Coor Hall, Memorial Union) are in review |
| A3 Places | Partly. ASU dining on campus, 37 places, 33 with weekly hours. 18 venues still need a building. OSM places and libraries are left out for now |
| A4 Event to building | Done. A few matches are flagged for a manual check |
| B Walking network | Done. 261 x 261 matrix, routes drawn on the walkways |
| C Feasibility and filtering | Done. Round-trip check, filters by type and free events, a day picker, and food or coffee on the way |
| D User schedule | Not done. One next class only, no saved schedule |
| E Front end | Done for the gap page. Mobile checked at phone width in a desktop browser only |
| F Delivery | Not tracked here |

## 1. Work breakdown

No owners assigned yet. We discuss this list first.

### A. Data
1. **Events**: extend the existing ASU Events script. Parse start and end times,
   handle recurring events and future dates.
2. **Campus buildings**: building ID, name, aliases (e.g. "MU" and "Memorial Union"),
   coordinates, ideally entrance points.
3. **Places (POIs)**: coffee, food, study spots. Planned sources: OSM, ASU Dining, library.
   Include opening hours. (Done so far: ASU Dining, checked by hand. See the status above.)
4. **Event location to building matching**: map strings like
   "Memorial Union, Room 230" to a `building_id`. This is the highest quality risk,
   so plan for fuzzy matching plus a manual lookup table.

### B. Walking network analysis
1. Get and clean the Tempe campus walking network (OSM plus manual fixes).
2. Snap building entrances and user locations onto the network.
3. Compute walking times: a building-to-building matrix, plus times from an
   arbitrary user location.
4. Produce route geometry for display on the map.

### C. Spatial queries and filtering
1. **Feasibility check** (round trip, not one way):
   `walk(here -> X) + stay time + walk(X -> next class) <= gap - buffer`.
2. Filter by type, time and date.
3. Ranking (e.g. by remaining time or distance).

### D. User schedule
1. Data model: course, days, start/end time, building.
2. Input: manual entry with building autocomplete. Stretch goal: `.ics` import.
3. Stored in the browser (localStorage), no accounts.
4. Derive "next class" and "current location" from the current time or a chosen date.

### E. Web front end
1. Map (Leaflet or MapLibre), input panel, filter panel, event cards.
2. Route display and mobile layout.
3. Clear messaging, e.g. "12 minutes of gap left".

### F. Integration and delivery
Deployment (GitHub Pages), testing, README, final report and presentation.

## 2. Architecture

**Static site plus offline processing.**

- Python scripts generate JSON/GeoJSON files. The front end is plain JS that reads
  them. No backend.
- Building-to-building walking times are precomputed into a matrix (around 200
  buildings, so about 40,000 pairs, which is small). The front end only does lookups.
- For an arbitrary user location, snap to the nearest building or network node,
  then look up the matrix.
- If we later need live routing, we can add a routing API.

**`building_id` is the shared join key.** Events, POIs, schedules and the matrix
all reference buildings by it. The exact file formats are in
[data_contract.md](data_contract.md). If we agree on the contract first, everyone
can build against mock data and integration becomes a plug-in step.

### Repo layout (as it is now)

```
pipeline/   Python: buildings, entrances, network and matrix, event matching, places
data/       processed files that the page reads, made by pipeline/ (data contract)
data/source/ inputs kept by hand or raw extractions, read by pipeline/ only
web/        the pages (gap.html is the main one), one copy only
docs/       project plan, architecture, data contract, conventions, wireframe
asu_events_output/  full event export and the geocoding cache
```

## 3. Git workflow

**Rule: main always works. Nobody pushes directly to main. Changes go through
branches and Pull Requests (PRs).**

### One-time setup
In GitHub: Settings -> Rules -> add a rule for `main` that requires a PR and at
least 1 review before merging.

### Daily flow
```bash
git switch main
git pull                              # 1. update before starting

git switch -c feat/walk-matrix        # 2. new branch: type/short-name

git add pipeline/matrix.py
git commit -m "Add building-to-building walk time matrix"   # 3. small commits

git push -u origin feat/walk-matrix   # 4. push your branch
```
Then open a PR on GitHub, ask a teammate to review, and merge. Afterwards:
```bash
git switch main && git pull
git branch -d feat/walk-matrix
```

### Rules of thumb
- One feature per branch, merged within 1 to 3 days. Long-lived branches cause conflicts.
- Each person works mostly in their own folder or files to avoid conflicts.
- Pull before you start each day. If your branch falls behind, run `git merge main`
  and resolve conflicts locally.
- Never `git push --force`. Do not commit large or regenerable files (use `.gitignore`).
- Reviews can be quick. The main check is that the data contract is not broken.
- If you already edited files on `main` locally, run `git switch -c feat/xxx`.
  Your changes move to the new branch with you.

## 4. Open questions for the team
1. Static site only, or is a backend/routing API acceptable?
2. Which data sources for buildings and POIs?
3. How do users enter their schedule: manual only, or `.ics` import too?
4. ~~Campus scope~~: **Tempe campus only** (proposed 2026-10-12). Other campuses are out of scope.
5. Who reviews whose PRs?
