// 合成音效：柴油引擎、路噪、風切、氣煞洩氣、換檔、倒車警示
import { clamp } from './config.js';
import { bus, eng, app } from './state.js';

let ctx = null, master, noiseBuf, n = null, beepT = 0;

function noiseSource() {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = true; s.start();
  return s;
}
function gainNode(v, dest) {
  const g = ctx.createGain();
  g.gain.value = v;
  if (dest) g.connect(dest);
  return g;
}
function filter(type, freq, q, dest) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (dest) f.connect(dest);
  return f;
}
function osc(type, dest) {
  const o = ctx.createOscillator();
  o.type = type; o.connect(dest); o.start();
  return o;
}

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = gainNode(0.9, ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // 引擎本體：點火頻率 + 半階低頻 + 倍頻，經過輕微失真與低通
    const engGain = gainNode(0, master);
    const engLP = filter('lowpass', 300, 0.7, engGain);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) curve[i] = Math.tanh((i / 128 - 1) * 2.2);
    shaper.curve = curve;
    shaper.connect(engLP);
    const o1 = osc('sawtooth', gainNode(0.5, shaper));
    const o2 = osc('square', gainNode(0.4, shaper));
    const o3 = osc('sawtooth', gainNode(0.2, shaper));
    const o4 = osc('triangle', gainNode(0.5, shaper));

    // 柴油爆震聲：噪音依點火頻率開關
    const knockGain = gainNode(0, master);
    noiseSource().connect(filter('bandpass', 1700, 0.7, knockGain));
    const lfoDepth = gainNode(0, knockGain.gain);
    const lfo = osc('square', lfoDepth);

    // 渦輪、路噪、風切
    const turboGain = gainNode(0, master);
    const turbo = osc('sine', turboGain);
    const roadGain = gainNode(0, master);
    const roadLP = filter('lowpass', 300, 0.5, roadGain);
    noiseSource().connect(roadLP);
    const windGain = gainNode(0, master);
    noiseSource().connect(filter('bandpass', 900, 0.4, windGain));

    n = { engGain, engLP, o1, o2, o3, o4, knockGain, lfoDepth, lfo, turbo, turboGain, roadGain, roadLP, windGain };
  } catch { ctx = null; n = null; }
}

// 暫停或回到選單時把聲音整個停住
export function setAudioPaused(p) {
  if (!ctx) return;
  try { if (p) ctx.suspend(); else ctx.resume(); } catch { /* 非必要 */ }
}

const set = (param, v, tc = 0.04) => param.setTargetAtTime(v, ctx.currentTime, tc);

export function updateAudio(dt) {
  if (!n) return;
  set(master.gain, app.muted ? 0 : 0.9, 0.05);
  const rpm = eng.rpm, load = eng.on ? eng.thr : 0, alive = rpm > 40 ? 1 : 0;
  const f = Math.max(6, rpm / 20); // 六缸四行程：每分鐘轉速 / 20 = 每秒點火次數
  set(n.o1.frequency, f);
  set(n.o2.frequency, f / 2);
  set(n.o3.frequency, f * 2.02);
  set(n.o4.frequency, f * 1.5);
  set(n.lfo.frequency, f);
  set(n.engGain.gain, alive * (0.11 + load * 0.12));
  set(n.engLP.frequency, 170 + rpm * 0.22 + load * 650);
  const knock = alive * (eng.on ? 0.018 + load * 0.03 : 0.01);
  set(n.knockGain.gain, knock);
  set(n.lfoDepth.gain, knock);
  set(n.turbo.frequency, 1400 + rpm * 1.7);
  set(n.turboGain.gain, load * clamp((rpm - 1000) / 1200, 0, 1) * 0.012, 0.25);
  const sp = Math.abs(bus.v);
  set(n.roadGain.gain, clamp(sp / 18, 0, 1) * 0.09, 0.1);
  set(n.roadLP.frequency, 180 + sp * 28, 0.1);
  set(n.windGain.gain, clamp(sp / 25, 0, 1) ** 2 * 0.05, 0.1);

  // 倒車警示音
  if (eng.gear === 'R' && eng.on) {
    beepT -= dt;
    if (beepT <= 0) { beepT = 0.8; tone('square', 1050, 1050, 0.3, 0.035); }
  } else beepT = 0;
}

function tone(type, f0, f1, len, vol, delay = 0) {
  if (!ctx || app.muted) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + len + 0.05);
}
function burst(filterType, freq, len, vol, delay = 0) {
  if (!ctx || app.muted) return;
  const s = ctx.createBufferSource(), g = ctx.createGain(), t = ctx.currentTime + delay;
  s.buffer = noiseBuf;
  const f = filter(filterType, freq, 0.6, g);
  s.connect(f);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(master);
  s.start(t, Math.random()); s.stop(t + len + 0.05);
}

export const sfx = {
  air(len = 0.45) { burst('highpass', 2600, len, 0.14); },                    // 氣煞 / 氣動門洩氣
  shift() { tone('triangle', 150, 70, 0.07, 0.2); burst('bandpass', 900, 0.05, 0.08); },
  grind() { for (let k = 0; k < 6; k++) tone('sawtooth', 210 + k * 9, 180, 0.05, 0.1, k * 0.045); },
  starter() { for (let k = 0; k < 7; k++) tone('square', 95, 70, 0.06, 0.09, k * 0.075); },
  tick(hi) { burst('bandpass', hi ? 2600 : 1900, 0.03, 0.16); },               // 方向燈繼電器
  thump(vol = 0.3) { burst('lowpass', 180, 0.22, vol); tone('sine', 70, 38, 0.18, vol * 0.8); },
  doorOpen() { this.air(0.6); tone('sine', 880, 880, 0.35, 0.1, 0.1); tone('sine', 660, 660, 0.4, 0.1, 0.3); },
  doorClose() { tone('sine', 660, 660, 0.35, 0.1); tone('sine', 880, 880, 0.4, 0.1, 0.2); this.air(0.5); },
};