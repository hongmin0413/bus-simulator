// 路上的其他車輛：小客車、計程車、小貨車、機車，以及路邊違停的車。全部在格子座標上移動，畫的時候才轉成世界座標
import { N, CELL, EDGE, ownRoad, crossRoad, stopDist, warp, warpH, clamp, rand, pick, angDiff, rightOf, leftOf, inGrid, hasLight } from './config.js';
import { THREE, scene, boxGeo, vcMat, basic, lightState, stops, turnBox } from './world.js';
import { app, bg } from './state.js';
import { peds } from './peds.js';

export const cars = [];   // 每一筆都有 kind、w（車寬）、len（車長），公車碰撞判定會用到；parked = true 是違停車
const parked = [];        // cars 裡違停的那幾台

// w / len：車寬、車長；vmax：最高速範圍 (m/s)；acc：一般起步的加速度（市區開車不會全油門）
const KINDS = {
  car: { w: 1.9, len: 4.3, vmax: [9, 13], acc: 2.2 },
  taxi: { w: 1.9, len: 4.4, vmax: [10, 14], acc: 2.6 },
  truck: { w: 2.0, len: 5.2, vmax: [8, 10.5], acc: 1.6 },
  scooter: { w: 0.7, len: 1.9, vmax: [10, 15], acc: 3.6 },
};
// 機車騎的位置：多半貼著路邊，其次是鑽兩個車道中間，少數騎在外側車道正中
const SCOOTER_PREF = ['edge', 'edge', 'edge', 'split', 'split', 'mid'];
// 這台車在這條路上第 lane 個車道（由內往外）時，離路中線多遠
function laneOff(c, road, lane) {
  if (c.kind !== 'scooter') return road.lanes[Math.min(lane, road.n - 1)];
  if (c.pref === 'split' && road.n > 1) return road.bounds[road.n - 1] + 0.1;
  if (c.pref === 'mid') return road.lanes[road.n - 1];
  return road.half - EDGE - 0.75;
}

const CAR_COLORS = [0xc62828, 0x1565c0, 0xeeeeee, 0x424242, 0x2e7d32, 0x6a1b9a, 0xbdbdbd, 0x90a4ae, 0x212121];
const SCOOTER_COLORS = [0xd32f2f, 0x1976d2, 0xfafafa, 0x212121, 0xf57c00, 0x00897b, 0xec407a];
const JACKET_COLORS = [0x37474f, 0x5d4037, 0x1a237e, 0xfdd835, 0x558b2f, 0xad1457, 0xe0e0e0];
const GLASS = 0x22303c, DARK = 0x17181a, TAIL = 0x5a1010;
const flasher = basic(0x6a4a00);      // 違停車的雙黃燈，全部共用一個材質一起閃
const brakeLit = basic(0xff2a1a);     // 亮起的煞車燈
const blinkLit = basic(0xffb000);     // 亮起的方向燈
const geoCache = {};                  // 同車種同顏色共用幾何體
const cached = (key, make) => (geoCache[key] ||= make());

// 區域 +z 為車頭、+x 為左側。整台車合併成一個幾何體，只要畫一次；
// 煞車燈與方向燈是另外的小零件，平常不顯示（不用畫），亮的時候才顯示
function buildMesh(kind, flashing) {
  const K = KINDS[kind], hl = K.len / 2, hw = K.w / 2;
  const paint = kind === 'scooter' ? pick(SCOOTER_COLORS) : kind === 'taxi' ? 0xf7c600 : kind === 'truck' ? 0x1e5aa8 : pick(CAR_COLORS);
  const extra = kind === 'scooter' ? Math.floor(rand(0, 4)) : 0;
  const geo = cached(kind + paint + extra, () => {
    if (kind === 'scooter') return boxGeo([
      [0.5, 0.55, 1.5, 0, 0.6, 0, paint],                               // 車身
      [0.16, 0.5, 1.85, 0, 0.26, 0, DARK],                              // 前後輪
      [0.5, 0.75, 0.42, 0, 1.25, -0.15, JACKET_COLORS[(extra * 3 + paint) % 7]],   // 騎士
      [0.3, 0.3, 0.32, 0, 1.78, -0.12, SCOOTER_COLORS[(extra + paint) % 7]],       // 安全帽
      [0.2, 0.1, 0.04, 0, 0.8, -0.76, TAIL],                            // 尾燈
    ]);
    if (kind === 'truck') return boxGeo([
      [1.9, 1.35, 1.5, 0, 1.15, 1.75, paint], [1.75, 0.55, 0.1, 0, 1.45, 2.5, GLASS],   // 車頭
      [2.0, 0.55, 3.5, 0, 0.85, -0.8, 0x2f6fbf], [1.9, 0.3, 4.6, 0, 0.45, 0, DARK],    // 貨斗、底盤
      ...[[0.88, 1.6], [-0.88, 1.6], [0.88, -1.5], [-0.88, -1.5]].map(([wx, wz]) => [0.26, 0.68, 0.68, wx, 0.34, wz, 0x0c0d0f]),   // 四個輪子
      [0.3, 0.14, 0.04, 0.8, 0.5, -hl, TAIL], [0.3, 0.14, 0.04, -0.8, 0.5, -hl, TAIL],
    ]);
    return boxGeo([
      [1.9, 0.6, K.len, 0, 0.72, 0, paint], [1.66, 0.58, 2.2, 0, 1.3, -0.25, GLASS], [1.7, 0.06, 1.9, 0, 1.6, -0.25, paint],   // 車身、車窗、車頂
      [1.94, 0.2, K.len + 0.06, 0, 0.38, 0, DARK],                                                                             // 保險桿與底盤
      ...[[0.86, 1.35], [-0.86, 1.35], [0.86, -1.35], [-0.86, -1.35]].map(([wx, wz]) => [0.24, 0.62, 0.62, wx, 0.31, wz, 0x0c0d0f]),   // 四個輪子
      [0.4, 0.16, 0.04, 0.7, 0.85, -hl, TAIL], [0.4, 0.16, 0.04, -0.7, 0.85, -hl, TAIL],   // 尾燈（沒亮的時候是暗紅色）
      [0.4, 0.12, 0.04, 0.7, 0.8, hl, 0xf3f0dc], [0.4, 0.12, 0.04, -0.7, 0.8, hl, 0xf3f0dc],   // 頭燈
      ...(kind === 'taxi' ? [[0.5, 0.18, 0.25, 0, 1.74, 0, 0xf5f5f5]] : []),   // 車頂燈
    ]);
  });
  const m = new THREE.Mesh(geo, vcMat);
  if (flashing) {
    m.add(new THREE.Mesh(cached('f' + kind, () => boxGeo([[1.96, 0.16, 0.1, 0, 0.82, -hl, 0], [1.96, 0.16, 0.1, 0, 0.82, hl, 0]])), flasher));
    return m;
  }
  const lampY = kind === 'scooter' ? 0.8 : kind === 'truck' ? 0.5 : 0.85, lampX = kind === 'scooter' ? 0 : kind === 'truck' ? 0.8 : 0.7;
  const part = (key, parts, mat) => {
    const p = new THREE.Mesh(cached(key + kind, () => boxGeo(parts)), mat);
    p.visible = false;
    m.add(p);
    return p;
  };
  const back = kind === 'scooter' ? -0.78 : -hl - 0.02;
  m.userData.brake = part('b', kind === 'scooter' ? [[0.22, 0.12, 0.04, 0, lampY, back, 0]] : [[0.42, 0.18, 0.04, lampX, lampY, back, 0], [0.42, 0.18, 0.04, -lampX, lampY, back, 0]], brakeLit);
  // 方向燈：車頭與車尾的同一側各一顆
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const x = s * (kind === 'scooter' ? 0.22 : hw - 0.1);
    m.userData[side] = part(side, [[0.16, 0.14, 0.06, x, lampY, back, 0], [0.16, 0.14, 0.06, x, lampY - (kind === 'scooter' ? -0.25 : 0.05), -back, 0]], blinkLit);
  }
  return m;
}
const tmp = {};
function syncMesh(c) {
  warp(c.x, c.z, tmp);
  c.mesh.position.set(tmp.x, 0, tmp.z);
  c.mesh.rotation.y = warpH(c.x, c.z, c.h);
}

// phase 0：開往路口前的停等點；phase 1：穿過路口開往下一條路的入口
// phase 2：機車兩段式左轉，先直行到待轉區；phase 3：在待轉區等橫向綠燈
function targetExit(c) {
  const r = rightOf(c.d);
  c.back = stopDist(c.d, c.ni, c.nj, c.kind === 'scooter') + 0.6 + c.len / 2;   // 車頭剛好停在停止線前
  c.tx = c.ni * CELL - c.d.x * c.back + r.x * c.off;
  c.tz = c.nj * CELL - c.d.z * c.back + r.z * c.off;
  c.phase = 0;
  planNext(c);
}
// 一開上這段路就先決定下個路口要往哪走（真的駕駛也是早就知道要轉彎）：
// 要左轉的會提前打方向燈、換到內側車道，要右轉的換到外側車道
function planNext(c) {
  const straight = c.d, right = rightOf(c.d), left = leftOf(c.d);
  const opts = [straight, right, left].filter((d) => inGrid(c.ni + d.x, c.nj + d.z));
  let nd = pick(opts);
  if (opts[0] === straight && Math.random() < 0.5) nd = straight;
  c.next = nd;
  c.turn = nd === left ? 'L' : nd === right ? 'R' : null;
  c.twoStage = nd === left && c.kind === 'scooter' && hasLight(c.ni, c.nj);   // 機車在有紅綠燈的路口左轉要兩段式
  const road = ownRoad(c.d, c.ni, c.nj);
  c.wantLane = c.kind === 'scooter' || !c.turn ? c.lane : c.turn === 'L' ? 0 : road.n - 1;
  c.changeAt = rand(32, 58);   // 離停等點多遠時開始變換車道
  c.yieldT = 0;
}
// 從路口 (ni, nj) 開上 nd 方向的那條路，走第 lane 個車道
function enterRoad(c, nd, lane) {
  const r = rightOf(nd), road = ownRoad(nd, c.ni, c.nj), out = crossRoad(nd, c.ni, c.nj).half + 3;
  c.lane = Math.min(lane, road.n - 1);
  c.off = laneOff(c, road, c.lane);
  c.tx = c.ni * CELL + nd.x * out + r.x * c.off;
  c.tz = c.nj * CELL + nd.z * out + r.z * c.off;
  c.phase = 1;
  c.d = nd; c.ni += nd.x; c.nj += nd.z;
}
// 左轉前看對向有沒有直行或右轉的車正要通過路口；有就先等（最多等 6 秒，避免卡死）
function oncoming(c) {
  for (const o of cars) {
    if (o.parked || o === c) continue;
    if (o.phase === 0 && o.ni === c.ni && o.nj === c.nj && o.d.x === -c.d.x && o.d.z === -c.d.z) {
      // 對向還沒進路口的車：正在開過來、離停止線 30 公尺內、而且不是也要左轉
      if (o.v > 1.5 && o.turn !== 'L' && Math.hypot(o.tx - o.x, o.tz - o.z) < 30) return true;
    } else if (o.phase === 1 && o.ni - o.d.x === c.ni && o.nj - o.d.z === c.nj && o.h !== undefined) {
      // 已經在路口裡、迎面而來的車
      if (Math.sin(o.h) * c.d.x + Math.cos(o.h) * c.d.z < -0.7) return true;
    }
  }
  return false;
}
// 到了停等點、可以走的時候：照先前決定的方向開進路口。回傳 false 表示還要等
function proceed(c, dt) {
  const nd = c.next, right = rightOf(c.d);
  if (c.twoStage) {
    // 機車兩段式左轉：先直行到路口右前角的待轉區
    const b = turnBox(c.d, c.ni, c.nj), a = rand(-1.2, 1.2), s = rand(-0.4, 0.4);
    c.tx = b.x + c.d.x * a + right.x * s;
    c.tz = b.z + c.d.z * a + right.z * s;
    c.nd = nd; c.phase = 2;
    return true;
  }
  if (c.turn === 'L' && c.yieldT < 6 && oncoming(c)) { c.yieldT += dt; return false; }
  enterRoad(c, nd, c.turn === 'L' ? 0 : c.turn === 'R' ? 9 : c.lane);   // 左轉進內側車道、右轉進外側車道、直行不換
  return true;
}

export function spawnCar(kind = 'car') {
  const K = KINDS[kind];
  for (let tries = 0; tries < 60; tries++) {
    const i = Math.floor(rand(0, N + 1)), j = Math.floor(rand(0, N + 1));
    const d = pick([{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]);
    if (!inGrid(i + d.x, j + d.z)) continue;
    const road = ownRoad(d, i, j);
    const c = { kind, w: K.w, len: K.len, acc: K.acc * rand(0.85, 1.15), pref: pick(SCOOTER_PREF), lane: Math.floor(rand(0, road.n)), still: 0, react: 0, lcT: 0 };
    const off = laneOff(c, road, c.lane);
    const r = rightOf(d), t = rand(crossRoad(d, i, j).half + 12, CELL - stopDist(d, i + d.x, j + d.z, false) - 8);
    const x = i * CELL + d.x * t + r.x * off, z = j * CELL + d.z * t + r.z * off;
    if (Math.hypot(x - bg.x, z - bg.z) < 45) continue;
    if (cars.some((o) => Math.hypot(o.x - x, o.z - z) < (K.len + o.len) / 2 + 4)) continue;
    Object.assign(c, { x, z, h: Math.atan2(d.x, d.z), v: rand(4, 9), vmax: rand(K.vmax[0], K.vmax[1]), d, off, ni: i + d.x, nj: j + d.z, mesh: buildMesh(kind) });
    scene.add(c.mesh);
    targetExit(c);
    syncMesh(c);
    cars.push(c);
    return;
  }
}

// 路邊違停：停在街廓中段的路邊，佔掉外側車道靠右的一部分。巷道與有公車站的路段不放
function spawnParked() {
  const kind = pick(['car', 'car', 'car', 'taxi', 'truck']), K = KINDS[kind];
  for (let tries = 0; tries < 60; tries++) {
    const i = Math.floor(rand(0, N + 1)), j = Math.floor(rand(0, N + 1));
    const d = pick([{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]);
    if (!inGrid(i + d.x, j + d.z)) continue;
    const road = ownRoad(d, i, j);
    if (road.n < 2) continue;
    const off = road.half - EDGE - 0.15 - K.w / 2;
    const r = rightOf(d), t = rand(crossRoad(d, i, j).half + 26, CELL - stopDist(d, i + d.x, j + d.z, false) - 22);
    const x = i * CELL + d.x * t + r.x * off, z = j * CELL + d.z * t + r.z * off;
    if (Math.hypot(x - bg.x, z - bg.z) < 40) continue;
    if (stops.some((s) => s.d.x === d.x && s.d.z === d.z && Math.hypot(s.x - x, s.z - z) < 34)) continue;
    if (parked.some((o) => Math.hypot(o.x - x, o.z - z) < 30)) continue;
    const h = Math.atan2(d.x, d.z);
    const c = { kind, parked: true, w: K.w, len: K.len, x, z, h, v: 0, d, off, fx: Math.sin(h), fz: Math.cos(h), mesh: buildMesh(kind, true) };
    scene.add(c.mesh);
    syncMesh(c);
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

// 從 (x, z) 沿著 (fx, fz) 直直開下去，還要多遠會碰到公車的車身（已經在車身範圍內回傳 0，碰不到回傳 -1）
// margin：車身左右各多留的寬度（自己的半個車寬加一點間隙）
function busAhead(x, z, fx, fz, margin) {
  const rx = x - bg.x, rz = z - bg.z;
  const px = -rx * bg.fz + rz * bg.fx, pz = rx * bg.fx + rz * bg.fz;       // 自己在公車座標裡的位置（px 左右、pz 前後）
  const dx = -fx * bg.fz + fz * bg.fx, dz = fx * bg.fx + fz * bg.fz;       // 自己的行進方向
  const hx = 1.25 + margin, hz = 6.3;
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, d, h] of [[px, dx, hx], [pz, dz, hz]]) {
    if (Math.abs(d) < 1e-6) { if (Math.abs(p) > h) return -1; continue; }
    const a = (-h - p) / d, b = (h - p) / d;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  if (t1 < 0 || t0 > t1) return -1;
  return Math.max(0, t0);
}

// 目標車道旁邊有沒有空位可以切過去（前後 7 公尺內沒有同向的車）
function laneClear(c, off) {
  const rX = -c.d.z, rZ = c.d.x;
  for (const o of cars) {
    if (o === c || o.d.x !== c.d.x || o.d.z !== c.d.z) continue;
    const px = o.x - c.x, pz = o.z - c.z;
    if (Math.abs(px * c.d.x + pz * c.d.z) < (o.len + c.len) / 2 + 3 && Math.abs(px * rX + pz * rZ - (off - c.off)) < (o.w + c.w) / 2 + 0.3) return false;
  }
  return true;
}

export function updateCars(dt) {
  const blink = app.time % 0.8 < 0.4;
  flasher.color.setHex(app.time % 0.9 < 0.45 ? 0xffb000 : 0x6a4a00);
  for (const c of cars) { c.fx = Math.sin(c.h); c.fz = Math.cos(c.h); }   // 先算好朝向，下面兩兩比對時不用重算
  for (const c of cars) {
    if (c.parked) continue;
    const ud = c.mesh.userData;
    if (c.phase === 3) {   // 在待轉區等橫向綠燈
      if (lightState(c.ni, c.nj, c.nd.x !== 0 ? 0 : 1) === 'g') enterRoad(c, c.nd, 9);
      ud.brake.visible = true; ud.L.visible = ud.R.visible = false;
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
    if (mustStop || (c.phase === 0 && c.yieldT > 0)) want = arrived ? 0 : Math.min(want, Math.sqrt(7 * Math.max(dist - 1.5, 0)));
    else if (c.phase === 0 && dist < 14) want = Math.min(want, c.turn ? 5.5 : 8);   // 要轉彎的先慢下來

    // 快到路口時換到該走的車道（左轉靠內、右轉靠外），旁邊有空位才切；離路口太近還沒換成就直接切
    if (c.phase === 0 && c.wantLane !== c.lane && dist < c.changeAt) {
      const road = ownRoad(c.d, c.ni, c.nj), off = laneOff(c, road, c.wantLane);
      if (dist < 16 || laneClear(c, off)) {
        c.lcSig = c.wantLane < c.lane ? 'L' : 'R'; c.lcT = 2.5;   // 變換車道時打 2.5 秒方向燈
        c.lane = c.wantLane; c.off = off;
        const r = rightOf(c.d);
        c.tx = c.ni * CELL - c.d.x * c.back + r.x * off; c.tz = c.nj * CELL - c.d.z * c.back + r.z * off;
      }
    }

    // 前方有同向車輛就減速。只看橫向真的會重疊的車，所以機車能從汽車旁邊鑽到前面（紅燈時一路鑽進機車停等區）
    const look = 8 + c.v * 2;
    for (const o of cars) {
      const rx = o.x - c.x, rz = o.z - c.z;
      if (o === c || rx > 45 || rx < -45 || rz > 45 || rz < -45 || o.fx * fx + o.fz * fz < 0.3) continue;
      const fwd = rx * fx + rz * fz, gap = (o.len + c.len) / 2 + 2.6;
      if (fwd <= 0 || fwd > gap + look || Math.abs(-rx * fz + rz * fx) > (o.w + c.w) / 2 - 0.1) continue;
      want = Math.min(want, Math.max(0, fwd - gap) * 1.2);
    }
    // 公車是一個 12 × 2.5 公尺的長方形障礙：不管從哪個方向來（跟在後面、橫向穿越、對向轉彎），
    // 只要照現在的方向開下去會撞上車身就減速停下來。外側車道夠寬，公車靠左一點走，機車還是能從右邊過去
    const hit = busAhead(c.x, c.z, fx, fz, c.w / 2 + 0.25);
    if (hit >= 0) {
      const gap = hit - c.len / 2;
      if (gap < look + 3) want = Math.min(want, Math.max(0, gap - 2.4) * 1.2);
    }
    // 禮讓正在過馬路的行人
    for (const p of peds) {
      if (!p.walking) continue;
      const qx = p.x - c.x, qz = p.z - c.z;
      if (qx > 12 || qx < -12 || qz > 12 || qz < -12) continue;
      const f = qx * fx + qz * fz;
      if (f > 0 && f < c.len / 2 + 5 && Math.abs(-qx * fz + qz * fx) < c.w / 2 + 2.2) want = 0;
    }

    // 停了一陣子之後要再起步，會有一點反應時間（綠燈亮了不會整排車同時衝出去）
    if (c.v < 0.15) {
      c.still += dt;
      if (want > 0.5) {
        if (c.still > 1.2 && c.react <= 0 && !c.going) c.react = rand(0.35, 1.0);
        c.going = true;
        if (c.react > 0) { c.react -= dt; want = 0; }
      } else c.going = false;
    } else { c.still = 0; c.react = 0; c.going = false; }

    // 轉向目標：在路段上時瞄準自己車道線前方 8 公尺的點，前面有違停車就先往左偏過去
    let ax = c.tx, az = c.tz;
    if (c.phase === 0) {
      const rX = -c.d.z, rZ = c.d.x;
      let eff = c.off;
      for (const p of parked) {
        if (p.d.x !== c.d.x || p.d.z !== c.d.z) continue;
        const px = p.x - c.x, pz = p.z - c.z, f = px * c.d.x + pz * c.d.z;
        if (f < -(p.len + c.len) / 2 - 2 || f > 26 || Math.abs(px * rX + pz * rZ) > 12) continue;
        eff = Math.min(eff, p.off - p.w / 2 - (c.kind === 'scooter' ? 0.7 : 0.5) - c.w / 2);
        break;
      }
      const nx = c.ni * CELL + rX * eff, nz = c.nj * CELL + rZ * eff;
      const al = Math.min((c.x - nx) * c.d.x + (c.z - nz) * c.d.z + 8, -c.back);
      ax = nx + c.d.x * al; az = nz + c.d.z * al;
    }

    // 煞車燈：明顯在減速，或停著不動時亮。方向燈：快到路口要轉彎、正在轉彎、或正在變換車道時閃
    const braking = want < c.v - 0.4 || (c.v < 0.3 && want < 0.3);
    if (c.lcT > 0) c.lcT -= dt;
    const sig = c.phase === 1 ? c.sig : c.turn && c.phase === 0 && dist < 38 && !c.twoStage ? c.turn : c.lcT > 0 ? c.lcSig : null;
    if (c.phase === 0) c.sig = c.turn && !c.twoStage ? c.turn : null;   // 進路口後沿用進來前的方向燈
    ud.brake.visible = braking;
    ud.L.visible = blink && sig === 'L';
    ud.R.visible = blink && sig === 'R';

    c.v += clamp(want - c.v, -9 * dt, c.acc * dt);
    const turn = (c.v / 3.5) * dt;
    c.h += clamp(angDiff(Math.atan2(ax - c.x, az - c.z), c.h), -turn, turn);
    c.x += Math.sin(c.h) * c.v * dt;
    c.z += Math.cos(c.h) * c.v * dt;
    if (arrived) {
      if (c.phase === 1) targetExit(c);
      else if (c.phase === 2) { c.phase = 3; c.v = 0; c.h = Math.atan2(c.nd.x, c.nd.z); }
      else if (!mustStop) proceed(c, dt);
    }
    syncMesh(c);
  }
}