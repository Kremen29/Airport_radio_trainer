"""Hint counting and the drawn-taxiway check. Neither one blocks a correct readback."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.route_draw import evaluate_drawing

ROOT = Path(__file__).resolve().parents[1]
ROUTE = json.loads((ROOT / "data" / "departure_route.json").read_text(encoding="utf-8"))


def _taxi_samples():
    points = ROUTE["paths"]["taxi"]["coordinates"]
    step = max(1, len(points) // 30)
    return points[::step] + [points[-1]]


def test_correct_osm_route_matches_alfa_one_then_zulu():
    result = evaluate_drawing(_taxi_samples())
    assert result["ok"] is True
    assert result["used_taxiways"] == ["A1", "Z"]
    assert result["ended_at_hold"] is True
    assert result["entered_runway"] is False
    assert any("Alfa 1" in line and "Zulu" in line for line in result["feedback"])


def test_runway_crossing_is_reported_from_real_centreline():
    start = ROUTE["paths"]["taxi"]["coordinates"][0]
    middle = ROUTE["runway_centerline_06_24"][len(ROUTE["runway_centerline_06_24"]) // 2]
    result = evaluate_drawing([start, middle])
    assert result["ok"] is False
    assert result["entered_runway"] is True
    assert any("runway 24" in line for line in result["feedback"])


def test_hint_is_counted_and_does_not_change_the_step():
    client = TestClient(app)
    session = client.post("/api/session").json()
    sid = session["session_id"]
    noted = client.post(f"/api/session/{sid}/hint")
    assert noted.status_code == 200
    body = noted.json()
    assert body["step"] == "request_delivery"
    assert body["hints_used"] == 1
    assert body["score"]["hints_used"] == 1
    assert body["movement"] is None


def test_draw_mode_holds_the_aircraft_until_a_line_is_submitted():
    client = TestClient(app)
    session = client.post("/api/session").json()
    sid = session["session_id"]
    armed = client.post(f"/api/session/{sid}/draw-mode", json={"enabled": True})
    assert armed.json()["draw_mode"] is True

    def say(text):
        response = client.post(f"/api/session/{sid}/transmission", json={"text": text})
        assert response.status_code == 200
        return response.json()

    say("Ruzyne Delivery, Oscar Kilo Alfa Bravo Charlie, request startup.")
    say(
        "Runway two four, QNH one zero one three, contact Ruzyne Ground "
        "one two one decimal nine one zero, Oscar Kilo Alfa Bravo Charlie."
    )
    say("Ruzyne Ground, Oscar Kilo Alfa Bravo Charlie, request startup and pushback.")
    pushed = say("Startup approved, pushback approved, Oscar Kilo Alfa Bravo Charlie.")
    assert pushed["movement"]["action"] == "pushback"
    taxi_call = client.post(f"/api/session/{sid}/arrived").json()
    assert taxi_call["step"] == "readback_taxi"
    assert taxi_call["draw_tools"] is True

    held = say("Taxi via Alfa one and Zulu, holding short of runway two four, Oscar Kilo Alfa Bravo Charlie.")
    assert held["movement"] is None
    assert held["draw_waiting"] is True
    assert held["step"] == "readback_taxi"

    released = client.post(
        f"/api/session/{sid}/drawing",
        json={"points": _taxi_samples()},
    ).json()
    assert released["drawing"]["ok"] is True
    assert released["movement"]["action"] == "taxi"
    assert released["movement"]["coordinates"][-1] == ROUTE["paths"]["taxi"]["coordinates"][-1]
