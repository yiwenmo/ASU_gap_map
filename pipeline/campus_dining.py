"""
ASU dining on the Tempe campus: the hand-checked list and its weekly opening hours.

Reads  data/source/campus_dining.csv         one venue per row: name, building_id, source, note
       data/source/campus_dining_hours.txt   name | type | Mon | Tue | Wed | Thu | Fri | Sat | Sun
(both are checked by hand against the Sun Devil Hospitality site and its Tempe dining map)

load() gives one dict per venue that has a building_id:
  {name, category, building_id, hours, source}
`hours` is {"mon": [["07:30", "21:00"]], "tue": [], "wed": null, ...}
  list of [open, close] = open in those ranges, [] = closed all day, null = not known
  a close time can pass midnight and is then written past 24:00 ("26:00" = 2:00 AM the next day)
  `hours` is null when the venue is not in the hours table.

The table is read as it is: Closed = closed that day, No data = not known.
"""

import csv
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
VENUES = ROOT / "data" / "source" / "campus_dining.csv"
HOURS = ROOT / "data" / "source" / "campus_dining_hours.txt"

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
CATEGORY = {"Restaurant / fast food": "food", "Coffee / bakery / drinks": "coffee",
            "Convenience store / market": "food", "Other": "food"}


def to_min(t):
    """'7:30AM' -> 450, '12:00AM' -> 0, '12:00PM' -> 720"""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})\s*([AP]M)", t.strip().upper())
    h, mi, ap = int(m.group(1)), int(m.group(2)), m.group(3)
    return (h % 12 + (12 if ap == "PM" else 0)) * 60 + mi


def clock(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def parse_cell(cell):
    """'10:00AM-2:00AM' -> [['10:00', '26:00']];  'Closed' -> [];  'No data' -> None"""
    cell = cell.strip()
    if cell.lower() == "closed":
        return []
    if cell.lower() == "no data" or not cell:
        return None
    a, b = cell.split("-")
    start, end = to_min(a), to_min(b)
    if end <= start:      # closes after midnight (12:00AM counts as the end of the day)
        end += 1440
    return [[clock(start), clock(end)]]


def read_hours():
    table = {}
    for line in HOURS.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, kind, *cells = [c.strip() for c in line.split("|")]
        hours = dict(zip(DAYS, [parse_cell(c) for c in cells]))
        table[name] = {"category": CATEGORY.get(kind, "food"), "hours": hours}
    return table


def short_name(name):
    """'Starbucks (Memorial Union)' -> 'Starbucks' (the building is shown next to it anyway)"""
    return re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()


def load():
    table = read_hours()
    out = []
    for row in csv.DictReader(VENUES.open(encoding="utf-8")):
        if not row["building_id"]:
            continue
        info = table.get(row["name"])
        out.append({
            "name": short_name(row["name"]),
            "category": info["category"] if info else ("coffee" if re.search(r"coffee|cafe|café|starbucks", row["name"], re.I) else "food"),
            "building_id": row["building_id"],
            "hours": info["hours"] if info else None,
            "source": row["source"],
        })
    return out


def without_building():
    return [r["name"] for r in csv.DictReader(VENUES.open(encoding="utf-8")) if not r["building_id"]]


if __name__ == "__main__":
    v = load()
    print(f"{len(v)} venues with a building, {len(without_building())} without")
    for x in v[:3]:
        print(x)
