// 進入點：關卡選單、暫停選單、主迴圈
import { CELL, EDGE, ROAD_V, ROAD_H, $ } from './config.js';
import { bus, bg, eng, game, zone, input, tilt, app, placeBusAt } from './state.js';
import { renderer, updateLights, beam, stops, ROUTE_NODES, buildRoute } from './world.js';
import { updateBus, syncBusMesh } from './bus.js';
import { setGear, shift, startEngine } from './engine.js';
import { cars, resetTraffic, updateCars } from './traffic.js';
import { setNextStop, updateService, toggleDoors } from './service.js';
import { updateHud, resetHud } from './hud.js';
import { resetRules } from './rules.js';
import { layout, render } from './view.js';
import { initAudio, updateAudio, setAudioPaused, setHorn } from './audio.js';
import { enableTilt, updateKeys } from './input.js';
import { toggleHand, setSignal, toggleHazard } from './signals.js';
import { LEVELS } from './levels.js';
import { peds, resetPeds, updatePeds } from './peds.js';

// ───────── 紀錄與設定（存在這支手機的瀏覽器裡）─────────
const store = {
  get(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 存不了就算了 */ } },
};
const best = store.get('bus-best', {});
const SENS_NAME = ['低', '中', '高'];
app.sens = [0, 1, 2].includes(store.get('bus-sens', 1)) ? store.get('bus-sens', 1) : 1;
// 畫面：省電（每秒 30 格、解析度較低，手機比較不燙）／流暢（每秒 60 格）。有觸控螢幕的裝置預設省電
const GFX_NAME = ['省電', '流暢'], GFX = [{ fps: 30, dpr: 1.25 }, { fps: 60, dpr: 1.5 }];
app.gfx = [0, 1].includes(store.get('bus-gfx')) ? store.get('bus-gfx') : navigator.maxTouchPoints > 0 ? 0 : 1;
function applyGfx() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, GFX[app.gfx].dpr));
  layout();
}
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

// ───────── 關卡 ─────────
// 載入關卡：重建路線與車流，所有狀態歸零
function loadLevel(n) {
  const L = LEVELS[n];
  app.level = n;
  buildRoute(L);
  Object.assign(game, { money: 0, served: 0, onboard: [], service: null, timeMul: L.timeMul, lapDone: false });
  Object.assign(bus, { doors: false, doorT: 0, jolt: 0, roll: 0, steerFrac: 0, hand: true, signal: null, hazard: false, blink: false });
  Object.assign(eng, { clutch: 0, rpm: 0, on: false, thr: 0, crank: 0 });   // 開場引擎是熄火的，要踩離合器按「發動」
  input.gas = input.brake = input.clutch = 0;
  // 起點：路線第一個路口往東 24 公尺、最外側車道
  const [i0, j0] = ROUTE_NODES[0], road = ROAD_H[j0];
  placeBusAt(i0 * CELL + ROAD_V[i0].half + 24, j0 * CELL + road.half - EDGE - 2.3, Math.PI / 2);
  resetRules();
  resetTraffic(L);
  resetPeds(L.peds);
  setNextStop(0);
  setGear('N');
  syncBusMesh();
  resetHud();
}

function renderLevels() {
  const box = $('levels');
  box.textContent = '';
  LEVELS.forEach((L, n) => {
    const b = document.createElement('button');
    const rec = best[n];
    const add = (cls, text) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; b.appendChild(e); };
    add('nm', `${n + 1}. ${L.name}`);
    add('ds', L.desc);
    add('rc', rec ? `${stars(rec.stars)}　最佳 $${rec.money}` : `尚未完成　三星目標 $${L.goal}`);
    b.addEventListener('click', () => startLevel(n));
    box.appendChild(b);
  });
}

// wantFull：使用者想不想要全螢幕。自己按切換鈕退出就記成不要，之後不會再自動進去
let tiltReady = false, wasFull = false, wantFull = true;
const canFull = !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
document.documentElement.classList.toggle('nofs', !canFull);
// 沒有觸控螢幕的裝置不會有傾斜感應，「校正」按鈕就不顯示
document.documentElement.classList.toggle('notouch', !(navigator.maxTouchPoints > 0));
async function goFull() {
  if (!canFull) return;
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* 非必要 */ }
  try { await screen.orientation.lock('landscape'); } catch { /* 非必要 */ }
  try { await navigator.wakeLock.request('screen'); } catch { /* 非必要 */ }
  layout();
  setTimeout(layout, 400); // 進入全螢幕、轉向後版面會再變一次
}

async function startLevel(n) {
  initAudio();
  if (!tiltReady) { tiltReady = true; await enableTilt(); }
  loadLevel(n);
  $('levelCancel').hidden = true;
  $('start').classList.add('hide');
  $('menu').hidden = true;
  $('hud').hidden = false;
  layout();   // 後照鏡的位置要在 HUD 顯示之後重算（HUD 隱藏時量到的大小是 0，鏡子會被關掉）
  if (wantFull) await goFull();
  tilt.needCal = true;   // 以現在拿手機的角度當作方向盤正中
  app.paused = false;
  app.running = true;
  setAudioPaused(false);
  last = performance.now();
}

// ───────── 暫停與結算選單 ─────────
function openMenu(mode) {
  if (!app.running) return;
  app.paused = true;
  setHorn(false);
  setAudioPaused(true);
  input.gas = input.brake = input.clutch = 0;
  const result = mode === 'result';
  $('menuTitle').textContent = result ? '完成一圈！' : '暫停';
  // 結算畫面只留「重新開始」「選擇關卡」
  $('mResume').hidden = $('mSens').hidden = $('mGfx').hidden = result;
  $('result').hidden = !result;
  $('mSens').textContent = '轉向靈敏度：' + SENS_NAME[app.sens];
  $('mGfx').textContent = '畫面：' + GFX_NAME[app.gfx];
  $('menu').hidden = false;
}
function closeMenu() {
  $('menu').hidden = true;
  app.paused = false;
  setAudioPaused(false);
  last = performance.now();
  if (wantFull) goFull();
}
function showResult() {
  const L = LEVELS[app.level], earned = game.money;
  const n = earned >= L.goal ? 3 : earned >= L.goal * 0.6 ? 2 : 1;
  const old = best[app.level];
  const record = !old || earned > old.money;
  if (record) { best[app.level] = { money: earned, stars: n }; store.set('bus-best', best); }
  $('resStars').textContent = stars(n);
  $('resText').textContent = `總收入 $${earned}（三星目標 $${L.goal}）${record ? '　新紀錄！' : `　最佳 $${old.money}`}`;
  openMenu('result');
}

$('pauseBtn').addEventListener('click', () => openMenu('pause'));
$('mResume').addEventListener('click', closeMenu);
$('mRestart').addEventListener('click', () => startLevel(app.level));
// 從暫停選單去選關卡：遊戲維持暫停，選了才真的換；按取消就回到原本的選單，進度不變
$('mLevels').addEventListener('click', () => {
  $('menu').hidden = true;
  $('hud').hidden = true;
  renderLevels();
  $('levelCancel').hidden = false;
  $('start').classList.remove('hide');
});
$('levelCancel').addEventListener('click', () => {
  $('start').classList.add('hide');
  $('levelCancel').hidden = true;
  $('hud').hidden = false;
  $('menu').hidden = false;
  layout();
});
// 切換全螢幕的按鈕（每個畫面各一個）
function toggleFull() {
  if (document.fullscreenElement) { wantFull = false; document.exitFullscreen().catch(() => {}); }
  else { wantFull = true; goFull(); }
}
document.querySelectorAll('.fsToggle').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleFull(); }));
// 瀏覽器規定全螢幕要由點擊觸發，所以開啟網頁後第一次點畫面時就進全螢幕
document.addEventListener('click', () => { if (wantFull) goFull(); }, { once: true });
$('mGfx').addEventListener('click', () => {
  app.gfx = (app.gfx + 1) % 2;
  store.set('bus-gfx', app.gfx);
  $('mGfx').textContent = '畫面：' + GFX_NAME[app.gfx];
  applyGfx();
});
$('mSens').addEventListener('click', () => {
  app.sens = (app.sens + 1) % 3;
  store.set('bus-sens', app.sens);
  $('mSens').textContent = '轉向靈敏度：' + SENS_NAME[app.sens];
});
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyP' || e.repeat || !app.running || !$('start').classList.contains('hide') || !$('result').hidden) return;
  if (app.paused) closeMenu(); else openMenu('pause');
});
// 退出全螢幕或切到別的 App 時自動暫停；按「繼續」會再進全螢幕
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  document.querySelectorAll('.fsToggle[data-label]').forEach((b) => { b.textContent = on ? '退出全螢幕' : '全螢幕'; });
  layout();
  if (on) wasFull = true;
  else if (wasFull && wantFull && app.running && !app.paused) openMenu('pause');   // 不是自己按鈕退出的（例如按返回鍵）才暫停
});
document.addEventListener('visibilitychange', () => { if (document.hidden && app.running && !app.paused) openMenu('pause'); });

// ───────── 主迴圈 ─────────
function tick(dt) {
  app.time += dt;
  updateKeys(dt);
  updateBus(dt);
  updateService(dt);
  updateCars(dt);
  updatePeds(dt);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  // 限制每秒格數：很多手機螢幕是 90／120 Hz，不限制的話顯示晶片會一直全速運轉、發燙
  if (now - last < 1000 / GFX[app.gfx].fps - 3) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (app.running && !app.paused) {
    tick(dt);
    updateHud();
    updateAudio(dt);
    if (game.lapDone) { game.lapDone = false; showResult(); }
  }
  updateLights();
  beam.material.opacity = 0.16 + 0.08 * Math.sin(now / 300);
  render(dt);
}

loadLevel(0);   // 選單後面先放一個場景當背景
applyGfx();
renderLevels();
$('loading').hidden = true;
requestAnimationFrame(frame);

// 除錯用：在主控台以 __sim.step(n) 同步推進 n 格（每格 1/60 秒）
window.__sim = {
  bus, bg, eng, game, zone, input, tilt, app, stops, cars, peds, shift, startEngine, toggleDoors, toggleHand, setSignal, toggleHazard,
  LEVELS, loadLevel, startLevel, openMenu, closeMenu,
  step(n) { for (let k = 0; k < n; k++) tick(1 / 60); },
  // 測試用的自動駕駛：沿著目前這條路走，保持離中線 lat 公尺（右側為正）。每格呼叫一次再 step(1)；路是彎的，不轉方向盤會撞上人行道
  hold(lat) {
    const v = Math.abs(bg.fx) < Math.abs(bg.fz), d = v ? { x: 0, z: Math.sign(bg.fz) } : { x: Math.sign(bg.fx), z: 0 };
    const off = v ? (bg.x - Math.round(bg.x / CELL) * CELL) * -d.z : (bg.z - Math.round(bg.z / CELL) * CELL) * d.x;
    const he = Math.atan2(bg.fx * d.z - bg.fz * d.x, bg.fx * d.x + bg.fz * d.z);
    input.drag = Math.max(-1, Math.min(1, (lat - off) * 0.12 + he * 1.6));
  },
};