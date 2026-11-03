"""End-to-end departure gates: typed transmissions, no runway entry without clearance."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

ROOT = Path(__file__).resolve().parents[1]
ROUTE = json.loads((ROOT / "data" / "departure_route.json").read_text(encoding="utf-8"))

DELIVERY = "Ruzyne Delivery, Oscar Kilo Alfa Bravo Charlie, stand 3, request startup."
DELIVERY_READBACK = (
    "Runway two four, QNH one zero one three, contact Ruzyne Ground "
    "one two one decimal nine one zero, Oscar Kilo Alfa Bravo Charlie."
)
GROUND = "Ruzyne Ground, Oscar Kilo Alfa Bravo Charlie, request startup and pushback."
PUSH_READBACK = "Startup approved, pushback approved, Oscar Kilo Alfa Bravo Charlie."
TAXI = "Taxi via Alfa one and Zulu, holding short of runway two four, Oscar Kilo Alfa Bravo Charlie."
TAXI_WRONG = "Taxi via Alfa one and Zulu, holding short of runway zero six, Oscar Kilo Alfa Bravo Charlie."
HOLD = (
    "Holding short of runway two four, Ruzyne Tower one three four decimal five six zero, "
    "Oscar Kilo Alfa Bravo Charlie."
)
LINEUP_BAD = "Runway two four, cleared for takeoff, Oscar Kilo Alfa Bravo Charlie."
LINEUP = "Runway two four, line up and wait, Oscar Kilo Alfa Bravo Charlie."
TAKEOFF = "Runway two four, cleared for takeoff, Oscar Kilo Alfa Bravo Charlie."
RADAR = "Contact Praha Radar one two zero decimal five three zero, Oscar Kilo Alfa Bravo Charlie."


def _say(client: TestClient, session_id: str, text: str) -> dict:
    response = client.post(f"/api/session/{session_id}/transmission", json={"text": text})
    assert response.status_code == 200, response.text
    return response.json()


def _arrive(client: TestClient, session_id: str) -> dict:
    response = client.post(f"/api/session/{session_id}/arrived")
    assert response.status_code == 200, response.text
    return response.json()


def test_full_departure_blocks_runway_until_the_right_clearance():
    client = TestClient(app)
    session = client.post("/api/session").json()
    sid = session["session_id"]
    assert session["step"] == "request_delivery"
    assert session["position"] == "stand"
    assert session["movement"] is None

    heard = _say(client, sid, DELIVERY)
    assert heard["step"] == "readback_delivery"
    assert heard["speech"]["speaker"] == "delivery"
    assert "one zero one three" in heard["speech"]["speech"]
    assert "QNH 1013" in " ".join(heard["notes"])

    _say(client, sid, DELIVERY_READBACK)
    ground = _say(client, sid, GROUND)
    assert ground["speaker"]["frequency"] == "121.910"
    assert ground["speaker"]["verified"] is True

    push = _say(client, sid, PUSH_READBACK)
    assert push["movement"]["action"] == "pushback"
    assert push["movement"]["reverse"] is True
    assert push["position"] == "stand"

    taxi_instruction = _arrive(client, sid)
    assert taxi_instruction["step"] == "readback_taxi"
    assert "Hold short" in taxi_instruction["atc_text"]
    assert taxi_instruction["show_lineup"] is False

    blocked = _say(client, sid, TAXI_WRONG)
    assert blocked["movement"] is None
    assert blocked["step"] == "readback_taxi"
    assert blocked["movement_locked"] is True
    assert blocked["last_evaluation"]["safety_critical"] is True
    assert blocked["atc_text"].startswith("Negative")
    assert blocked["score"]["critical"] >= 1
    assert "runway 24" in blocked["last_evaluation"]["incorrect"]

    taxi = _say(client, sid, TAXI)
    assert taxi["movement"]["action"] == "taxi"
    assert taxi["show_lineup"] is False
    # The cleared taxi path ends at the holding point, still off the runway.
    assert taxi["movement"]["coordinates"][-1] == ROUTE["paths"]["taxi"]["coordinates"][-1]
    assert ROUTE["geometry_checks"]["min_distance_taxi_to_rwy_06_24_centerline_m"] > 100

    at_hold = _arrive(client, sid)
    assert at_hold["position"] == "hold"
    assert at_hold["show_lineup"] is False
    assert "134.560" in at_hold["speaker"]["frequency"] or "134" in at_hold["atc_text"] or "five six zero" in at_hold["atc_text"]

    _say(client, sid, HOLD)
    early_takeoff = _say(client, sid, LINEUP_BAD)
    assert early_takeoff["step"] == "readback_lineup"
    assert early_takeoff["movement"] is None
    assert early_takeoff["show_lineup"] is False
    assert early_takeoff["last_evaluation"]["safety_critical"] is True
    assert early_takeoff["atc_text"].startswith("Negative")

    lineup = _say(client, sid, LINEUP)
    assert lineup["movement"]["action"] == "lineup"
    assert lineup["show_lineup"] is True
    assert lineup["show_takeoff"] is False

    takeoff_call = _arrive(client, sid)
    assert takeoff_call["position"] == "runway"
    assert "cleared for takeoff" in takeoff_call["atc_text"]
    # Still no roll until the takeoff readback.
    assert takeoff_call["movement"] is None
    assert takeoff_call["show_takeoff"] is False

    only_lineup = _say(client, sid, LINEUP)
    assert only_lineup["movement"] is None
    assert only_lineup["step"] == "readback_takeoff"

    rolling = _say(client, sid, TAKEOFF)
    assert rolling["movement"]["action"] == "takeoff"
    assert rolling["show_takeoff"] is True

    radar = _arrive(client, sid)
    assert "120.530" in radar["atc_text"] or "five three zero" in radar["atc_text"]
    done = _say(client, sid, RADAR)
    assert done["completed"] is True
    assert done["score"]["overall"] is not None
    assert done["score"]["correct"] >= 8
    assert done["score"]["critical"] >= 1  # the deliberate runway and lineup mistakes
    assert done["movement"] is None


def test_abbreviated_callsign_still_scores():
    client = TestClient(app)
    sid = client.post("/api/session").json()["session_id"]
    body = _say(client, sid, "request startup, Oscar Bravo Charlie")
    assert body["last_evaluation"]["accepted"]
    assert body["last_evaluation"]["perfect"]


def test_airport_document_separates_verified_and_simulated():
    client = TestClient(app)
    payload = client.get("/api/airport").json()
    assert payload["geojson"]["attribution"].startswith("© OpenStreetMap")
    assert payload["route"]["not_an_official_clearance"] is True
    assert payload["route"]["spoken_taxiways"] == ["A1", "Z"]
    freqs = {item["mhz"] for item in payload["sources"]["aip"]["frequencies"]}
    assert {"120.060", "121.910", "134.560", "120.530", "122.160"} <= freqs
    assert any("1013" in line for line in payload["sources"]["simulated"])
    ids = {item["id"]: item["status"] for item in payload["catalog"]["scenarios"]}
    assert ids["departure"] == "available"
    assert ids["arrival"] == "stub"
    assert ids["random"] == "stub"


def test_taxi_path_stays_clear_of_the_runway_and_lineup_reaches_it():
    def dist_point_to_segment(point, a, b) -> float:
        ax, ay = _xy(a)
        bx, by = _xy(b)
        px, py = _xy(point)
        vx, vy = bx - ax, by - ay
        length = vx * vx + vy * vy
        t = 0 if length == 0 else max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / length))
        return ((px - (ax + vx * t)) ** 2 + (py - (ay + vy * t)) ** 2) ** 0.5

    def _xy(lonlat):
        lon, lat = lonlat
        return (lon * 71_500, lat * 111_000)

    centerline = ROUTE["runway_centerline_06_24"]
    taxi = ROUTE["paths"]["taxi"]["coordinates"]
    nearest = min(
        dist_point_to_segment(point, centerline[i], centerline[i + 1])
        for point in taxi
        for i in range(len(centerline) - 1)
    )
    assert nearest > 100

    end = ROUTE["paths"]["lineup"]["coordinates"][-1]
    lineup_gap = min(
        dist_point_to_segment(end, centerline[i], centerline[i + 1]) for i in range(len(centerline) - 1)
    )
    assert lineup_gap < 5
