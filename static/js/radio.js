/* Radio voice: local WAV through a band-pass when the server can speak,
   otherwise the browser voice with static and squelch layered on top. */

class Radio {
  constructor() {
    this.ctx = null;
    this.static = null;
    this.staticGain = null;
    this.current = null;
    this.speaking = false;
    this.mode = "";
    this._skip = null;
    this.keeper = null;
    this.lastText = "";
    this.unlocked = false;
    this.muted = localStorage.getItem("lkpr-speaker") === "off";
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
    }
    return this.ctx;
  }

  unlock() {
    /* Call this synchronously inside a tap or click, before any await.
       iOS only allows later ATC audio if a buffer actually starts during that gesture. */
    const ctx = this.ensure();
    const pending = ctx.resume();
    const frames = Math.max(1, Math.floor(ctx.sampleRate * 0.2));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.001;
    src.connect(gain);
    gain.connect(ctx.destination);
    try { src.start(0); } catch (err) { /* already started */ }
    if (!this.keeper) {
      const osc = ctx.createOscillator();
      const hold = ctx.createGain();
      hold.gain.value = 0.00001;
      osc.frequency.value = 440;
      osc.connect(hold);
      hold.connect(ctx.destination);
      osc.start();
      this.keeper = osc;
    }
    this.unlocked = true;
    return pending;
  }

  async resume() {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
  }

  skip() {
    if (this._skip) this._skip();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (this.current) {
      try { this.current.stop(); } catch (err) { /* already stopped */ }
    }
  }

  remember(text) {
    if (text) this.lastText = text;
  }

  async speak(text) {
    if (!text) return;
    this.remember(text);
    if (this.muted) {
      this.mode = "muted";
      return;
    }
    this.skip();
    const token = {};
    this._token = token;
    this.speaking = true;
    document.querySelector(".comms").classList.add("tx-atc");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      await this.resume();
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (this._token !== token) return;
      if (!response.ok) throw new Error("tts unavailable");
      const raw = await response.arrayBuffer();
      if (this._token !== token) return;
      const audio = await this.ctx.decodeAudioData(raw.slice(0));
      if (this._token !== token) return;
      this.mode = "filtered";
      await this.playBuffer(audio, token);
    } catch (err) {
      if (this._token === token) {
        this.mode = "browser";
        await this.speakBrowser(text, token);
      }
    } finally {
      clearTimeout(timer);
      if (this._token === token) {
        this.speaking = false;
        document.querySelector(".comms").classList.remove("tx-atc");
        this.stopStatic();
      }
    }
  }

  playBuffer(buffer, token) {
    const ctx = this.ctx;
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 300;
      high.Q.value = 0.7;
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 3400;
      const shape = ctx.createWaveShaper();
      shape.curve = this.curve(1.6);
      const gain = ctx.createGain();
      gain.gain.value = 0.95;
      src.connect(high);
      high.connect(low);
      low.connect(shape);
      shape.connect(gain);
      gain.connect(ctx.destination);
      this.current = src;
      this.startStatic();
      this.click();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.click();
        this.stopStatic();
        resolve();
      };
      this._skip = finish;
      src.onended = finish;
      src.start();
      setTimeout(finish, Math.ceil(buffer.duration * 1000) + 700);
    });
  }

  speakBrowser(text, token) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1.05;
      utterance.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find((item) => /en-US/i.test(item.lang))
        || voices.find((item) => /en-GB/i.test(item.lang))
        || voices.find((item) => /^en/i.test(item.lang));
      if (voice) utterance.voice = voice;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.click();
        this.stopStatic();
        resolve();
      };
      this._skip = () => {
        window.speechSynthesis.cancel();
        finish();
      };
      utterance.onstart = () => {
        if (this._token !== token) return;
        this.click();
        this.startStatic();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      setTimeout(finish, 20000);
    });
  }

  startStatic() {
    const ctx = this.ensure();
    this.stopStatic();
    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    band.Q.value = 0.55;
    const gain = ctx.createGain();
    gain.gain.value = 0.012;
    src.connect(band);
    band.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    this.static = src;
    this.staticGain = gain;
  }

  stopStatic() {
    if (!this.static) return;
    try { this.static.stop(); } catch (err) { /* already stopped */ }
    this.static = null;
  }

  click() {
    const ctx = this.ensure();
    const duration = 0.05;
    const n = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.22));
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1600;
    band.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.4;
    src.connect(band);
    band.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  curve(amount) {
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return curve;
  }
}
