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
import { updateRules, updateComfort } from './rules.js';
import { cabin, updateCabin } from './cabin.js';

// 車身尺寸取甲類大客車（12 公尺級市區公車）常見的數值：長 12、寬 2.5、高約 3.5（含車頂冷氣）、軸距 6、前懸 2.7、後懸 3.3 公尺
// 原點在後軸中心。區域 +z 為車頭，+x 為左側（駕駛座），-x 為右側（車門）
// 車身與駕駛艙的座標是照「車身從 z = -3 到 9」寫的，整組再往後移 BODY_Z（-0.3），前後懸才會是 2.7 / 3.3；輪子不跟著移
export const busMesh = new THREE.Group();
export const ext = new THREE.Group();     // 車外看得到的部分
ext.position.z = BODY_Z;
busMesh.add(ext, cabin);
const brakeMat = basic(0x661111);
const sigMat = { L: basic(0x6a4a00), R: basic(0x6a4a00) };
const doorMeshes = [], frontWheels = [];
{
  // 車外不會動的方塊合併；駕駛艙由 cabin.js 獨立建模。
  const E = [];
  const DARK = 0x14171c, ARCH = 0x101317, WINDOW = 0x1a2733;
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
  // 一張低解析度 alpha 貼圖取代硬邊黑方塊，保留單一接地面片。
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128; shadowCanvas.height = 256;
  const sg = shadowCanvas.getContext('2d');
  sg.scale(1, 2);
  const fade = sg.createRadialGradient(64, 64, 15, 64, 64, 64);
  fade.addColorStop(0, 'rgba(0,0,0,.65)');
  fade.addColorStop(0.65, 'rgba(0,0,0,.4)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = fade; sg.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 13.6), basic(0x000000, {
    map: shadowTex, transparent: true, opacity: 0.65, depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.025, 3 + BODY_Z);
  busMesh.add(shadow);   // 不跟 ext 側傾，接地陰影才不會斜插路面或飄起。
  ext.add(new THREE.Mesh(boxGeo(E), vcMat));

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
let pedCool = 0, hitCooldown = 0, peakP = 0, prevBrk = 0;
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
  // 氣壓煞車：踩下踏板後氣壓要一點時間才建立起來（約 0.2 秒到全力），放開也不是瞬間洩完
  bus.brakeP += clamp(input.brake - bus.brakeP, -7 * dt, 5 * dt);
  const hand = bus.hand || bus.doors, brk = bus.brakeP;
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
  const braking = brk > 0.02 || hand;
  if (v0 !== 0 && v0 * bus.v < 0 && (braking || Math.abs(engA) < 0.05)) bus.v = 0;
  if (braking && Math.abs(bus.v) < 0.15 && Math.abs(engA) < brakeA) bus.v = 0;
  if (Math.abs(bus.v) < 0.03 && Math.abs(engA) < 0.01) bus.v = 0;
  bus.v = clamp(bus.v, -6, 30);
  // 加減速造成的點頭感（離合器放太快時特別明顯）
  bus.jolt += (clamp((bus.v - v0) / dt, -8, 8) - bus.jolt) * Math.min(1, dt * 9);
  // 轉彎時車身往外側傾斜：側向加速度每 1 m/s² 傾約 0.7 度，最多 2.5 度（右轉時往左倒，roll 為正）
  const latAcc = (bus.v * bus.v / WHEELBASE) * Math.tan(bus.steer);
  bus.roll += (clamp(latAcc * 0.012, -0.045, 0.045) - bus.roll) * Math.min(1, dt * 4);
  // 放開煞車踏板：煞車氣室的氣從排氣閥噴出來，「嘶」一聲，踩得越重聲音越大
  peakP = Math.max(peakP, brk);
  if (input.brake === 0 && prevBrk > 0) { if (peakP > 0.15) sfx.air(0.2 + 0.35 * peakP, 0.05 + 0.13 * peakP); peakP = 0; }
  prevBrk = input.brake;
  updateComfort(dt, hitCooldown > 1.3);

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
  // 雨刷：開著就一直來回擺；關掉後擺完這一趟回到原位才停
  if (bus.wiper || bus.wiperT > 0) {
    const before = bus.wiperT;
    bus.wiperT += dt / 1.3;
    if (before < 0.5 && bus.wiperT >= 0.5) sfx.wiper();
    if (bus.wiperT >= 1) { bus.wiperT = bus.wiper ? bus.wiperT - 1 : 0; sfx.wiper(); }
  }
  brakeMat.color.setHex(braking ? 0xff2020 : 0x661111);
  updateSignals(dt);
  for (const side of ['L', 'R']) sigMat[side].color.setHex(lampOn(side) ? 0xffb000 : 0x6a4a00);
  syncBusMesh();
}
export function syncBusMesh() {
  busMesh.position.set(bus.x, 0, bus.z);
  busMesh.rotation.y = bus.h;
  ext.rotation.z = cabin.rotation.z = -bus.roll;   // 整個車身繞著地面的縱軸傾斜
  updateCabin();
}