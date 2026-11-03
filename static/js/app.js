/* Departure trainer UI. The server owns the scenario; this page draws and speaks. */

const map = new AirportMap(document.getElementById("airport"));
const radio = new Radio();

const ui = {
  nav: document.getElementById("phase-nav"),
  speaker: document.getElementById("speaker-name"),
  awaiting: document.getElementById("awaiting-label"),
  freq: document.getElementById("speaker-freq"),
  atc: document.getElementById("atc-text"),
  notes: document.getElementById("notes"),
  prompt: document.getElementById("prompt"),
  said: document.getElementById("said"),
  expected: document.getElementById("expected"),
  gap: document.getElementById("gap"),
  score: document.getElementById("info-score"),
  banner: document.getElementById("banner"),
  ptt: document.getElementById("ptt"),
  typed: document.getElementById("typed"),
  example: document.getElementById("example"),
  result: document.getElementById("result"),
  support: document.getElementById("speech-support"),
  radioMode: document.getElementById("radio-mode"),
  status: document.getElementById("map-status"),
  follow: document.getElementById("follow"),
};

const session = {
  id: null,
  speed: 1,
  airport: null,
  view: null,
  animating: false,
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const inputSelect = document.getElementById("input-mode");
let recognition = null;
let listenBuffer = "";
let holding = false;
let recorder = null;
let recordStream = null;
let recordChunks = [];
let serverWhisper = false;

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function chosenMode() {
  return inputSelect.value || "auto";
}

function effectiveMode() {
  const choice = chosenMode();
  if (choice === "typed") return "typed";
  if (choice === "browser") return SpeechRecognition ? "browser" : "typed";
  if (choice === "server") return serverWhisper ? "server" : "typed";
  if (isIOS()) return serverWhisper ? "server" : "typed";
  if (SpeechRecognition && window.isSecureContext) return "browser";
  if (serverWhisper && navigator.mediaDevices) return "server";
  return "typed";
}

function supportLine() {
  const mode = effectiveMode();
  const secure = window.isSecureContext;
  ui.ptt.disabled = mode === "typed";
  if (!secure && mode !== "browser") {
    ui.support.textContent = "The microphone on an iPhone needs HTTPS, not a plain http:// address of another computer. Typing works on this page. Auto uses browser speech on Chrome and Edge, and recording plus the server on iPhone when faster-whisper is installed.";
  } else if (mode === "browser") {
    ui.support.textContent = "Push to talk uses the browser Web Speech API. Hold the button or the space bar. On iPhone this API is unreliable, so Auto switches to Record and transcribe when the server can hear you.";
  } else if (mode === "server") {
    ui.support.textContent = "Push to talk records in the browser and the trainer transcribes it on the server. iPhone sends an mp4/aac file. No paid speech API.";
  } else if (isIOS() && !serverWhisper) {
    ui.support.textContent = "Safari on iPhone and iPad has no reliable on-device recognition here, and server transcription is not installed. Type the transmission, or install optional faster-whisper and choose Record and transcribe.";
  } else {
    ui.support.textContent = "Voice recognition is off for this browser. Type what you would say and press Send.";
  }
  ui.ptt.querySelector(".ptt-kicker").textContent = mode === "server" ? "Hold to record" : "Hold";
}

async function boot() {
  inputSelect.value = localStorage.getItem("lkpr-input") || "auto";
  try {
    const info = await fetch("/api/transcribe/status").then((response) => response.json());
    serverWhisper = Boolean(info.available);
  } catch (err) {
    serverWhisper = false;
  }
  supportLine();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  try {
    const airport = await fetch("/api/airport").then((response) => {
      if (!response.ok) throw new Error("Airport data failed");
      return response.json();
    });
    session.airport = airport;
    map.load(airport);
    ui.status.hidden = true;
    fillSources(airport.sources);
    const created = await fetch("/api/session", { method: "POST" }).then((response) => response.json());
    apply(created, false);
  } catch (err) {
    ui.status.hidden = false;
    ui.status.textContent = session.airport
      ? "The map is on this device, but scoring needs the trainer server."
      : "The airport diagram did not load. Is the trainer server running? Open it once online so the map can be kept for offline use.";
  }
}

function apply(view, speak) {
  session.view = view;
  session.id = view.session_id;
  render(view);
  map.showLineup = view.show_lineup;
  map.showTakeoff = view.show_takeoff;
  map.goal = view.goal;
  if (view.movement && !session.animating) {
    session.animating = true;
    map.play(view.movement, session.speed, async () => {
      session.animating = false;
      const next = await fetch(`/api/session/${session.id}/arrived`, { method: "POST" }).then((response) => response.json());
      apply(next, true);
    });
  } else if (!view.movement) {
    map.snap(view.position);
    if (speak && view.speech && view.speech.speech) {
      radio.speak(view.speech.speech).then(showRadioMode);
    }
  }
}

function render(view) {
  ui.speaker.textContent = view.speaker.label;
  const verified = view.speaker.verified ? "AIP frequency" : "Training value";
  ui.freq.textContent = view.speaker.frequency ? `${view.speaker.frequency} MHz · ${verified}` : "";
  const awaiting = {
    request: "Your call",
    readback: "Read back",
    movement: "Aircraft moving",
    complete: "Exercise complete",
  }[view.awaiting] || "Radio";
  ui.awaiting.textContent = awaiting;
  ui.atc.textContent = view.atc_text || "The frequency is quiet. Make the call when you are ready.";
  ui.prompt.textContent = view.prompt || "";
  ui.notes.innerHTML = "";
  (view.notes || []).forEach((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    if (/simulated|training|not a published|not live|does not invent/i.test(note)) item.className = "simulated";
    ui.notes.appendChild(item);
  });
  ui.expected.textContent = view.expected || "—";
  const evaluation = view.last_evaluation;
  if (evaluation) {
    ui.said.textContent = evaluation.said || "—";
    const gaps = [...evaluation.missing, ...evaluation.incorrect];
    ui.gap.textContent = gaps.length ? gaps.join("; ") : "Nothing missing.";
    ui.gap.className = gaps.length ? "bad" : "ok";
  }
  const score = view.score.overall === null ? "–" : `${Math.round(view.score.overall)}%`;
  ui.score.textContent = score;
  ui.banner.hidden = !view.movement_locked;
  ui.banner.textContent = view.movement_locked
    ? "Movement held. ATC said “Negative”. Correct the missing item before the aircraft moves."
    : "";
  ui.nav.innerHTML = "";
  view.nav.forEach((phase) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = phase.id;
    button.className = phase.state;
    if (phase.state === "active") button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => openPhase(phase));
    ui.nav.appendChild(button);
  });
  ui.example.hidden = true;
  ui.example.textContent = view.example || "";
  document.getElementById("hint").textContent = "Show example";
  renderResult(view);
  document.querySelector(".comms").classList.toggle("tx-you", false);
}

function renderResult(view) {
  if (!view.completed) {
    ui.result.hidden = true;
    return;
  }
  const score = view.score;
  ui.result.hidden = false;
  const parts = score.parts || {};
  ui.result.innerHTML = `
    <h3>Training score ${score.overall}%</h3>
    <p>Weights are a training design: critical instructions 40, callsign 15, runway and routing 25, completeness 20. Not an official assessment.</p>
    <dl>
      <dt>Correct responses</dt><dd>${score.correct}</dd>
      <dt>Errors</dt><dd>${score.errors}</dd>
      <dt>Missed elements</dt><dd>${score.missed}</dd>
      <dt>Critical mistakes</dt><dd>${score.critical}</dd>
      <dt>Critical instructions</dt><dd>${parts.critical}%</dd>
      <dt>Callsign</dt><dd>${parts.callsign}%</dd>
      <dt>Runway and routing</dt><dd>${parts.routing}%</dd>
      <dt>Completeness</dt><dd>${parts.completeness}%</dd>
    </dl>`;
}

async function sendText(text) {
  const trimmed = (text || "").trim();
  if (!trimmed || !session.id || session.animating) return;
  ui.typed.value = "";
  const response = await fetch(`/api/session/${session.id}/transmission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: trimmed }),
  });
  if (!response.ok) {
    ui.banner.hidden = false;
    ui.banner.textContent = "The trainer could not score that transmission.";
    return;
  }
  apply(await response.json(), true);
}

function openPhase(phase) {
  if (phase.state !== "stub" || !session.airport) return;
  const catalog = session.airport.catalog.scenarios;
  const scenario = phase.id === "APPROACH" || phase.id === "FINAL"
    ? catalog.find((item) => item.id === "arrival")
    : catalog.find((item) => item.id === "random");
  document.getElementById("stub-title").textContent = scenario.title;
  const body = document.getElementById("stub-body");
  body.innerHTML = `<p>${scenario.summary}</p>`;
  if (scenario.phases) {
    const list = document.createElement("ol");
    scenario.phases.forEach((item) => {
      const line = document.createElement("li");
      line.textContent = `${item.nav}: ${item.atc}`;
      list.appendChild(line);
    });
    body.appendChild(list);
  }
  document.getElementById("stub-dialog").showModal();
}

function fillSources(sources) {
  const body = document.getElementById("sources-body");
  const freq = sources.aip.frequencies.map((item) => (
    `<li><span class="tag verified">AIP</span> ${item.station} ${item.mhz} — ${item.hours}. ${item.remarks}</li>`
  )).join("");
  const simulated = sources.simulated.map((item) => `<li><span class="tag simulated">Simulated</span> ${item}</li>`).join("");
  const limits = sources.geography.simplified_or_unverified.map((item) => `<li>${item}</li>`).join("");
  body.innerHTML = `
    <p>${sources.disclaimer}</p>
    <h3>Geography</h3>
    <p>${sources.geography.attribution}. ${sources.geography.method}</p>
    <ul>${limits}</ul>
    <h3>From the Czech AIP, ${sources.aip.retrieved}</h3>
    <p>Runway preference order ${sources.aip.runway_preference_order.join(", ")}. ${sources.aip.runway_preference_reference}</p>
    <ul>${freq}</ul>
    <h3>Simulated for this exercise</h3>
    <ul>${simulated}</ul>
    <p>${sources.phraseology}</p>`;
}

function showRadioMode() {
  ui.radioMode.textContent = radio.mode === "filtered"
    ? "Radio effect: the voice is band-pass filtered, with light static and squelch clicks."
    : "Radio effect: static and squelch around the browser voice. A local WAV (pyttsx3 or espeak) is filtered fully when that engine is available.";
}

function startListen() {
  if (holding || radio.speaking || ui.ptt.disabled) return;
  const mode = effectiveMode();
  if (mode === "server") {
    startRecording();
    return;
  }
  if (mode !== "browser" || !SpeechRecognition) return;
  holding = true;
  listenBuffer = "";
  ui.ptt.setAttribute("aria-pressed", "true");
  document.querySelector(".comms").classList.add("tx-you");
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) listenBuffer += piece + " ";
      else interim += piece;
    }
    ui.said.textContent = (listenBuffer + interim).trim() || "Listening…";
  };
  recognition.onerror = () => {
    ui.support.textContent = "The microphone was blocked or the recognizer stopped. Allow the microphone for this site, switch Voice input to Record and transcribe, or type the transmission.";
  };
  try {
    recognition.start();
  } catch (err) {
    holding = false;
    ui.ptt.setAttribute("aria-pressed", "false");
  }
}

function stopListen() {
  if (recorder && recorder.state === "recording") {
    stopRecording();
    return;
  }
  if (!holding) return;
  holding = false;
  ui.ptt.setAttribute("aria-pressed", "false");
  document.querySelector(".comms").classList.remove("tx-you");
  if (recognition) recognition.stop();
  setTimeout(() => {
    const text = listenBuffer.trim();
    listenBuffer = "";
    if (text) sendText(text);
  }, 350);
}

function pickMime() {
  if (!window.MediaRecorder) return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    ui.support.textContent = "This browser cannot record audio. Type the transmission.";
    return;
  }
  if (!window.isSecureContext) {
    ui.support.textContent = "Recording needs HTTPS. On a phone, open the https address, or type the transmission.";
    return;
  }
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    ui.support.textContent = "Microphone permission was denied. Allow it for this site, or type the transmission.";
    return;
  }
  const mime = pickMime();
  recorder = mime ? new MediaRecorder(recordStream, { mimeType: mime }) : new MediaRecorder(recordStream);
  recordChunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) recordChunks.push(event.data);
  };
  recorder.start();
  holding = true;
  ui.ptt.setAttribute("aria-pressed", "true");
  document.querySelector(".comms").classList.add("tx-you");
  ui.said.textContent = "Recording…";
}

function stopRecording() {
  holding = false;
  ui.ptt.setAttribute("aria-pressed", "false");
  document.querySelector(".comms").classList.remove("tx-you");
  const active = recorder;
  const stream = recordStream;
  recorder = null;
  recordStream = null;
  if (!active) return;
  active.onstop = async () => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    const type = active.mimeType || "audio/mp4";
    const blob = new Blob(recordChunks, { type });
    recordChunks = [];
    if (!blob.size) return;
    ui.said.textContent = "Transcribing…";
    const body = new FormData();
    const extension = type.includes("mp4") || type.includes("aac") ? "m4a" : "webm";
    body.append("audio", blob, `pilot.${extension}`);
    try {
      const response = await fetch("/api/transcribe", { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        ui.support.textContent = payload.detail || "Transcription is unavailable. Type the transmission.";
        ui.said.textContent = "Transcription failed.";
        return;
      }
      if (payload.text) sendText(payload.text);
      else ui.said.textContent = "No words recognised. Try again or type.";
    } catch (err) {
      ui.support.textContent = "Could not reach the trainer to transcribe. Type the transmission.";
    }
  };
  if (active.state !== "inactive") active.stop();
}

document.getElementById("send").addEventListener("click", () => {
  radio.unlock();
  sendText(ui.typed.value);
});
ui.typed.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendText(ui.typed.value);
  }
});
ui.ptt.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  radio.unlock();
  startListen();
});
ui.ptt.addEventListener("pointerup", stopListen);
ui.ptt.addEventListener("pointercancel", stopListen);
ui.ptt.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "touch") return;
  stopListen();
});
ui.ptt.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat) return;
  if (event.target === ui.typed || event.target === inputSelect) return;
  event.preventDefault();
  radio.unlock();
  startListen();
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Space" && event.target !== ui.typed) stopListen();
});

document.getElementById("hint").addEventListener("click", () => {
  const open = ui.example.hidden;
  ui.example.hidden = !open;
  document.getElementById("hint").textContent = open ? "Hide example" : "Show example";
});
document.getElementById("skip-voice").addEventListener("click", () => radio.skip());
document.getElementById("speed").addEventListener("click", (event) => {
  session.speed = session.speed === 1 ? 4 : 1;
  event.currentTarget.textContent = `Movement ${session.speed}×`;
});
document.getElementById("restart").addEventListener("click", async () => {
  map.stop();
  session.animating = false;
  radio.skip();
  const created = await fetch("/api/session", { method: "POST" }).then((response) => response.json());
  map.snap("stand");
  apply(created, false);
});
inputSelect.addEventListener("change", () => {
  localStorage.setItem("lkpr-input", inputSelect.value);
  supportLine();
});
document.getElementById("sources-open").addEventListener("click", () => {
  radio.unlock();
  document.getElementById("sources-dialog").showModal();
});
document.getElementById("zoom-in").addEventListener("click", () => map.zoomAt(map.cssWidth / 2, map.cssHeight / 2, 1.25));
document.getElementById("zoom-out").addEventListener("click", () => map.zoomAt(map.cssWidth / 2, map.cssHeight / 2, 0.8));
document.getElementById("fit").addEventListener("click", () => map.fit());
ui.follow.addEventListener("click", () => {
  map.follow = !map.follow;
  ui.follow.setAttribute("aria-pressed", map.follow ? "true" : "false");
});
map.onFollowChange = (value) => ui.follow.setAttribute("aria-pressed", value ? "true" : "false");

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

boot();
