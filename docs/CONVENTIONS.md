# Team Conventions (draft for discussion)

The goal is that everyone can work on their own part and the parts still fit together at the end. Details of file formats are in [data_contract.md](data_contract.md).

## 1. One way to say "where": `building_id`

Every dataset describes a location with `building_id` (the ASU building code, e.g `MU`, `COOR`), not with free text, addresses or raw coordinates.

```
events ──┐
places ──┼── building_id ──> walk_matrix[from][to] ──> "can I make it?"
schedule ┘
```

- Events: done (`pipeline/match_events.py`).
- Places (coffee, food, study): to do. Each place gets the `building_id` it is in or next to.
- Schedule: the user picks a building from a list, and we store its `building_id`.
- Walking times: `walk_matrix[from_id][to_id]`, in seconds.

## 2. Scope

Tempe campus only. Data for other campuses and online events stays in the CSV GeoJSON, but is not shown on the map. Every record keeps a `campus` field so we can add campuses later.

## 3. Formats

- Coordinates: WGS84, GeoJSON order `[lon, lat]`.
- Times: ISO 8601 with the Arizona offset. Show "2:30 PM" only in the UI.
- Walking time: seconds.
- File and field names: lowercase with underscores (`building_id`).
- Changing a field means updating `data_contract.md` in the same PR and telling the team.

## 4. One source for each thing

| Thing | Lives in | Rule |
|---|---|---|
| Page code (html/css/js) | `web/` | Edit here only |
| Scripts that make data | `pipeline/` | One script per kind of data |
| Processed data the page reads | `data/` | Made by `pipeline/`, never edited by hand |
| Full event export and caches | `asu_events_output/` | Can be re-made |

Files that a script can re-make should not be edited by hand (a rerun overwrites them).

## 5. Git

- Nobody pushes to `main`. Work on a branch (`feat/...`, `fix/...`, `docs/...`), open a PR,
  one teammate reviews, then merge.
- Small branches, merged within 1 to 3 days.
- `git pull` on `main` before starting each day.
- The reviewer mainly checks that the data contract is not broken.

## 6. CHANGELOG

When you finish something, add a short entry to `CHANGELOG.md`:

- what you added and where the data came from,
- problems you hit, what happened, and how you fixed them,
- what is still not done.

This is how the rest of the team (and the final report) finds out why things look the way they do.

## 7. Decisions to confirm with the team

1. `building_id` = ASU building code is the only location key.
2. Tempe only for now.
3. Folder layout: `pipeline/`, `data/`, `web/`, `docs/`.
4. The page reads `data/` directly (done: `web/` is no longer copied into `asu_events_output/`).
