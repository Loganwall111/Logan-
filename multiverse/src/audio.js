// Procedural ambience (drones, wind, rain, underwater muffling) + narration playback.
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.voice = null;
    this.settings = { master: 0.8, music: 0.5, voice: 1.0 };
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.master;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    this.master.connect(this.lowpass);
    this.lowpass.connect(ctx.destination);

    // Music bus: slow drones with a shimmering top.
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    const freqs = [55, 82.4, 110, 164.8, 220.5];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = (i - 2) * 4;
      const g = ctx.createGain();
      g.gain.value = 0.05 / (i + 1);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lg = ctx.createGain();
      lg.gain.value = 0.02;
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(this.music);
      o.start();
      lfo.start();
    });

    // Noise source shared by wind and rain.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.04) * 0.995;
      d[i] = last * 10;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.noise = src;

    this.wind = ctx.createGain();
    this.wind.gain.value = 0.09;
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass';
    windF.frequency.value = 500;
    windF.Q.value = 0.4;
    src.connect(windF);
    windF.connect(this.wind);
    this.wind.connect(this.music);

    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    const rainF = ctx.createBiquadFilter();
    rainF.type = 'highpass';
    rainF.frequency.value = 1800;
    src.connect(rainF);
    rainF.connect(this.rain);
    this.rain.connect(this.master);
    src.start();

    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.settings.master, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(this.settings.music * 0.9, this.ctx.currentTime, 0.2);
  }

  setSettings(s) {
    Object.assign(this.settings, s);
    this.applyVolumes();
    if (this.voiceEl) this.voiceEl.volume = Math.min(1, this.settings.voice);
  }

  startMusic() {
    if (this.music) this.music.gain.setTargetAtTime(this.settings.music * 0.9, this.ctx.currentTime, 1.2);
  }

  setRain(amount) {
    if (this.rain) this.rain.gain.setTargetAtTime(amount * 0.22, this.ctx.currentTime, 0.4);
  }

  setUnderwater(under) {
    if (!this.lowpass) return;
    this.lowpass.frequency.setTargetAtTime(under ? 650 : 20000, this.ctx.currentTime, 0.15);
  }

  // Plays a narration clip. Resolves when it ends (or rejects if it cannot play).
  playVoice(url) {
    this.stopVoice();
    const el = new Audio(url);
    el.preload = 'auto';
    el.volume = Math.min(1, this.settings.voice);
    this.voiceEl = el;
    return new Promise((resolve, reject) => {
      el.onended = () => resolve();
      el.onerror = () => reject(new Error(`Could not load ${url}`));
      el.play().catch(reject);
    });
  }

  stopVoice() {
    if (this.voiceEl) {
      this.voiceEl.onended = null;
      this.voiceEl.onerror = null;
      this.voiceEl.pause();
      this.voiceEl = null;
    }
  }
}
