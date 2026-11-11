// 輸入：手機傾斜（方向盤）、觸控踏板與排檔、鍵盤
import { clamp, $ } from './config.js';
import { input, tilt, app } from './state.js';
import { shift } from './engine.js';
import { toggleDoors, resetBus } from './service.js';
import { toast } from './ui.js';
import { toggleHand, setSignal, toggleHazard } from './signals.js';

// ───────── 旋轉手機 = 方向盤 ─────────
// 用重力在螢幕平面上的方向算出手機被轉了幾度，不受手機前後仰角影響
const tiltAngle = () => -Math.atan2(tilt.ux * tilt.sign, tilt.uy * tilt.sign);
export function calibrate(silent) {
  if (!tilt.active) { if (!silent) toast('偵測不到手機傾斜感應器'); return; }
  tilt.sign = tilt.uy < 0 ? -1 : 1;   // iOS 與 Android 的重力正負號相反
  tilt.zero = tiltAngle();
  if (!silent) toast('方向盤已校正');
}
function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null) return;
  const th = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * Math.PI / 180;
  const ux = g.x * Math.cos(th) - g.y * Math.sin(th), uy = g.x * Math.sin(th) + g.y * Math.cos(th);
  if (Math.hypot(ux, uy) < 2.5) return; // 手機幾乎平放時不更新
  tilt.ux = ux; tilt.uy = uy; tilt.active = true;
  if (tilt.needCal) { tilt.needCal = false; calibrate(true); }
  tilt.raw = tiltAngle();
}
export async function enableTilt() {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      if ((await DeviceMotionEvent.requestPermission()) !== 'granted') return;
    }
    addEventListener('devicemotion', onMotion);
  } catch { /* 沒有感應器時改用鍵盤或拖曳 */ }
}
addEventListener('orientationchange', () => { tilt.needCal = true; });

// ───────── 鍵盤 ─────────
const PEDAL = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', ShiftLeft: 'clutch', ShiftRight: 'clutch' };
const HOLD = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
const cycleCam = () => { app.camMode = (app.camMode + 1) % 2; };   // 0 駕駛座、1 車後
addEventListener('keydown', (e) => {
  if (PEDAL[e.code]) { input[PEDAL[e.code]] = 1; if (PEDAL[e.code] === 'clutch') input.clutchSlow = true; e.preventDefault(); return; }
  if (HOLD[e.code]) { input[HOLD[e.code]] = true; e.preventDefault(); return; }
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat || !app.running) return;
  if (e.code === 'Space') toggleHand();
  else if (e.code === 'KeyQ') setSignal('L');
  else if (e.code === 'KeyE') setSignal('R');
  else if (e.code === 'KeyH') toggleHazard();
  const m = /^Digit([1-6])$/.exec(e.code);
  if (m) shift(m[1]);
  else if (e.code === 'KeyR') shift('R');
  else if (e.code === 'KeyN') shift('N');
  else if (e.code === 'KeyF') toggleDoors();
  else if (e.code === 'KeyC') cycleCam();
  else if (e.code === 'Backspace') resetBus();
  else if (e.code === 'KeyM') { app.muted = !app.muted; toast(app.muted ? '已靜音' : '已開啟聲音'); }
});
addEventListener('keyup', (e) => {
  if (PEDAL[e.code]) input[PEDAL[e.code]] = 0;
  if (HOLD[e.code]) input[HOLD[e.code]] = false;
});
addEventListener('blur', () => { input.gas = input.brake = input.clutch = 0; input.left = input.right = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ───────── 觸控踏板：按得越靠上踩得越深 ─────────
function bindPedal(id, name, min) {
  const el = $(id), fill = el.querySelector('i');
  const set = (e) => {
    const r = el.getBoundingClientRect();
    const depth = clamp((1 - (e.clientY - r.top) / r.height) * 1.12, 0, 1); // 最上面一小段就算踩到底
    input[name] = min + (1 - min) * depth;
    if (name === 'clutch') input.clutchSlow = false; else fill.style.height = input[name] * 100 + '%';
  };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(e); });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => {
    input[name] = 0;
    if (name !== 'clutch') fill.style.height = '0';
  });
}
// 三個踏板都從 0 開始：第一下按在哪裡就是多深，按在最下面幾乎沒踩
bindPedal('gas', 'gas', 0);
bindPedal('brake', 'brake', 0);
bindPedal('clutch', 'clutch', 0);

document.querySelectorAll('#shifter button').forEach((b) => {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); shift(b.dataset.gear); });
});
document.querySelectorAll('#acts button').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const a = b.dataset.act;
    if (a === 'door') toggleDoors();
    else if (a === 'cam') cycleCam();
    else calibrate(false);
  });
});

// 方向燈（左手）、雙黃燈（儀表上方）、手煞車（右手）
const tap = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
document.querySelectorAll('#signals button').forEach((b) => tap(b, () => setSignal(b.dataset.sig)));
tap($('hazard'), toggleHazard);
tap($('hand'), toggleHand);

// 沒有傾斜感應器時：在畫面上左右拖曳來轉方向盤
{
  const cv = $('c');
  let sx = 0, id = null;
  cv.addEventListener('pointerdown', (e) => { if (!tilt.active && app.running) { id = e.pointerId; sx = e.clientX; input.drag = 0; } });
  cv.addEventListener('pointermove', (e) => { if (e.pointerId === id) input.drag = clamp((e.clientX - sx) / 110, -1, 1); });
  for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, (e) => { if (e.pointerId === id) { id = null; input.drag = null; } });
}