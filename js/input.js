// 輸入：手機傾斜（方向盤）、觸控踏板與排檔、鍵盤
import { clamp, $ } from './config.js';
import { input, tilt, app, bus } from './state.js';
import { shift, canShift, onGear, ignition } from './engine.js';
import { eng } from './state.js';
import { toggleDoors, resetBus } from './service.js';
import { toast } from './ui.js';
import { toggleHand, setSignal, toggleHazard } from './signals.js';
import { setHorn } from './audio.js';

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
const cycleCam = () => { app.camMode = (app.camMode + 1) % 2; };   // 0 駕駛座、1 車外（車外視角的角度與遠近會記住，切回來還在原位）
addEventListener('keydown', (e) => {
  if (PEDAL[e.code]) { held[PEDAL[e.code]] = true; byKey[PEDAL[e.code]] = true; e.preventDefault(); return; }
  if (HOLD[e.code]) { input[HOLD[e.code]] = true; e.preventDefault(); return; }
  if (e.code === 'KeyG') { if (app.running && !app.paused) setHorn(true); return; }   // 喇叭：按住才響
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat || !app.running) return;
  if (e.code === 'Space') toggleHand();
  else if (e.code === 'KeyQ') setSignal('L');
  else if (e.code === 'KeyE') setSignal('R');
  else if (e.code === 'KeyH') toggleHazard();
  else if (e.code === 'Enter') ignition(true);
  const m = /^Digit([1-6])$/.exec(e.code);
  if (m) shift(m[1]);
  else if (e.code === 'KeyR') shift('R');
  else if (e.code === 'KeyN') shift('N');
  else if (e.code === 'KeyF') toggleDoors();
  else if (e.code === 'KeyC') cycleCam();
  else if (e.code === 'Backspace') resetBus();
  else if (e.code === 'KeyX') toggleWiper();
  else if (e.code === 'KeyM') { app.muted = !app.muted; toast(app.muted ? '已靜音' : '已開啟聲音'); }
});
addEventListener('keyup', (e) => {
  if (PEDAL[e.code]) held[PEDAL[e.code]] = false;
  if (HOLD[e.code]) input[HOLD[e.code]] = false;
  if (e.code === 'KeyG') setHorn(false);
  if (e.code === 'Enter') ignition(false);
});
addEventListener('blur', () => { held.gas = held.brake = held.clutch = false; input.left = input.right = false; setHorn(false); });

// 鍵盤踩踏板：按住越久踩越深，放開後慢慢回彈（每秒變化量：[踩下, 放開]）
// 離合器只在這裡設定目標，實際的快踩與慢放由 engine.js 依轉速處理
const held = { gas: false, brake: false, clutch: false }, byKey = { gas: false, brake: false, clutch: false };
const KEY_RATE = { gas: [2, 2.5], brake: [1.3, 3] };   // 油門約 0.5 秒踩到底、煞車約 0.8 秒
export function updateKeys(dt) {
  for (const name of ['gas', 'brake']) {
    if (!byKey[name]) continue;
    const [down, up] = KEY_RATE[name];
    input[name] = clamp(input[name] + (held[name] ? down : -up) * dt, 0, 1);
    if (!held[name] && input[name] === 0) byKey[name] = false;
  }
  if (byKey.clutch) { input.clutch = held.clutch ? 1 : 0; input.clutchSlow = true; }
}
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ───────── 不讓頁面被放大 ─────────
// 有些手機瀏覽器（尤其 iPhone）不理會「禁止縮放」的設定，連點兩下或兩指張開還是會把整個網頁放大，而且全螢幕時縮不回去
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });   // iPhone 的兩指縮放
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault());
{
  // 連點兩下：第二下如果不是點在按鈕上（按鈕另外用 css 的 touch-action 擋），就取消它的預設動作
  let last = 0;
  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    if (now - last < 350 && !e.target.closest('button, summary')) e.preventDefault();
    last = now;
  }, { passive: false });
  // 萬一還是被放大了：把禁止縮放的設定重新套用一次，瀏覽器會縮回原本的大小
  const vv = window.visualViewport, meta = document.querySelector('meta[name="viewport"]');
  if (vv && meta) vv.addEventListener('resize', () => {
    if (vv.scale < 1.02) return;
    const c = meta.content;
    meta.content = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1';
    requestAnimationFrame(() => { meta.content = c; });
  });
}

// ───────── 觸控踏板：按得越靠上踩得越深 ─────────
function bindPedal(id, name, min) {
  const el = $(id);
  const set = (e) => {
    const r = el.getBoundingClientRect();
    const depth = clamp((1 - (e.clientY - r.top) / r.height) * 1.12, 0, 1); // 最上面一小段就算踩到底
    input[name] = min + (1 - min) * depth;
    byKey[name] = false;
    if (name === 'clutch') input.clutchSlow = false;
  };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(e); });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { input[name] = 0; });
}
// 三個踏板都從 0 開始：第一下按在哪裡就是多深，按在最下面幾乎沒踩
bindPedal('gas', 'gas', 0);
bindPedal('brake', 'brake', 0);
bindPedal('clutch', 'clutch', 0);

// ───────── 拖曳排檔 ─────────
// knob.x：0~3 第幾排（0 = R 那一排）；knob.y：-1 上排檔位、0 空檔、1 下排檔位
// 排檔桿一直跟在手指底下，不會自己跳：
//   在檔位上時只能沿著那一排上下動（跟真車的 H 型槽一樣），不會橫向滑進別的檔；
//   拉回中間變成空檔後才能左右移動，離哪一排近就進哪一排，所以斜著拖（例如 2 檔往右上拖進 3 檔）也可以。
//   每次入檔後，會以手指當時的位置重新對準那一排，連續換檔時手指的左右偏移不會越積越多。
// 離合器沒踩到底會被擋住推不進去。
// R 檔有防誤入的擋塊（跟真車一樣，手不用離開排檔桿）：要先回到空檔，在空檔的橫槽裡往左多推一段、頂過擋塊才進得了 R 那一排；
// 還在檔位上、或斜著一路拖過去，都會被擋在外面。
{
  const gate = $('shifter'), knobEl = $('knob');
  const TOP = [null, '1', '3', '5'], BOT = ['R', '2', '4', '6'];
  const POS = { 1: [1, -1], 2: [1, 1], 3: [2, -1], 4: [2, 1], 5: [3, -1], 6: [3, 1], R: [0, 1] };
  const IN = 0.6, OUT = 0.35, STOP = 0.3;   // 推過 IN 入檔；退回 OUT 以內變空檔；被擋住時最多推到 STOP
  const R_STOP = 0.52, R_PUSH = 0.45;        // R 檔擋塊的位置（第幾排）；要多推多少排的距離才頂得開
  // x / y：畫面上排檔桿的位置；tx / ty：手指想帶它去的位置；col：目前對準哪一排
  const knob = { x: 2, y: 0, tx: 2, ty: 0, col: 2, id: null, px: 0, py: 0, warned: false, push: 0, rOpen: false, warnedR: false };
  const draw = () => {
    knobEl.style.left = (knob.x + 0.5) * 25 + '%';
    knobEl.style.top = 50 + knob.y * 34 + '%';
  };
  // 放手後排檔桿不會停在半路：在檔位上就卡進定位；空檔則像真車一樣被彈簧拉回正中（3、4 檔那一排）
  const settle = () => {
    const p = POS[eng.gear];
    if (p) { knob.x = p[0]; knob.y = p[1]; } else { knob.x = 2; knob.y = 0; }
    knob.tx = knob.x; knob.ty = knob.y; knob.col = knob.x;
    draw();
  };
  onGear(() => { if (knob.id === null) settle(); });
  gate.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (knob.id !== null) return;
    gate.setPointerCapture(e.pointerId);
    knob.id = e.pointerId; knob.px = e.clientX; knob.py = e.clientY;
    knob.tx = knob.x; knob.ty = knob.y; knob.col = Math.round(knob.x);
    knob.push = 0; knob.rOpen = knob.x < 0.5; knob.warnedR = false;   // 已經在 R 那一排的話，擋塊算是開著的
    knobEl.classList.add('drag');
  });
  gate.addEventListener('pointermove', (e) => {
    if (e.pointerId !== knob.id) return;
    const r = gate.getBoundingClientRect();
    let nx = knob.tx + (e.clientX - knob.px) / (r.width / 4);
    if (!knob.rOpen && nx < R_STOP) {
      // 撞到 R 檔的擋塊：在空檔的橫槽裡繼續往左推，累積推過 R_PUSH 才頂得開
      if (eng.gear === 'N' && Math.abs(knob.ty) < OUT) {
        knob.push += R_STOP - nx;
        if (knob.push > R_PUSH) knob.rOpen = true;
      } else if (!knob.warnedR && nx < R_STOP - 0.2) { toast('要先回空檔，再往左多推一點進 R 檔', 'bad'); knob.warnedR = true; }
      if (!knob.rOpen) nx = R_STOP;
    }
    if (nx > R_STOP + 0.1) { knob.push = 0; knob.rOpen = false; }   // 離開擋塊就復位
    knob.tx = clamp(nx, 0, 3);
    knob.ty = clamp(knob.ty + (e.clientY - knob.py) / (r.height * 0.34), -1, 1);
    knob.px = e.clientX; knob.py = e.clientY;
    // 空檔時可以左右移動，離哪一排近就對準哪一排；在檔位上時鎖在那一排
    if (eng.gear === 'N') knob.col = Math.round(knob.tx);
    if (knob.col === 0 && knob.ty < 0) knob.ty = 0;   // R 那一排只有下半段
    let y = knob.ty;
    const want = y < -IN ? TOP[knob.col] : y > IN ? BOT[knob.col] : Math.abs(y) < OUT ? 'N' : null;
    if (want && want !== eng.gear) {
      if (want === 'N') {
        if (canShift('N')) shift('N');
        else { if (!knob.warned) { shift('N'); knob.warned = true; } y = Math.sign(y) * (OUT + 0.04); }   // 還在出力：拉不出來
      }
      else if (canShift(want)) { shift(want); knob.tx = knob.col; }   // 入檔：以手指現在的位置重新對準這一排
      else {
        if (!knob.warned) { shift(want); knob.warned = true; }   // 只提示一次：打齒聲與原因
        y = Math.sign(y) * STOP;                                  // 被擋住：只能離開中間一點點
      }
    }
    if (Math.abs(y) < 0.25 || Math.abs(y) > IN + 0.2) knob.warned = false;
    knob.x = eng.gear === 'N' ? knob.tx : knob.col;
    knob.y = y;
    draw();
  });
  for (const ev of ['pointerup', 'pointercancel']) gate.addEventListener(ev, (e) => {
    if (e.pointerId !== knob.id) return;
    knob.id = null; knob.warned = false;
    knobEl.classList.remove('drag');
    settle();
  });
  draw();
}
// 雨刷開關
function toggleWiper() { if (app.running) bus.wiper = !bus.wiper; }

// 方向燈（左手）、雙黃燈（儀表上方）、手煞車與發動鈕（儀表兩側）
const tap = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
document.querySelectorAll('#signals [data-sig]').forEach((b) => tap(b, () => setSignal(b.dataset.sig)));
// 喇叭：按住才響，手指放開就停（跟發動鈕一樣，不把滑出按鈕當成放開）
{
  const b = $('horn');
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (app.running && !app.paused) { setHorn(true); b.classList.add('on'); } });
  for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => { setHorn(false); b.classList.remove('on'); });
}
tap($('hazard'), toggleHazard);
tap($('hand'), toggleHand);
tap($('doorBtn'), toggleDoors);
tap($('wiperBtn'), toggleWiper);
tap($('camBtn'), cycleCam);
tap($('calBtn'), () => calibrate(false));
// 發動鈕：按住到引擎點著才放；手指放開或滑出去就算放開
{
  // 只有「同一根手指真的放開」才算放開。手機上長按時，系統可能會送出 pointercancel（長按選單、螢幕底部的系統手勢），
  // 手指稍微滑出按鈕也會有 pointerleave；這些都不該讓發動中斷，否則在手機上永遠發不動
  const b = $('ign');
  let id = null;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    id = e.pointerId;
    try { b.setPointerCapture(id); } catch { /* 非必要 */ }
    ignition(true);
  });
  b.addEventListener('pointerup', (e) => { if (e.pointerId === id) { id = null; ignition(false); } });
}

// 在畫面上拖曳：車外視角時是繞著公車轉動鏡頭（兩指捏合或滑鼠滾輪可拉近拉遠）；駕駛座視角且沒有傾斜感應器時是轉方向盤
{
  const cv = $('c'), pts = new Map();   // 車外視角時按在畫面上的手指
  const zoom = (k) => { app.orbit.dist = clamp(app.orbit.dist * k, 9, 34); };   // 最遠到看得見整個路口左右，再遠車子太小沒有意義
  const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  let sx = 0, id = null, pinch = 0;
  cv.addEventListener('pointerdown', (e) => {
    if (!app.running) return;
    if (app.camMode === 1) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      app.orbit.drag = true;
      if (pts.size === 2) pinch = spread();
    } else if (!tilt.active && id === null) { id = e.pointerId; sx = e.clientX; input.drag = 0; }
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (p) {
      if (pts.size === 1) {
        app.orbit.yaw -= (e.clientX - p.x) * 0.009;
        app.orbit.pitch = clamp(app.orbit.pitch + (e.clientY - p.y) * 0.006, 0.06, 1.35);
      }
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) { const s = spread(); if (pinch > 0 && s > 0) zoom(pinch / s); pinch = s; }
    } else if (e.pointerId === id) input.drag = clamp((e.clientX - sx) / 110, -1, 1);
  });
  for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, (e) => {
    pts.delete(e.pointerId);
    if (!pts.size) app.orbit.drag = false;
    if (e.pointerId === id) { id = null; input.drag = null; }
  });
  cv.addEventListener('wheel', (e) => { if (app.running && app.camMode === 1) { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); } }, { passive: false });
}