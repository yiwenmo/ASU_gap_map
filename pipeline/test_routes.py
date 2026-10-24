import json
from pathlib import Path

# -------------------------
# Load walking matrix
# -------------------------

ROOT = Path(__file__).resolve().parent.parent
MATRIX_FILE = ROOT / "data" / "walk_matrix.json"

with open(MATRIX_FILE, "r", encoding="utf-8") as f:
    walk_matrix = json.load(f)


# -------------------------
# Walking speed assumption
# -------------------------

WALKING_SPEED_MPS = 1.4


# -------------------------
# Route information
# -------------------------

def get_route_info(start_building, end_building):

    start_building = start_building.upper()
    end_building = end_building.upper()

    # Check starting building
    if start_building not in walk_matrix:
        print(f"Starting building '{start_building}' not found.")
        return

    # Check destination
    if end_building not in walk_matrix[start_building]:
        print(f"Destination building '{end_building}' not found.")
        return

    # Get walking distance
    distance_meters = walk_matrix[start_building][end_building]

    # Calculate walking time
    walking_seconds = distance_meters / WALKING_SPEED_MPS
    walking_minutes = walking_seconds / 60

    print("--------------------------------")
    print(f"Route: {start_building} -> {end_building}")
    print(f"Distance: {distance_meters} meters")
    print(f"Estimated walking time: {walking_minutes:.1f} minutes")
    print("--------------------------------")


# -------------------------
# Sample ASU routes
# -------------------------

get_route_info("MU", "HAYDN")
get_route_info("COOR", "MU")
get_route_info("NOBLE", "COOR")