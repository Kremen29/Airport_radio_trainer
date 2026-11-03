"""Compare a finger-drawn taxi line with the OSM taxiway graph.

Names come only from OpenStreetMap `ref` tags. A way with no ref is reported
as unnamed. Nothing here invents a taxiway designator.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHONETIC = {
    "A": "Alfa", "B": "Bravo", "C": "Charlie", "D": "Delta", "E": "Echo",
    "F": "Foxtrot", "G": "Golf", "H": "Hotel", "J": "Juliett", "K": "Kilo",
    "L": "Lima", "M": "Mike", "N": "November", "P": "Papa", "Q": "Quebec",
    "R": "Romeo", "S": "Sierra", "T": "Tango", "U": "Uniform", "V": "Victor",
    "W": "Whiskey", "X": "X-ray", "Y": "Yankee", "Z": "Zulu",
}
SNAP_M = 42.0
RUNWAY_M = 28.0
HOLD_M = 90.0


def _meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    x = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)) * 111_320
    y = (lat2 - lat1) * 110_540
    return math.hypot(x, y)


def _point_segment(point, start, end) -> tuple[float, tuple[float, float]]:
    """Return distance in metres and the closest point on the segment, lon/lat."""
    ax, ay = _xy(start)
    bx, by = _xy(end)
    px, py = _xy(point)
    vx, vy = bx - ax, by - ay
    length = vx * vx + vy * vy
    t = 0.0 if length == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / length))
    qx, qy = ax + vx * t, ay + vy * t
    dist = math.hypot(px - qx, py - qy)
    lon = start[0] + t * (end[0] - start[0])
    lat = start[1] + t * (end[1] - start[1])
    return dist, (lon, lat)


def _xy(lonlat: tuple[float, float]) -> tuple[float, float]:
    lon, lat = lonlat
    return (
        lon * math.cos(math.radians(lat)) * 111_320,
        lat * 110_540,
    )


def _dist_polyline(point, line: list[tuple[float, float]]) -> float:
    best = 1e18
    for index in range(len(line) - 1):
        dist, _near = _point_segment(point, line[index], line[index + 1])
        if dist < best:
            best = dist
    return best


def spoken_ref(ref: str | None) -> str:
    if not ref:
        return "an unnamed taxiway (no ref in OpenStreetMap)"
    letters = "".join(ch for ch in ref if ch.isalpha()).upper()
    digits = "".join(ch for ch in ref if ch.isdigit())
    words = []
    unknown = False
    for ch in letters:
        if ch in PHONETIC:
            words.append(PHONETIC[ch])
        else:
            unknown = True
            words.append(ch)
    label = " ".join(words) if words else ref
    if digits:
        label = f"{label} {digits}"
    if unknown:
        return f"{label} (OpenStreetMap ref {ref})"
    return label


@lru_cache(maxsize=1)
def _network() -> dict:
    geo = json.loads((ROOT / "data" / "lkpr_aeroway.geojson").read_text(encoding="utf-8"))
    route = json.loads((ROOT / "data" / "departure_route.json").read_text(encoding="utf-8"))
    segments = []
    runway = []
    for feature in geo["features"]:
        props = feature.get("properties") or {}
        kind = props.get("aeroway")
        geom = feature.get("geometry") or {}
        if kind == "taxiway" and geom.get("type") == "LineString":
            ref = props.get("ref") or None
            coords = [(pair[0], pair[1]) for pair in geom["coordinates"]]
            for index in range(len(coords) - 1):
                if _meters(coords[index], coords[index + 1]) < 0.4:
                    continue
                segments.append((ref, coords[index], coords[index + 1]))
        if kind == "runway" and props.get("ref") == "06/24" and geom.get("type") == "LineString":
            runway.extend((pair[0], pair[1]) for pair in geom["coordinates"])
    hold = tuple(route["paths"]["taxi"]["coordinates"][-1])
    expected = list(route["spoken_taxiways"])
    return {"segments": segments, "runway": runway, "hold": hold, "expected": expected}


def _resample(points: list[tuple[float, float]], step_m: float) -> list[tuple[float, float]]:
    if len(points) < 2:
        return points
    samples = [points[0]]
    carry = 0.0
    for index in range(1, len(points)):
        start, end = points[index - 1], points[index]
        length = _meters(start, end)
        if length < 0.5:
            continue
        travelled = step_m - carry
        while travelled <= length:
            t = travelled / length
            samples.append((
                start[0] + t * (end[0] - start[0]),
                start[1] + t * (end[1] - start[1]),
            ))
            travelled += step_m
        carry = length - (travelled - step_m)
    if _meters(samples[-1], points[-1]) > 5:
        samples.append(points[-1])
    return samples


def _nearest(point, segments):
    best = (1e18, None, point)
    for ref, start, end in segments:
        dist, near = _point_segment(point, start, end)
        if dist < best[0]:
            best = (dist, ref, near)
    return best


def evaluate_drawing(raw_points: list[list[float]]) -> dict:
    """Score one drawn line. A wrong line is reported and does not block the scenario."""
    net = _network()
    points = []
    for pair in raw_points:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        try:
            points.append((float(pair[0]), float(pair[1])))
        except (TypeError, ValueError):
            continue
    expected = net["expected"]
    expected_words = ", then ".join(spoken_ref(ref) for ref in expected)
    if len(points) < 2:
        return {
            "ok": False,
            "submitted": False,
            "feedback": ["Draw a line from the aircraft to the holding point, then tap Submit."],
            "used_taxiways": [],
            "expected_taxiways": expected,
            "entered_runway": False,
            "ended_at_hold": False,
            "snapped": [],
        }

    samples = _resample(points, 20.0)
    snapped = []
    refs = []
    off = 0
    for sample in samples:
        dist, ref, near = _nearest(sample, net["segments"])
        if dist <= SNAP_M:
            snapped.append([round(near[0], 6), round(near[1], 6)])
            refs.append(ref)
        else:
            off += 1
            snapped.append([round(sample[0], 6), round(sample[1], 6)])
            refs.append(None)

    collapsed: list[str | None] = []
    for ref in refs:
        if not collapsed or collapsed[-1] != ref:
            collapsed.append(ref)
    named = [ref for ref in collapsed if ref]
    extras = []
    for ref in named:
        if ref not in expected and ref not in extras:
            extras.append(ref)

    matched = 0
    for ref in named:
        if matched < len(expected) and ref == expected[matched]:
            matched += 1
    order_ok = matched == len(expected)
    missing = expected[matched:]

    runway_hit = False
    runway = net["runway"]
    if len(runway) >= 2:
        for sample in samples:
            if _dist_polyline(sample, runway) < RUNWAY_M:
                runway_hit = True
                break
    ended = _meters(points[-1], net["hold"]) <= HOLD_M
    off_ratio = off / max(1, len(samples))

    feedback: list[str] = []
    if runway_hit:
        feedback.append("You'd enter runway 24 without clearance.")
    shown = extras[:4]
    for ref in shown:
        feedback.append(
            f"You used taxiway {spoken_ref(ref)} instead of the cleared route ({expected_words})."
        )
    if len(extras) > len(shown):
        feedback.append(f"The line also meets {len(extras) - len(shown)} other taxiways that are not on this clearance.")
    if not order_ok:
        if missing and not extras:
            feedback.append(
                "The drawing does not include taxiway "
                + ", ".join(spoken_ref(ref) for ref in missing)
                + "."
            )
        else:
            feedback.append(f"Taxiway order does not match the clearance: {expected_words}.")
    if not ended:
        feedback.append("The line does not end at the holding point on taxiway Zulu.")
    if off_ratio > 0.4:
        feedback.append("Part of the line is not on a taxiway in the OpenStreetMap data.")
    ok = order_ok and not extras and ended and not runway_hit and off_ratio <= 0.4
    if ok:
        unnamed = any(ref is None for ref in collapsed)
        note = " The short link between them has no name in OpenStreetMap, so it is not given one here." if unnamed else ""
        feedback.append(f"That follows {expected_words} and stops short of runway 24.{note}")

    return {
        "ok": ok,
        "submitted": True,
        "feedback": feedback,
        "used_taxiways": named,
        "expected_taxiways": expected,
        "entered_runway": runway_hit,
        "ended_at_hold": ended,
        "snapped": snapped,
    }
