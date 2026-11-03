"""Local text-to-speech for the radio effect.

The browser can always speak with speechSynthesis. When this module can
produce a WAV, the page plays that buffer through a Web Audio band-pass
so the voice itself is filtered. pyttsx3 uses Windows SAPI on Windows and
espeak on other systems. espeak-ng on PATH is the fallback. No paid API.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

_lock = threading.Lock()


def synthesize(text: str) -> bytes | None:
    spoken = " ".join(text.split())
    if not spoken:
        return None
    if len(spoken) > 500:
        spoken = spoken[:500]
    with _lock:
        wav = _pyttsx3(spoken)
        if wav:
            return wav
        return _espeak(spoken)


def _pyttsx3(text: str) -> bytes | None:
    try:
        import pyttsx3
    except Exception:
        return None
    path = Path(tempfile.mkstemp(suffix=".wav")[1])
    try:
        engine = pyttsx3.init()
        engine.setProperty("rate", 165)
        engine.save_to_file(text, str(path))
        engine.runAndWait()
        # pyttsx3 can leave the engine unusable for a second call in-process.
        try:
            engine.stop()
        except Exception:
            pass
        data = path.read_bytes() if path.exists() else b""
        if len(data) < 1000:
            return None
        return data
    except Exception:
        return None
    finally:
        path.unlink(missing_ok=True)


def _espeak(text: str) -> bytes | None:
    binary = shutil.which("espeak-ng") or shutil.which("espeak")
    if not binary:
        return None
    path = Path(tempfile.mkstemp(suffix=".wav")[1])
    try:
        subprocess.run(
            [binary, "-v", "en", "-s", "150", "-w", str(path), text],
            check=True,
            capture_output=True,
            timeout=20,
        )
        data = path.read_bytes()
        if len(data) < 1000:
            return None
        return data
    except Exception:
        return None
    finally:
        path.unlink(missing_ok=True)
