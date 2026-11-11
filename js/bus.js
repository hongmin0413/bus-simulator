// 公車模型與行駛物理
import { CELL, HALF, WHEELBASE, LIMIT_KMH, clamp, angDiff, onRoad, hasLight } from './config.js';
import { THREE, scene, box, lambert, basic, lightState, stops } from './world.js';
import { bus, eng, game, zone, input, tilt, app, busCenter } from './state.js';
import { updateEngine } from './engine.js';
import { cars } from './traffic.js';
import { addMoney } from './ui.js';
import { sfx } from './audio.js';
import { updateSignals, lampOn } from './signals.js';
import { peds, finishCrossing } from './peds.js';

// 原點在後軸中心。區域 +z 為車頭，+x 為左側（駕駛座），-x 為右側（車門）
export const busMesh = new THREE.Group();
export const ext = new THREE.Group();     // 車外看得到的部分
export const cabin = new THREE.Group();   // 駕駛艙內裝
busMesh.add(ext, cabin);
const brakeMat = basic(0x661111);
const sigMat = { L: basic(0x6a4a00), R: basic(0x6a4a00) };
const doorMeshes = [], frontWheels = [];
let steeringWheel;
{
  box(ext, lambert(0x0e9f86), 2.55, 2.9, 12, 0, 1.9, 3);
  box(ext, lambert(0xf4f6f7), 2.57, 0.5, 12.02, 0, 1.25, 3);
  box(ext, lambert(0x1a2733), 2.59, 1.05, 10.4, 0, 2.55, 2.9);
  box(ext, lambert(0x1a2733), 2.3, 1.5, 0.06, 0, 2.3, 9.0);
  box(ext, lambert(0xdfe5e8), 2.2, 0.12, 9, 0, 3.4, 3);
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 48;
  const g = cv.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#ffb300'; g.font = 'bold 34px "Microsoft JhengHei", "Noto Sans TC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('1 市區環線', 128, 26);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.38), basic(0xffffff, { map: new THREE.CanvasTexture(cv) }));
  sign.position.set(0, 3.13, 9.04);
  ext.add(sign);
  for (const x of [-0.9, 0.9]) {
    box(ext, basic(0xfff6c8), 0.4, 0.2, 0.06, x, 0.9, 9.01);
    box(ext, brakeMat, 0.4, 0.25, 0.06, x, 1.1, -3.01);
  }
  // 方向燈：前、後、車側各一顆（+x 是左側）
  for (const [side, x] of [['L', 1], ['R', -1]]) {
    box(ext, sigMat[side], 0.16, 0.2, 0.06, x * 1.19, 0.9, 9.02);
    box(ext, sigMat[side], 0.16, 0.25, 0.06, x * 1.19, 1.42, -3.02);
    box(ext, sigMat[side], 0.06, 0.14, 0.3, x * 1.3, 1.3, 6.2);
  }
  const doorMat = lambert(0x37546b);
  for (const z of [7.7, 2.6]) {
    const d = box(ext, doorMat, 0.08, 2.15, 1.3, -1.29, 1.55, z);
    d.userData.z = z;
    doorMeshes.push(d);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.36, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const tyre = lambert(0x17181a);
  // 輪胎略凸出車身，加上淺色輪圈與深色輪拱，後照鏡裡才認得出前後輪
  const hubGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 14);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = lambert(0xc9ced6), arch = lambert(0x101317);
  for (const z of [0, WHEELBASE]) for (const x of [-1.2, 1.2]) {
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.add(new THREE.Mesh(hubGeo, hub));
    box(ext, arch, 0.05, 0.85, 1.4, Math.sign(x) * 1.275, 0.72, z);
    w.position.set(x, 0.52, z);
    ext.add(w);
    if (z) frontWheels.push(w);
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 12.8), basic(0x000000, { transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.04, 3);
  ext.add(shadow);

  // 駕駛艙（左駕）。駕駛的眼睛在 [0.8, 2.3, 7.1]（見 view.js），座位貼著左側車窗、在前輪前方
  const trim = lambert(0x2b3038), dark = lambert(0x14171c), rim = lambert(0x3a4049), grey = lambert(0x6b727c), yellow = lambert(0xf2c200);
  // 儀表台：低而平，上緣在視線下方，才看得到車頭前的路面
  box(cabin, trim, 2.5, 0.5, 0.7, 0, 1.25, 8.62);
  box(cabin, dark, 2.5, 0.06, 0.75, 0, 1.52, 8.62);
  // 駕駛正前方的儀表罩與兩顆錶
  box(cabin, dark, 0.86, 0.26, 0.3, 0.8, 1.66, 8.42);
  const gaugeGeo = new THREE.CircleGeometry(0.075, 20);
  for (const gx of [0.62, 0.98]) {
    const face = new THREE.Mesh(gaugeGeo, basic(0x24323f));
    face.position.set(gx, 1.67, 8.265);
    face.rotation.y = Math.PI;   // 面向駕駛
    cabin.add(face);
    box(cabin, basic(0xff5a4a), 0.012, 0.065, 0.005, gx - 0.015, 1.69, 8.26);
  }
  // 前擋風玻璃的框：左右 A 柱、上方的路線牌箱、駕駛側遮陽板、車內後照鏡
  box(cabin, dark, 0.09, 1.85, 0.09, 1.24, 2.45, 8.98);
  box(cabin, dark, 0.09, 1.85, 0.09, -1.24, 2.45, 8.98);
  box(cabin, dark, 2.6, 0.34, 0.3, 0, 3.26, 8.88);
  box(cabin, trim, 0.9, 0.22, 0.03, 0.8, 3.0, 8.72);
  box(cabin, dark, 0.46, 0.15, 0.04, 0.05, 2.98, 8.74);
  box(cabin, basic(0x9fb4c6), 0.42, 0.11, 0.01, 0.05, 2.98, 8.715);
  // 左側：駕駛旁的車身與窗框（窗台以下是車身，以上是玻璃）
  box(cabin, trim, 0.08, 1.0, 2.9, 1.265, 1.05, 7.55);
  box(cabin, dark, 0.08, 0.1, 2.9, 1.265, 3.33, 7.55);
  box(cabin, dark, 0.08, 1.85, 0.1, 1.265, 2.45, 6.2);
  // 地板與天花板；右前方是車門，地板在那裡下降成上車階梯
  box(cabin, grey, 1.8, 0.06, 3.2, 0.37, 0.97, 7.4);
  box(cabin, grey, 0.76, 0.06, 1.9, -0.9, 0.6, 8.0);
  box(cabin, yellow, 0.05, 0.37, 1.9, -0.52, 0.8, 8.0);
  box(cabin, trim, 2.55, 0.05, 3.2, 0, 3.4, 7.4);
  // 右側前門：門框後柱、門的下半部、扶手、投幣箱
  box(cabin, dark, 0.08, 2.6, 0.1, -1.265, 2.05, 7.02);
  box(cabin, trim, 0.06, 0.55, 1.85, -1.27, 0.72, 8.0);
  box(cabin, dark, 0.06, 0.08, 1.85, -1.27, 2.0, 8.0);
  box(cabin, yellow, 0.045, 2.3, 0.045, -0.5, 2.15, 7.1);
  box(cabin, grey, 0.3, 0.75, 0.3, -0.3, 1.4, 8.05);
  box(cabin, yellow, 0.32, 0.06, 0.32, -0.3, 1.8, 8.05);
  // 方向盤：大客車的方向盤又大又平，像端著一個盤子
  const pivot = new THREE.Group();
  // 位置比真車離駕駛遠一點、高一點，這樣直視前方時畫面下緣還看得到方向盤的上半圈
  pivot.position.set(0.8, 1.56, 7.98);
  pivot.rotation.x = 1.0;   // 盤面朝上偏向駕駛，遠端比近端高
  box(pivot, dark, 0.1, 0.1, 0.55, 0, 0, 0.28);   // 轉向柱往前下方伸進儀表台
  steeringWheel = new THREE.Group();
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.027, 8, 32), rim));
  box(steeringWheel, rim, 0.48, 0.055, 0.03, 0, 0, 0);
  box(steeringWheel, rim, 0.055, 0.25, 0.03, 0, -0.125, 0);
  box(steeringWheel, dark, 0.16, 0.16, 0.05, 0, 0, 0);
  pivot.add(steeringWheel);
  cabin.add(pivot);
  scene.add(busMesh);
}

// 車身上用來判斷是否壓上人行道的取樣點 [左右, 前後]
const SAMPLE = [[-1.05, -2.4], [1.05, -2.4], [-1.05, 8.6], [1.05, 8.6], [-1.05, 3], [1.05, 3]];
function blocked(x, z, h) {
  const fx = Math.sin(h), fz = Math.cos(h);
  for (const [lx, lz] of SAMPLE) {
    if (!onRoad(x + lx * fz + lz * fx, z - lx * fx + lz * fz, 0.9)) return true;
  }
  return false;
}

// 轉向靈敏度（低、中、高）：手機轉幾弧度打到底，約 23、16、11 度
export const SENS = [0.4, 0.28, 0.19];
const MAX_STEER = 0.85;
let pedCool = 0, hitCooldown = 0, speedingT = 0, prevBoxKey = null, wasBraking = false;
function crash(text) {
  const hard = Math.abs(bus.v) > 1.5;
  bus.v = -bus.v * 0.25;
  if (hard && hitCooldown <= 0) { addMoney(-50, text); sfx.thump(0.5); hitCooldown = 1.5; }
}

export function updateBus(dt) {
  hitCooldown -= dt;

  // 方向盤：手機傾斜 > 畫面拖曳 > 鍵盤
  let target, rate = 1.6;
  if (tilt.active) {
    let t = angDiff(tilt.raw, tilt.zero) / SENS[app.sens];   // 手機轉到這個角度就打到底
    t = Math.abs(t) < 0.04 ? 0 : t;
    tilt.val += (clamp(t, -1, 1) - tilt.val) * Math.min(1, dt * 28);
    target = tilt.val; rate = 14;
  } else if (input.drag !== null) { target = input.drag; rate = 4; }
  else target = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  bus.steerFrac += clamp(target - bus.steerFrac, -rate * dt, rate * dt);
  // 輪胎最大轉角約 49 度（最小迴轉半徑約 5 公尺）。中間段比較細膩、越往外打越多；車速越快轉角越小
  bus.steer = Math.sign(bus.steerFrac) * Math.abs(bus.steerFrac) ** 1.15 * MAX_STEER / (1 + Math.abs(bus.v) * 0.045);

  // 縱向：引擎（經離合器）+ 煞車 + 阻力
  const hand = bus.hand || bus.doors, brk = input.brake;
  const v0 = bus.v;
  const engA = updateEngine(dt);
  // 手煞車（與開門時的連鎖煞車）只作用在後軸：行進間拉起的減速度比腳煞車小，車停住後才鎖得住引擎的推力
  const brakeA = brk * 6 + (hand ? (Math.abs(bus.v) > 0.5 ? 3.5 : 8) : 0);
  let a = engA;
  if (Math.abs(bus.v) > 0.02) a -= Math.sign(bus.v) * (brakeA + 0.15) + bus.v * 0.015;
  bus.v += a * dt;
  const braking = brk > 0 || hand;
  if (v0 !== 0 && v0 * bus.v < 0 && (braking || Math.abs(engA) < 0.05)) bus.v = 0;
  if (braking && Math.abs(bus.v) < 0.15 && Math.abs(engA) < brakeA) bus.v = 0;
  if (Math.abs(bus.v) < 0.03 && Math.abs(engA) < 0.01) bus.v = 0;
  bus.v = clamp(bus.v, -6, 30);
  // 加減速造成的點頭感（離合器放太快時特別明顯）
  bus.jolt += (clamp((bus.v - v0) / dt, -8, 8) - bus.jolt) * Math.min(1, dt * 9);
  if (wasBraking && !braking && Math.abs(bus.v) < 0.1) sfx.air(0.35); // 放開煞車的洩氣聲
  wasBraking = braking;

  const nh = bus.h - (bus.v / WHEELBASE) * Math.tan(bus.steer) * dt;
  const nx = bus.x + Math.sin(nh) * bus.v * dt, nz = bus.z + Math.cos(nh) * bus.v * dt;
  if (blocked(nx, nz, nh)) crash('撞上人行道');
  else { bus.x = nx; bus.z = nz; bus.h = nh; }

  // 與車輛碰撞
  const fx = Math.sin(bus.h), fz = Math.cos(bus.h), c = busCenter();
  for (const car of cars) {
    const rx = car.x - c.x, rz = car.z - c.z;
    const lz = rx * fx + rz * fz, lx = -rx * fz + rz * fx;
    if (Math.abs(lx) < 1.33 + car.w / 2 && Math.abs(lz) < 6 + car.len / 2 && Math.abs(bus.v) > 0.5 && lz * bus.v > 0) {
      car.v = 0;
      crash(car.kind === 'scooter' ? '碰撞機車' : '碰撞車輛');
      break;
    }
  }

  // 行人：撞到重罰；車頭前 3.5 公尺內有人在過馬路還不減速，算未禮讓
  pedCool -= dt;
  for (const p of peds) {
    if (!p.walking) continue;
    const rx = p.x - c.x, rz = p.z - c.z;
    const lz = rx * fx + rz * fz, lx = -rx * fz + rz * fx;
    if (Math.abs(lx) < 1.6 && Math.abs(lz) < 6.3 && Math.abs(bus.v) > 0.3) {
      bus.v = 0;
      finishCrossing(p);
      addMoney(-200, '撞到行人');
      sfx.thump(0.5);
      pedCool = 4;
    } else if (pedCool <= 0 && bus.v > 1.5 && lz > 6 && lz < 9.5 && Math.abs(lx) < 2.4) {
      addMoney(-60, '未禮讓行人');
      pedCool = 4;
    }
  }

  // 闖紅燈：車頭進入路口的瞬間判定
  const hx = bus.x + fx * 9, hz = bus.z + fz * 9;
  const i = Math.round(hx / CELL), j = Math.round(hz / CELL);
  const inside = Math.abs(hx - i * CELL) < HALF && Math.abs(hz - j * CELL) < HALF;
  const key = inside ? i + ',' + j : null;
  if (key && key !== prevBoxKey && hasLight(i, j) && bus.v > 1) {
    if (lightState(i, j, Math.abs(fx) > Math.abs(fz) ? 0 : 1) === 'r') addMoney(-100, '闖紅燈');
  }
  prevBoxKey = key;

  // 超速
  speedingT = Math.abs(bus.v) * 3.6 > LIMIT_KMH + 6 ? speedingT + dt : 0;
  if (speedingT > 2) { addMoney(-20, '超速'); speedingT = 0; }

  // 停靠區判定
  const s = stops[game.next], sx = c.x - s.x, sz = c.z - s.z;
  zone.along = sx * s.d.x + sz * s.d.z;
  zone.lat = sx * s.r.x + sz * s.r.z;
  zone.dist = Math.hypot(sx, sz);
  zone.inZone = Math.abs(zone.along) < 4.5 && Math.abs(zone.lat) < 1.8 && Math.abs(angDiff(bus.h, s.heading)) < 0.3;

  // 模型
  bus.doorT = clamp(bus.doorT + (bus.doors ? 1 : -1) * dt * 2, 0, 1);
  doorMeshes.forEach((d) => (d.position.z = d.userData.z - bus.doorT * 1.25));
  frontWheels.forEach((w) => (w.rotation.y = -bus.steer));
  steeringWheel.rotation.z = bus.steerFrac * Math.PI * 6;   // 方向盤左右各三圈
  brakeMat.color.setHex(braking ? 0xff2020 : 0x661111);
  updateSignals(dt);
  for (const side of ['L', 'R']) sigMat[side].color.setHex(lampOn(side) ? 0xffb000 : 0x6a4a00);
  syncBusMesh();
}
export function syncBusMesh() {
  busMesh.position.set(bus.x, 0, bus.z);
  busMesh.rotation.y = bus.h;
}