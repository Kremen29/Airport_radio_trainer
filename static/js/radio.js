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
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
    }
    return this.ctx;
  }

  unlock() {
    /* iOS will not play audio that starts outside a tap. Call this synchronously
       from the gesture, before any await. A resumed AudioContext can then play
       the server WAV later. speechSynthesis on iOS is less reliable. */
    const ctx = this.ensure();
    if (ctx.state === "suspended") ctx.resume();
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    this.unlocked = true;
    if (window.speechSynthesis) {
      try {
        const primer = new SpeechSynthesisUtterance(" ");
        primer.volume = 0.01;
        primer.rate = 2;
        window.speechSynthesis.speak(primer);
      } catch (err) { /* priming is best-effort */ }
    }
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

  async speak(text) {
    this.skip();
    const token = {};
    this._token = token;
    this.speaking = true;
    document.querySelector(".comms").classList.add("tx-atc");
    try {
      await this.resume();
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (this._token !== token) return;
      if (response.ok) {
        const audio = await this.ctx.decodeAudioData(await response.arrayBuffer());
        if (this._token !== token) return;
        this.mode = "filtered";
        await this.playBuffer(audio, token);
      } else {
        this.mode = "browser";
        await this.speakBrowser(text, token);
      }
    } catch (err) {
      if (this._token === token) {
        this.mode = "browser";
        await this.speakBrowser(text, token);
      }
    } finally {
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
      utterance.lang = "en-GB";
      utterance.rate = 0.94;
      utterance.pitch = 0.9;
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find((item) => /en-GB/i.test(item.lang)) || voices.find((item) => /^en/i.test(item.lang));
      if (voice) utterance.voice = voice;
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios) utterance.pitch = 1;
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
