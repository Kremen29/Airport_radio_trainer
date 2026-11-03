# LKPR Radio Trainer

A training simulator for radio communication when departing from Prague/Ruzyně airport (LKPR / Václav Havel Airport). You see the airport drawn from OpenStreetMap data, hear ATC instructions in English phraseology, and reply by microphone or keyboard. The aircraft moves only after a correct readback. It must not enter the runway on a mere taxi clearance, and it must not start the takeoff roll after a "line up and wait" instruction.

**Live app:** [https://lkpr-radio-trainer.onrender.com](https://lkpr-radio-trainer.onrender.com) — on iPhone or iPad, open it in Safari and use Share, Add to Home Screen (see [Mobile and PWA](#mobile-and-pwa-iphone-ipad-safari)).

This program is for practice only. It is not an operational aid and does not replace the AIP, charts, or training with an instructor.

The app interface is in English.

## What is verified and what is only training

Verified from the Czech AIP (eAIP LKPR, downloaded 2026-11-03 from [aim.rlp.cz](https://aim.rlp.cz/eaip/html/eAIP/LK-AD-2.LKPR-en-GB.html)):

- Runways 06/24 (3715 × 45 m) and 12/30 (3250 × 45 m).
- The preferred runway order starts with runway 24 (AD 2.21).
- Callsigns and frequencies: Ruzyně Delivery 120.060, Ruzyně Ground 121.910, Ruzyně Tower 134.560, Praha Radar for departures 120.530, ATIS 122.160.
- The taxiway names A1 and Z used by the scenario are in the AIP. The AIP mentions holding for runway 24 on TWY Z.

Simulated, marked as training both in the app and here:

- QNH 1013 hPa is the standard pressure for the exercise, not live ATIS or METAR.
- There is no SID, route, squawk, or initial level. Those depend on the specific flight and are not made up.
- The callsign OK-ABC is fictitious.
- The instruction "taxi via Alfa one and Zulu" follows one path in the OSM taxiway graph. It is not a published standard route.
- Between A1 and Z, OSM has about 67 m of unnamed taxiway. The app does not invent a designator for it.
- The aircraft symbol moves faster than real life so the exercise does not take as long as real taxiing.

Details are in the app under the Sources button and in the file `data/sources.json`. Check the current AIP before any real flight. Data changes.

Map: © OpenStreetMap contributors, ODbL licence. This is not the official aerodrome chart AD 2-LKPR-2-1.

## Installation on Windows (PowerShell, Python 3.13)

Open PowerShell in the project folder. If Windows says running scripts is disabled, the `Set-ExecutionPolicy` command below applies only to this window and does not change system settings.

```powershell
cd C:\path\to\this\project
py -3.13 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8741
```

If the `py -3.13` command is not available, create the environment like this:

```powershell
python -m venv .venv
```

Then run the activation and installation the same way as above.

To permanently allow local scripts for your account, if you want to (not needed for a one-off run):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

The script `Start-LKPR-Trainer.ps1` does the same startup:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\Start-LKPR-Trainer.ps1
```

Open [http://127.0.0.1:8741](http://127.0.0.1:8741) in your browser.

Leave the server running. Stop it with Ctrl+C in the PowerShell window.

## Microphone

1. On a computer, use Chrome or Edge. Speech recognition uses the Web Speech API and works on `http://127.0.0.1`. Firefox has no reliable voice input; type into the Typed transmission field.
2. iPhone and iPad are covered in the Mobile section. The Web Speech API in Safari is unreliable and sends audio to Apple servers. The app can therefore send a recording to your Python server and transcribe it with the optional faster-whisper.
3. Allow the microphone for this page next to the address bar.
4. On Windows, open Settings, Privacy & security, Microphone. Allow microphone access and access for the browser.
5. Hold the Push to talk button, or hold the space bar, speak in English, and release. The sentence is sent when you release.
6. If the browser cannot get the microphone, type your reply into the field and press Send. This is always the last fallback.

Scoring does not look for a word-for-word sentence. It recognises the callsign in abbreviated form too (Oscar Bravo Charlie, OK-ABC), the runway as "two four", "24" or "twenty four", and both "alpha" and "alfa". If a safety element is missing, ATC says "Negative…" and the aircraft stays put until you correct the readback. The panel shows what you said, what was expected, and what was missing.

## ATC voice and radio

The voice is free and local:

- The browser (`speechSynthesis`), always available with no sign-up.
- If pyttsx3 is installed on the computer, Windows uses the system SAPI voice and the page plays it through Web Audio: a band-pass filter, light noise, and a squelch click at the start and end. On Linux, espeak-ng is used.

The frequencies on the station label come from the AIP. The QNH in the Delivery transmission is for training.

## Departure exercise

1. You call Ruzyně Delivery and request startup.
2. You read back the runway 24, QNH, and the Ground frequency.
3. You call Ruzyně Ground and request startup and pushback.
4. You read back both. Only then does the aircraft push back from stand 3.
5. You read back the taxi via Alfa 1 and Zulu and "hold short" of runway 24. A wrong runway keeps the aircraft in place.
6. At the holding point, you read back hold short and the Tower frequency.
7. You read back "line up and wait". "Cleared for takeoff" at this step is an error and will not let you onto the runway.
8. Once you are lined up on the runway, a separate takeoff clearance follows. Without it, the takeoff roll does not start.
9. You read back the handover to Praha Radar 120.530 and see your score.

Arrival and Random practice are prepared in the navigation as further scenarios and are not playable in this version.

The score is a training proposal (40% critical instructions, 15% callsign, 25% runway and route, 20% completeness), not an official exam.

## Tests

```powershell
.\.venv\Scripts\Activate.ps1
python -m pytest
```

## Troubleshooting

- `py` or `python` does nothing: install Python 3.13 from python.org and tick Add python.exe to PATH during installation. Then open a new PowerShell window.
- Red text about ExecutionPolicy: use `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` and run the `.venv` activation again.
- The browser says the page cannot be reached: the server must be running in the uvicorn window. On the computer the address is `http://127.0.0.1:8741`. For a phone on Wi-Fi, use the `https://` address from the Mobile section.
- Port 8741 is taken: stop the other copy, or run `python -m uvicorn app.main:app --host 127.0.0.1 --port 8742` and open that address.
- The microphone is silent: check the lock in the address bar, the Windows system permission, and use Chrome or Edge. Type your replies in the meantime.
- ATC is silent: the Skip voice button skips speech, and typing works even while speech plays. On Windows, pyttsx3 needs a voice in Settings, Time & language, Speech. Without it, the browser voice speaks and the radio adds noise and squelch.
- The map is empty: reload the page. The data is in `data/lkpr_aeroway.geojson` and is not meant to be downloaded on every start.
- Tests: `python -m pytest` in the project folder with `.venv` active.

## Mobile and PWA (iPhone, iPad, Safari)

The layout is the same app. In portrait, the map is at the top and the radio at the bottom; the Push to talk button is large and sits within thumb reach. In landscape, the map is next to the radio. iPad keeps the map next to the panel like a computer, with a larger button.

Add to Home Screen:

1. Open the trainer's address in Safari (for example [https://lkpr-radio-trainer.onrender.com](https://lkpr-radio-trainer.onrender.com)).
2. Share, Add to Home Screen.
3. The LKPR Radio icon opens the app without the Safari toolbar. The manifest, theme colour, and apple-touch-icon are in the project.

The first tap unlocks audio (otherwise iOS will not play speech or radio). The ATC voice, which comes as WAV from the server, then plays through Web Audio with the filter. The fallback browser voice (`speechSynthesis`) is often played by iOS only directly on a tap, not after the server responds. On iPhone, therefore, count on the voice from the server (pyttsx3 / espeak in Docker).

Voice input option:

- Auto: Chrome and Edge use the Web Speech API. iPhone records and the server transcribes when faster-whisper is installed. Otherwise typing remains.
- Browser speech: Web Speech API. Unreliable on iPhone.
- Record and transcribe: MediaRecorder. iOS sends mp4/aac, Chrome webm. The server transcribes with faster-whisper (base model, CPU).
- Typing only: keyboard only.

### HTTPS, because iOS will not allow the microphone otherwise

`http://127.0.0.1` is secure only on the same device. `http://192.168…` from an iPhone does not get the microphone.

On the same Wi-Fi, from PowerShell in the project folder (you need openssl, which comes with Git for Windows):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\Start-LKPR-HTTPS.ps1
```

The script prints the address `https://<computer-ip>:8741`. Allow port 8741 in Windows Firewall for the private network.

iPhone does not trust a self-signed certificate on its own. Safari shows a warning. Trust is enabled in Settings, General, About, Certificate Trust Settings, only once the certificate is in a device profile. This is inconvenient, and after an IP change the certificate has to be made again. Away from home, the deployment below is simpler, since it has HTTPS from the provider.

Optional transcription on your own computer:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-whisper.txt
```

It also needs ffmpeg in PATH (on Windows, for example `winget install Gyan.FFmpeg`). The `base` model takes about 1 GB of RAM, the `small` model about 2 GB. Without this package, transcription returns an error and typing still works. The `WHISPER_MODEL` variable can be `tiny`, `base`, or `small`.

### Tutorial and audio on iPhone

On the first visit, a short tutorial in English starts. The Start button also unlocks audio: iOS plays ATC only after a tap. The tutorial can be reopened with the Tutorial button. Next, Back, and Skip are at the bottom of the screen so the panel does not overflow on iPhone.

Every ATC transmission is read aloud and also shown as text. The Repeat button repeats it, Speaker on/off mutes it. If the server does not deliver the voice within eight seconds, the browser voice speaks. On iPhone, the side silent-mode switch mutes the sound: turn the volume up and switch silent mode off.

Auto on iPhone first tries Safari recognition. The words appear in the field, you check them, and tap Send. If Safari does not allow the microphone and faster-whisper is on the server, the next press records. On Render without whisper, typing remains. On a computer, the sentence is sent automatically when you release the button, as before.

### What works offline and what needs the server or internet

After one successful load, the page stores its look, scripts, and map data (`/api/airport`) in the service worker. Without a network, the diagram can be shown again.

Without your server, the following does not work:

- the next scenario step, scoring, and movement based on the readback (the logic is in Python),
- faster-whisper transcription of recordings,
- the WAV ATC voice (pyttsx3 / espeak). The fallback is the browser voice, unreliable on iPhone.

Additionally needs the internet:

- the Web Speech API in Safari sends audio to Apple servers,
- the Web Speech API in Chrome may use Google,
- the first download of the faster-whisper model,
- a deployed version outside your computer.

Typing replies, the cached map, and the aircraft arrow (while a scenario is running) need no paid service. The scenario itself, however, needs Python running.

## Deployment outside home Wi-Fi

I do not create accounts or deployments for you. The `Dockerfile` and `fly.toml` files are ready. The image listens on the port from the `PORT` variable (default 7860) and includes espeak-ng and ffmpeg. faster-whisper is not in the image unless you change `ARG INSTALL_WHISPER=0` to `1` in the Dockerfile.

Recommendation: Hugging Face Spaces, Docker SDK, CPU basic hardware (free, roughly 16 GB RAM, HTTPS out of the box). On 512 MB RAM (free Render, small Fly) do not run faster-whisper. iPhone would only have typing and the unreliable Web Speech API there.

### Hugging Face Spaces

1. An account on huggingface.co, New Space, Docker SDK, CPU basic hardware, public or private Space.
2. Upload the `app`, `static`, `data` folders and the `Dockerfile`, `requirements.txt`, `requirements-whisper.txt` files to the Space.
3. If you want transcription from iPhone, set `ARG INSTALL_WHISPER=1` in the Dockerfile and keep CPU basic hardware. The build downloads PyTorch and the model is fetched on the first recording (hundreds of MB; the first sentence takes longer).
4. The Space gets the address `https://<name>.hf.space`. Open it in Safari and add it to the Home Screen.
5. The Space sleeps after inactivity. The first visit wakes it up.

### Render

1. New Web Service, Docker environment, root with this Dockerfile.
2. Render sets `PORT` and HTTPS itself.
3. Keep `INSTALL_WHISPER=0`. The free instance has 512 MB and the model does not fit. The ATC voice runs via espeak in the image. On iPhone, type, or try Browser speech knowing that Safari is unreliable.
4. Health check: `/api/health`.

### Fly.io

1. Install `flyctl`, and in the project folder run `fly launch` (the `fly.toml` file already has internal port 7860 and HTTPS).
2. `fly deploy`.
3. Transcription: in `fly.toml` change `INSTALL_WHISPER` to `"1"` and `memory` to `"2048mb"`, then deploy again. Two gigabytes are no longer within the small free allowance. The `fra` region is close.

When the machine is asleep, the first request starts it. Check prices and limits on the provider's page; they change.

## Folders

- `app/` — FastAPI, departure scenario, readback scoring, local TTS, optional transcription
- `static/` — map, radio, manifest and service worker
- `data/` — airport GeoJSON, route from stand 3, and sources
- `scripts/build_lkpr_data.py` — rebuilds the map from an OSM extract
- `scripts/make_dev_cert.py` — training HTTPS certificate for a phone on Wi-Fi
- `Dockerfile`, `fly.toml` — deployment preparation, they do not run on their own
- `tests/` — scoring, the full departure via typed input, manifest and service worker
