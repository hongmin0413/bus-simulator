// 公車模型與行駛物理
import { WHEELBASE, BODY_Z, clamp, angDiff, onRoad, unwarp } from './config.js';
import { THREE, scene, box, boxGeo, vcMat, lambert, basic, stops } from './world.js';
import { bus, bg, game, zone, input, tilt, app, refreshGrid, loadFactor } from './state.js';
import { updateEngine } from './engine.js';
import { cars } from './traffic.js';
import { addMoney } from './ui.js';
import { sfx } from './audio.js';
import { updateSignals, lampOn } from './signals.js';
import { peds, finishCrossing } from './peds.js';
import { updateRules } from './rules.js';

// 車身尺寸取甲類大客車（12 公尺級市區公車）常見的數值：長 12、寬 2.5、高約 3.5（含車頂冷氣）、軸距 6、前懸 2.7、後懸 3.3 公尺
// 原點在後軸中心。區域 +z 為車頭，+x 為左側（駕駛座），-x 為右側（車門）
// 車身與駕駛艙的座標是照「車身從 z = -3 到 9」寫的，整組再往後移 BODY_Z（-0.3），前後懸才會是 2.7 / 3.3；輪子不跟著移
export const busMesh = new THREE.Group();
export const ext = new THREE.Group();     // 車外看得到的部分
export const cabin = new THREE.Group();   // 駕駛艙內裝
ext.position.z = cabin.position.z = BODY_Z;
busMesh.add(ext, cabin);
const brakeMat = basic(0x661111);
const sigMat = { L: basic(0x6a4a00), R: basic(0x6a4a00) };
const doorMeshes = [], frontWheels = [];
let steeringWheel;
{
  // 不會動的方塊先收集起來，最後各合併成一個幾何體（車外一個、駕駛艙一個），減少手機的繪圖負擔
  const E = [], C = [];
  const TRIM = 0x2b3038, DARK = 0x14171c, RIM = 0x3a4049, GREY = 0x6b727c, YELLOW = 0xf2c200, ARCH = 0x101317, WINDOW = 0x1a2733;
  const PAINT = 0x0e9f86, SKIRT = 0x22272e, PLATE = 0xf5f5f5;
  // 車身、腰線白帶、裙邊、側窗
  E.push([2.5, 2.9, 12, 0, 1.9, 3, PAINT], [2.52, 0.5, 12.02, 0, 1.25, 3, 0xf4f6f7], [2.52, 0.3, 12.02, 0, 0.6, 3, SKIRT], [2.54, 1.05, 10.4, 0, 2.55, 2.9, WINDOW]);
  // 側窗的窗柱
  for (const z of [-2.2, -0.7, 0.8, 3.9, 5.4, 6.9]) E.push([0.03, 1.05, 0.12, 1.265, 2.55, z, PAINT], [0.03, 1.05, 0.12, -1.265, 2.55, z, PAINT]);
  // 車頭：擋風玻璃、頭燈之間的飾板、保險桿、車牌
  E.push([2.3, 1.5, 0.06, 0, 2.3, 9.0, WINDOW], [1.3, 0.22, 0.05, 0, 0.9, 9.01, DARK], [2.54, 0.28, 0.14, 0, 0.6, 9.0, SKIRT], [0.55, 0.17, 0.03, 0, 0.62, 9.08, PLATE]);
  // 車尾：後窗、引擎散熱格柵、保險桿、車牌
  E.push([1.9, 0.75, 0.06, 0, 2.65, -3.0, WINDOW], [1.3, 0.4, 0.06, 0, 1.75, -3.0, DARK], [2.54, 0.28, 0.14, 0, 0.6, -3.0, SKIRT], [0.55, 0.17, 0.03, 0, 0.62, -3.08, PLATE]);
  // 車頂：冷氣機與逃生口
  E.push([1.8, 0.14, 3.2, 0, 3.42, 1.4, 0xe8ecef], [0.8, 0.06, 0.8, 0, 3.38, 5.6, 0xdfe5e8]);
  // 左右後照鏡：從車頭上緣往外伸的支架與鏡殼
  for (const s of [1, -1]) E.push([0.42, 0.05, 0.05, s * 1.45, 3.05, 9.0, DARK], [0.07, 0.42, 0.24, s * 1.63, 2.78, 9.06, DARK]);
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 48;
  const g = cv.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#ffb300'; g.font = 'bold 34px "Microsoft JhengHei", "Noto Sans TC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('1 市區環線', 128, 26);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.38), basic(0xffffff, { map: new THREE.CanvasTexture(cv) }));
  sign.position.set(0, 3.13, 9.04);
  ext.add(sign);
  const headlight = basic(0xfff6c8);
  for (const x of [-0.9, 0.9]) {
    box(ext, headlight, 0.4, 0.2, 0.06, x, 0.9, 9.03);
    box(ext, brakeMat, 0.4, 0.25, 0.06, x, 1.2, -3.01);
  }
  // 方向燈：前、後、車側各一顆（+x 是左側）
  for (const [side, x] of [['L', 1], ['R', -1]]) {
    const lamp = new THREE.Mesh(boxGeo([[0.16, 0.2, 0.06, x * 1.165, 0.9, 9.03, 0], [0.16, 0.25, 0.06, x * 1.165, 1.5, -3.02, 0], [0.06, 0.14, 0.3, x * 1.275, 1.3, 6.2, 0]]), sigMat[side]);
    ext.add(lamp);
  }
  // 前門在前輪前方（前懸），中門在兩軸之間
  const doorMat = lambert(0x37546b);
  for (const z of [7.7, 2.6]) {
    const d = box(ext, doorMat, 0.08, 2.15, 1.3, -1.265, 1.55, z);
    d.userData.z = z;
    doorMeshes.push(d);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const tyre = lambert(0x17181a);
  // 輪胎略凸出車身，加上淺色輪圈與深色輪拱，後照鏡裡才認得出前後輪。後軸是雙輪，所以比較寬
  const hubGeo = new THREE.CylinderGeometry(0.29, 0.29, 0.36, 14);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = lambert(0xc9ced6);
  for (const z of [0, WHEELBASE]) for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.add(new THREE.Mesh(hubGeo, hub));
    if (!z) w.scale.x = 1.7;
    E.push([0.05, 0.85, 1.4, s * 1.25, 0.72, z - BODY_Z, ARCH]);
    w.position.set(s * (z ? 1.13 : 1.02), 0.5, z - BODY_Z);   // 輪子的位置以後軸為準，不跟著車身後移
    ext.add(w);
    if (z) frontWheels.push(w);
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 12.8), basic(0x000000, { transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.04, 3);
  ext.add(shadow);
  ext.add(new THREE.Mesh(boxGeo(E), vcMat));

  // 駕駛艙（左駕）。駕駛的眼睛在車身座標 [0.8, 2.3, 7.3]（見 view.js），座位貼著左側車窗、在前輪前方
  // 儀表台：低而平，上緣在視線下方，才看得到車頭前的路面
  C.push([2.45, 0.5, 0.7, 0, 1.25, 8.62, TRIM], [2.45, 0.06, 0.75, 0, 1.52, 8.62, DARK]);
  // 駕駛正前方的儀表罩與兩顆錶
  C.push([0.86, 0.26, 0.3, 0.8, 1.66, 8.42, DARK]);
  const gaugeGeo = new THREE.CircleGeometry(0.075, 20), faceMat = basic(0x24323f), needleMat = basic(0xff5a4a);
  for (const gx of [0.62, 0.98]) {
    const face = new THREE.Mesh(gaugeGeo, faceMat);
    face.position.set(gx, 1.67, 8.265);
    face.rotation.y = Math.PI;   // 面向駕駛
    cabin.add(face);
    box(cabin, needleMat, 0.012, 0.065, 0.005, gx - 0.015, 1.69, 8.26);
  }
  // 前擋風玻璃的框：左右 A 柱、上方的路線牌箱、駕駛側遮陽板、車內後照鏡
  C.push([0.09, 1.85, 0.09, 1.215, 2.45, 8.98, DARK], [0.09, 1.85, 0.09, -1.215, 2.45, 8.98, DARK], [2.55, 0.34, 0.3, 0, 3.26, 8.88, DARK]);
  C.push([0.9, 0.22, 0.03, 0.8, 3.0, 8.72, TRIM], [0.46, 0.15, 0.04, 0.05, 2.98, 8.74, DARK]);
  box(cabin, basic(0x9fb4c6), 0.42, 0.11, 0.01, 0.05, 2.98, 8.715);
  // 左側：駕駛旁的車身與窗框（窗台以下是車身，以上是玻璃）
  C.push([0.08, 1.0, 2.9, 1.24, 1.05, 7.55, TRIM], [0.08, 0.1, 2.9, 1.24, 3.33, 7.55, DARK], [0.08, 1.85, 0.1, 1.24, 2.45, 6.2, DARK]);
  // 地板與天花板；右前方是車門，地板在那裡下降成上車階梯
  C.push([1.8, 0.06, 3.2, 0.37, 0.97, 7.4, GREY], [0.76, 0.06, 1.9, -0.9, 0.6, 8.0, GREY], [0.05, 0.37, 1.9, -0.52, 0.8, 8.0, YELLOW], [2.5, 0.05, 3.2, 0, 3.4, 7.4, TRIM]);
  // 右側前門：門框後柱、門的下半部、扶手、投幣箱
  C.push([0.08, 2.6, 0.1, -1.24, 2.05, 7.02, DARK], [0.06, 0.55, 1.85, -1.245, 0.72, 8.0, TRIM], [0.06, 0.08, 1.85, -1.245, 2.0, 8.0, DARK]);
  C.push([0.045, 2.3, 0.045, -0.5, 2.15, 7.1, YELLOW], [0.3, 0.75, 0.3, -0.3, 1.4, 8.05, GREY], [0.32, 0.06, 0.32, -0.3, 1.8, 8.05, YELLOW]);
  cabin.add(new THREE.Mesh(boxGeo(C), vcMat));
  // 方向盤：大客車的方向盤又大又平，像端著一個盤子
  const pivot = new THREE.Group();
  // 位置比真車離駕駛遠一點、高一點，這樣直視前方時畫面下緣還看得到方向盤的上半圈
  pivot.position.set(0.8, 1.56, 7.98);
  pivot.rotation.x = 1.0;   // 盤面朝上偏向駕駛，遠端比近端高
  pivot.add(new THREE.Mesh(boxGeo([[0.1, 0.1, 0.55, 0, 0, 0.28, DARK]]), vcMat));   // 轉向柱往前下方伸進儀表台
  steeringWheel = new THREE.Group();
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.027, 8, 32), lambert(RIM)));
  steeringWheel.add(new THREE.Mesh(boxGeo([[0.48, 0.055, 0.03, 0, 0, 0, RIM], [0.055, 0.25, 0.03, 0, -0.125, 0, RIM], [0.16, 0.16, 0.05, 0, 0, 0, DARK]]), vcMat));
  pivot.add(steeringWheel);
  cabin.add(pivot);
  scene.add(busMesh);
}

// 車身上用來判斷是否壓上人行道的取樣點 [左右, 前後]
const SAMPLE = [[-1.05, -2.7], [1.05, -2.7], [-1.05, 8.3], [1.05, 8.3], [-1.05, 2.7], [1.05, 2.7]];
const tmp = {};
function blocked(x, z, h) {
  const fx = Math.sin(h), fz = Math.cos(h);
  for (const [lx, lz] of SAMPLE) {
    unwarp(x + lx * fz + lz * fx, z - lx * fx + lz * fz, tmp);
    if (!onRoad(tmp.x, tmp.z, 0.9)) return true;
  }
  return false;
}

// 轉向靈敏度（低、中、高）：手機轉幾弧度打到底，約 32、23、16 度
export const SENS = [0.55, 0.4, 0.28];
const MAX_STEER = 0.85;
let pedCool = 0, hitCooldown = 0, wasBraking = false;
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
  // 煞車的力道是固定的，車越重減速越慢；輪胎抓地力有上限，所以空車踩到八成多就到頂（6 m/s²），載滿時踩到底約 5.3
  const load = loadFactor();
  const brakeA = Math.min(6, brk * 7.2 * load) + (hand ? (Math.abs(bus.v) > 0.5 ? 3.5 * load : 8) : 0);
  let a = engA;
  // 滾動阻力：大客車輪胎的滾動阻力係數約 0.008，加上軸承與傳動的損耗，約 0.09 m/s²（跟車重成正比，所以減速度不受載重影響）
  // 風阻：風阻係數 0.65、迎風面積 7.5 平方公尺，力道 = 2.93 × v²，除以空車 12 噸；車越重越不容易被風拖慢
  if (Math.abs(bus.v) > 0.02) a -= Math.sign(bus.v) * (brakeA + 0.09) + bus.v * Math.abs(bus.v) * 0.000244 * load;
  bus.v += a * dt;
  const braking = brk > 0 || hand;
  if (v0 !== 0 && v0 * bus.v < 0 && (braking || Math.abs(engA) < 0.05)) bus.v = 0;
  if (braking && Math.abs(bus.v) < 0.15 && Math.abs(engA) < brakeA) bus.v = 0;
  if (Math.abs(bus.v) < 0.03 && Math.abs(engA) < 0.01) bus.v = 0;
  bus.v = clamp(bus.v, -6, 30);
  // 加減速造成的點頭感（離合器放太快時特別明顯）
  bus.jolt += (clamp((bus.v - v0) / dt, -8, 8) - bus.jolt) * Math.min(1, dt * 9);
  // 轉彎時車身往外側傾斜：側向加速度每 1 m/s² 傾約 0.7 度，最多 2.5 度（右轉時往左倒，roll 為正）
  const latAcc = (bus.v * bus.v / WHEELBASE) * Math.tan(bus.steer);
  bus.roll += (clamp(latAcc * 0.012, -0.045, 0.045) - bus.roll) * Math.min(1, dt * 4);
  if (wasBraking && !braking && Math.abs(bus.v) < 0.1) sfx.air(0.35); // 放開煞車的洩氣聲
  wasBraking = braking;

  const nh = bus.h - (bus.v / WHEELBASE) * Math.tan(bus.steer) * dt;
  const nx = bus.x + Math.sin(nh) * bus.v * dt, nz = bus.z + Math.cos(nh) * bus.v * dt;
  if (blocked(nx, nz, nh)) crash('撞上人行道');
  else { bus.x = nx; bus.z = nz; bus.h = nh; }
  refreshGrid();   // 以下的判定都在格子座標上做（bg：車身中心與朝向）

  // 與車輛碰撞
  const fx = bg.fx, fz = bg.fz;
  for (const car of cars) {
    const rx = car.x - bg.x, rz = car.z - bg.z;
    const lz = rx * fx + rz * fz, lx = -rx * fz + rz * fx;
    if (Math.abs(lx) < 1.3 + car.w / 2 && Math.abs(lz) < 6 + car.len / 2 && Math.abs(bus.v) > 0.5 && lz * bus.v > 0) {
      car.v = 0;
      crash(car.kind === 'scooter' ? '碰撞機車' : '碰撞車輛');
      break;
    }
  }

  // 行人：撞到重罰；車頭前 3.5 公尺內有人在過馬路還不減速，算未禮讓
  pedCool -= dt;
  for (const p of peds) {
    if (!p.walking) continue;
    const rx = p.x - bg.x, rz = p.z - bg.z;
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

  updateRules(dt);   // 闖紅燈、超速、逆向、方向燈

  // 停靠區判定
  const s = stops[game.next], sx = bg.x - s.x, sz = bg.z - s.z;
  zone.along = sx * s.d.x + sz * s.d.z;
  zone.lat = sx * s.r.x + sz * s.r.z;
  zone.dist = Math.hypot(sx, sz);
  zone.inZone = Math.abs(zone.along) < 4.5 && Math.abs(zone.lat) < 1.8 && Math.abs(angDiff(bg.h, s.heading)) < 0.3;

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
  ext.rotation.z = cabin.rotation.z = -bus.roll;   // 整個車身繞著地面的縱軸傾斜
}