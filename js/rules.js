// 交通違規與行車平順度判定：闖紅燈、超速、逆向、轉彎或變換車道沒打方向燈、進站出站沒打方向燈。全部用公車的格子座標（bg）判斷
import { CELL, LIMIT_KMH, ROAD_V, ROAD_H, nodeOf, hasLight } from './config.js';
import { lightState } from './world.js';
import { bus, bg, app } from './state.js';
import { addMoney } from './ui.js';
import { schoolTech } from './school.js';

const NEAR = 14;   // 離路口邊緣這麼近就算「正在過路口」：大客車轉彎要甩很大，這一段不判逆向與變換車道
let prevBox = null, speedingT = 0, wrongT = 0, laneCool = 0;
let zone = null;        // 進入路口範圍時記下的行車方向與時間；不在路口範圍時為 null
let lane = null;        // 目前在第幾個車道（由內往外，-1 = 壓到對向）；剛離開路口或重設後為 null
const sigT = { L: -99, R: -99 };   // 左、右方向燈最後一次亮著的時間
let departT = null;     // 在站牌關門的時間；之後起步時要檢查有沒有打左燈。不在等起步時為 null

// ── 行車平順度：車上有站著的乘客，頓一下就會站不穩 ──
// 數值是參考一般說法估的：公車平常的加減速約 1～1.5 m/s²，超過 2.5～3 站著的人就抓不住
let hardT = 0, comfortCool = 0, prevV = 0, prevA = 0;
// hit：這一格有沒有發生碰撞（碰撞另外扣錢，不算在這裡）。判斷用的是 bus.jolt：平滑過（約 0.1 秒）的加減速度
export function updateComfort(dt, hit) {
  comfortCool -= dt;
  const a = bus.jolt, v = bus.v;
  let why = '';
  if (hit) hardT = 0;
  else if (Math.abs(prevV) > 0.02 && v === 0 && prevA < -STOP_JOLT) why = '煞停太頓';   // 車停住前的那一刻還踩得很重，乘客會往前撲
  else if (Math.abs(a) > SPIKE) why = a < 0 ? '急煞' : '起步或換檔太猛';               // 瞬間的一大下：離合器放太快、轉速沒對上、重踩煞車
  else {
    hardT = Math.abs(a) > HARD ? hardT + dt : 0;                                          // 持續的大加減速
    if (hardT > 0.5) why = a < 0 ? '急煞' : '急加速';
  }
  // 駕訓班沒有乘客：同樣的情況算「其他技術操作不當」，每次扣 2 分
  if (why && comfortCool <= 0) { if (app.school) schoolTech(why + '（操作不當）'); else addMoney(-10, why + '，乘客站不穩'); comfortCool = 4; hardT = 0; }
  prevV = v; prevA = a;
}
const STOP_JOLT = 2.4, SPIKE = 4.2, HARD = 3;

export function resetRules() {
  hardT = 0; comfortCool = 0; prevV = 0; prevA = 0;
  prevBox = null; speedingT = 0; wrongT = 0; laneCool = 0; zone = null; lane = null; departT = null;
  sigT.L = sigT.R = -99;
}

// 進站：在停靠區開門時呼叫。靠邊停車前要打右燈（開門前 8 秒內打過就算）
export function checkArrive() {
  if (app.time - sigT.R > 8) addMoney(-20, '進站未打方向燈');
}
// 出站：在站牌關門時呼叫。之後車子一起步就檢查有沒有打左燈
export function startDepart() { departT = app.time; }
export const waitingDepart = () => departT !== null;
// 這一側的方向燈現在是不是亮著（提示用）
export const signalOn = (side) => bus.signal === side && !bus.hazard;

export function updateRules(dt) {
  const t = app.time, kmh = Math.abs(bus.v) * 3.6;
  if (bus.signal && !bus.hazard) sigT[bus.signal] = t;   // 開著雙黃燈時別人看不出方向燈，不算
  laneCool -= dt;
  // 出站起步：車子動起來的時候，從關門前 3 秒到現在都沒打過左燈就扣錢
  if (departT !== null && bus.v > 1) {
    if (sigT.L < departT - 3) addMoney(-20, '出站未打方向燈');
    departT = null;
  }

  // 闖紅燈：車頭進入路口的瞬間判定
  const hx = bg.x + bg.fx * 6, hz = bg.z + bg.fz * 6;
  const hi = nodeOf(hx), hj = nodeOf(hz);
  const inside = Math.abs(hx - hi * CELL) < ROAD_V[hi].half && Math.abs(hz - hj * CELL) < ROAD_H[hj].half;
  const key = inside ? hi + ',' + hj : null;
  if (key && key !== prevBox && hasLight(hi, hj) && bus.v > 1) {
    if (lightState(hi, hj, Math.abs(bg.fx) > Math.abs(bg.fz) ? 0 : 1) === 'r') addMoney(-100, '闖紅燈');
  }
  prevBox = key;

  // 超速
  speedingT = kmh > LIMIT_KMH + 6 ? speedingT + dt : 0;
  if (speedingT > 2) { addMoney(-20, '超速'); speedingT = 0; }

  // 以下看車身中心在哪：路口範圍內，還是某一條路的路段上
  const i = nodeOf(bg.x), j = nodeOf(bg.z), dx = bg.x - i * CELL, dz = bg.z - j * CELL;
  const hv = ROAD_V[i].half, hh = ROAD_H[j].half;
  const along = Math.abs(bg.fx) > Math.abs(bg.fz) ? { x: Math.sign(bg.fx), z: 0 } : { x: 0, z: Math.sign(bg.fz) };   // 車頭大致朝哪個方向
  if (Math.abs(dx) < hv + NEAR && Math.abs(dz) < hh + NEAR) {
    if (!zone) zone = { d: along, t };
    lane = null; wrongT = 0;
    return;
  }
  const vertical = Math.abs(dx) <= hv;   // 在縱向道路上（否則在橫向道路上）
  const aligned = (vertical ? Math.abs(bg.fz) : Math.abs(bg.fx)) > 0.8;
  const d = vertical ? { x: 0, z: Math.sign(bg.fz) || 1 } : { x: Math.sign(bg.fx) || 1, z: 0 };

  // 剛離開路口：跟進路口時的方向比，轉了彎卻沒打方向燈就扣錢（進路口前 4 秒內打過就算）
  if (zone) {
    if (aligned) {
      const cross = zone.d.x * d.z - zone.d.z * d.x;   // -1 左轉、+1 右轉、0 直行或迴轉
      const side = cross < 0 ? 'L' : 'R';
      if (cross !== 0 && bus.v > 0.5 && sigT[side] < zone.t - 4) addMoney(-30, (side === 'L' ? '左轉' : '右轉') + '未打方向燈');
    }
    zone = null;
  }
  if (!aligned || bus.v < 1.5) { wrongT = 0; return; }

  // 離中線多遠（右側為正）與所在車道
  const road = vertical ? ROAD_V[i] : ROAD_H[j];
  const lat = vertical ? dx * -d.z : dz * d.x;
  let now = lane;
  if (now === null) {
    now = lat < 0 ? -1 : road.n - 1;
    for (let k = 0; k < road.n; k++) if (lat >= road.bounds[k] && lat < road.bounds[k + 1]) now = k;
  } else {
    // 車身中心越過車道線 0.6 公尺才算換了車道，貼著線走不會來回跳
    const lo = now < 0 ? -Infinity : road.bounds[now], hi2 = now < 0 ? 0 : now >= road.n - 1 ? Infinity : road.bounds[now + 1];
    if (lat < lo - 0.6) now--; else if (lat > hi2 + 0.6) now++;
  }
  if (lane !== null && now !== lane && now >= 0 && lane >= 0 && laneCool <= 0) {
    const side = now < lane ? 'L' : 'R';
    if (t - sigT[side] > 3) { addMoney(-20, '變換車道未打方向燈'); laneCool = 3; }
  }
  lane = now;

  // 逆向：車身中心越過中線超過 0.3 公尺、持續 1.5 秒（大客車轉彎、閃違停車時短暫壓線不算）
  if (lat < -0.3) {
    wrongT += dt;
    if (wrongT > 1.5) { addMoney(-60, '逆向行駛'); wrongT = -3; }
  } else if (wrongT > 0) wrongT = 0;
  else wrongT = Math.min(0, wrongT + dt);
}