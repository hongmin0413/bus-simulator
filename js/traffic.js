// 路上的其他車輛：小客車、計程車、小貨車、機車，以及路邊違停的車
import { N, CELL, HALF, LANE_IN, LANE_OUT, clamp, rand, pick, angDiff, rightOf, leftOf, inGrid, hasLight } from './config.js';
import { THREE, scene, box, lambert, basic, lightState, stops } from './world.js';
import { app, busCenter } from './state.js';
import { peds } from './peds.js';

export const cars = [];   // 每一筆都有 kind、w（車寬）、len（車長），公車碰撞判定會用到；parked = true 是違停車
const parked = [];        // cars 裡違停的那幾台

// w / len：車寬、車長；vmax：最高速範圍 (m/s)；acc：加速度
const KINDS = {
  car: { w: 1.9, len: 4.3, vmax: [9, 13], acc: 3 },
  taxi: { w: 1.9, len: 4.4, vmax: [10, 14], acc: 3.5 },
  truck: { w: 2.0, len: 5.2, vmax: [8, 10.5], acc: 2.2 },
  scooter: { w: 0.7, len: 1.9, vmax: [10, 15], acc: 5 },
};
// 機車騎的位置：多半貼著路邊，其次是鑽兩個車道中間，少數騎在外側車道正中
const SCOOTER_OFF = [6.45, 6.45, 6.45, 3.5, 3.5, 5.25];
const PARK_OFF = 6.1;        // 違停車中心離路中線的距離：佔掉外側車道的右半邊
const STOP_BACK = HALF + 3.8; // 停等點離路口中心的距離（再加半個車長），車頭剛好停在停止線前

const mats = (list) => list.map((c) => lambert(c));
const CAR_MATS = mats([0xc62828, 0x1565c0, 0xeeeeee, 0x424242, 0x2e7d32, 0x6a1b9a, 0xbdbdbd, 0x90a4ae, 0x212121]);
const SCOOTER_MATS = mats([0xd32f2f, 0x1976d2, 0xfafafa, 0x212121, 0xf57c00, 0x00897b, 0xec407a]);
const JACKET_MATS = mats([0x37474f, 0x5d4037, 0x1a237e, 0xfdd835, 0x558b2f, 0xad1457, 0xe0e0e0]);
const glass = lambert(0x22303c), taxiYellow = lambert(0xf7c600), truckBlue = lambert(0x1e5aa8), bed = lambert(0x2f6fbf);
const dark = lambert(0x17181a), white = lambert(0xf5f5f5);
const flasher = basic(0x6a4a00);   // 違停車的雙黃燈，全部共用一個材質一起閃

// 區域 +z 為車頭
function buildMesh(kind, flashing) {
  const m = new THREE.Group();
  if (kind === 'scooter') {
    box(m, pick(SCOOTER_MATS), 0.5, 0.55, 1.5, 0, 0.6, 0);        // 車身
    box(m, dark, 0.16, 0.5, 1.85, 0, 0.26, 0);                    // 前後輪
    box(m, pick(JACKET_MATS), 0.5, 0.75, 0.42, 0, 1.25, -0.15);   // 騎士
    box(m, pick(SCOOTER_MATS), 0.3, 0.3, 0.32, 0, 1.78, -0.12);   // 安全帽
  } else if (kind === 'truck') {
    box(m, truckBlue, 1.9, 1.35, 1.5, 0, 1.15, 1.75);             // 車頭
    box(m, glass, 1.75, 0.55, 0.1, 0, 1.45, 2.5);
    box(m, bed, 2.0, 0.55, 3.5, 0, 0.85, -0.8);                   // 貨斗
    box(m, dark, 1.95, 0.4, 4.6, 0, 0.35, 0);
  } else {
    const paint = kind === 'taxi' ? taxiYellow : pick(CAR_MATS);
    box(m, paint, 1.9, 0.75, kind === 'taxi' ? 4.4 : 4.3, 0, 0.7, 0);
    box(m, glass, 1.7, 0.6, 2.3, 0, 1.35, -0.2);
    if (kind === 'taxi') box(m, white, 0.5, 0.18, 0.25, 0, 1.74, 0);   // 車頂燈
  }
  if (flashing) {
    const half = KINDS[kind].len / 2;
    box(m, flasher, 1.96, 0.16, 0.1, 0, 0.82, -half);
    box(m, flasher, 1.96, 0.16, 0.1, 0, 0.82, half);
  }
  return m;
}

// phase 0：開往路口前的停等點；phase 1：穿過路口開往下一條路的入口
// phase 2：機車兩段式左轉，先直行到待轉區；phase 3：在待轉區等橫向綠燈
function targetExit(c) {
  const r = rightOf(c.d), back = STOP_BACK + c.len / 2;
  c.tx = c.ni * CELL - c.d.x * back + r.x * c.off;
  c.tz = c.nj * CELL - c.d.z * back + r.z * c.off;
  c.phase = 0;
}
function enterRoad(c, nd) {
  const r = rightOf(nd);
  c.tx = c.ni * CELL + nd.x * (HALF + 3) + r.x * c.off;
  c.tz = c.nj * CELL + nd.z * (HALF + 3) + r.z * c.off;
  c.phase = 1;
  c.d = nd; c.ni += nd.x; c.nj += nd.z;
}
function chooseNext(c) {
  const straight = c.d, right = rightOf(c.d), left = leftOf(c.d);
  const opts = [straight, right, left].filter((d) => inGrid(c.ni + d.x, c.nj + d.z));
  let nd = pick(opts);
  if (opts[0] === straight && Math.random() < 0.5) nd = straight;
  if (nd === left && c.kind === 'scooter' && hasLight(c.ni, c.nj)) {
    // 待轉區在路口的右前角，橫向車道停止線的前面
    const a = rand(3.9, 6.6);
    c.tx = c.ni * CELL + right.x * 7.3 + c.d.x * a;
    c.tz = c.nj * CELL + right.z * 7.3 + c.d.z * a;
    c.nd = nd; c.phase = 2;
    return;
  }
  if (nd === left) c.off = LANE_IN;
  else if (c.kind === 'scooter') c.off = c.pref;
  else if (nd === right) c.off = LANE_OUT;
  enterRoad(c, nd);
}

export function spawnCar(kind = 'car') {
  const K = KINDS[kind];
  for (let tries = 0; tries < 60; tries++) {
    const i = Math.floor(rand(0, N + 1)), j = Math.floor(rand(0, N + 1));
    const d = pick([{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]);
    if (!inGrid(i + d.x, j + d.z)) continue;
    const off = kind === 'scooter' ? pick(SCOOTER_OFF) : Math.random() < 0.5 ? LANE_IN : LANE_OUT;
    const r = rightOf(d), t = rand(HALF + 6, CELL - HALF - 12);
    const x = i * CELL + d.x * t + r.x * off, z = j * CELL + d.z * t + r.z * off;
    const bc = busCenter();
    if (Math.hypot(x - bc.x, z - bc.z) < 45) continue;
    if (cars.some((o) => Math.hypot(o.x - x, o.z - z) < (K.len + o.len) / 2 + 4)) continue;
    const mesh = buildMesh(kind);
    scene.add(mesh);
    const c = {
      kind, w: K.w, len: K.len, acc: K.acc, x, z, h: Math.atan2(d.x, d.z), v: rand(4, 9), vmax: rand(K.vmax[0], K.vmax[1]),
      d, off, pref: off, ni: i + d.x, nj: j + d.z, mesh,
    };
    targetExit(c);
    cars.push(c);
    return;
  }
}

// 路邊違停：停在街廓中段的路邊，佔掉半個外側車道。有公車站的路段不放
function spawnParked() {
  const kind = pick(['car', 'car', 'car', 'taxi', 'truck']), K = KINDS[kind];
  for (let tries = 0; tries < 60; tries++) {
    const i = Math.floor(rand(0, N + 1)), j = Math.floor(rand(0, N + 1));
    const d = pick([{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]);
    if (!inGrid(i + d.x, j + d.z)) continue;
    const r = rightOf(d), t = rand(HALF + 24, CELL - HALF - 24);
    const x = i * CELL + d.x * t + r.x * PARK_OFF, z = j * CELL + d.z * t + r.z * PARK_OFF;
    const bc = busCenter();
    if (Math.hypot(x - bc.x, z - bc.z) < 40) continue;
    if (stops.some((s) => s.d.x === d.x && s.d.z === d.z && Math.hypot(s.x - x, s.z - z) < 34)) continue;
    if (parked.some((o) => Math.hypot(o.x - x, o.z - z) < 30)) continue;
    const mesh = buildMesh(kind, true), h = Math.atan2(d.x, d.z);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = h;
    scene.add(mesh);
    const c = { kind, parked: true, w: K.w, len: K.len, x, z, h, v: 0, d, fx: Math.sin(h), fz: Math.cos(h), mesh };
    cars.push(c);
    parked.push(c);
    return;
  }
}

// 清掉所有車輛，依關卡設定重新產生
export function resetTraffic(level) {
  for (const c of cars) scene.remove(c.mesh);
  cars.length = 0; parked.length = 0;
  for (let k = 0; k < level.parked; k++) spawnParked();
  for (let k = 0; k < level.cars; k++) {
    const r = Math.random();
    spawnCar(r < 0.16 ? 'taxi' : r < 0.3 ? 'truck' : 'car');
  }
  for (let k = 0; k < level.scooters; k++) spawnCar('scooter');
}

export function updateCars(dt) {
  const bc = busCenter();
  flasher.color.setHex(app.time % 0.9 < 0.45 ? 0xffb000 : 0x6a4a00);
  for (const c of cars) { c.fx = Math.sin(c.h); c.fz = Math.cos(c.h); }   // 先算好朝向，下面兩兩比對時不用重算
  for (const c of cars) {
    if (c.parked) continue;
    if (c.phase === 3) {   // 在待轉區等橫向綠燈
      if (lightState(c.ni, c.nj, c.nd.x !== 0 ? 0 : 1) === 'g') { c.off = c.pref; enterRoad(c, c.nd); }
      continue;
    }
    const dx = c.tx - c.x, dz = c.tz - c.z, dist = Math.hypot(dx, dz);
    const fx = c.fx, fz = c.fz;
    let want = c.phase === 1 ? Math.min(c.vmax, 6.5) : c.phase === 2 ? Math.min(7, 1 + dist * 1.5) : c.vmax;
    const arrived = dist < (c.phase === 2 ? 0.7 : 2.5) || (dist < 10 && dx * fx + dz * fz < 0);

    let mustStop = false;
    if (c.phase === 0 && hasLight(c.ni, c.nj)) {
      const st = lightState(c.ni, c.nj, c.d.x !== 0 ? 0 : 1);
      mustStop = st === 'r' || (st === 'y' && dist > c.v * 1.2);
    }
    if (mustStop) want = arrived ? 0 : Math.min(want, Math.sqrt(7 * Math.max(dist - 1.5, 0)));
    else if (c.phase === 0 && dist < 14) want = Math.min(want, 8);

    // 前方有同向車輛就減速。只看橫向真的會重疊的車，所以機車能從汽車旁邊鑽到前面
    const look = 8 + c.v * 2;
    for (const o of cars) {
      const rx = o.x - c.x, rz = o.z - c.z;
      if (o === c || rx > 45 || rx < -45 || rz > 45 || rz < -45 || o.fx * fx + o.fz * fz < 0.3) continue;
      const fwd = rx * fx + rz * fz, gap = (o.len + c.len) / 2 + 2.6;
      if (fwd <= 0 || fwd > gap + look || Math.abs(-rx * fz + rz * fx) > (o.w + c.w) / 2 - 0.1) continue;
      want = Math.min(want, Math.max(0, fwd - gap) * 1.2);
    }
    // 前方是公車也減速
    const rx = bc.x - c.x, rz = bc.z - c.z, fwd = rx * fx + rz * fz, gapB = 6 + c.len / 2 + 4.8;
    if (fwd > 0 && fwd < gapB + look && Math.abs(-rx * fz + rz * fx) < 1.8 + c.w / 2) want = Math.min(want, Math.max(0, fwd - gapB) * 1.2);
    // 禮讓正在過馬路的行人
    for (const p of peds) {
      if (!p.walking) continue;
      const qx = p.x - c.x, qz = p.z - c.z;
      if (qx > 12 || qx < -12 || qz > 12 || qz < -12) continue;
      const f = qx * fx + qz * fz;
      if (f > 0 && f < c.len / 2 + 5 && Math.abs(-qx * fz + qz * fx) < c.w / 2 + 2.2) want = 0;
    }

    // 轉向目標：在路段上時瞄準自己車道線前方 8 公尺的點，前面有違停車就先往左偏過去
    let ax = c.tx, az = c.tz;
    if (c.phase === 0) {
      const rX = -c.d.z, rZ = c.d.x;
      let eff = c.off;
      if (c.off > 3) for (const p of parked) {
        if (p.d.x !== c.d.x || p.d.z !== c.d.z) continue;
        const px = p.x - c.x, pz = p.z - c.z, f = px * c.d.x + pz * c.d.z;
        if (f < -(p.len + c.len) / 2 - 2 || f > 26 || Math.abs(px * rX + pz * rZ) > 9) continue;
        eff = c.kind === 'scooter' ? 3.9 : 2.9;
        break;
      }
      const nx = c.ni * CELL + rX * eff, nz = c.nj * CELL + rZ * eff;
      const al = Math.min((c.x - nx) * c.d.x + (c.z - nz) * c.d.z + 8, -(STOP_BACK + c.len / 2));
      ax = nx + c.d.x * al; az = nz + c.d.z * al;
    }

    c.v += clamp(want - c.v, -9 * dt, c.acc * dt);
    const turn = (c.v / 3.5) * dt;
    c.h += clamp(angDiff(Math.atan2(ax - c.x, az - c.z), c.h), -turn, turn);
    c.x += Math.sin(c.h) * c.v * dt;
    c.z += Math.cos(c.h) * c.v * dt;
    if (arrived) {
      if (c.phase === 1) targetExit(c);
      else if (c.phase === 2) { c.phase = 3; c.v = 0; c.h = Math.atan2(c.nd.x, c.nd.z); }
      else if (!mustStop) chooseNext(c);
    }
    c.mesh.position.set(c.x, 0, c.z);
    c.mesh.rotation.y = c.h;
  }
}