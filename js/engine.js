// 手排動力系統：引擎轉速與車輪轉速是兩個獨立的量，靠離合器的摩擦力矩互相拉近。
// 所以離合器放太快會頓一下甚至熄火，慢慢放（半離合）才能平順起步。
import { IDLE, REDLINE, GEAR_ACC, rpmPerMs, CLUTCH_BITE, CLUTCH_RANGE, clamp } from './config.js';
import { bus, eng, input, app } from './state.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';

const INERTIA = 1800;      // 每單位扭力讓引擎每秒改變的轉速
const CLUTCH_MAX = 1.6;    // 離合器完全接合時可傳遞的扭力（引擎最大扭力 = 1）
const STALL_RPM = 250;

const gearListeners = [];
export const onGear = (fn) => gearListeners.push(fn);   // 檔位改變時通知（排檔桿畫面用）
export function setGear(g) {
  eng.gear = g;
  document.querySelectorAll('#shifter [data-gear]').forEach((b) => b.classList.toggle('cur', b.dataset.gear === g));
  gearListeners.forEach((fn) => fn(g));
}

// 現在能不能入這個檔；不能時回傳原因
function shiftBlock(g) {
  if (g !== 'N' && eng.clutch < CLUTCH_BITE) return '離合器要踩到底才能換檔';
  if (g === 'R' && bus.v > 1) return '車還在前進，不能入 R 檔';
  if (g !== 'R' && g !== 'N' && bus.v < -1) return '車還在倒退，先停下來';
  return '';
}
export const canShift = (g) => app.running && !shiftBlock(g);

export function shift(g) {
  if (!app.running || g === eng.gear) return;
  const why = shiftBlock(g);
  if (why) { toast(why, 'bad'); sfx.grind(); return; }
  setGear(g);
  sfx.shift();
}

// 推進引擎與離合器，回傳引擎經離合器傳到車輪的加速度 (m/s²)
export function updateEngine(dt) {
  eng.thr += clamp((bus.doors ? 0 : input.gas) - eng.thr, -6 * dt, 4 * dt);
  const g = eng.gear, dir = g === 'R' ? -1 : 1;
  if (input.clutchSlow) {
    // 鍵盤：按下約 0.2 秒踩到底；放開時自動幫忙做半離合——
    // 還沒接合前放得快，進入接合區後看轉速差慢慢放，引擎快被拖熄火就先停住不放，轉速接上了再整個放開
    let down = 3;
    // 什麼時候幫忙做半離合：
    //   起步用的檔位（1、2、R）隨時都幫；3~6 檔只有車速撐得住這個檔位（接上後轉速不低於 500）才幫，
    //   所以行進間換檔會平順，但用高檔位起步不幫，會頓或熄火。手煞車沒放一律不幫。
    const wheelRpm = Math.abs(bus.v) * (g === 'N' ? 0 : rpmPerMs(g));
    const assist = !bus.hand && g !== 'N' && (g === '1' || g === '2' || g === 'R' || wheelRpm >= 500);
    if (assist && eng.clutch <= CLUTCH_BITE + 0.02 && eng.clutch > CLUTCH_BITE - CLUTCH_RANGE) {
      const slip = Math.abs(eng.rpm - wheelRpm);
      down = slip < 80 ? 2 : eng.rpm < 520 ? 0 : 0.3;
      // 轉速還在掉（例如踩著煞車或拉著手煞車）就把離合器踩回去一點，停在半離合不熄火
      if (slip >= 80 && eng.rpm < 500 && input.clutch < eng.clutch) eng.clutch = Math.min(CLUTCH_BITE, eng.clutch + 1.2 * dt);
    }
    eng.clutch += clamp(input.clutch - eng.clutch, -down * dt, 5 * dt);
  } else eng.clutch += clamp(input.clutch - eng.clutch, -12 * dt, 14 * dt);   // 觸控：完全跟著手指

  const grip = g === 'N' ? 0 : clamp((CLUTCH_BITE - eng.clutch) / CLUTCH_RANGE, 0, 1) * CLUTCH_MAX;

  if (!eng.on && (eng.clutch > 0.8 || g === 'N')) {
    eng.on = true;
    eng.rpm = Math.max(eng.rpm, 350);
    sfx.starter();
    toast('引擎已發動', 'good');
  }

  const STEPS = 4, h = dt / STEPS, ratio = grip ? rpmPerMs(g) : 0, acc = grip ? GEAR_ACC[g] : 0;
  let v = bus.v, sum = 0;
  for (let k = 0; k < STEPS; k++) {
    const rpm = eng.rpm;
    let torque = 0;
    if (eng.on) {
      // 大型柴油引擎的扭力：1000~1500 rpm 最大，往上越轉越沒力，所以該在 1700 rpm 左右升檔
      const curve = clamp(rpm < 1000 ? 0.65 + 0.35 * (rpm - 300) / 700 : rpm > 1500 ? 1 - (rpm - 1500) / 900 * 0.5 : 1, 0, 1);
      // 油門踏板不是線性的：柴油引擎踩一半就有大約七成半的力，後半段才是慢慢加到滿
      const gas = rpm > REDLINE ? 0 : (1 - (1 - eng.thr) ** 2) * curve;
      const idleGov = clamp((IDLE + 40 - rpm) / 150, 0, 1) * 0.4; // 怠速控制
      torque = Math.max(gas, idleGov);
    }
    const friction = rpm > 1 ? 0.07 + 0.11 * rpm / REDLINE : 0;
    const clutchT = grip ? clamp((rpm - v * dir * ratio) / 120, -1, 1) * grip : 0;
    eng.rpm = Math.max(0, rpm + (torque - friction - clutchT) * INERTIA * h);
    const a = dir * clutchT * acc;
    v += a * h;
    sum += a;
  }

  if (eng.on && eng.rpm < STALL_RPM && grip) {
    eng.on = false;
    sfx.thump(0.35);
    toast('熄火了！離合器踩到底重新發動', 'bad');
  }
  return sum / STEPS;
}