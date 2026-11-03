"""Scenario catalog. Only departure runs. Arrival and random practice are stubs."""

ARRIVAL_PHASES = [
    {"id": "initial", "nav": "APPROACH", "pilot": "Initial contact with Praha Radar on the arrival frequency.", "atc": "Descent and heading instructions."},
    {"id": "final", "nav": "FINAL", "pilot": "Established on final.", "atc": "Continue approach, then a separate landing clearance."},
    {"id": "landing", "nav": "FINAL", "pilot": "Read back the landing clearance.", "atc": "Runway, cleared to land — not combined with an earlier instruction."},
    {"id": "vacate", "nav": "TAXI", "pilot": "Vacate and report.", "atc": "Taxi to stand on a verified route. Not built in this version."},
]

RANDOM_POOL = {
    "status": "stub",
    "generates": ["heading", "altitude", "runway", "frequency", "callsign"],
    "note": "Short random readback drills are a later exercise. The evaluator already understands headings, altitudes are not scored in the departure scenario, and runways, frequencies and callsigns are.",
}


def catalog() -> dict:
    return {
        "scenarios": [
            {
                "id": "departure",
                "title": "Departure from Prague",
                "status": "available",
                "summary": "Stand 3 to runway 24 via taxiways A1 and Z. Delivery, Ground, Tower, then Praha Radar.",
            },
            {
                "id": "arrival",
                "title": "Arrival at Prague",
                "status": "stub",
                "summary": "Not implemented. The phase list is reserved so the same session model can host it.",
                "phases": ARRIVAL_PHASES,
            },
            {
                "id": "random",
                "title": "Random ATC practice",
                "status": "stub",
                "summary": "Not implemented. Reserved for short drills built from the same element checker.",
                "pool": RANDOM_POOL,
            },
        ]
    }
