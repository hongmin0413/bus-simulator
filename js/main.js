// 進入點：關卡選單、暫停選單、主迴圈
import { CELL, HALF, LANE_OUT, IDLE, $ } from './config.js';
import { bus, eng, game, zone, input, tilt, app, placeBusAt } from './state.js';
import { updateLights, beam, stops, ROUTE_NODES, buildRoute } from './world.js';
import { updateBus, syncBusMesh } from './bus.js';
import { setGear, shift } from './engine.js';
import { cars, resetTraffic, updateCars } from './traffic.js';
import { setNextStop, updateService, toggleDoors } from './service.js';
import { updateHud } from './hud.js';
import { layout, render } from './view.js';
import { initAudio, updateAudio, setAudioPaused } from './audio.js';
import { enableTilt, calibrate } from './input.js';
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
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

// ───────── 關卡 ─────────
// 載入關卡：重建路線與車流，所有狀態歸零
function loadLevel(n) {
  const L = LEVELS[n];
  app.level = n;
  buildRoute(L);
  Object.assign(game, { money: 0, served: 0, laps: 0, onboard: [], service: null, timeMul: L.timeMul, lapDone: false, lapStart: 0 });
  Object.assign(bus, { doors: false, doorT: 0, jolt: 0, steerFrac: 0, hand: true, signal: null, hazard: false, blink: false });
  Object.assign(eng, { clutch: 0, rpm: IDLE, on: true, thr: 0 });
  input.gas = input.brake = input.clutch = 0;
  placeBusAt(ROUTE_NODES[0][0] * CELL + HALF + 12, ROUTE_NODES[0][1] * CELL + LANE_OUT, Math.PI / 2);
  resetTraffic(L);
  resetPeds(L.peds);
  setNextStop(0);
  setGear('N');
  syncBusMesh();
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

let tiltReady = false, wasFull = false;
async function goFull() {
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
  $('start').classList.add('hide');
  $('menu').hidden = true;
  $('hud').hidden = false;
  await goFull();
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
  setAudioPaused(true);
  input.gas = input.brake = input.clutch = 0;
  const result = mode === 'result';
  $('menuTitle').textContent = result ? '完成一圈！' : '暫停';
  $('mResume').textContent = result ? '繼續下一圈' : '繼續';
  $('result').hidden = !result;
  $('mSens').textContent = '轉向靈敏度：' + SENS_NAME[app.sens];
  $('menu').hidden = false;
}
function closeMenu() {
  $('menu').hidden = true;
  app.paused = false;
  setAudioPaused(false);
  last = performance.now();
  goFull();
}
function showResult() {
  const L = LEVELS[app.level], earned = game.money - game.lapStart;
  const n = earned >= L.goal ? 3 : earned >= L.goal * 0.6 ? 2 : 1;
  game.lapStart = game.money;
  const old = best[app.level];
  const record = !old || earned > old.money;
  if (record) { best[app.level] = { money: earned, stars: n }; store.set('bus-best', best); }
  $('resStars').textContent = stars(n);
  $('resText').textContent = `本圈收入 $${earned}（三星目標 $${L.goal}）${record ? '　新紀錄！' : `　最佳 $${old.money}`}`;
  openMenu('result');
}

$('pauseBtn').addEventListener('click', () => openMenu('pause'));
$('mResume').addEventListener('click', closeMenu);
$('mRestart').addEventListener('click', () => startLevel(app.level));
$('mLevels').addEventListener('click', () => {
  app.running = false; app.paused = false;
  $('menu').hidden = true;
  $('hud').hidden = true;
  renderLevels();
  $('start').classList.remove('hide');
});
$('mFull').addEventListener('click', goFull);
$('mCal').addEventListener('click', () => calibrate(false));
$('mSens').addEventListener('click', () => {
  app.sens = (app.sens + 1) % 3;
  store.set('bus-sens', app.sens);
  $('mSens').textContent = '轉向靈敏度：' + SENS_NAME[app.sens];
});
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyP' || e.repeat || !app.running) return;
  if (app.paused) closeMenu(); else openMenu('pause');
});
// 退出全螢幕或切到別的 App 時自動暫停；按「繼續」會再進全螢幕
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) wasFull = true;
  else if (wasFull && app.running && !app.paused) openMenu('pause');
});
document.addEventListener('visibilitychange', () => { if (document.hidden && app.running && !app.paused) openMenu('pause'); });

// ───────── 主迴圈 ─────────
function tick(dt) {
  app.time += dt;
  updateBus(dt);
  updateService(dt);
  updateCars(dt);
  updatePeds(dt);
}

let last = performance.now();
function frame(now) {
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
  requestAnimationFrame(frame);
}

loadLevel(0);   // 選單後面先放一個場景當背景
layout();
renderLevels();
$('loading').hidden = true;
requestAnimationFrame(frame);

// 除錯用：在主控台以 __sim.step(n) 同步推進 n 格（每格 1/60 秒）
window.__sim = {
  bus, eng, game, zone, input, tilt, app, stops, cars, peds, shift, toggleDoors, toggleHand, setSignal, toggleHazard,
  LEVELS, loadLevel, startLevel, openMenu, closeMenu,
  step(n) { for (let k = 0; k < n; k++) tick(1 / 60); },
};