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

  // 駕駛艙（左駕）
  const trim = lambert(0x23272e), dark = lambert(0x14171c), rim = lambert(0x4a525c);
  box(cabin, trim, 2.5, 0.6, 0.85, 0, 1.3, 8.55);
  box(cabin, dark, 0.95, 0.22, 0.3, 0.62, 1.7, 8.35);
  box(cabin, dark, 0.07, 2.1, 0.07, 1.26, 2.5, 9.0);
  box(cabin, dark, 0.07, 2.1, 0.07, -1.26, 2.5, 9.0);
  box(cabin, dark, 2.6, 0.2, 0.2, 0, 3.5, 8.95);
  box(cabin, trim, 0.1, 0.5, 2.4, 1.27, 1.35, 7.6);
  const pivot = new THREE.Group();
  pivot.position.set(0.62, 1.72, 7.95);
  pivot.rotation.x = -0.75;
  steeringWheel = new THREE.Group();
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 28), rim));
  box(steeringWheel, rim, 0.58, 0.07, 0.03, 0, 0, 0);
  box(steeringWheel, rim, 0.07, 0.3, 0.03, 0, -0.15, 0);
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

// 轉向靈敏度（低、中、高）：手機轉幾弧度打到底，約 34、24、17 度
export const SENS = [0.6, 0.42, 0.3];
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
    tilt.val += (clamp(t, -1, 1) - tilt.val) * Math.min(1, dt * 20);
    target = tilt.val; rate = 9;
  } else if (input.drag !== null) { target = input.drag; rate = 4; }
  else target = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  bus.steerFrac += clamp(target - bus.steerFrac, -rate * dt, rate * dt);
  bus.steer = bus.steerFrac * 0.6 / (1 + Math.abs(bus.v) * 0.075);

  // 縱向：引擎（經離合器）+ 煞車 + 阻力
  const hand = bus.hand || bus.doors, brk = input.brake;
  const v0 = bus.v;
  const engA = updateEngine(dt);
  const brakeA = brk * 6 + (hand ? 8 : 0);
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
  steeringWheel.rotation.z = bus.steerFrac * 2.2;
  brakeMat.color.setHex(braking ? 0xff2020 : 0x661111);
  updateSignals(dt);
  for (const side of ['L', 'R']) sigMat[side].color.setHex(lampOn(side) ? 0xffb000 : 0x6a4a00);
  syncBusMesh();
}
export function syncBusMesh() {
  busMesh.position.set(bus.x, 0, bus.z);
  busMesh.rotation.y = bus.h;
}