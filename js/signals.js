// 手煞車、方向燈、雙黃燈
import { bus, app } from './state.js';
import { sfx } from './audio.js';

let blinkT = 0, turned = false;

// side: 'L' 或 'R'。該側的燈此刻是否亮著
export const lampOn = (side) => bus.blink && (bus.hazard || bus.signal === side);

function restart() {
  blinkT = 0;
  bus.blink = bus.hazard || !!bus.signal;
  if (bus.blink) sfx.tick(true);
}
export function toggleHand() {
  if (!app.running) return;
  bus.hand = !bus.hand;
  if (bus.hand) sfx.air(0.7, 0.2);   // 拉起手煞車：彈簧煞車氣室把氣排掉，很大的一聲「噗嘶——」   // 放開時的洩氣聲由 bus.js 處理
}
export function setSignal(side) {
  if (!app.running) return;
  bus.signal = bus.signal === side ? null : side;
  turned = false;
  restart();
}
export function toggleHazard() {
  if (!app.running) return;
  bus.hazard = !bus.hazard;
  restart();
}

export function updateSignals(dt) {
  // 轉彎後方向盤回正，方向燈自動跳掉
  if (bus.signal) {
    const s = bus.steerFrac * (bus.signal === 'R' ? 1 : -1);
    if (s > 0.4) turned = true;
    else if (turned && s < 0.12) { bus.signal = null; turned = false; }
  }
  if (!bus.hazard && !bus.signal) { bus.blink = false; return; }
  blinkT += dt;
  if (blinkT >= 0.38) { blinkT = 0; bus.blink = !bus.blink; sfx.tick(bus.blink); }
}