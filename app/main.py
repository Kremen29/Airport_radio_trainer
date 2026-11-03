"""FastAPI entry point for the LKPR radio trainer.

Run from the project root:

    python -m uvicorn app.main:app --host 127.0.0.1 --port 8741
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.catalog import catalog
from app.scenario import SessionStore, public_route, public_sources
from app.transcribe import status as transcribe_status
from app.transcribe import transcribe_path
from app.tts import synthesize

ROOT = Path(__file__).resolve().parents[1]
GEOJSON = json.loads((ROOT / "data" / "lkpr_aeroway.geojson").read_text(encoding="utf-8"))

app = FastAPI(title="LKPR Radio Trainer", version="0.1.0")
store = SessionStore()
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


class TransmissionIn(BaseModel):
    text: str = Field(default="", max_length=600)


class SpeechIn(BaseModel):
    text: str = Field(default="", max_length=500)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/favicon.ico")
def favicon() -> FileResponse:
    return FileResponse(ROOT / "static" / "icons" / "favicon-32.png", media_type="image/png")


@app.get("/manifest.webmanifest")
def manifest() -> FileResponse:
    return FileResponse(ROOT / "static" / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker() -> FileResponse:
    # Served from the site root so the worker can cache the whole trainer.
    return FileResponse(ROOT / "static" / "sw.js", media_type="application/javascript")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "lkpr-radio-trainer"}


@app.get("/api/airport")
def airport() -> dict:
    return {
        "geojson": GEOJSON,
        "route": public_route(),
        "sources": public_sources(),
        "catalog": catalog(),
    }


@app.post("/api/session")
def create_session() -> dict:
    return store.create().payload()


@app.get("/api/session/{session_id}")
def read_session(session_id: str) -> dict:
    session = store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.payload()


@app.post("/api/session/{session_id}/transmission")
def transmission(session_id: str, body: TransmissionIn) -> dict:
    session = store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.transmit(body.text)


@app.post("/api/session/{session_id}/arrived")
def arrived(session_id: str) -> dict:
    session = store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.movement_complete()


@app.get("/api/transcribe/status")
def transcribe_info() -> dict:
    return transcribe_status()


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    """Turn a PTT recording into text. 503 when faster-whisper is not installed."""
    info = transcribe_status()
    if not info["available"]:
        raise HTTPException(status_code=503, detail=info["reason"])
    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty recording.")
    if len(raw) > 8_000_000:
        raise HTTPException(status_code=413, detail="Recording is too long.")
    suffix = _audio_suffix(audio.filename or "", audio.content_type or "")
    path = Path(tempfile.mkstemp(suffix=suffix)[1])
    try:
        path.write_bytes(raw)
        text = transcribe_path(path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc.__class__.__name__}") from exc
    finally:
        path.unlink(missing_ok=True)
    return {"text": text}


def _audio_suffix(filename: str, content_type: str) -> str:
    lower = filename.lower()
    for ext in (".m4a", ".mp4", ".aac", ".webm", ".wav", ".ogg", ".mp3"):
        if lower.endswith(ext):
            return ext
    if "mp4" in content_type or "aac" in content_type or "m4a" in content_type:
        return ".m4a"
    if "wav" in content_type:
        return ".wav"
    if "ogg" in content_type:
        return ".ogg"
    return ".webm"


@app.post("/api/tts")
def tts(body: SpeechIn) -> Response:
    """WAV for the Web Audio radio chain. 503 lets the browser speak instead."""
    audio = synthesize(body.text)
    if not audio:
        raise HTTPException(status_code=503, detail="Local TTS is not available. Use browser speech.")
    return Response(content=audio, media_type="audio/wav")
