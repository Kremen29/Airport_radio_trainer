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
let preferServer = false;
let penOn = false;
let browserListenDone = false;
let recognitionError = "";
let abandonRecognition = false;
let iosRestarts = 0;

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function chosenMode() {
  return inputSelect.value || "auto";
}

function voiceFallback() {
  if (serverWhisper && window.isSecureContext && navigator.mediaDevices) return "server";
  return "typed";
}

function effectiveMode() {
  const choice = chosenMode();
  if (choice === "typed") return "typed";
  if (choice === "browser") return SpeechRecognition ? "browser" : voiceFallback();
  if (choice === "server") return serverWhisper ? "server" : "typed";
  if (preferServer && serverWhisper && window.isSecureContext) return "server";
  if (SpeechRecognition && window.isSecureContext) return "browser";
  return voiceFallback();
}

function supportLine() {
  const mode = effectiveMode();
  const secure = window.isSecureContext;
  ui.ptt.disabled = mode === "typed";
  if (!secure && mode !== "browser") {
    ui.support.textContent = "The microphone on an iPhone needs HTTPS, not a plain http:// address of another computer. Typing works on this page. Auto uses browser speech on Chrome and Edge, and recording plus the server on iPhone when faster-whisper is installed.";
  } else if (mode === "browser" && isIOS()) {
    ui.support.textContent = "Hold Push to talk and speak. The words go into the box so you can edit them, then tap Send. If Safari cannot hear you, the next hold records for the server when transcription is installed.";
  } else if (mode === "browser") {
    ui.support.textContent = "Push to talk uses the browser Web Speech API. Hold the button or the space bar. The transmission is sent when you release.";
  } else if (mode === "server") {
    ui.support.textContent = "Push to talk records in the browser and the trainer transcribes it on the server. iPhone sends an mp4/aac file. No paid speech API.";
  } else if (isIOS()) {
    ui.support.textContent = "Safari could not use speech recognition, and server transcription is not installed on this host. Type the transmission and tap Send.";
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
    let created = await fetch("/api/session", { method: "POST" }).then((response) => response.json());
    if (localStorage.getItem("lkpr-draw") === "1") {
      const armed = await fetch(`/api/session/${created.session_id}/draw-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      if (armed.ok) created = await armed.json();
    }
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
    if (view.speech && view.speech.speech) {
      radio.remember(view.speech.speech);
      if (speak) speakAtc(view.speech.speech);
    }
  }
}

function speakAtc(text) {
  const tutorial = document.getElementById("tutorial");
  if (tutorial && !tutorial.hidden) {
    radio.queuedAtc = text;
    return;
  }
  radio.speak(text).then(showRadioMode);
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
  const hints = document.getElementById("info-hints");
  if (hints) hints.textContent = String(view.hints_used || 0);
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
  renderHint(view);
  renderDraw(view);
  renderResult(view);
  document.querySelector(".comms").classList.toggle("tx-you", false);
}

function renderHint(view) {
  const sentence = view.example || "Nothing to say on this step.";
  document.getElementById("hint-sentence").textContent = sentence;
  const blocked = view.last_evaluation && view.last_evaluation.blocks_progress;
  const fix = document.getElementById("hint-fix");
  const list = document.getElementById("hint-gaps");
  list.innerHTML = "";
  if (!blocked) {
    fix.hidden = true;
    return;
  }
  fix.hidden = false;
  const evaluation = view.last_evaluation;
  evaluation.missing.forEach((item) => {
    const line = document.createElement("li");
    line.textContent = `Missing: ${item}`;
    list.appendChild(line);
  });
  evaluation.incorrect.forEach((item) => {
    const line = document.createElement("li");
    line.textContent = `Incorrect: ${item}`;
    list.appendChild(line);
  });
  const corrected = document.createElement("li");
  corrected.textContent = `Corrected readback: ${sentence}`;
  list.appendChild(corrected);
}

function renderDraw(view) {
  const box = document.getElementById("draw-mode");
  if (document.activeElement !== box) box.checked = Boolean(view.draw_mode);
  const tools = document.getElementById("draw-tools");
  const opening = view.draw_tools && tools.hidden;
  tools.hidden = !view.draw_tools;
  if (opening) penOn = true;
  if (!view.draw_tools) penOn = false;
  syncPen();
  const list = document.getElementById("draw-feedback");
  list.innerHTML = "";
  if (view.drawing && view.drawing.feedback) {
    map.userRunway = Boolean(view.drawing.entered_runway);
    view.drawing.feedback.forEach((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    });
    map.draw();
  }
}

function syncPen() {
  const button = document.getElementById("draw-pen");
  const toolsOpen = !document.getElementById("draw-tools").hidden;
  map.setPen(penOn && toolsOpen);
  button.textContent = penOn ? "Draw on" : "Draw off";
  button.setAttribute("aria-pressed", penOn ? "true" : "false");
  document.body.classList.toggle("drawing-route", penOn && toolsOpen);
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
      <dt>Hints used</dt><dd>${score.hints_used || 0}</dd>
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
  if (radio.muted) {
    ui.radioMode.textContent = "Speaker is off. ATC text still appears. Tap Speaker on to hear it.";
    return;
  }
  ui.radioMode.textContent = radio.mode === "filtered"
    ? "Radio effect: the voice is band-pass filtered, with light static and squelch clicks."
    : "Radio effect: the browser voice is speaking, with static and squelch. The server voice is used when it answers in time.";
}

const FATAL_SPEECH = ["not-allowed", "service-not-allowed", "network", "audio-capture", "start-failed"];

function startListen() {
  if (holding || radio.speaking || ui.ptt.disabled) return;
  const mode = effectiveMode();
  if (mode === "server") {
    startRecording();
    return;
  }
  if (mode !== "browser" || !SpeechRecognition) {
    offerTyped("Voice recognition is not available. Type the transmission and tap Send.");
    return;
  }
  holding = true;
  browserListenDone = false;
  abandonRecognition = false;
  iosRestarts = 0;
  recognitionError = "";
  listenBuffer = "";
  ui.ptt.setAttribute("aria-pressed", "true");
  document.querySelector(".comms").classList.add("tx-you");
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = !isIOS();
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) listenBuffer += `${piece} `;
      else interim += piece;
    }
    const heard = (listenBuffer + interim).trim();
    ui.said.textContent = heard || "Listening…";
    if (isIOS() && heard) ui.typed.value = heard;
  };
  recognition.onerror = (event) => {
    recognitionError = event && event.error ? event.error : "error";
    if (FATAL_SPEECH.includes(recognitionError) && holding && serverWhisper) {
      abandonRecognition = true;
      holding = false;
      try { recognition.stop(); } catch (err) { /* already stopped */ }
      startRecording();
    }
  };
  recognition.onend = () => {
    if (abandonRecognition) return;
    if (holding && isIOS() && !FATAL_SPEECH.includes(recognitionError) && iosRestarts < 8) {
      iosRestarts += 1;
      try { recognition.start(); } catch (err) { /* restart on the next press */ }
      return;
    }
    if (!holding) finishBrowserListen();
  };
  try {
    recognition.start();
  } catch (err) {
    recognitionError = "start-failed";
    holding = false;
    ui.ptt.setAttribute("aria-pressed", "false");
    document.querySelector(".comms").classList.remove("tx-you");
    handleSpeechFailure();
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
  if (recognition) {
    try { recognition.stop(); } catch (err) { /* already stopped */ }
  }
  setTimeout(finishBrowserListen, isIOS() ? 900 : 350);
}

function finishBrowserListen() {
  if (browserListenDone) return;
  browserListenDone = true;
  const text = listenBuffer.trim();
  listenBuffer = "";
  if (!text) {
    if (recognitionError) handleSpeechFailure();
    return;
  }
  ui.typed.value = text;
  ui.said.textContent = text;
  if (isIOS()) {
    ui.support.textContent = "Check the words, then tap Send.";
    return;
  }
  sendText(text);
}

function handleSpeechFailure() {
  if (FATAL_SPEECH.includes(recognitionError) && serverWhisper) {
    preferServer = true;
    supportLine();
    ui.support.textContent = "Safari speech did not start. The next hold records audio for the server.";
    return;
  }
  offerTyped("I didn't catch that. Type the transmission and tap Send.");
}

function offerTyped(message) {
  ui.support.textContent = message;
  ui.ptt.disabled = effectiveMode() === "typed";
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
      if (payload.text && isIOS()) {
        ui.typed.value = payload.text;
        ui.said.textContent = payload.text;
        ui.support.textContent = "Check the words, then tap Send.";
      } else if (payload.text) {
        sendText(payload.text);
      } else {
        ui.said.textContent = "No words recognised. Try again or type.";
      }
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

document.getElementById("hint-open").addEventListener("click", () => {
  const panel = document.getElementById("hint-panel");
  panel.hidden = !panel.hidden;
});
document.getElementById("hint-use").addEventListener("click", async () => {
  const sentence = document.getElementById("hint-sentence").textContent.trim();
  if (!sentence || !session.id) return;
  ui.typed.value = sentence;
  ui.typed.focus();
  const response = await fetch(`/api/session/${session.id}/hint`, { method: "POST" });
  if (response.ok) apply(await response.json(), false);
});
document.getElementById("hint-hear").addEventListener("click", () => {
  radio.unlock();
  const sentence = document.getElementById("hint-sentence").textContent.trim();
  if (sentence) radio.speak(sentence).then(showRadioMode);
});
document.getElementById("draw-mode").addEventListener("change", async (event) => {
  localStorage.setItem("lkpr-draw", event.target.checked ? "1" : "0");
  if (!session.id) return;
  const response = await fetch(`/api/session/${session.id}/draw-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: event.target.checked }),
  });
  if (response.ok) apply(await response.json(), false);
});
document.getElementById("draw-pen").addEventListener("click", () => {
  penOn = !penOn;
  syncPen();
});
document.getElementById("draw-undo").addEventListener("click", () => {
  map.userPoints.pop();
  map.userRunway = false;
  map.draw();
});
document.getElementById("draw-clear").addEventListener("click", () => {
  map.userPoints = [];
  map.userRunway = false;
  map.draw();
  document.getElementById("draw-feedback").innerHTML = "";
});
document.getElementById("draw-submit").addEventListener("click", async () => {
  if (!session.id) return;
  if (map.userPoints.length < 2) {
    document.getElementById("draw-feedback").innerHTML = "<li>Draw a line from the aircraft to the holding point first.</li>";
    return;
  }
  const response = await fetch(`/api/session/${session.id}/drawing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points: map.userPoints }),
  });
  if (!response.ok) return;
  apply(await response.json(), true);
});
document.getElementById("speaker-toggle").addEventListener("click", () => {
  radio.unlock();
  radio.muted = !radio.muted;
  localStorage.setItem("lkpr-speaker", radio.muted ? "off" : "on");
  if (radio.muted) radio.skip();
  syncSpeakerButton();
  showRadioMode();
});
document.getElementById("repeat-atc").addEventListener("click", () => {
  radio.unlock();
  if (radio.muted) {
    radio.muted = false;
    localStorage.setItem("lkpr-speaker", "on");
    syncSpeakerButton();
  }
  if (radio.lastText) radio.speak(radio.lastText).then(showRadioMode);
});
document.getElementById("tutorial-open").addEventListener("click", () => {
  radio.unlock();
  openTutorial();
});
document.getElementById("tutorial-next").addEventListener("click", onTutorialNext);
document.getElementById("tutorial-back").addEventListener("click", onTutorialBack);
document.getElementById("tutorial-skip").addEventListener("click", () => closeTutorial(true));
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
  window.speechSynthesis.getVoices();
}

const TUTORIAL = [
  {
    title: "Welcome",
    body: "This is a practice radio for a departure from Prague, LKPR. You hear the controller, you answer, and the aircraft moves only after a correct readback. It is training, not a clearance for a real flight.",
    speech: "Welcome. This is a practice radio for a departure from Prague. You hear the controller, you answer, and the aircraft moves only after a correct readback.",
    target: null,
  },
  {
    title: "Your aircraft",
    body: "The map is Prague Airport. Callsign OK-ABC is parked at stand 3. The magenta line is the training taxi route toward runway 24. The aircraft stays off the runway until a later clearance.",
    speech: "The map is Prague Airport. Oscar Kilo Alfa Bravo Charlie is parked at stand 3. The magenta line is the training taxi route.",
    target: ".map-wrap",
  },
  {
    title: "Who is talking",
    body: "This panel shows the unit on frequency, such as Ruzyně Delivery, and the frequency from the AIP. The words underneath are what ATC said. Every transmission is spoken as well as shown.",
    speech: "This panel shows who is on frequency, and the words they said. Every transmission is spoken as well as shown.",
    target: ".comms-head",
  },
  {
    title: "How you answer",
    body: "Hold the big Push to talk button and speak, then release. On a computer you can hold the space bar. Or type the call and tap Send. On iPhone, check the words in the box before you send them.",
    speech: "Hold the big push to talk button and speak, then release. Or type the call and tap Send.",
    target: ".pilot-row",
  },
  {
    title: "What to read back",
    body: "A readback repeats the safety items in the clearance: runway, QNH, frequency, heading, altitude, taxi route, hold short, and line-up or takeoff. End with your callsign. Roger alone is not enough.",
    speech: "Read back the runway, QNH, frequency, heading, altitude, taxi route, hold short, and the clearance. End with your callsign.",
    target: "#prompt",
  },
  {
    title: "Your first call",
    body: "Try: Ruzyne Delivery, Oscar Kilo Alfa Bravo Charlie, stand 3, request startup. The Hint button shows that full sentence. Use this copies it into the box. A hint never stops the aircraft.",
    speech: "Your first call is: Ruzyne Delivery, Oscar Kilo Alfa Bravo Charlie, stand 3, request startup. The Hint button shows the full sentence.",
    target: "#hint-open",
  },
  {
    title: "Score and mistakes",
    body: "After you transmit, you see what you said, what was expected, and what was missing or wrong. A critical mistake, such as the wrong runway, makes ATC say Negative. The aircraft does not move until you correct it.",
    speech: "The score panel shows what you said, what was expected, and what was missing. If ATC says negative, the aircraft waits until you correct it.",
    target: ".eval",
  },
  {
    title: "Start the departure",
    body: "You are at stand 3, ready to call Delivery. Tap Start scenario. The tutorial can be opened again from the Tutorial button, which also turns the iPhone speaker on.",
    speech: "You are at stand 3, ready to call Delivery. Tap start scenario when you are ready.",
    target: null,
  },
];

let tutorialIndex = 0;
let tutorialHeard = false;

function openTutorial() {
  tutorialIndex = 0;
  tutorialHeard = false;
  document.getElementById("tutorial").hidden = false;
  showTutorialStep();
}

function showTutorialStep() {
  const step = TUTORIAL[tutorialIndex];
  document.querySelectorAll(".tutorial-target").forEach((node) => node.classList.remove("tutorial-target"));
  document.getElementById("tutorial-count").textContent = `Step ${tutorialIndex + 1} of ${TUTORIAL.length}`;
  document.getElementById("tutorial-title").textContent = step.title;
  document.getElementById("tutorial-body").textContent = step.body;
  const next = document.getElementById("tutorial-next");
  const last = tutorialIndex === TUTORIAL.length - 1;
  if (!tutorialHeard) next.textContent = "Start";
  else next.textContent = last ? "Start scenario" : "Next";
  document.getElementById("tutorial-back").disabled = tutorialIndex === 0;
  if (step.target) {
    const node = document.querySelector(step.target);
    if (node) {
      node.classList.add("tutorial-target");
      node.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
}

function onTutorialNext() {
  radio.unlock();
  const last = tutorialIndex === TUTORIAL.length - 1;
  if (!tutorialHeard) {
    tutorialHeard = true;
    showTutorialStep();
    radio.speak(TUTORIAL[tutorialIndex].speech).then(showRadioMode);
    return;
  }
  if (last) {
    closeTutorial(true);
    return;
  }
  tutorialIndex += 1;
  tutorialHeard = true;
  showTutorialStep();
  radio.speak(TUTORIAL[tutorialIndex].speech).then(showRadioMode);
}

function onTutorialBack() {
  radio.unlock();
  if (tutorialIndex === 0) return;
  tutorialIndex -= 1;
  tutorialHeard = true;
  showTutorialStep();
  radio.speak(TUTORIAL[tutorialIndex].speech).then(showRadioMode);
}

function closeTutorial(markDone) {
  document.getElementById("tutorial").hidden = true;
  document.querySelectorAll(".tutorial-target").forEach((node) => node.classList.remove("tutorial-target"));
  radio.skip();
  if (markDone) localStorage.setItem("lkpr-tutorial-done", "1");
  if (radio.queuedAtc) {
    const pending = radio.queuedAtc;
    radio.queuedAtc = "";
    radio.speak(pending).then(showRadioMode);
  }
}

function syncSpeakerButton() {
  const button = document.getElementById("speaker-toggle");
  button.textContent = radio.muted ? "Speaker off" : "Speaker on";
  button.setAttribute("aria-pressed", radio.muted ? "false" : "true");
}

boot();
if (!localStorage.getItem("lkpr-tutorial-done")) openTutorial();
syncSpeakerButton();
