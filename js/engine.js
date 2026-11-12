// 手排動力系統：引擎轉速與車輪轉速是兩個獨立的量，靠離合器的摩擦力矩互相拉近。
// 所以離合器放太快會頓一下甚至熄火，慢慢放（半離合）才能平順起步。
import { IDLE, REDLINE, GEAR_ACC, rpmPerMs, CLUTCH_BITE, CLUTCH_RANGE, clamp } from './config.js';
import { bus, eng, input, app, loadFactor } from './state.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';

// 每單位扭力讓引擎每秒改變的轉速。8 公升級柴油引擎最大扭力約 1100 N·m、引擎加飛輪的轉動慣量約 3 kg·m²，
// 換算約每秒 3500 rpm。慣量越小，離合器放太快時轉速掉得越快、越容易熄火
const INERTIA = 3500;
const CLUTCH_MAX = 1.6;    // 離合器完全接合時可傳遞的扭力（引擎最大扭力 = 1）
const STALL_RPM = 300;
const CRANK_TIME = 0.9;
// 怠速控制能補多少扭力：柴油引擎的調速器會一直補油把轉速拉回怠速，上限是低轉速、渦輪還沒增壓時的扭力，
// 約最大扭力的一半；轉速被拖到 400 rpm 以下才快速沒力
const lowTorque = (rpm) => clamp((rpm - 200) / 200, 0, 1) * 0.5;

// 按下發動鈕時做的事（測試時也可以直接呼叫，不用模擬「按住」）：引擎沒發動時是發動，一定要把離合器踩到底；
// 引擎運轉中再按一次是熄火，跟真車轉鑰匙一樣不用踩離合器，但要車子停住才有效（避免行駛中誤觸）
export function startEngine() {
  if (!app.running || app.paused || eng.crank > 0) return;
  if (eng.on) {
    if (Math.abs(bus.v) > 0.3) { toast('車子停住才能熄火', 'bad'); return; }
    eng.on = false;
    sfx.thump(0.2);
    toast('引擎已熄火');
    return;
  }
  if (eng.clutch < CLUTCH_BITE) { toast('要先把離合器踩到底才能發動', 'bad'); return; }
  eng.crank = CRANK_TIME;   // 啟動馬達先帶著引擎轉一秒左右才點得著（馬達聲由 audio.js 依 eng.crank 開關）
}

// 發動鈕按下、放開。發動要一直按著到引擎點著（像轉著鑰匙不放），中途放開啟動馬達就停；熄火按一下就好
export function ignition(down) {
  if (down) startEngine();
  else if (eng.crank > 0) { eng.crank = 0; toast('要按住「發動」直到引擎點著', 'bad'); }
}

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
  if (g === 'R' && eng.gear !== 'N') return '要先回空檔才能入 R 檔';
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
    // 什麼時候幫忙做半離合（只在正常行駛的情況下幫；其他情況離合器會直接放開，該熄火就熄火）：
    //   行進間（時速 3 公里以上）：換進任何檔位都幫，邊煞車邊降檔也幫。
    //   靜止起步：只有 1、2、R 檔幫；3～6 檔不幫。
    //   靜止時以下情況一律不幫：手煞車沒放、車門沒關、還踩著煞車。
    //   引擎沒發動（或正在發動）時也不幫。
    const wheelRpm = Math.abs(bus.v) * (g === 'N' ? 0 : rpmPerMs(g));
    const moving = Math.abs(bus.v) > 0.85;
    const canStart = (g === '1' || g === '2' || g === 'R') && !bus.hand && !bus.doors && input.brake < 0.1;
    const assist = eng.on && g !== 'N' && (moving ? !bus.hand && !bus.doors : canStart);
    if (assist && eng.clutch <= CLUTCH_BITE + 0.02 && eng.clutch > CLUTCH_BITE - CLUTCH_RANGE) {
      const slip = Math.abs(eng.rpm - wheelRpm);
      down = slip < 80 ? 2 : eng.rpm < 570 ? 0 : 0.3;
      // 轉速還在掉（例如踩著煞車或拉著手煞車）就把離合器踩回去一點，停在半離合不熄火
      if (slip >= 80 && eng.rpm < 545 && input.clutch < eng.clutch) eng.clutch = Math.min(CLUTCH_BITE, eng.clutch + 1.2 * dt);
    }
    eng.clutch += clamp(input.clutch - eng.clutch, -down * dt, 5 * dt);
  } else eng.clutch += clamp(input.clutch - eng.clutch, -12 * dt, 14 * dt);   // 觸控：完全跟著手指

  const grip = g === 'N' ? 0 : clamp((CLUTCH_BITE - eng.clutch) / CLUTCH_RANGE, 0, 1) * CLUTCH_MAX;

  // GEAR_ACC 是空車的數值；載了乘客車變重，同樣的扭力加速度變小（引擎煞車也一樣）
  const load = loadFactor();
  const STEPS = 4, h = dt / STEPS, ratio = grip ? rpmPerMs(g) : 0, acc = grip ? GEAR_ACC[g] * load : 0;
  let v = bus.v, sum = 0;
  for (let k = 0; k < STEPS; k++) {
    const rpm = eng.rpm;
    let torque = 0;
    if (eng.on) {
      // 大型柴油引擎的扭力：1000~1500 rpm 最大，往上越轉越沒力，所以該在 1700 rpm 左右升檔
      const curve = clamp(rpm < 1000 ? 0.65 + 0.35 * (rpm - 300) / 700 : rpm > 1500 ? 1 - (rpm - 1500) / 900 * 0.5 : 1, 0, 1);
      // 油門踏板不是線性的：柴油引擎踩一半就有大約七成半的力，後半段才是慢慢加到滿
      const gas = rpm > REDLINE ? 0 : (1 - (1 - eng.thr) ** 2) * curve;
      // 怠速控制：轉速一低於怠速就補油，補到上限為止。所以在平路上不踩油門、離合器放開，
      // 不管幾檔車都會維持怠速前進（真實的柴油大客車就是這樣）；爬坡、起步太急、或拖到上限還不夠時才會熄火
      const idleGov = clamp((IDLE + 10 - rpm) / 60, 0, 1) * lowTorque(rpm);
      torque = Math.max(gas, idleGov);
    } else if (eng.crank > 0) torque = clamp((260 - rpm) / 100, 0, 1) * 0.35;   // 啟動馬達把引擎帶到 200 多轉
    const friction = rpm > 1 ? 0.07 + 0.11 * rpm / REDLINE : 0;
    const clutchT = grip ? clamp((rpm - v * dir * ratio) / 120, -1, 1) * grip : 0;
    eng.rpm = Math.max(0, rpm + (torque - friction - clutchT) * INERTIA * h);
    const a = dir * clutchT * acc;
    v += a * h;
    sum += a;
  }

  if (eng.crank > 0) {
    eng.crank -= dt;
    // 離合器放掉，啟動馬達就斷電。發動中容許踏板稍微鬆一點（手機上另一隻手去按發動鈕時，踩離合器的手指容易往下滑）
    if (eng.clutch < CLUTCH_BITE - 0.25) { eng.crank = 0; toast('離合器鬆開了，發動中斷', 'bad'); }
    else if (eng.crank <= 0) { eng.on = true; eng.rpm = Math.max(eng.rpm, 350); toast('引擎已發動', 'good'); }
  }
  if (eng.on && eng.rpm < STALL_RPM && grip) {
    eng.on = false;
    sfx.thump(0.35);
    toast('熄火了！踩住離合器，按「發動」', 'bad');
  }
  return sum / STEPS;
}