"""PWA shell and the optional transcription endpoint."""

from fastapi.testclient import TestClient

from app.main import app


def test_manifest_and_service_worker():
    client = TestClient(app)
    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    body = manifest.json()
    assert body["name"] == "LKPR Radio Trainer"
    assert body["display"] == "standalone"
    assert body["start_url"] == "/"
    assert body["theme_color"] == "#1b2740"
    assert any(icon["sizes"] == "192x192" for icon in body["icons"])
    assert any(icon["purpose"] == "maskable" for icon in body["icons"])

    worker = client.get("/sw.js")
    assert worker.status_code == 200
    assert "/api/airport" in worker.text
    assert "caches" in worker.text
    assert "lkpr-trainer-v4" in worker.text

    page = client.get("/")
    assert page.status_code == 200
    html = page.text
    assert 'rel="manifest"' in html
    assert "apple-mobile-web-app-capable" in html
    assert "apple-touch-icon" in html
    assert 'id="input-mode"' in html
    assert 'id="tutorial"' in html
    assert 'id="speaker-toggle"' in html
    assert 'id="repeat-atc"' in html
    assert "silent switch" in html
    assert 'id="hint-open"' in html
    assert 'id="draw-mode"' in html
    script = client.get("/static/js/app.js")
    assert script.status_code == 200
    assert "request startup" in script.text
    assert "SpeechRecognition" in script.text
    radio = client.get("/static/js/radio.js")
    assert "decodeAudioData" in radio.text
    assert "8000" in radio.text

    for path in (
        "/static/icons/icon-192.png",
        "/static/icons/icon-512.png",
        "/static/icons/apple-touch-icon.png",
        "/favicon.ico",
    ):
        icon = client.get(path)
        assert icon.status_code == 200, path
        assert icon.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_transcribe_is_optional():
    client = TestClient(app)
    status = client.get("/api/transcribe/status")
    assert status.status_code == 200
    payload = status.json()
    assert "available" in payload
    assert payload["model"] == "base"
    if not payload["available"]:
        refused = client.post("/api/transcribe", files={"audio": ("pilot.m4a", b"not-audio", "audio/mp4")})
        assert refused.status_code == 503
        assert "faster-whisper" in refused.json()["detail"]
