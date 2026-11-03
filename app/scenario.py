"""Departure scenario state machine.

Arrival and random practice are described in the catalog and are not playable.
The departure flow is a simplified ICAO-style training sequence on verified
LKPR station names. Clearance content that is not from the AIP is marked
simulated in the payload notes.
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from app.evaluator import evaluate_transmission
from app.route_draw import evaluate_drawing

ROOT = Path(__file__).resolve().parents[1]
ROUTE = json.loads((ROOT / "data" / "departure_route.json").read_text(encoding="utf-8"))
SOURCES = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))

STATIONS = {
    "delivery": {"id": "delivery", "label": "RUZYNĚ DELIVERY", "frequency": "120.060", "verified": True},
    "ground": {"id": "ground", "label": "RUZYNĚ GROUND", "frequency": "121.910", "verified": True},
    "tower": {"id": "tower", "label": "RUZYNĚ TOWER", "frequency": "134.560", "verified": True},
    "radar": {"id": "radar", "label": "PRAHA RADAR", "frequency": "120.530", "verified": True},
}

# Element buckets: critical = mandatory clearance items (40%), callsign (15%),
# routing = runway / taxiway / frequency-of-route (25%). Completeness is every item (20%).
def E(eid: str, label: str, bucket: str, blocks: bool = True, safety: bool = False) -> dict:
    return {"id": eid, "label": label, "bucket": bucket, "blocks": blocks, "safety": safety}


QNH_NOTE = "QNH 1013 hPa is a simulated training value (standard pressure), not live ATIS or METAR."
ROUTE_NOTE = (
    "Training taxi route only: OSM taxiways Alfa 1 and Zulu, plus a 67 m unnamed "
    "taxiway link between them. This is not a published standard taxi route."
)
FLOW_NOTE = (
    "Simplified training flow. Live LKPR clearances include the flight's actual "
    "route, SID and squawk, which this scenario does not invent."
)

STEPS: dict[str, dict] = {
    "request_delivery": {
        "phase": "RAMP",
        "speaker": "delivery",
        "prompt": "Parked at stand 3. Call Ruzyně Delivery and request startup. Use your callsign.",
        "expected": "Callsign and a startup or departure request.",
        "example": "Ruzyne Delivery, Oscar Kilo Alfa Bravo Charlie, stand 3, request startup.",
        "elements": [
            E("callsign", "callsign OK-ABC", "callsign", blocks=False),
            E("intent:delivery", "startup or departure request", "critical", blocks=True, safety=False),
        ],
        "negative": "Station calling, say again your callsign and request.",
        "notes": [FLOW_NOTE],
    },
    "readback_delivery": {
        "phase": "RAMP",
        "speaker": "delivery",
        "prompt": "Read back the runway, the QNH, and the Ground frequency.",
        "expected": "Runway 24, QNH 1013, Ground 121.910, and your callsign.",
        "example": "Runway two four, QNH one zero one three, contact Ruzyne Ground one two one decimal nine one zero, Oscar Kilo Alfa Bravo Charlie.",
        "elements": [
            E("callsign", "callsign OK-ABC", "callsign", blocks=False),
            E("runway:24", "runway 24", "routing", blocks=True, safety=True),
            E("qnh:1013", "QNH 1013", "critical", blocks=True, safety=True),
            E("freq:121.910", "Ground frequency 121.910", "critical", blocks=True, safety=True),
        ],
        "negative": "Negative. Runway two four, QNH one zero one three. Contact Ruzyne Ground, one two one decimal nine one zero.",
        "atc": "Oscar Kilo Alfa Bravo Charlie, Ruzyně Delivery, runway two four, QNH one zero one three. Contact Ruzyně Ground, one two one decimal nine one zero.",
        "notes": [QNH_NOTE, "Ground frequency 121.910 is from AIP AD 2.18, retrieved 2026-11-03."],
    },
    "request_ground": {
        "phase": "RAMP",
        "speaker": "ground",
        "prompt": "Check in with Ruzyně Ground. Request startup and pushback.",
        "expected": "Callsign, and a request for startup or pushback.",
        "example": "Ruzyne Ground, Oscar Kilo Alfa Bravo Charlie, stand 3, request startup and pushback.",
        "elements": [
            E("callsign", "callsign OK-ABC", "callsign", blocks=False),
            E("intent:ground", "startup or pushback request", "critical", blocks=True),
        ],
        "negative": "Negative, say again. Request startup and pushback.",
        "notes": ["AIP AD 2.20.2: engine-start and pushback instructions are issued by Ground or Tower, depending on the hours."],
    },
    "readback_startup_pushback": {
        "phase": "RAMP",
        "speaker": "ground",
        "prompt": "Read back startup and pushback. The aircraft will not move until you do.",
        "expected": "Startup approved, pushback approved, and your callsign.",
        "example": "Startup approved, pushback approved, Oscar Kilo Alfa Bravo Charlie.",
        "elements": [
            E("callsign", "callsign OK-ABC", "callsign", blocks=False),
            E("startup_approved", "startup approved", "critical", blocks=True),
            E("pushback_approved", "pushback approved", "critical", blocks=True),
        ],
        "negative": "Negative. Startup approved, pushback approved.",
        "atc": "Oscar Kilo Alfa Bravo Charlie, Ruzyně Ground, startup approved, pushback approved.",
        "notes": ["No facing direction is given. The AIP does not publish one for this stand, so none is invented."],
        "move": "pushback",
    },
    "readback_taxi": {
        "phase": "TAXI",
        "speaker": "ground",
        "prompt": "Read back the taxi route and hold short of runway 24. You may not enter the runway.",
        "expected": "Taxi via A1 and Zulu, hold short of runway 24, and your callsign.",
        "example": "Taxi via Alfa one and Zulu, holding short of runway two four, Oscar Kilo Alfa Bravo Charlie.",
        "elements": [
            E("callsign", "callsign OK-ABC", "callsign", blocks=False),
            E("taxiway:A1", "taxiway Alfa 1", "routing", blocks=True, safety=True),
            E("taxiway:Z", "taxiway Zulu", "routing", blocks=True, safety=True),
            E("hold_short", "hold short", "critical", blocks=True, safety=True),
            E("runway:24", "runway 24", "routing", blocks=True, safety=True),
        ],
        "negative": "Negative. Hold short of runway two four. Taxi via Alfa one and Zulu.",
        "atc": "Oscar Kilo Alfa Bravo Charlie, taxi to holding point runway two four, via Alfa one and Zulu. Hold short of runway two four.",
        "notes": [ROUTE_NOTE],
        "move": "taxi",
    },
    "readback_hold": {
        "phase": "TAXI",
        "speaker": "ground",
        "prompt": "You are at the holding point. Read back hold short, and the Tower frequency.",
        "expected": "Hold short of runway 24, Tower 134.560, and your callsign.",
        "example": "Holding short of runway two four, contact Ruzyne Tower one three four decimal five six zero, Oscar Kilo Alfa Bravo Charlie.",
        "elements": [
            E("callsign", "callsign OK-ABC", "callsign", blocks=False),
            E("hold_short", "hold short", "critical", blocks=True, safety=True),
            E("runway:24", "runway 24", "routing", blocks=True, safety=True),
            E("freq:134.560", "Tower frequency 134.560", "critical", blocks=True, safety=True),
        ],
        "negative": "Negative. Hold short of runway two four. Contact Ruzyne Tower, one three four decimal five six zero.",
        "atc": "Oscar Kilo Alfa Bravo Charlie, hold short of runway two four. Contact Ruzyně Tower, one three four decimal five six zero.",
        "notes": ["Tower frequency 134.560 is from AIP AD 2.18, retrieved 2026-11-03. The aircraft stays off the runway."],
    },
    "readback_lineup": {
        "phase": "TAKEOFF",
        "speaker": "tower",
        "prompt": "Read back line up and wait. A takeoff clearance is a different instruction — do not use it yet.",
        "expected": "Runway 24, line up and wait, and your callsign. Not a takeoff clearance.",
        "example": "Runway two four, line up and wait, Oscar Kilo Alfa Bravo Charlie.",
        "elements": [
            E("callsign", "callsign OK-ABC", "callsign", blocks=False),
            E("lineup", "line up and wait", "critical", blocks=True, safety=True),
            E("forbid_takeoff", "no takeoff clearance on this transmission", "critical", blocks=True, safety=True),
            E("runway:24", "runway 24", "routing", blocks=True, safety=True),
        ],
        "negative": "Negative. Runway two four, line up and wait.",
        "atc": "Oscar Kilo Alfa Bravo Charlie, runway two four, line up and wait.",
        "notes": ["Line up and wait is not a takeoff clearance. The aircraft stops aligned on the runway."],
        "move": "lineup",
    },
    "readback_takeoff": {
        "phase": "TAKEOFF",
        "speaker": "tower",
        "prompt": "Read back the takeoff clearance and the runway.",
        "expected": "Runway 24, cleared for takeoff, and your callsign.",
        "example": "Runway two four, cleared for takeoff, Oscar Kilo Alfa Bravo Charlie.",
        "elements": [
            E("callsign", "callsign OK-ABC", "callsign", blocks=False),
            E("takeoff", "cleared for takeoff", "critical", blocks=True, safety=True),
            E("runway:24", "runway 24", "routing", blocks=True, safety=True),
        ],
        "negative": "Negative. Runway two four, cleared for takeoff.",
        "atc": "Oscar Kilo Alfa Bravo Charlie, runway two four, cleared for takeoff.",
        "notes": ["The takeoff roll starts only after this clearance is read back."],
        "move": "takeoff",
    },
    "readback_radar": {
        "phase": "TAKEOFF",
        "speaker": "tower",
        "prompt": "Read back the departure frequency.",
        "expected": "Praha Radar on 120.530, and your callsign.",
        "example": "Contact Praha Radar one two zero decimal five three zero, Oscar Kilo Alfa Bravo Charlie.",
        "elements": [
            E("callsign", "callsign OK-ABC", "callsign", blocks=False),
            E("station:radar", "Praha Radar or departure", "critical", blocks=True),
            E("freq:120.530", "departure frequency 120.530", "critical", blocks=True, safety=True),
        ],
        "negative": "Negative. Contact Praha Radar, one two zero decimal five three zero.",
        "atc": "Oscar Kilo Alfa Bravo Charlie, contact Praha Radar, one two zero decimal five three zero.",
        "notes": [
            "120.530 is the AIP frequency for Praha Radar, departure aircraft (AD 2.18). The moment of the handoff is a training choice."
        ],
    },
}

# What the pilot hears next after a correct transmission, when the aircraft does not have to move first.
NEXT_AFTER_ACCEPT = {
    "request_delivery": "readback_delivery",
    "readback_delivery": "request_ground",
    "request_ground": "readback_startup_pushback",
    "readback_hold": "readback_lineup",
}

# After the animation for this movement finishes, ATC speaks the next instruction.
NEXT_AFTER_MOVE = {
    "pushback": "readback_taxi",
    "taxi": "readback_hold",
    "lineup": "readback_takeoff",
    "takeoff": "readback_radar",
}

POSITION_AFTER_MOVE = {
    "pushback": "apron",
    "taxi": "hold",
    "lineup": "runway",
    "takeoff": "airborne",
}


def _speech(text: str) -> str:
    return (
        text.replace("Ruzyně", "Ruzyne")
        .replace("Alfa", "Alfa")
        .replace("—", ", ")
    )


class DepartureSession:
    def __init__(self) -> None:
        self.id = uuid4().hex[:12]
        self.step = "request_delivery"
        self.position = "stand"
        self.moving: str | None = None
        self.log: list[dict] = []
        self.attempts: list[dict] = []
        self.last_evaluation: dict | None = None
        self.pending_speech: dict | None = None
        self.instruction = ""
        self.completed = False
        self.draw_mode = False
        self.hints_used = 0
        self.drawing = None
        self.drawing_submitted = False
        self.taxi_cleared = False

    def _log_atc(self, speaker: str, text: str, keep_as_instruction: bool) -> None:
        self.log.append({"role": "atc", "speaker": speaker, "text": text})
        if keep_as_instruction:
            self.instruction = text

    def transmit(self, text: str) -> dict:
        if self.completed:
            return self.payload()
        if self.moving:
            self.log.append({"role": "you", "text": text})
            self._log_atc(self._speaker_id(), "Stand by.", keep_as_instruction=False)
            self.pending_speech = {"text": "Stand by.", "speech": "Stand by.", "speaker": self._speaker_id()}
            return self.payload()

        spec = STEPS[self.step]
        result = evaluate_transmission(text, spec["elements"])
        result["expected"] = spec["expected"]
        self.last_evaluation = result
        self.attempts.append(
            {
                "step": self.step,
                "score": result["score"],
                "perfect": result["perfect"],
                "accepted": result["accepted"],
                "safety_critical": result["safety_critical"] and not result["accepted"],
                "missing": len(result["missing"]),
                "parts": result["parts"],
            }
        )
        self.log.append({"role": "you", "text": text})

        if not result["accepted"]:
            self._log_atc(spec["speaker"], spec["negative"], keep_as_instruction=False)
            self.pending_speech = {
                "text": spec["negative"],
                "speech": _speech(spec["negative"]),
                "speaker": spec["speaker"],
            }
            return self.payload(movement=None)

        move = spec.get("move")
        if move == "taxi" and self.draw_mode and not self.drawing_submitted:
            self.taxi_cleared = True
            self.pending_speech = None
            return self.payload(movement=None)
        if move:
            self.moving = move
            self.pending_speech = None
            return self.payload(movement=self._movement(move))

        nxt = NEXT_AFTER_ACCEPT.get(self.step)
        if self.step == "readback_radar" or nxt is None:
            self.completed = True
            self.step = "complete"
            self.pending_speech = None
            return self.payload()

        self.step = nxt
        return self._speak_current()

    def note_hint(self) -> dict:
        """Counting a hint must not change the step or block the aircraft."""
        self.hints_used += 1
        return self.payload()

    def set_draw_mode(self, enabled: bool) -> dict:
        if not self.moving and self.position in {"stand", "apron"}:
            self.draw_mode = bool(enabled)
            if not self.draw_mode:
                self.taxi_cleared = False
        return self.payload()

    def submit_drawing(self, points: list) -> dict:
        self.drawing = evaluate_drawing(points)
        if self.drawing.get("submitted"):
            self.drawing_submitted = True
        movement = None
        if self.taxi_cleared and self.drawing_submitted and not self.moving:
            self.moving = "taxi"
            movement = self._movement("taxi")
        return self.payload(movement=movement)

        nxt = NEXT_AFTER_ACCEPT.get(self.step)
        if nxt == "complete" or nxt is None and self.step == "readback_radar":
            self.completed = True
            self.step = "complete"
            self.pending_speech = None
            return self.payload()
        if self.step == "readback_radar":
            self.completed = True
            self.step = "complete"
            self.pending_speech = None
            return self.payload()

        self.step = nxt
        return self._speak_current()

    def movement_complete(self) -> dict:
        if not self.moving:
            return self.payload()
        finished = self.moving
        self.position = POSITION_AFTER_MOVE[finished]
        self.moving = None
        self.step = NEXT_AFTER_MOVE[finished]
        return self._speak_current()

    def _speak_current(self) -> dict:
        if self.step == "complete":
            self.completed = True
            self.pending_speech = None
            return self.payload()
        spec = STEPS[self.step]
        atc = spec.get("atc")
        if atc:
            self._log_atc(spec["speaker"], atc, keep_as_instruction=True)
            self.pending_speech = {"text": atc, "speech": _speech(atc), "speaker": spec["speaker"]}
        else:
            self.pending_speech = None
        return self.payload()

    def _movement(self, action: str) -> dict:
        path = ROUTE["paths"][action]
        return {
            "action": action,
            "reverse": path["reverse"],
            "coordinates": path["coordinates"],
        }

    def _speaker_id(self) -> str:
        if self.step == "complete":
            return "tower"
        return STEPS[self.step]["speaker"]

    def _score(self) -> dict:
        if not self.attempts:
            return {
                "overall": None,
                "correct": 0,
                "errors": 0,
                "missed": 0,
                "critical": 0,
                "parts": None,
                "hints_used": self.hints_used,
            }
        overall = round(sum(item["score"] for item in self.attempts) / len(self.attempts), 1)
        parts = {}
        for name in ("critical", "callsign", "routing", "completeness"):
            parts[name] = round(sum(item["parts"][name] for item in self.attempts) / len(self.attempts) * 100, 1)
        return {
            "overall": overall,
            "correct": sum(1 for item in self.attempts if item["perfect"]),
            "errors": sum(1 for item in self.attempts if not item["perfect"]),
            "missed": sum(item["missing"] for item in self.attempts),
            "critical": sum(1 for item in self.attempts if item["safety_critical"]),
            "parts": parts,
            "hints_used": self.hints_used,
        }

    def payload(self, movement: dict | None = None) -> dict:
        if self.step == "complete":
            spec = {
                "phase": "TAKEOFF",
                "speaker": "radar",
                "prompt": "Departure exercise complete. Review the training score.",
                "expected": "",
                "example": "",
                "notes": ["Training score only. Not an official aviation assessment."],
            }
        else:
            spec = STEPS[self.step]

        draw_waiting = self.draw_mode and self.taxi_cleared and not self.drawing_submitted and not self.moving
        if self.moving:
            prompt = "Aircraft moving on the cleared path only. Stand by for the next call."
        elif draw_waiting:
            prompt = "Readback accepted. Draw the taxi route from the aircraft to the holding point, then tap Submit. The aircraft follows the cleared route, not a wrong line."
        else:
            prompt = spec["prompt"]

        atc_text = ""
        for entry in reversed(self.log):
            if entry["role"] == "atc":
                atc_text = entry["text"]
                break
        # A corrected readback should show the clearance being flown, not the earlier "Negative".
        if self.last_evaluation and self.last_evaluation.get("accepted") and atc_text.startswith("Negative"):
            atc_text = self.instruction or atc_text

        if self.moving:
            awaiting = "movement"
        elif str(self.step).startswith("request"):
            awaiting = "request"
        elif self.completed:
            awaiting = "complete"
        else:
            awaiting = "readback"

        show_lineup = self.moving in {"lineup", "takeoff"} or self.position in {"runway", "airborne"}
        show_takeoff = self.moving == "takeoff" or self.position == "airborne"

        phase = spec["phase"]
        nav = []
        order = ["RAMP", "TAXI", "TAKEOFF"]
        seen = order.index(phase) if phase in order else 0
        for name in order:
            idx = order.index(name)
            state = "active" if name == phase and not self.completed else "done" if idx < seen or self.completed else "pending"
            if self.completed and name == "TAKEOFF":
                state = "done"
            nav.append({"id": name, "state": state})
        nav.append({"id": "APPROACH", "state": "stub"})
        nav.append({"id": "FINAL", "state": "stub"})

        score = self._score()
        body = {
            "session_id": self.id,
            "scenario": "departure",
            "scenario_status": "available",
            "step": self.step,
            "phase": phase,
            "position": self.position,
            "moving": self.moving,
            "completed": self.completed,
            "speaker": STATIONS[spec["speaker"]],
            "prompt": prompt,
            "awaiting": awaiting,
            "expected": spec["expected"],
            "example": spec["example"],
            "hints_used": self.hints_used,
            "draw_mode": self.draw_mode,
            "draw_tools": bool(self.draw_mode and self.step == "readback_taxi" and not self.moving),
            "draw_waiting": draw_waiting,
            "drawing": self.drawing,
            "notes": spec.get("notes", []),
            "atc_text": atc_text,
            "show_lineup": show_lineup,
            "show_takeoff": show_takeoff,
            "nav": nav,
            "score": score,
            "last_evaluation": self.last_evaluation,
            "log": self.log[-12:],
            "goal": "takeoff" if show_takeoff else "lineup" if show_lineup else "hold",
            "callsign": "OK-ABC",
            "callsign_spoken": "Oscar Kilo Alfa Bravo Charlie",
            "airport": "LKPR",
            "mode": "READBACK TRAINING",
            "movement_locked": bool(self.last_evaluation and self.last_evaluation.get("blocks_progress") and not self.moving and not self.completed),
        }
        body["movement"] = movement
        body["speech"] = self.pending_speech
        self.pending_speech = None
        return body


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, DepartureSession] = {}

    def create(self) -> DepartureSession:
        session = DepartureSession()
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> DepartureSession | None:
        return self._sessions.get(session_id)


def public_route() -> dict:
    """Route payload for the map. Paths included; evaluation logic is not."""
    return {
        "id": ROUTE["id"],
        "description": ROUTE["description"],
        "not_an_official_clearance": True,
        "stand": ROUTE["stand"],
        "runway": ROUTE["runway"],
        "hold": ROUTE["hold"],
        "spoken_taxiways": ROUTE["spoken_taxiways"],
        "unnamed_connector_m": ROUTE["unnamed_connector_m"],
        "unnamed_connector_note": ROUTE["unnamed_connector_note"],
        "geometry_checks": ROUTE["geometry_checks"],
        "initial": ROUTE["initial"],
        "paths": ROUTE["paths"],
        "taxi_segments": ROUTE["taxi_segments"],
    }


def public_sources() -> dict:
    return SOURCES
