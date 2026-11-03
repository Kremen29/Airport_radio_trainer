"""Optional on-server speech-to-text for iPhone Safari.

iOS Safari's Web Speech API is unreliable and needs Apple's servers.
The page can record audio (mp4/aac on iOS, webm elsewhere) and post it here.
faster-whisper is not installed by default. See requirements-whisper.txt.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

_lock = threading.Lock()
_model = None


def status() -> dict:
    model_name = os.environ.get("WHISPER_MODEL", "base")
    try:
        import faster_whisper  # noqa: F401
    except Exception as exc:
        return {
            "available": False,
            "model": model_name,
            "reason": "faster-whisper is not installed. Typing still works. See requirements-whisper.txt.",
            "detail": exc.__class__.__name__,
        }
    return {"available": True, "model": model_name, "device": "cpu", "compute_type": os.environ.get("WHISPER_COMPUTE", "int8")}


def transcribe_path(path: Path) -> str:
    model = _load()
    segments, _info = model.transcribe(
        str(path),
        language="en",
        vad_filter=False,
        beam_size=1,
    )
    return " ".join(segment.text.strip() for segment in segments).strip()


def _load():
    global _model
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel

            _model = WhisperModel(
                os.environ.get("WHISPER_MODEL", "base"),
                device="cpu",
                compute_type=os.environ.get("WHISPER_COMPUTE", "int8"),
            )
        return _model
