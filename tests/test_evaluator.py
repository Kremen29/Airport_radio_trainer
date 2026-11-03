"""Element-level readback checks, including speech-recognition variants."""

from app.evaluator import evaluate_transmission, extract

CALLSIGN = {"id": "callsign", "label": "callsign OK-ABC", "bucket": "callsign", "blocks": False, "safety": False}
RUNWAY = {"id": "runway:24", "label": "runway 24", "bucket": "routing", "blocks": True, "safety": True}
HOLD = {"id": "hold_short", "label": "hold short", "bucket": "critical", "blocks": True, "safety": True}
A1 = {"id": "taxiway:A1", "label": "taxiway Alfa 1", "bucket": "routing", "blocks": True, "safety": True}
ZULU = {"id": "taxiway:Z", "label": "taxiway Zulu", "bucket": "routing", "blocks": True, "safety": True}
LINEUP = {"id": "lineup", "label": "line up and wait", "bucket": "critical", "blocks": True, "safety": True}
NO_TAKEOFF = {
    "id": "forbid_takeoff",
    "label": "no takeoff clearance on this transmission",
    "bucket": "critical",
    "blocks": True,
    "safety": True,
}
TAKEOFF = {"id": "takeoff", "label": "cleared for takeoff", "bucket": "critical", "blocks": True, "safety": True}
QNH = {"id": "qnh:1013", "label": "QNH 1013", "bucket": "critical", "blocks": True, "safety": True}
GROUND_FREQ = {"id": "freq:121.910", "label": "Ground frequency 121.910", "bucket": "critical", "blocks": True, "safety": True}


def test_callsign_variants():
    samples = [
        "Oscar Kilo Alfa Bravo Charlie",
        "Oscar Kilo Alpha Bravo Charlie",
        "OK-ABC",
        "okabc",
        "OK ABC",
        "Oscar Kilo Bravo Charlie",
        "Oscar Bravo Charlie",
        "o k a b c",
    ]
    for sample in samples:
        assert extract(sample).callsign, sample


def test_callsign_too_short():
    assert not extract("Bravo Charlie").callsign
    assert not extract("Alfa Bravo Charlie").callsign


def test_runway_speech_variants():
    for sample in ("runway two four", "runway 24", "runway twenty four", "RWY 24"):
        assert extract(sample).runways == {"24"}, sample
    assert extract("runway zero six").runways == {"06"}
    assert "24" not in extract("heading two four zero").runways


def test_taxiway_alpha_and_callsign_together():
    features = extract(
        "taxi via alpha 1 and zulu, holding short of runway 24, Oscar Kilo Alfa Bravo Charlie"
    )
    assert "A1" in features.taxiways
    assert "Z" in features.taxiways
    assert features.callsign
    assert features.hold_short
    assert features.runways == {"24"}


def test_hold_short_blocks_when_missing_and_passes_on_variant():
    elements = [CALLSIGN, A1, ZULU, HOLD, RUNWAY]
    bad = evaluate_transmission(
        "taxi via alfa one and zulu, runway two four, Oscar Kilo Alfa Bravo Charlie",
        elements,
    )
    assert not bad["accepted"]
    assert bad["safety_critical"]
    assert "hold short" in bad["missing"]

    good = evaluate_transmission(
        "taxi via alfa one and zulu, holding short of runway two four, oscar bravo charlie",
        elements,
    )
    assert good["accepted"]
    assert good["perfect"]
    assert good["score"] == 100


def test_wrong_runway_is_critical():
    result = evaluate_transmission(
        "holding short of runway zero six, via alfa one and zulu, Oscar Kilo Alfa Bravo Charlie",
        [CALLSIGN, A1, ZULU, HOLD, RUNWAY],
    )
    assert not result["accepted"]
    assert result["safety_critical"]
    assert "runway 24" in result["incorrect"]


def test_lineup_is_not_takeoff():
    elements = [CALLSIGN, LINEUP, NO_TAKEOFF, RUNWAY]
    jumped = evaluate_transmission(
        "runway two four, cleared for takeoff, Oscar Kilo Alfa Bravo Charlie",
        elements,
    )
    assert not jumped["accepted"]
    assert jumped["safety_critical"]
    assert any("takeoff" in item for item in jumped["incorrect"])

    correct = evaluate_transmission(
        "runway 24, lining up and waiting, OK-ABC",
        elements,
    )
    assert correct["accepted"]
    assert correct["perfect"]


def test_takeoff_requires_the_clearance_word():
    elements = [CALLSIGN, TAKEOFF, RUNWAY]
    only_lineup = evaluate_transmission("runway two four, line up and wait, OKABC", elements)
    assert not only_lineup["accepted"]
    assert "cleared for takeoff" in only_lineup["missing"]

    good = evaluate_transmission("cleared for takeoff runway two four, oscar kilo bravo charlie", elements)
    assert good["accepted"]
    assert good["perfect"]


def test_qnh_and_frequency_variants():
    elements = [CALLSIGN, RUNWAY, QNH, GROUND_FREQ]
    said = (
        "runway 24, QNH one zero one three, contact ground one two one decimal nine one, "
        "Oscar Kilo Alpha Bravo Charlie"
    )
    result = evaluate_transmission(said, elements)
    assert result["accepted"], result
    assert result["perfect"]

    wrong = evaluate_transmission(
        "runway 24, QNH 1012, one two one decimal nine two zero, OK-ABC",
        elements,
    )
    assert not wrong["accepted"]
    assert "QNH 1013" in wrong["incorrect"]
    assert "Ground frequency 121.910" in wrong["incorrect"]
