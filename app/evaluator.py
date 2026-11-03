"""Readback checker for the LKPR trainer.

Matching is by critical elements, not by the exact sentence. Speech-recognition
variants such as "alpha"/"alfa", "24"/"two four"/"twenty four" and abbreviated
callsigns are accepted.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

PHONETICS = {
    "alfa": "A",
    "bravo": "B",
    "charlie": "C",
    "delta": "D",
    "echo": "E",
    "foxtrot": "F",
    "golf": "G",
    "hotel": "H",
    "india": "I",
    "juliett": "J",
    "kilo": "K",
    "lima": "L",
    "mike": "M",
    "november": "N",
    "oscar": "O",
    "papa": "P",
    "quebec": "Q",
    "romeo": "R",
    "sierra": "S",
    "tango": "T",
    "uniform": "U",
    "victor": "V",
    "whiskey": "W",
    "xray": "X",
    "yankee": "Y",
    "zulu": "Z",
}

DIGIT_WORDS = {
    "zero": "0",
    "oh": "0",
    "niner": "9",
    "nine": "9",
    "one": "1",
    "two": "2",
    "three": "3",
    "tree": "3",
    "four": "4",
    "fower": "4",
    "five": "5",
    "fife": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
}

RUNWAY_PAIRS = {("0", "6"): "06", ("2", "4"): "24", ("1", "2"): "12", ("3", "0"): "30"}
DECIMAL_WORDS = {"decimal", "point", "dot"}
CALLSIGN_PATTERNS = ("OKABC", "OKBC", "OBC")

WEIGHTS = {"critical": 0.40, "callsign": 0.15, "routing": 0.25, "completeness": 0.20}


@dataclass
class Features:
    callsign: bool = False
    runways: set[str] = field(default_factory=set)
    taxiways: set[str] = field(default_factory=set)
    hold_short: bool = False
    lineup: bool = False
    takeoff: bool = False
    startup_approved: bool = False
    pushback_approved: bool = False
    startup_request: bool = False
    pushback_request: bool = False
    request_word: bool = False
    departure_request: bool = False
    qnh: set[str] = field(default_factory=set)
    frequencies: set[float] = field(default_factory=set)
    radar_station: bool = False
    tokens: list[str] = field(default_factory=list)
    text: str = ""


def normalize(text: str) -> str:
    lowered = text.lower().strip()
    for src, dst in (
        ("ě", "e"),
        ("š", "s"),
        ("č", "c"),
        ("ř", "r"),
        ("ž", "z"),
        ("ý", "y"),
        ("á", "a"),
        ("í", "i"),
        ("é", "e"),
        ("ů", "u"),
        ("ú", "u"),
        ("ň", "n"),
        ("ď", "d"),
        ("ť", "t"),
        ("ö", "o"),
    ):
        lowered = lowered.replace(src, dst)
    lowered = lowered.replace("alpha", "alfa").replace("juliette", "juliett").replace("juliet", "juliett")
    lowered = lowered.replace("x-ray", "xray").replace("x ray", "xray")
    lowered = re.sub(r"[^a-z0-9.\s-]", " ", lowered)
    # Keep dots only inside numbers (121.910). A trailing period must not stick to "charlie".
    lowered = re.sub(r"(?<!\d)\.(?!\d)", " ", lowered)
    lowered = lowered.replace("-", " ")
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def _is_digit_token(token: str) -> bool:
    return token in DIGIT_WORDS or token.isdigit()


def _expand_digits(token: str) -> list[str]:
    if token in DIGIT_WORDS:
        return [DIGIT_WORDS[token]]
    if token.isdigit():
        return list(token)
    return []


def _preprocess_twenty(tokens: list[str]) -> list[str]:
    """Speech engines often hear 'two four' as 'twenty four'."""
    out: list[str] = []
    i = 0
    while i < len(tokens):
        if tokens[i] == "twenty" and i + 1 < len(tokens) and tokens[i + 1] in DIGIT_WORDS:
            out.extend(["two", tokens[i + 1]])
            i += 2
            continue
        out.append(tokens[i])
        i += 1
    return out


def _is_single_digit(token: str) -> bool:
    return token in DIGIT_WORDS or (token.isdigit() and len(token) == 1)


def _classify_digits(digits: list[str], nxt: int):
    n = len(digits)
    if n == 2 and tuple(digits) in RUNWAY_PAIRS:
        return ("runway", RUNWAY_PAIRS[tuple(digits)], nxt)
    if n == 3:
        return ("heading", int("".join(digits)), nxt)
    if n == 4:
        return ("qnh", "".join(digits), nxt)
    if n in (5, 6):
        return ("freq", round(float("".join(digits[:3]) + "." + "".join(digits[3:])), 3), nxt)
    if n == 1:
        return ("digit", digits[0], nxt)
    if n == 0:
        return None
    return ("digits", "".join(digits), nxt)


def _parse_cluster(tokens: list[str], index: int, blank: list[bool]):
    if blank[index]:
        return None
    token = tokens[index]
    if re.fullmatch(r"\d+\.\d+", token):
        return ("freq", round(float(token), 3), index + 1)
    # "1013" or "24" is one number. Do not glue it to the next spoken digit.
    if token.isdigit() and len(token) >= 2:
        return _classify_digits(list(token), index + 1)
    if not _is_single_digit(token):
        return None
    digits: list[str] = []
    j = index
    while j < len(tokens) and not blank[j] and _is_single_digit(tokens[j]):
        digits.extend(_expand_digits(tokens[j]))
        j += 1
    if j < len(tokens) and not blank[j] and tokens[j] in DECIMAL_WORDS:
        j += 1
        frac: list[str] = []
        while j < len(tokens) and not blank[j] and _is_single_digit(tokens[j]) and len(frac) < 3:
            frac.extend(_expand_digits(tokens[j]))
            j += 1
        if len(digits) >= 3 and len(frac) >= 2:
            return ("freq", round(float("".join(digits[:3]) + "." + "".join(frac[:3])), 3), j)
    return _classify_digits(digits, j)


def _letter_of(token: str) -> str | None:
    if token in PHONETICS:
        return PHONETICS[token]
    if len(token) == 1 and token.isalpha():
        return token.upper()
    return None


def extract(text: str) -> Features:
    features = Features(text=normalize(text))
    if not features.text:
        return features
    tokens = _preprocess_twenty(features.text.split())
    features.tokens = tokens
    blank = [False] * len(tokens)

    # Compact registration forms: OKABC, OK ABC.
    i = 0
    while i < len(tokens):
        compact = tokens[i].replace(" ", "")
        if compact == "okabc":
            features.callsign = True
            blank[i] = True
        elif tokens[i] == "ok" and i + 1 < len(tokens) and tokens[i + 1] == "abc":
            features.callsign = True
            blank[i] = True
            blank[i + 1] = True
            i += 1
        i += 1

    letters: list[tuple[int, str]] = []
    for idx, token in enumerate(tokens):
        if blank[idx]:
            continue
        letter = _letter_of(token)
        if letter and (token in PHONETICS or len(token) == 1):
            letters.append((idx, letter))

    used_letters: set[int] = set()
    for start in range(len(letters)):
        if letters[start][0] in used_letters:
            continue
        for pattern in CALLSIGN_PATTERNS:
            if start + len(pattern) > len(letters):
                continue
            window = letters[start : start + len(pattern)]
            if "".join(letter for _, letter in window) != pattern:
                continue
            if any(idx in used_letters for idx, _ in window):
                continue
            features.callsign = True
            for idx, _letter in window:
                used_letters.add(idx)
                blank[idx] = True
            break

    # Taxiways from the phonetics that were not part of the callsign.
    i = 0
    while i < len(tokens):
        if blank[i]:
            i += 1
            continue
        token = tokens[i]
        designator = None
        consume = 1
        match = re.fullmatch(r"([a-z])(\d)", token)
        if match:
            designator = match.group(1).upper() + match.group(2)
        else:
            letter = PHONETICS.get(token) or (token.upper() if len(token) == 1 and token.isalpha() else None)
            if letter and (token in PHONETICS or len(token) == 1):
                if i + 1 < len(tokens) and not blank[i + 1] and _is_digit_token(tokens[i + 1]):
                    designator = letter + _expand_digits(tokens[i + 1])[0]
                    consume = 2
                else:
                    designator = letter
        if designator:
            features.taxiways.add(designator)
            for k in range(consume):
                blank[i + k] = True
            i += consume
            continue
        i += 1

    i = 0
    while i < len(tokens):
        if blank[i]:
            i += 1
            continue
        parsed = _parse_cluster(tokens, i, blank)
        if not parsed:
            i += 1
            continue
        kind, value, nxt = parsed
        if kind == "runway":
            features.runways.add(value)
        elif kind == "qnh":
            features.qnh.add(value)
        elif kind == "freq":
            features.frequencies.add(round(float(value), 3))
        i = max(nxt, i + 1)

    raw = features.text
    features.hold_short = re.search(r"\bhold(?:ing)? short\b|\bshort of runway\b", raw) is not None
    features.lineup = re.search(r"\blin(?:e|ing)\s*up\b|\blineup\b", raw) is not None
    negated = re.search(r"\b(?:not|negative)\s+cleared\b", raw) is not None
    takeoff = re.search(r"\bcleared\b(?:\s+\w+){0,4}\s+take\s*off\b", raw) or re.search(
        r"\btake\s*off\b(?:\s+\w+){0,3}\s+cleared\b", raw
    )
    features.takeoff = bool(takeoff) and not negated
    features.startup_approved = re.search(
        r"\bstart\s*up approved\b|\bapproved(?:\s+\w+){0,2}\s+start|\bstart approved\b|\bcleared to start\b",
        raw,
    ) is not None
    features.pushback_approved = re.search(
        r"\bpush\s*back approved\b|\bapproved(?:\s+\w+){0,2}\s+push\s*back\b",
        raw,
    ) is not None
    features.startup_request = ("startup" in tokens) or ("start" in tokens and "up" in tokens) or ("start" in tokens)
    features.pushback_request = ("pushback" in tokens) or ("push" in tokens and "back" in tokens)
    features.request_word = "request" in tokens or "requesting" in tokens
    features.departure_request = "departure" in tokens or "clearance" in tokens or "taxi" in tokens
    features.radar_station = any(word in tokens for word in ("praha", "prague", "radar", "departure"))
    # "start" inside "startup" is already a separate token; the bare word "stand" must not count.
    if features.startup_request and "start" in tokens and "startup" not in tokens and "up" not in tokens:
        # A lone "start" still counts as a startup request ("request start").
        pass
    return features


def _close(freq: float, expected: float) -> bool:
    return abs(freq - expected) <= 0.0025


def _status_for(element_id: str, features: Features) -> str:
    if element_id == "callsign":
        return "ok" if features.callsign else "missing"
    if element_id.startswith("runway:"):
        expected = element_id.split(":", 1)[1]
        if expected in features.runways and features.runways <= {expected}:
            return "ok"
        if features.runways and expected not in features.runways:
            return "incorrect"
        if features.runways and expected in features.runways:
            return "incorrect"
        return "missing"
    if element_id.startswith("taxiway:"):
        expected = element_id.split(":", 1)[1]
        return "ok" if expected in features.taxiways else "missing"
    if element_id == "hold_short":
        return "ok" if features.hold_short else "missing"
    if element_id == "lineup":
        return "ok" if features.lineup else "missing"
    if element_id == "takeoff":
        return "ok" if features.takeoff else "missing"
    if element_id == "forbid_takeoff":
        return "incorrect" if features.takeoff else "ok"
    if element_id == "startup_approved":
        return "ok" if features.startup_approved else "missing"
    if element_id == "pushback_approved":
        return "ok" if features.pushback_approved else "missing"
    if element_id.startswith("qnh:"):
        expected = element_id.split(":", 1)[1]
        if not features.qnh:
            return "missing"
        return "ok" if expected in features.qnh else "incorrect"
    if element_id.startswith("freq:"):
        expected = float(element_id.split(":", 1)[1])
        if not features.frequencies:
            return "missing"
        return "ok" if any(_close(freq, expected) for freq in features.frequencies) else "incorrect"
    if element_id == "intent:delivery":
        ok = features.request_word or features.startup_request or features.departure_request
        return "ok" if ok else "missing"
    if element_id == "intent:ground":
        ok = features.startup_request or features.pushback_request
        return "ok" if ok else "missing"
    if element_id == "station:radar":
        return "ok" if features.radar_station else "missing"
    return "missing"


def _fraction(flags: list[bool]) -> float:
    if not flags:
        return 1.0
    return sum(1.0 for flag in flags if flag) / len(flags)


def evaluate_transmission(text: str, elements: list[dict]) -> dict:
    """Score one pilot transmission against the element list for this step."""
    features = extract(text or "")
    missing: list[str] = []
    incorrect: list[str] = []
    element_results = []
    buckets: dict[str, list[bool]] = {name: [] for name in WEIGHTS}
    blocks = False
    safety = False
    for element in elements:
        status = _status_for(element["id"], features)
        ok = status == "ok"
        buckets[element["bucket"]].append(ok)
        buckets["completeness"].append(ok)
        element_results.append({"id": element["id"], "label": element["label"], "status": status})
        if not ok and element.get("blocks"):
            blocks = True
        if not ok and element.get("safety"):
            safety = True
        if status == "missing":
            missing.append(element["label"])
        elif status == "incorrect":
            incorrect.append(element["label"])

    parts = {name: _fraction(flags) for name, flags in buckets.items()}
    score = round(100 * sum(WEIGHTS[name] * parts[name] for name in WEIGHTS), 1)
    perfect = not missing and not incorrect
    return {
        "said": text or "",
        "accepted": not blocks,
        "perfect": perfect,
        "missing": missing,
        "incorrect": incorrect,
        "blocks_progress": blocks,
        "safety_critical": safety,
        "score": score,
        "parts": {name: round(value, 3) for name, value in parts.items()},
        "elements": element_results,
        "heard": {
            "callsign": features.callsign,
            "runways": sorted(features.runways),
            "taxiways": sorted(features.taxiways),
            "frequencies": sorted(features.frequencies),
            "qnh": sorted(features.qnh),
            "hold_short": features.hold_short,
            "lineup": features.lineup,
            "takeoff": features.takeoff,
        },
    }
