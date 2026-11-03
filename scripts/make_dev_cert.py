#!/usr/bin/env python3
"""Write a self-signed cert so a phone on the same Wi-Fi can use the microphone.

iOS only allows the microphone in a secure context (HTTPS or localhost).
A laptop's LAN address over plain HTTP is not enough. Trusting this cert on
an iPhone is awkward; a hosted HTTPS address is easier for everyday use.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CERT = ROOT / "certs" / "dev-cert.pem"
KEY = ROOT / "certs" / "dev-key.pem"


def main() -> None:
    names = sys.argv[1:] or ["localhost", "127.0.0.1"]
    CERT.parent.mkdir(parents=True, exist_ok=True)
    openssl = shutil.which("openssl")
    if not openssl:
        raise SystemExit(
            "OpenSSL was not found. On Windows, Git for Windows includes openssl.exe. "
            "Add it to PATH, or deploy the app (the host provides HTTPS) instead of this certificate."
        )
    san = ",".join(
        f"IP:{name}" if _is_ip(name) else f"DNS:{name}" for name in names
    )
    subprocess.run(
        [
            openssl, "req", "-x509", "-newkey", "rsa:2048", "-sha256",
            "-keyout", str(KEY), "-out", str(CERT),
            "-days", "825", "-nodes",
            "-subj", "/CN=lkpr-trainer",
            "-addext", f"subjectAltName={san}",
        ],
        check=True,
    )
    print(f"Wrote {CERT}")
    print("Names:", ", ".join(names))


def _is_ip(value: str) -> bool:
    parts = value.split(".")
    return len(parts) == 4 and all(part.isdigit() for part in parts)


if __name__ == "__main__":
    main()
