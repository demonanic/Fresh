// Systemic synthwave/industrial soundtrack (GDD §34). Layers build with network threat:
//   0 calm:     pad + sparse hats + machinery pulse
//   1 rising:   + four-on-the-floor kick
//   2 tense:    + driving bass arpeggio
//   3 attack:   + snare backbeat, 16th hats, distortion
// Everything is synthesized with WebAudio; no audio files.
export class Soundtrack {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.intensity = 0;
    this.step = 0;
    this.nextTime = 0;
    this.bpm = 112;
    this.timer = null;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.comp = c.createDynamicsCompressor();
    this.master.connect(this.comp).connect(c.destination);
    this.music = c.createGain(); this.music.gain.value = 0.55; this.music.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.5; this.sfx.connect(this.master);
    this.dist = c.createWaveShaper();
    this.dist.curve = this.makeCurve(30);
    this.distGain = c.createGain(); this.distGain.gain.value = 0;
    this.dist.connect(this.distGain).connect(this.music);
    this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.nextTime = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
  }

  setIntensity(level) { this.intensity = Math.max(0, Math.min(3, level)); }

  makeCurve(k) {
    const n = 1024; const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); }
    return curve;
  }

  schedule() {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < c.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t) {
    const lvl = this.intensity;
    const s16 = step % 16;
    if (this.distGain) this.distGain.gain.setTargetAtTime(lvl >= 3 ? 0.18 : 0, t, 0.2);
    // Pad: chord change every bar (Am - F - C - G), synthwave staple.
    if (s16 === 0) {
      const bar = Math.floor(step / 16) % 4;
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
      for (const n of chords[bar]) this.pad(n, t, (60 / this.bpm) * 4);
      this.rootNote = chords[bar][0];
    }
    if (s16 % 8 === 4) this.click(t, 0.05); // machinery pulse
    if (lvl >= 1 && s16 % 4 === 0) this.kick(t);
    if (lvl >= 3 && (s16 === 4 || s16 === 12)) this.snare(t);
    if ((lvl >= 3) || (lvl >= 1 && s16 % 2 === 0) || (lvl === 0 && s16 % 4 === 2)) this.hat(t, s16 % 4 === 2 ? 0.12 : 0.06);
    if (lvl >= 2) {
      const arp = [0, 12, 7, 12, 3, 12, 7, 15];
      const root = (this.rootNote || 57) - 24;
      this.bass(root + arp[s16 % 8], t, 0.11);
    }
  }

  freq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  pad(note, t, dur) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.freq(note); o.detune.value = (Math.random() - 0.5) * 14;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + this.intensity * 400;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.4); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }

  kick(t) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = c.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.music); g.connect(this.dist);
    o.start(t); o.stop(t + 0.32);
  }

  noise(t, dur, type, freq, vol, dest) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest || this.music);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    return g;
  }

  snare(t) {
    const g = this.noise(t, 0.18, 'bandpass', 1800, 0.35);
    g.connect(this.dist);
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
    const og = c.createGain(); og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(this.music); o.start(t); o.stop(t + 0.12);
  }

  hat(t, vol) { this.noise(t, 0.04, 'highpass', 7000, vol); }

  click(t, vol) { this.noise(t, 0.02, 'bandpass', 3200, vol); }

  bass(note, t, dur) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.freq(note);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // --- SFX ---
  sfxShot() { this.blip(880, 0.04, 'square', 0.04); }
  sfxBuild() { this.blip(523, 0.08, 'triangle', 0.15); this.blip(784, 0.12, 'triangle', 0.12, 0.07); }
  sfxKill() { if (this.ctx) this.noise(this.ctx.currentTime, 0.15, 'lowpass', 1200, 0.2, this.sfx); }
  sfxAlarm() { this.blip(660, 0.25, 'sawtooth', 0.12); this.blip(440, 0.3, 'sawtooth', 0.12, 0.25); }
  sfxGood() { this.blip(659, 0.1, 'triangle', 0.15); this.blip(988, 0.18, 'triangle', 0.15, 0.1); }
  sfxBad() { this.blip(220, 0.3, 'sawtooth', 0.15); }

  blip(freq, dur, type, vol, delay = 0) {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }
}
