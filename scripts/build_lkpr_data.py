#!/usr/bin/env python3
"""Build local LKPR GeoJSON and one stand-to-runway route from an OSM extract.

The extract is not shipped. It was downloaded on 2026-11-03 from the
OpenStreetMap API (bbox tiles covering LKPR). Re-run this script with those
tiles in data/raw/*.osm or /tmp/lkpr_tiles/*.osm.

Nothing in the output is an official taxi clearance. Taxiway names and
geometry come from OpenStreetMap tags. Runway identifiers are cross-checked
against the Czech eAIP in data/sources.json, which this script does not fetch.
"""

from __future__ import annotations

import json
import math
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import heapq

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data"
RAW_CANDIDATES = [ROOT / "data" / "raw", Path("/tmp/lkpr_tiles")]

# Airport box. Drops stray aeroway fragments pulled in by the map tiles.
BOUNDS = (50.085, 14.210, 50.125, 14.300)  # south, west, north, east

# Stand 3 on the north apron, next to Terminal 1 / Pier A. Chosen because the
# OSM graph connects it to named taxiways A1 and Z without crossing a runway.
STAND_REF = "3"
STAND_NEAR = (50.11086, 14.26892)
HOLD_NODE = "1044043712"  # runway-type holding position on taxiway Z


def meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    x = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)) * 111_320
    y = (lat2 - lat1) * 110_540
    return math.hypot(x, y)


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def in_bounds(lat: float, lon: float) -> bool:
    s, w, n, e = BOUNDS
    return s <= lat <= n and w <= lon <= e


def load_osm() -> tuple[dict, dict]:
    files: list[Path] = []
    for folder in RAW_CANDIDATES:
        if folder.exists():
            files.extend(sorted(folder.glob("*.osm")))
    if not files:
        raise SystemExit("No OSM tiles found. Place *.osm in data/raw/ and re-run.")

    nodes: dict[str, tuple[float, float, dict]] = {}
    ways: dict[str, tuple[list[str], dict]] = {}
    for path in files:
        for _ev, el in ET.iterparse(path, events=("end",)):
            if el.tag == "node":
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                nodes[el.get("id")] = (float(el.get("lat")), float(el.get("lon")), tags)
                el.clear()
            elif el.tag == "way":
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                if tags.get("aeroway"):
                    ways[el.get("id")] = ([n.get("ref") for n in el.findall("nd")], tags)
                el.clear()
    return nodes, ways


def coords_of(nodes: dict, nds: list[str]) -> list[tuple[float, float]]:
    return [nodes[n][:2] for n in nds if n in nodes]


def runway_polyline(nodes: dict, ways: dict, ref: str) -> list[tuple[float, float]]:
    segs = []
    for nds, tags in ways.values():
        if tags.get("aeroway") == "runway" and tags.get("ref") == ref:
            line = coords_of(nodes, nds)
            if len(line) >= 2:
                segs.append(line)
    if not segs:
        raise SystemExit(f"Runway {ref} not found")
    segs.sort(key=lambda s: s[0][1])
    poly = segs[0][:]
    for seg in segs[1:]:
        if meters(poly[-1], seg[0]) < 40:
            poly.extend(seg[1:])
        elif meters(poly[-1], seg[-1]) < 40:
            poly.extend(list(reversed(seg))[1:])
        else:
            poly.extend(seg)
    return poly


def project_distance(pt: tuple[float, float], line: list[tuple[float, float]]):
    """Return (distance_m, projected_point, along_from_start_m)."""
    best = 1e18
    best_pt = line[0]
    best_along = 0.0
    acc = 0.0
    for i in range(len(line) - 1):
        a, b = line[i], line[i + 1]
        seg = meters(a, b)
        lat_scale = 110_540
        lon_scale = math.cos(math.radians(a[0])) * 111_320
        ax, ay = 0.0, 0.0
        bx, by = (b[1] - a[1]) * lon_scale, (b[0] - a[0]) * lat_scale
        px, py = (pt[1] - a[1]) * lon_scale, (pt[0] - a[0]) * lat_scale
        l2 = bx * bx + by * by
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, (px * bx + py * by) / l2))
        d = math.hypot(px - bx * t, py - by * t)
        if d < best:
            best = d
            best_pt = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
            best_along = acc + seg * t
        acc += seg
    return best, best_pt, best_along


def point_along(line: list[tuple[float, float]], distance_from_start: float) -> tuple[float, float]:
    acc = 0.0
    total = sum(meters(line[i], line[i + 1]) for i in range(len(line) - 1))
    distance_from_start = max(0.0, min(total, distance_from_start))
    for i in range(len(line) - 1):
        seg = meters(line[i], line[i + 1])
        if acc + seg >= distance_from_start or i == len(line) - 2:
            t = 0 if seg == 0 else (distance_from_start - acc) / seg
            t = max(0.0, min(1.0, t))
            a, b = line[i], line[i + 1]
            return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        acc += seg
    return line[-1]


def dijkstra(adj, src: str, dst: str):
    pq = [(0.0, src)]
    dist = {src: 0.0}
    prev = {}
    pref = {}
    while pq:
        d, u = heapq.heappop(pq)
        if d != dist.get(u):
            continue
        if u == dst:
            break
        for v, w, ref, wid in adj[u]:
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = u
                pref[v] = (ref, wid)
                heapq.heappush(pq, (nd, v))
    if dst not in dist:
        raise SystemExit(f"No taxiway path from {src} to {dst}")
    path = [dst]
    edges = []
    while path[-1] != src:
        edges.append(pref[path[-1]])
        path.append(prev[path[-1]])
    path.reverse()
    edges.reverse()
    return path, edges, dist[dst]


def round_ll(pt: tuple[float, float]) -> list[float]:
    # GeoJSON order: longitude, latitude. Six decimals is about 0.1 m.
    return [round(pt[1], 6), round(pt[0], 6)]


def display_name(tags: dict) -> str | None:
    name = tags.get("name")
    if name == "Prst A":
        return "Pier A"
    if name == "Prst B":
        return "Pier B"
    if name == "Prst C":
        return "Pier C"
    if name == "Terminál 1":
        return "Terminal 1"
    if name == "Terminál 2":
        return "Terminal 2"
    if name == "Terminál 3":
        return "Terminal 3"
    return name


def feature_from_way(nodes, wid, nds, tags) -> dict | None:
    line = coords_of(nodes, nds)
    if len(line) < 2:
        return None
    mid = line[len(line) // 2]
    if not in_bounds(*mid):
        return None
    closed = nds[0] == nds[-1] and len(line) >= 4
    if not closed and meters(line[0], line[-1]) < 8 and len(line) >= 4 and tags.get("aeroway") in {"apron", "terminal", "hangar"}:
        closed = True
        line = line + [line[0]]
    geom_type = "Polygon" if closed else "LineString"
    coordinates = [round_ll(p) for p in line]
    if geom_type == "Polygon":
        coordinates = [coordinates]
    props = {
        "aeroway": tags.get("aeroway"),
        "osm_id": int(wid),
    }
    if tags.get("ref"):
        props["ref"] = tags["ref"]
    if tags.get("name"):
        props["name"] = tags["name"]
    shown = display_name(tags)
    if shown:
        props["display_name"] = shown
    if tags.get("width"):
        props["width"] = tags["width"]
    if tags.get("length"):
        props["length"] = tags["length"]
    if tags.get("surface"):
        props["surface"] = tags["surface"]
    return {"type": "Feature", "properties": props, "geometry": {"type": geom_type, "coordinates": coordinates}}


def main() -> None:
    nodes, ways = load_osm()
    rwy = runway_polyline(nodes, ways, "06/24")
    rwy_1230 = runway_polyline(nodes, ways, "12/30")
    thr06, thr24 = rwy[0], rwy[-1]
    rwy_len = sum(meters(rwy[i], rwy[i + 1]) for i in range(len(rwy) - 1))

    adj: dict[str, list] = defaultdict(list)
    for wid, (nds, tags) in ways.items():
        if tags.get("aeroway") != "taxiway":
            continue
        ref = tags.get("ref") or ""
        for i in range(len(nds) - 1):
            a, b = nds[i], nds[i + 1]
            if a not in nodes or b not in nodes:
                continue
            d = meters(nodes[a][:2], nodes[b][:2])
            if d < 0.4:
                continue
            adj[a].append((b, d, ref, wid))
            adj[b].append((a, d, ref, wid))

    if HOLD_NODE not in nodes:
        raise SystemExit("Holding node missing from extract")
    hold_tags = nodes[HOLD_NODE][2]
    hold_d, hold_proj, hold_along = project_distance(nodes[HOLD_NODE][:2], rwy)

    # Stand 3 lead-in line nearest the terminal centroid we selected.
    stand_way = None
    stand_nds = None
    best = 1e18
    for wid, (nds, tags) in ways.items():
        if tags.get("aeroway") != "parking_position" or tags.get("ref") != STAND_REF:
            continue
        cs = coords_of(nodes, nds)
        if not cs:
            continue
        c = (sum(p[0] for p in cs) / len(cs), sum(p[1] for p in cs) / len(cs))
        d = meters(c, STAND_NEAR)
        if d < best:
            best = d
            stand_way = wid
            stand_nds = nds
    if stand_way is None or best > 150:
        raise SystemExit(f"Stand {STAND_REF} not found near expected point ({best})")

    graph_nodes = [n for n in stand_nds if n in adj]
    if len(graph_nodes) != 1:
        raise SystemExit(f"Expected one taxiway connection for stand 3, got {graph_nodes}")
    gate_node = graph_nodes[0]
    # Parked position is the lead-in endpoint that is not on the taxi graph.
    if stand_nds[0] == gate_node:
        parked_order = list(reversed(stand_nds))
    elif stand_nds[-1] == gate_node:
        parked_order = list(stand_nds)
    else:
        # gate is in the middle; start from the far end
        ends = [stand_nds[0], stand_nds[-1]]
        far = max(ends, key=lambda n: meters(nodes[n][:2], nodes[gate_node][:2]))
        # walk the way from far to gate
        if stand_nds[0] == far:
            parked_order = stand_nds[: stand_nds.index(gate_node) + 1]
        else:
            parked_order = list(reversed(stand_nds[stand_nds.index(gate_node) :]))
    push_pts = [nodes[n][:2] for n in parked_order if n in nodes]

    path, edges, taxi_dist = dijkstra(adj, gate_node, HOLD_NODE)
    taxi_pts = [nodes[n][:2] for n in path]

    # Segment summary, including unnamed connectors. Do not invent refs.
    segments = []
    idx_name = edges[0][0]
    acc = 0.0
    ways_acc: list[int] = []
    unnamed_tags = []
    for i, (ref, wid) in enumerate(edges):
        step = meters(nodes[path[i]][:2], nodes[path[i + 1]][:2])
        if ref != idx_name and acc > 0:
            segments.append({"ref": idx_name or None, "length_m": round(acc, 1), "osm_ways": ways_acc})
            acc = 0.0
            ways_acc = []
            idx_name = ref
        acc += step
        if int(wid) not in ways_acc:
            ways_acc.append(int(wid))
        if not ref:
            tags = ways[wid][1]
            unnamed_tags.append({k: tags.get(k) for k in ("ref", "name", "aeroway") if k in tags or k == "ref"})
    segments.append({"ref": idx_name or None, "length_m": round(acc, 1), "osm_ways": ways_acc})

    min_taxi_d = min(project_distance(p, rwy)[0] for p in taxi_pts)
    min_1230 = min(project_distance(p, rwy_1230)[0] for p in taxi_pts)

    # Line-up: follow Z from the hold toward the centreline. Stop on the
    # runway edge, then snap to the centreline and roll far enough to align.
    cur = HOLD_NODE
    seen = {cur}
    lineup_nodes = [cur]
    for _ in range(30):
        dcur = project_distance(nodes[cur][:2], rwy)[0]
        options = []
        for v, w, ref, wid in adj[cur]:
            if v in seen:
                continue
            dv = project_distance(nodes[v][:2], rwy)[0]
            options.append((dv, ref == "Z", -w, v, ref))
        if not options:
            break
        options.sort()
        # Prefer staying on Z while it still moves us toward the runway.
        z_opts = [o for o in options if o[3] and o[4] == "Z" and o[0] <= dcur + 2]
        pick = z_opts[0] if z_opts else options[0]
        dv, _prefer, _negw, v, ref = pick
        if dv > dcur + 5 and ref != "Z":
            break
        lineup_nodes.append(v)
        seen.add(v)
        cur = v
        if dv < 26:
            break
    lineup_pts = [nodes[n][:2] for n in lineup_nodes]
    entry = lineup_pts[-1]
    d_entry, proj, along = project_distance(entry, rwy)
    # Place the lined-up stop 140 m down-runway from the threshold-side
    # projection, facing the departure direction (toward THR 06).
    lineup_stop_along = max(0.0, along - 140.0)
    stop = point_along(rwy, lineup_stop_along)
    # If the projection is already further from THR 24 than 140 m, keep it.
    along_from_thr24 = rwy_len - along
    if along_from_thr24 > 200:
        # Entered well downfield; stop 80 m further in the departure direction.
        lineup_stop_along = max(0.0, along - 80.0)
        stop = point_along(rwy, lineup_stop_along)
    lineup_pts = lineup_pts + [proj, stop]

    # Takeoff roll along the true centreline, departure direction, ~2200 m
    # or until 400 m before the far threshold — whichever is shorter.
    start_along = lineup_stop_along
    end_along = max(400.0, start_along - 2200.0)
    takeoff_pts = []
    dist = start_along
    while dist > end_along:
        takeoff_pts.append(point_along(rwy, dist))
        dist -= 40.0
    takeoff_pts.append(point_along(rwy, end_along))

    # Headings.
    park_heading = bearing(push_pts[-1], push_pts[0]) if len(push_pts) >= 2 else 0.0
    # Nose points at the stand (reverse of pushback motion) while parked.
    if len(push_pts) >= 2:
        park_heading = bearing(push_pts[1], push_pts[0])

    def path_obj(points, reverse: bool) -> dict:
        return {"reverse": reverse, "coordinates": [round_ll(p) for p in points]}

    named = [s["ref"] for s in segments if s["ref"]]
    # Collapse consecutive duplicates for the spoken clearance.
    spoken = []
    for ref in named:
        if not spoken or spoken[-1] != ref:
            spoken.append(ref)
    unnamed_m = round(sum(s["length_m"] for s in segments if not s["ref"]), 1)

    route = {
        "id": "stand3_a1_z_rwy24",
        "description": (
            "One OSM taxiway-graph path from parking stand 3 to the runway holding "
            "position on taxiway Z, then onto runway 06/24 for a runway 24 departure."
        ),
        "not_an_official_clearance": True,
        "stand": {
            "ref": STAND_REF,
            "osm_way": int(stand_way),
            "source": "OpenStreetMap aeroway=parking_position",
            "note": (
                "Stand number 3 appears in the Czech AIP visual-docking list. "
                "The coordinates are the OSM lead-in line, not a surveyed AIP coordinate."
            ),
        },
        "runway": {
            "departure": "24",
            "pair": "06/24",
            "magnetic_bearing_aip": 240,
            "true_bearing_aip": 245,
            "aip_length_m": 3715,
            "osm_centerline_length_m": round(rwy_len, 1),
            "threshold_24": round_ll(thr24),
            "threshold_06": round_ll(thr06),
        },
        "hold": {
            "osm_node": HOLD_NODE,
            "taxiway": "Z",
            "holding_position_type": hold_tags.get("holding_position:type"),
            "distance_to_centerline_m": round(hold_d, 1),
            "note": (
                "OSM node tagged aeroway=holding_position, holding_position:type=runway, "
                "on taxiway Z. The AIP says a CAT I holding point for runway 24 is on "
                "taxiway Z. This file does not claim the OSM node is that surveyed point."
            ),
        },
        "taxi_segments": segments,
        "spoken_taxiways": spoken,
        "unnamed_connector_m": unnamed_m,
        "unnamed_connector_note": (
            "The OSM path includes a taxiway way with no ref and no name between "
            f"the named taxiways. Length about {unnamed_m} m. The training clearance "
            "says only the named taxiways and does not invent a designator for this link."
        ),
        "geometry_checks": {
            "taxi_length_m": round(taxi_dist, 1),
            "min_distance_taxi_to_rwy_06_24_centerline_m": round(min_taxi_d, 1),
            "min_distance_taxi_to_rwy_12_30_centerline_m": round(min_1230, 1),
            "lineup_end_distance_to_centerline_m": round(project_distance(lineup_pts[-1], rwy)[0], 2),
        },
        "initial": {
            "position": round_ll(push_pts[0]),
            "heading_deg": round(park_heading, 1),
            "heading_note": "Parked nose-in. Heading points along the stand lead-in, toward the stand, opposite the pushback direction.",
        },
        "paths": {
            "pushback": path_obj(push_pts, reverse=True),
            "taxi": path_obj(taxi_pts, reverse=False),
            "lineup": path_obj(lineup_pts, reverse=False),
            "takeoff": path_obj(takeoff_pts, reverse=False),
        },
        "runway_centerline_06_24": [round_ll(p) for p in rwy],
    }

    features = []
    keep = {"runway", "taxiway", "apron", "terminal", "parking_position", "hangar"}
    for wid, (nds, tags) in ways.items():
        if tags.get("aeroway") not in keep:
            continue
        feat = feature_from_way(nodes, wid, nds, tags)
        if feat:
            features.append(feat)

    for nid, (lat, lon, tags) in nodes.items():
        if tags.get("aeroway") != "holding_position":
            continue
        if not in_bounds(lat, lon):
            continue
        props = {
            "aeroway": "holding_position",
            "osm_id": int(nid),
            "holding_position_type": tags.get("holding_position:type"),
        }
        if nid == HOLD_NODE:
            props["trainer_hold"] = True
        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Point", "coordinates": round_ll((lat, lon))},
            }
        )

    geo = {
        "type": "FeatureCollection",
        "name": "LKPR aeroway extract",
        "source": "OpenStreetMap",
        "license": "ODbL-1.0",
        "retrieved": "2026-11-03",
        "attribution": "© OpenStreetMap contributors",
        "features": features,
    }

    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "lkpr_aeroway.geojson").write_text(json.dumps(geo, ensure_ascii=False), encoding="utf-8")
    (OUT_DIR / "departure_route.json").write_text(json.dumps(route, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"features {len(features)}")
    print("segments", json.dumps(segments))
    print("spoken", spoken, "unnamed_m", unnamed_m)
    print("checks", json.dumps(route["geometry_checks"]))
    print("unnamed tag sample", unnamed_tags[:6])
    print("hold", hold_d, hold_tags)
    print("park heading", round(park_heading, 1), "push pts", len(push_pts), "taxi", len(taxi_pts), "lineup", len(lineup_pts), "takeoff", len(takeoff_pts))
    print("sizes", (OUT_DIR / "lkpr_aeroway.geojson").stat().st_size, (OUT_DIR / "departure_route.json").stat().st_size)


if __name__ == "__main__":
    main()
