// 手排動力系統：引擎轉速與車輪轉速是兩個獨立的量，靠離合器的摩擦力矩互相拉近。
// 所以離合器放太快會頓一下甚至熄火，慢慢放（半離合）才能平順起步。
import { IDLE, REDLINE, GEAR_ACC, rpmPerMs, CLUTCH_BITE, CLUTCH_RANGE, clamp } from './config.js';
import { bus, eng, input, app } from './state.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';

const INERTIA = 1800;      // 每單位扭力讓引擎每秒改變的轉速
const CLUTCH_MAX = 1.6;    // 離合器完全接合時可傳遞的扭力（引擎最大扭力 = 1）
const STALL_RPM = 250;

export function setGear(g) {
  eng.gear = g;
  document.querySelectorAll('#shifter button').forEach((b) => b.classList.toggle('cur', b.dataset.gear === g));
}

export function shift(g) {
  if (!app.running || g === eng.gear) return;
  if (g !== 'N' && eng.clutch < CLUTCH_BITE) { toast('離合器要踩到底才能換檔', 'bad'); sfx.grind(); return; }
  if (g === 'R' && bus.v > 1) { toast('車還在前進，不能入 R 檔', 'bad'); sfx.grind(); return; }
  if (g !== 'R' && g !== 'N' && bus.v < -1) { toast('車還在倒退，先停下來', 'bad'); sfx.grind(); return; }
  setGear(g);
  sfx.shift();
}

// 推進引擎與離合器，回傳引擎經離合器傳到車輪的加速度 (m/s²)
export function updateEngine(dt) {
  eng.thr += clamp((bus.doors ? 0 : input.gas) - eng.thr, -6 * dt, 4 * dt);
  // 鍵盤放開離合器時自動慢放；觸控則完全跟著手指
  eng.clutch += clamp(input.clutch - eng.clutch, -(input.clutchSlow ? 1.3 : 12) * dt, 14 * dt);

  const g = eng.gear, dir = g === 'R' ? -1 : 1;
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
      const curve = clamp(rpm < 800 ? 0.6 + 0.4 * (rpm - 300) / 500 : rpm > 2000 ? 1 - (rpm - 2000) / 400 * 0.6 : 1, 0, 1);
      const gas = rpm > REDLINE ? 0 : eng.thr * curve;
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