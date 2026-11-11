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

// ───────── 柴油引擎 ─────────
// 做法是「聲源 + 共鳴」：聲源是一顆一顆的燃燒脈衝，播放速度跟著轉速走；
// 共鳴（排氣管的低頻、引擎本體的中頻、柴油特有的喀啦聲）是固定頻率的濾波器，不隨轉速移動。
// 這樣轉速升高時是「點火變密」而不是整個聲音被拉尖，聽起來才像同一顆引擎。

// 聲源：怠速 600 rpm 下的 4 個引擎循環（六缸，共 24 次點火）。
// 左聲道是燃燒壓力脈衝，右聲道是每次點火帶出的一小段噪音（喀啦聲的來源）。
// 每一缸的力道與時間都有一點差異，怠速時才會有柴油引擎那種不均勻的抖動感。
function engineBuffer(c) {
  const sr = c.sampleRate, CYCLES = 4, per = Math.round(sr / 30), len = per * 6 * CYCLES;
  const buf = c.createBuffer(2, len, sr), a = buf.getChannelData(0), b = buf.getChannelData(1);
  const CYL = [1, 0.8, 0.94, 0.74, 0.98, 0.86];
  let seed = 20261;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tauA = sr * 0.004, tauB = sr * 0.0022, rise = sr * 0.0004;
  for (let k = 0; k < 6 * CYCLES; k++) {
    const amp = CYL[k % 6] * (0.9 + rnd() * 0.2), start = k * per + Math.round((rnd() - 0.5) * per * 0.06) + len;
    for (let i = 0; i < per * 0.9; i++) {
      const j = (start + i) % len, up = Math.min(1, i / rise);
      a[j] += amp * up * Math.exp(-i / tauA);
      b[j] += amp * up * Math.exp(-i / tauB) * (rnd() * 2 - 1);
    }
  }
  let mean = 0;
  for (let i = 0; i < len; i++) mean += a[i];
  mean /= len;
  for (let i = 0; i < len; i++) a[i] -= mean;
  return buf;
}

// 各音層的基準音量（用離線算圖量過，怠速約 0.1、全油門約 0.25 RMS，不會破音）
// 手機喇叭幾乎發不出 200 Hz 以下的聲音，所以中頻與喀啦聲要夠大，引擎聲才不會在手機上消失
const K_LOW = 0.55, K_MID = 1.0, K_CLAT = 1.25;

export function buildEngine(c, dest, noise) {
  const G = (v, d) => { const g = c.createGain(); g.gain.value = v; if (d) g.connect(d); return g; };
  const F = (type, freq, q, d) => { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; if (d) f.connect(d); return f; };
  // 出口加一個柔性限幅：喀啦聲的尖峰會被壓圓，總音量最大約 0.7，不會破音
  const lim = c.createWaveShaper(), limCurve = new Float32Array(513);
  for (let i = 0; i < 513; i++) limCurve[i] = 0.7 * Math.tanh((i / 256 - 1) * 2.6);
  lim.curve = limCurve;
  lim.connect(dest);
  const out = G(0, G(0.5, lim));
  const hp = F('highpass', 30, 0.7, out);
  const shaper = c.createWaveShaper();
  const curve = new Float32Array(257);
  for (let i = 0; i < 257; i++) curve[i] = Math.tanh((i / 128 - 1) * 1.6);
  shaper.curve = curve;
  shaper.connect(hp);

  const src = c.createBufferSource();
  src.buffer = engineBuffer(c); src.loop = true;
  const sp = c.createChannelSplitter(2);
  src.connect(sp);

  // 低頻：排氣的悶響，加上排氣管在 85 Hz 附近的共鳴
  const low = G(0, shaper), lowLP = F('lowpass', 150, 0.9, low);
  sp.connect(lowLP, 0);
  sp.connect(F('bandpass', 85, 2.5, G(0.8, low)), 0);
  // 中頻：引擎本體與變速箱殼的共鳴，油門越深越明顯
  const mid = G(0, shaper);
  for (const [f, q, g] of [[310, 2.2, 1], [620, 2.5, 0.7], [1050, 2, 0.45]]) sp.connect(F('bandpass', f, q, G(g, mid)), 0);
  // 高頻：柴油引擎的喀啦聲（每次點火一小段噪音打在固定的共鳴上）
  const clat = G(0, out);
  for (const [f, q, g] of [[1700, 1.2, 1], [2900, 1.6, 0.7], [4300, 1.5, 0.4]]) sp.connect(F('bandpass', f, q, G(g, clat)), 1);
  // 進氣聲與渦輪
  const air = G(0, out), ns = c.createBufferSource();
  ns.buffer = noise; ns.loop = true;
  ns.connect(F('lowpass', 420, 0.5, air));
  const turboGain = G(0, out), turbo = c.createOscillator();
  turbo.type = 'sine'; turbo.connect(turboGain);
  src.start(); ns.start(); turbo.start();
  return { out, src, low, lowLP, mid, clat, air, turbo, turboGain };
}

// set(param, value, 時間常數)：即時播放時用漸變，離線算圖時直接設值
export function setEngine(e, rpm, load, on, set) {
  const alive = rpm > 40 ? 1 : 0, r = clamp(rpm / 2400, 0, 1.2), fire = on ? 1 : 0.3;
  set(e.src.playbackRate, Math.max(0.05, rpm / 600));
  set(e.lowLP.frequency, 110 + rpm * 0.06 + load * 140);
  const comp = 1 / Math.sqrt(Math.max(0.5, rpm / 600));   // 點火越密，每一下要相對小聲一點，音量才不會隨轉速暴增
  set(e.low.gain, K_LOW * comp * fire * (0.7 + 0.8 * load));
  set(e.mid.gain, K_MID * comp * fire * (0.9 + 0.9 * load + 0.4 * r));
  set(e.clat.gain, K_CLAT * comp * fire * (0.8 + 0.9 * load));
  set(e.air.gain, on ? 0.004 + load * r * 0.03 : 0, 0.15);
  set(e.turbo.frequency, 1400 + rpm * 1.7);
  set(e.turboGain.gain, load * clamp((rpm - 1000) / 1200, 0, 1) * 0.012, 0.25);
  set(e.out.gain, alive * (0.6 + 0.4 * load));
}

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = gainNode(0.9, ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const engine = buildEngine(ctx, master, noiseBuf);

    // 路噪、風切
    const roadGain = gainNode(0, master);
    const roadLP = filter('lowpass', 300, 0.5, roadGain);
    noiseSource().connect(roadLP);
    const windGain = gainNode(0, master);
    noiseSource().connect(filter('bandpass', 900, 0.4, windGain));

    n = { engine, roadGain, roadLP, windGain };
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
  setEngine(n.engine, eng.rpm, eng.on ? eng.thr : 0, eng.on, set);
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