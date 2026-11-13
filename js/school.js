// 駕訓班關卡：封閉的考驗場地（模型、坡道高度）、各考驗項目的判定與扣分
// 規則比照大客車場考的評分表（100 分滿分、70 分及格），只算駕駛技巧與方向燈，不算指差確認與口訣。
// 配置照使用者描述的大新店駕訓班路線與衛星圖：整圈是一條環形車道——
//   東邊往北（起點／終點線 → 右轉進曲線進退、倒車退出來 → 左偏 → 路邊停車、曲巷、車庫，項目都在右邊，入口跟車道的邊線接在一起）→
//   北端「直行、右彎、半圓左彎直接接到直線」→ 西邊往南（直線換檔、狹橋、紅綠燈、左偏、上坡起步）→
//   南端同樣的右彎加半圓 → 回到東邊（平交道、行人穿越道、終點線）。
// 尺寸：曲線進退用官方大客車規格放大 1.15 倍；其餘是參照衛星圖與比例自訂的。
// 場地用自己的一套座標（公尺；x 往東、z 往南；朝向 h = 0 朝南、π 朝北、π/2 朝東），整塊擺在離城市很遠的地方：
// 世界座標 = 場地座標 + (OX, OZ)
import { WHEELBASE, clamp } from './config.js';
import { THREE, scene, lambert, basic, boxGeo, vcMat } from './world.js';
import { bus, eng, game, app } from './state.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';

export const OX = -1500, OZ = 0;
const PI = Math.PI;

// ───────── 車道中線 ─────────
const LANE = 5.5, H = LANE / 2;          // 車道寬
// 項目那一段（路邊停車、曲巷、車庫）車道加寬到 7.75 公尺（往左加寬；右邊線接著項目的入口不動）：
// 5.5 公尺的話，12 公尺的車倒車入庫、路邊停車、出曲巷時車頭一定會甩過左邊的白線；倒車入庫時內側後輪也會切過車庫旁的邊線。寬度是自訂的
const HL2 = 5;
const XA1 = 36, XA2 = 26;                // 東邊往北的車道：起點那一段、其餘項目那一段（中間一個左偏，曲線進退的入口在左偏的中段）
const XB1 = 4, XB2 = 11;                 // 西邊往南的車道：換檔那一段、坡道那一段（紅綠燈後一個左偏）
const ZS = 175;                          // 南端半圓的位置（離平交道停止線 15 公尺：出半圓後要有一段直線讓車身回正再停）
// 從 (x, z) 朝 h 出發，依序接直線 ['S', 長度] 與圓弧 ['L' 或 'R', 半徑, 角度]，每 0.5 公尺一點：[x, z, h]
function path(x, z, h, ops) {
  const out = [[x, z, h]];
  for (const op of ops) {
    if (op[0] === 'S') {
      const n = Math.max(1, Math.ceil(op[1] / 0.5));
      for (let k = 1; k <= n; k++) out.push([x + Math.sin(h) * op[1] * k / n, z + Math.cos(h) * op[1] * k / n, h]);
    } else {
      const [t, R, ang] = op, s = t === 'L' ? 1 : -1, cx = x + s * R * Math.cos(h), cz = z - s * R * Math.sin(h);
      const n = Math.max(2, Math.ceil(ang * R / 0.5));
      for (let k = 1; k <= n; k++) { const hh = h + s * ang * k / n; out.push([cx - s * R * Math.cos(hh), cz + s * R * Math.sin(hh), hh]); }
    }
    [x, z, h] = out[out.length - 1];
  }
  return out;
}
// 左偏：先左彎再右彎，橫移 7 公尺（紅綠燈後那一個）
const JA = Math.acos(1 - 7 / 40), JOG = [['L', 20, JA], ['R', 20, JA]], JOG_LEN = 40 * Math.sin(JA);
const FIL = 6, FIL_S = 9;                // 入口轉角的圓角半徑（曲線進退要從 5.5 公尺寬的車道右轉近 100 度進去，用大一點的）
// 起點出去的左偏：一條斜 15 度的直線，兩頭用半徑 15 的小弧接到直線車道，橫移 10 公尺。曲線進退的入口接在這條斜線的右邊（偏後段，
// 前面留一段讓車子先左偏再右轉進去），倒車退出來後順著同一條斜線往前
const JA2 = 15 * PI / 180, RJ2 = 15, LD = (10 - 2 * RJ2 * (1 - Math.cos(JA2))) / Math.sin(JA2);
// 紅綠燈後的左偏從 z = 20 開始（紅綠燈停止線在它前面 6 公尺）。東邊那一側整個往北平移，讓曲線進退的開頭（入口的白線）
// 跟這個左偏的結束並排（使用者說的）：Z0 是起點左偏開始的地方，D 是比原本（Z0 = 100）往北移了多少
const JB0 = 20;
const Z0 = (() => {
  const l = path(XA1, 0, PI, [['L', RJ2, JA2]]), d = path(...l.at(-1), [['S', LD]]);
  const se = d[Math.round(d.length * 0.6)][1] - (H + FIL_S) * Math.sin(JA2);   // 起點左偏從 z = 0 開始時，曲線進退入口白線的 z
  return JB0 + JOG_LEN - se;
})();
const D = 100 - Z0;
const ZN = -58 - D;                      // 北端半圓在東邊車道的起點
// 北端：右彎 60 度（半徑 25，使用者要彎得圓順一點），再接一個左彎的半圓（240 度）直接接到對面的直線，中間不再回正，整個往左移 22 公尺。
// 南端：下坡後直接一個半徑 11 的半圓接到平交道那條直線，前後都沒有彎。
// 左彎的半徑算出來剛好接得上（約 23 公尺）；終點比起點往前約 42 公尺。
const TH = 60 * PI / 180, RB = 25;
const bulbOps = (R) => [['R', RB, TH], ['L', R, PI + TH]];
const RL = (() => {
  let lo = 6, hi = 40;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2, e = path(0, 0, PI, bulbOps(m)).at(-1); if (-e[0] < 22) lo = m; else hi = m; }
  return (lo + hi) / 2;
})();
const PIECES = {
  a1: path(XA1, ZS, PI, [['S', ZS - Z0]]),                 // 平交道、行人穿越道、終點線那一段
};
PIECES.jogL = path(...PIECES.a1.at(-1), [['L', RJ2, JA2]]);
PIECES.diag = path(...PIECES.jogL.at(-1), [['S', LD]]);   // 曲線進退的入口在這一段
PIECES.jogR = path(...PIECES.diag.at(-1), [['R', RJ2, JA2]]);
PIECES.a2 = path(...PIECES.jogR.at(-1), [['S', PIECES.jogR.at(-1)[1] - ZN]]);
PIECES.north = path(...PIECES.a2.at(-1), bulbOps(RL));
PIECES.b1 = path(...PIECES.north.at(-1), [['S', JB0 - PIECES.north.at(-1)[1]]]);
PIECES.jogB = path(...PIECES.b1.at(-1), JOG);
PIECES.b2 = path(...PIECES.jogB.at(-1), [['S', ZS - PIECES.jogB.at(-1)[1]]]);
PIECES.south = path(...PIECES.b2.at(-1), [['L', (XA1 - XB2) / 2, PI]]);
export const CENTER = Object.values(PIECES).flat();
const RB_END = PIECES.north[Math.ceil(TH * RB / 0.5)];   // 北端右彎結束的地方
const NEND = PIECES.north.at(-1);                         // 北端半圓接到換檔那條直線的地方
const zExt = CENTER.map((p) => p[1]), xExt = CENTER.map((p) => p[0]);
export const BOUND = { x0: Math.min(...xExt) - H - 4, x1: 70, z0: Math.min(...zExt) - H - 4, z1: Math.max(...zExt) + H + 4 };

// ───────── 各項目的位置（場地座標）─────────
const EA = XA2 + H;                      // 項目那一段車道的右邊線（路邊停車、曲巷、車庫的入口都接在這條線上）
// 曲線進退：從左偏中段的斜直線右轉進去，先左彎半圓、再右彎半圓，出口後是停車區。
// 壓管半徑用官方大客車規格（外 11.85、內 6.65）等比例放大 1.15 倍：官方尺寸對 12 公尺的車左右只剩約 0.3 公尺。
// 曲線進退用自己的座標畫：原點在斜直線六成的地方，lx 往車道右邊、lz 往車道後方（跟車道垂直、平行）；W() 換成場地座標，toS() 反過來
const SM = PIECES.diag[Math.round(PIECES.diag.length * 0.6)], SC = Math.cos(JA2), SS = Math.sin(JA2);
const W = (lx, lz) => [SM[0] + lx * SC + lz * SS, SM[1] - lx * SS + lz * SC];
const toS = (x, z) => [(x - SM[0]) * SC - (z - SM[1]) * SS, (x - SM[0]) * SS + (z - SM[1]) * SC];
const S = (() => {
  const k = 1.15, r1 = 11.85 * k, r2 = 6.65 * k, rc = (r1 + r2) / 2, half = (r1 - r2) / 2, z = 0, x0 = H + FIL_S, x = x0 + 16.5;   // 進口直線 16.5 公尺：曲線進退跟著斜線歪 15 度，短了後半段會碰到車道
  return { r1, r2, rc, half, x0, x, z, c1: [x, z - rc], c2: [x, z - 3 * rc], endZ: z - 4 * rc, stopX: x + 14 };
})();
export const SFRAME = { W, toS, S };
export const ISSUES = [];   // 場地自我檢查發現的問題（線碰到安全島）
const PARK = { x0: EA, x1: EA + 4, z0: 14 - D, z1: 32 - D };                // 路邊停車格：寬 4、長 18
// 曲巷（T 字）：右轉進直巷（朝東），盡頭是南北向的橫巷。左轉進北段、倒車退到南段、再左轉從直巷出來、出巷右轉
const ALLEY = { z: -4 - D, half: 4, cx: EA + FIL + 10, n: -23 - D, s: 8.5 - D };
const GARAGE = { x0: EA, x1: EA + 13, z0: -32.25 - D, z1: -27.75 - D };   // 車庫：寬 4.5、深 13，開口朝西（車道那一側）
const GZ = (GARAGE.z0 + GARAGE.z1) / 2;
const GEAR = { z0: NEND[1] + 10, z1: NEND[1] + 55 };                                 // 換檔穩定測試：45 公尺內依序換到 3 檔（官方）
const BRIDGE = { z0: GEAR.z1 + 15, z1: GEAR.z1 + 27 };                                 // 狹橋
// 狹橋與坡道的黑管：共四條，左右各兩條夾出一條輪道，輪子剛好過得去（輪道寬 1.2 公尺；後軸雙輪一組約 0.6 公尺寬）。數字是離中線的距離
const TRACK = [0.4, 1.6];
const LIGHT_Z = JB0 - 6;                                                // 紅綠燈的停止線
const FINISH = Z0 + 3;                                                // 終點線（也是起點：車頭停在線前）
const RAIL = { stop: 160, z0: 158, z1: 152 };                      // 鐵路平交道：停止線、鐵軌範圍（往北開，z 越來越小）。鐵軌到行人穿越道停止線約 29 公尺
const XWALK = { stop: 123, z0: 121, z1: 118 };                     // 行人穿越道
// 坡道：坡度 15%（使用者指定），坡長照大新店衛星圖上的坡道（約一個車身長）估 12 公尺，所以高 1.8 公尺。
// 上坡的起點在對面車道行人穿越道停止線與終點線的正中間（使用者說的）
const RUP = (XWALK.stop + FINISH) / 2;
const RAMP = { up0: RUP, up1: RUP + 12, top1: RUP + 18, dn1: RUP + 30, grade: 0.15, half: 2.2 };
RAMP.stop0 = RAMP.up0 + 8; RAMP.stop1 = RAMP.up0 + 11;            // 前輪要停在這兩條白線之間
export const START = { x: XA1, z: FINISH + 9, h: PI };             // 起點（後軸位置與朝向；朝北）

// 坡道上某一點的地面高度
export function groundY(x, z) {
  if (Math.abs(x - XB2) > RAMP.half || z <= RAMP.up0 || z >= RAMP.dn1) return 0;
  const top = (RAMP.up1 - RAMP.up0) * RAMP.grade;
  return z < RAMP.up1 ? (z - RAMP.up0) * RAMP.grade : z <= RAMP.top1 ? top : (RAMP.dn1 - z) * top / (RAMP.dn1 - RAMP.top1);
}

// ───────── 線（車輪壓到就扣分）：白線是車道邊線；壓管一般是黃色，狹橋與坡道的是黑色 ─────────
const pipes = {};
const WHITE = [], YELLOW = [], BLACK = [], GREEN = [], GREY = [], DECK = [];
// 沿著折線鋪一條平貼地面的帶子
function ribbon(list, pts, w, y = 0.04) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const nx = -(bz - az) / len * w / 2, nz = (bx - ax) / len * w / 2;
    const ya = typeof y === 'function' ? y(ax, az) : y, yb = typeof y === 'function' ? y(bx, bz) : y;
    list.push(ax + nx, ya, az + nz, bx + nx, yb, bz + nz, bx - nx, yb, bz - nz, ax + nx, ya, az + nz, bx - nx, yb, bz - nz, ax - nx, ya, az - nz);
  }
}
const fill = (list, x0, z0, x1, z1, y = 0.02) => list.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
function arcPts(c, r, a0, a1, step = 0.5) {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / step)), pts = [];
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  return pts;
}
// id：扣分時用哪一組（'white' 是車道邊線）
function addPipe(id, pts, list = YELLOW, y = 0.05, w = 0.16) {
  const g = (pipes[id] ||= { segs: [], box: [1e9, 1e9, -1e9, -1e9], touch: false, clear: 0 });
  for (let k = 0; k + 1 < pts.length; k++) g.segs.push([pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]]);
  for (const [x, z] of pts) { g.box[0] = Math.min(g.box[0], x); g.box[1] = Math.min(g.box[1], z); g.box[2] = Math.max(g.box[2], x); g.box[3] = Math.max(g.box[3], z); }
  ribbon(list, pts, w, y);
}
const edge = (pts) => addPipe('white', pts, WHITE, 0.04, 0.15);
const line = (pts, w = 0.14) => ribbon(WHITE, pts, w);   // 停止線、起點線這類橫跨車道、要開過去的線：不算壓線
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
const inBox = (x, z, r) => x > r[0] && x < r[2] && z > r[1] && z < r[3];

// 車道的兩條邊線：中線往左右各偏半個車道寬。項目的入口、曲線進退對面的空地、換檔區（兩側本來就是壓管）不畫
const CUTS = [
  [EA - 1, PARK.z0, EA + 1, PARK.z1],
  [EA - 1, ALLEY.z - ALLEY.half - FIL, EA + 1, ALLEY.z + ALLEY.half + FIL], [EA - 1, GARAGE.z0, EA + 1, GARAGE.z1],
  [XB1 - H - 1, GEAR.z0, XB1 + H + 1, GEAR.z1],
];
// 左邊線離中線多遠：項目那一段（左偏之後到北端半圓）是 HL2；北端在右彎的弧上漸漸收回一般寬度（在直線上收的話，直線跟右彎接起來會多一個折角）
const ZJ = PIECES.a2[0][1];
// 南端半圓（半徑 11）的內側加寬 1.5 公尺（彎道加寬；12 公尺的車在這麼小的彎內輪差將近 2 公尺），前後 6 公尺漸漸接回
const SW = 1.5;
// 加寬從起點左偏的斜線上就開始，一路慢慢加（斜線的左邊線還是一條直線），接到項目那一段時剛好是 HL2，左邊線只會彎一次
const LW = new Map();
PIECES.diag.forEach((p, k, a) => LW.set(p, H + (HL2 - H) * k / (a.length - 1)));
PIECES.jogR.forEach((p) => LW.set(p, HL2));
{ const n = Math.ceil(TH * RB / 0.5); PIECES.north.slice(0, n + 1).forEach((p, k) => LW.set(p, HL2 + (H - HL2) * k / n)); }
const leftW = (x, z) => {
  if (Math.abs(x - XA2) < 0.3 && z > ZN - 0.1 && z < ZJ + 0.1) return HL2;
  if (z > ZS - 6) return H + SW * clamp((z - ZS + 6) / 6, 0, 1);
  return H;
};
// 切掉的地方：項目入口、換檔區
const isCut = (ex, ez) => {
  const [lx, lz] = toS(ex, ez);
  return (Math.abs(lx - H) < 1 && Math.abs(lz) < S.half + FIL_S) || CUTS.some((c) => inBox(ex, ez, c));   // 曲線進退的入口用它自己的座標
};
for (const side of [1, -1]) {
  let run = [], prev = null, prevCut = false;
  const flush = () => { if (run.length > 1) edge(run); run = []; };
  for (const pt of CENTER) {
    const [x, z, h] = pt, w = side > 0 ? LW.get(pt) ?? leftW(x, z) : H, p = [x + side * w * Math.cos(h), z - side * w * Math.sin(h)], cut = isCut(...p);
    if (prev && cut !== prevCut) {
      // 從畫線到切掉（或反過來）的那一段裡，用二分法找出切口的位置，讓線剛好接到入口轉角的起點
      let a = prev, b = p;
      for (let i = 0; i < 12; i++) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (isCut(...m) === prevCut) a = m; else b = m; }
      run.push(b);
      if (cut) flush();
    }
    if (!cut) run.push(p);
    prev = p; prevCut = cut;
  }
  flush();
}

// 行車路線的中線（小地圖用；null 表示斷開）
export const ROUTE = [];
{
  for (let k = 0; k < CENTER.length; k += 3) ROUTE.push(CENTER[k]);
  ROUTE.push(CENTER[0], null);
  const A = (c, r, a0, a1) => arcPts(c, r, a0, a1, 1.5);
  ROUTE.push(...[[0, S.z], [S.x, S.z], ...A(S.c1, S.rc, PI / 2, -PI / 2), ...A(S.c2, S.rc, PI / 2, 1.5 * PI), [S.stopX - 3, S.endZ]].map((p) => W(...p)), null);
  ROUTE.push([XA2, ALLEY.z], [ALLEY.cx, ALLEY.z], null, [ALLEY.cx, ALLEY.n + 3], [ALLEY.cx, ALLEY.s - 3], null);
  ROUTE.push([XA2, GZ], [GARAGE.x1 - 3, GZ], null, [XA2, (PARK.z0 + PARK.z1) / 2 + 4], [PARK.x0 + 2, (PARK.z0 + PARK.z1) / 2]);
}

// ───────── 場地模型 ─────────
const group = new THREE.Group();
group.position.set(OX, 0, OZ);
group.visible = false;
scene.add(group);
const lampMats = [basic(0x3a0808), basic(0x3a2f05), basic(0x06361a)];
{
  // 地面：場地內是柏油，外面是草地
  const ground = (x0, z0, x1, z1, color, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-PI / 2), lambert(color));
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    group.add(m);
  };
  ground(-450, -400, 510, 600, 0x6f9d5b, -0.06);
  ground(BOUND.x0, BOUND.z0, BOUND.x1, BOUND.z1, 0x3b3e44, 0);

  // 起點線（終點線）
  line([[XA1 - H, FINISH], [XA1 + H, FINISH]], 0.5);

  // 1. 曲線進退：兩側都是壓管，入口的兩個轉角跟車道的邊線接在一起。進口直線 16.5 公尺，接左彎半圓、右彎半圓，出口後 14 公尺的停車區（盡頭也有壓管）
  const s = S;
  const sw = (pts) => pts.map((p) => W(...p));
  addPipe('s', sw([...arcPts([H + FIL_S, s.z + s.half + FIL_S], FIL_S, PI, 1.5 * PI), [s.x, s.z + s.half], ...arcPts(s.c1, s.r1, PI / 2, -PI / 2), ...arcPts(s.c2, s.r2, PI / 2, 1.5 * PI), [s.stopX, s.endZ + s.half], [s.stopX, s.endZ - s.half]]));
  addPipe('s', sw([...arcPts([H + FIL_S, s.z - s.half - FIL_S], FIL_S, PI, PI / 2), [s.x, s.z - s.half], ...arcPts(s.c1, s.r2, PI / 2, -PI / 2), ...arcPts(s.c2, s.r1, PI / 2, 1.5 * PI), [s.stopX, s.endZ - s.half]]));
  line(sw([[s.x0, s.z - s.half], [s.x0, s.z + s.half]]), 0.3);
  // 2. 路邊停車格：靠車道那一邊是開口，其餘三邊是壓管，兩端接上車道的邊線
  addPipe('park', [[PARK.x0, PARK.z0], [PARK.x1, PARK.z0], [PARK.x1, PARK.z1], [PARK.x0, PARK.z1]]);
  // 3. 曲巷（T 字）：直巷的兩個轉角接上車道的邊線
  const a = ALLEY, ax = a.cx - a.half;
  addPipe('alley', [...arcPts([EA + FIL, a.z + a.half + FIL], FIL, PI, 1.5 * PI), [ax, a.z + a.half], [ax, a.s], [a.cx + a.half, a.s], [a.cx + a.half, a.n], [ax, a.n], [ax, a.z - a.half], ...arcPts([EA + FIL, a.z - a.half - FIL], FIL, PI / 2, PI)]);
  // 4. 車庫：開口朝西，兩邊接上車道的邊線
  const g = GARAGE;
  addPipe('garage', [[g.x0, g.z0], [g.x1, g.z0], [g.x1, g.z1], [g.x0, g.z1]]);
  // 7. 換檔穩定測試：兩側壓管，起點與終點各一條白線
  for (const x of [XB1 - H, XB1 + H]) addPipe('gear', [[x, GEAR.z0], [x, GEAR.z1]]);
  for (const z of [GEAR.z0, GEAR.z1]) line([[XB1 - H, z], [XB1 + H, z]], 0.3);
  // 8. 狹橋：淺色橋面，四條黑管夾出左右兩條輪道
  fill(DECK, XB1 - 2, BRIDGE.z0, XB1 + 2, BRIDGE.z1, 0.015);
  for (const sg of [-1, 1]) for (const d of TRACK) addPipe('bridge', [[XB1 + sg * d, BRIDGE.z0], [XB1 + sg * d, BRIDGE.z1]], BLACK, 0.06);
  // 9. 紅綠燈：停止線
  line([[XB1 - H, LIGHT_Z], [XB1 + H, LIGHT_Z]], 0.4);
  // 10. 坡道：同樣四條黑管夾出左右兩條輪道；上坡段有兩條白線，前輪要停在兩條線之間
  const r = RAMP, yOf = (x, z) => groundY(XB2, z) + 0.06;
  for (const sg of [-1, 1]) for (const d of TRACK) addPipe('ramp', [[XB2 + sg * d, r.up0], [XB2 + sg * d, r.up1], [XB2 + sg * d, r.top1], [XB2 + sg * d, r.dn1]], BLACK, yOf);
  for (const z of [r.stop0, r.stop1]) ribbon(WHITE, [[XB2 - r.half, z], [XB2 + r.half, z]], 0.3, groundY(XB2, z) + 0.04);
  {
    const P = [], top = (r.up1 - r.up0) * r.grade, x0 = XB2 - r.half, x1 = XB2 + r.half;
    const quad = (p1, p2, p3, p4) => P.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
    const prof = [[r.up0, 0], [r.up1, top], [r.top1, top], [r.dn1, 0]];
    for (let k = 0; k < 3; k++) {
      const [za, ya] = prof[k], [zb, yb] = prof[k + 1];
      quad([x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb]);
      for (const x of [x0, x1]) quad([x, 0, za], [x, ya, za], [x, yb, zb], [x, 0, zb]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, lambert(0x6f747c, { side: THREE.DoubleSide })));
  }
  // 12. 鐵路平交道：停止線、兩條鐵軌與枕木
  line([[XA1 - H, RAIL.stop], [XA1 + H, RAIL.stop]], 0.4);
  for (let x = XA1 - 7; x < XA1 + 7; x += 1.2) fill(GREY, x, RAIL.z1 + 1.9, x + 0.4, RAIL.z0 - 1.9, 0.02);
  for (const z of [RAIL.z1 + 2.2, RAIL.z0 - 2.2]) fill(DECK, XA1 - 8, z - 0.08, XA1 + 8, z + 0.08, 0.06);
  // 13. 行人穿越道：停止線與斑馬線
  line([[XA1 - H, XWALK.stop], [XA1 + H, XWALK.stop]], 0.4);
  for (let x = XA1 - H + 0.3; x < XA1 + H; x += 1) fill(WHITE, x, XWALK.z1, x + 0.5, XWALK.z0, 0.04);

  // 安全島（草地）：邊緣是黃黑相間的緣石，照大新店的樣子。兩條車道中間只有窄窄一條
  const curb = (pts) => { for (let k = 0; k + 1 < pts.length; k++) ribbon(k % 2 ? GREY : YELLOW, [pts[k], pts[k + 1]], 0.3, 0.07); };
  const dense = (pts, step = 1) => {
    const out = [pts[0]];
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
      for (let i = 1; i <= n; i++) out.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
    }
    return out;
  };
  // 安全島：多邊形 [[x, z], ...]。每個都離車道的邊線至少 2 公尺（下面會自動檢查，壓到線的話主控台會出現警告）
  const ISLANDS = [
    // 兩條車道中間（坡道旁的車棚在這裡）：西邊沿著紅綠燈後的左偏斜過去
    [[XB1 + H + 2, NEND[1] + 8], [XA2 - HL2 - 2, NEND[1] + 8], [XA2 - HL2 - 2, Z0 - 2], [XA1 - H - 2, Z0 - 2], [XA1 - H - 2, ZS - 8], [XB2 + H + 2, ZS - 8],
      [XB2 + H + 2, JB0 + JOG_LEN], [XB1 + H + 2, JB0]],
    rect(ALLEY.cx + ALLEY.half + 2, -20 - D, BOUND.x1 - 1, 16 - D).slice(0, 4),                                      // 曲巷東邊
    rect(GARAGE.x1 + 2, ZN, BOUND.x1 - 1, -36 - D).slice(0, 4),                                                  // 車庫北邊
  ];
  for (const poly of ISLANDS) {
    const v = poly.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(v, [])) GREEN.push(v[a].x, 0.05, v[a].y, v[b].x, 0.05, v[b].y, v[c].x, 0.05, v[c].y);
    curb(dense([...poly, poly[0]]));
  }
  // 檢查：白線與壓管都不可以碰到安全島（離緣石至少 0.4 公尺）
  const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
  const nearPoly = (x, z, p) => p.some((q, i) => distSeg(x, z, [...q, ...p[(i + 1) % p.length]]) < 0.4);
  for (const id in pipes) for (const sg of pipes[id].segs) for (const [x, z] of [[sg[0], sg[1]], [sg[2], sg[3]]]) {
    const bad = ISLANDS.find((p) => inPoly(x, z, p) || nearPoly(x, z, p));
    if (bad) { ISSUES.push(`${id} ${x.toFixed(1)},${z.toFixed(1)}`); console.warn('駕訓班：線碰到安全島', id, x.toFixed(1), z.toFixed(1)); }
  }

  const flat = (list, color) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list), 3));
    group.add(new THREE.Mesh(geo, basic(color, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  };
  flat(GREEN, 0x5f9e4c); flat(DECK, 0x9a9fa6); flat(GREY, 0x26282c); flat(WHITE, 0xe2e2e2); flat(YELLOW, 0xf2c200); flat(BLACK, 0x050506);

  // 建物與擺設：圍牆、辦公室、坡道旁的車棚、停著的教練車、樹、紅綠燈、平交道標誌
  const B = [], WALL = 0x8d9299, POST = 0x59636e;
  const b = BOUND, w = b.x1 - b.x0, d = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  B.push([w, 1.6, 0.25, cx, 0.8, b.z0, WALL], [w, 1.6, 0.25, cx, 0.8, b.z1, WALL], [0.25, 1.6, d, b.x0, 0.8, cz, WALL], [0.25, 1.6, d, b.x1, 0.8, cz, WALL]);
  B.push([14, 4, 9, 50, 2, 118, 0xe6dccb], [14.6, 0.5, 9.6, 50, 4.25, 118, 0xb5483c]);                     // 辦公室（紅屋頂）
  B.push([4, 0.3, 30, 17.5, 4.6, RAMP.up0 + 15, 0x9aa3ad]);                                                            // 坡道旁的車棚
  for (const px of [16.2, 18.6]) for (const pz of [RAMP.up0 + 1, RAMP.dn1 - 1]) B.push([0.3, 4.5, 0.3, px, 2.25, pz, POST]);
  for (const [px, pz, c] of [[13.5, -62 - D, 0x2a62c9], [16.5, -62 - D, 0xe2b421], [13.5, -30 - D, 0x2a62c9], [16.5, 0 - D, 0xe9e9e4], [17.4, RAMP.up0 - 14, 0xe2b421], [20, 145, 0x2a62c9]]) {
    B.push([2.5, 2.9, 11, px, 1.9, pz, c], [2.52, 1, 9.6, px, 2.5, pz, 0x1a2733], [2.3, 0.9, 11.02, px, 0.5, pz, 0x22272e]);   // 停著的教練車
  }
  for (const [px, pz] of [[56, -14 - D], [56, 6 - D], [58, -50 - D], [62, -42 - D], [17, -45 - D], [17, RAMP.dn1 + 6], [22, 140], [46, 132], [56, 140]]) {
    B.push([0.5, 2.4, 0.5, px, 1.2, pz, 0x6b4a2f], [3.2, 3.2, 3.2, px, 3.8, pz, 0x3f7f3a]);
  }
  // 紅綠燈：立在停止線前方的右側（往南開，右邊是西邊），面向北邊開過來的車
  B.push([0.25, 5, 0.25, XB1 - 3.6, 2.5, LIGHT_Z + 5, POST], [0.7, 2.2, 0.5, XB1 - 3.6, 4.4, LIGHT_Z + 5, 0x1c1f24]);
  const sphere = new THREE.SphereGeometry(0.27, 12, 8);
  lampMats.forEach((m, k) => { const l = new THREE.Mesh(sphere, m); l.position.set(XB1 - 3.6, 5.1 - k * 0.7, LIGHT_Z + 4.7); group.add(l); });
  // 平交道：兩側各一支交叉形標誌
  const board = lambert(0xf2f2f2);
  for (const [px, pz] of [[XA1 + 4.2, RAIL.stop - 0.5], [XA1 - 4.2, RAIL.z1 - 1.5]]) {
    B.push([0.18, 3.6, 0.18, px, 1.8, pz, POST], [0.9, 0.9, 0.12, px, 2.3, pz, 0xe6a200]);
    for (const rz of [0.7, -0.7]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 0.26, 0.08), board);
      m.position.set(px, 3.5, pz);
      m.rotation.z = rz;
      group.add(m);
    }
  }
  group.add(new THREE.Mesh(boxGeo(B), vcMat));
}

// 各項目的名稱（順序是使用者給的）
export const ITEMS = ['曲線進退', '路邊停車', '曲巷調頭', '倒車入庫', '右彎', '左彎', '直線換檔', '狹橋', '紅綠燈', '上坡起步', '左彎', '鐵路平交道', '行人穿越道', '終點線'];
const NTOP = PIECES.north.reduce((m, p) => (p[1] < m[1] ? p : m)), SBOT = PIECES.south.reduce((m, p) => (p[1] > m[1] ? p : m));
// 各項目的位置（指示箭頭與小地圖用）
const TARGET = [W(S.x0, S.z), [PARK.x0 + 2, (PARK.z0 + PARK.z1) / 2], [ALLEY.cx, ALLEY.z], [GARAGE.x0 + 4, GZ], [RB_END[0], RB_END[1]], [NTOP[0], NTOP[1]], [XB1, GEAR.z0], [XB1, BRIDGE.z0], [XB1, LIGHT_Z], [XB2, RAMP.up0 + 9], [SBOT[0], SBOT[1]], [XA1, RAIL.stop], [XA1, XWALK.stop], [XA1, FINISH]];
// 按 Backspace 回到這一項的起點（後軸位置與朝向）
const RESET = [[XA1, START.z, PI], [XA2, 50 - D, PI], [XA2, 12 - D, PI], [XA2, -12 - D, PI], [XA2, -40 - D, PI], RB_END, [XB1, NEND[1] + 2, 0], [XB1, BRIDGE.z0 - 8, 0], [XB1, LIGHT_Z - 14, 0], [XB2, RAMP.up0 - 7, 0], [XB2, RAMP.dn1 + 6, 0], [XA1, 170, PI], [XA1, 135, PI], [XA1, START.z, PI]];
{
  const LABEL = [W(S.x0 + 3, S.z + 6), [PARK.x1 + 3.5, (PARK.z0 + PARK.z1) / 2], [ALLEY.cx - 7, ALLEY.z + 7], [GARAGE.x0 + 6, GARAGE.z0 - 3.5], [RB_END[0] + 6, RB_END[1]], [NTOP[0], NTOP[1] - 6], [XB1 - 5, GEAR.z0 + 6], [XB1 - 5, BRIDGE.z0], [XB1 - 5, LIGHT_Z - 4], [XB2 - 5, RAMP.up0], [SBOT[0], SBOT[1] + 6], [XA1 + 6, RAIL.stop + 2], [XA1 + 6, XWALK.stop + 2], [XA1 + 6, FINISH + 4]];
  ITEMS.forEach((name, k) => {
    const cv = document.createElement('canvas');
    cv.width = 384; cv.height = 96;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(16,40,90,.9)';
    g.beginPath(); if (g.roundRect) g.roundRect(3, 3, 378, 90, 22); else g.rect(3, 3, 378, 90);
    g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 46px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${k + 1} ${name}`, 192, 50, 360);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    sp.scale.set(5.2, 1.3, 1);
    sp.position.set(LABEL[k][0], 4.6, LABEL[k][1]);
    group.add(sp);
  });
}
export const setSchoolVisible = (on) => { group.visible = on; };

// ───────── 考驗狀態 ─────────
// score: 目前分數；cur: 現在考到第幾項（0 起算）；log: 扣分紀錄；light: 紅綠燈 'g'／'y'／'r'
export const school = { score: 100, cur: 0, log: [], time: 0, done: false, light: 'g' };
let st = {};
const cool = {};
export function resetSchool() {
  Object.assign(school, { score: 100, cur: 0, log: [], time: 0, done: false, light: 'g' });
  for (const k in cool) delete cool[k];
  for (const id in pipes) { pipes[id].touch = false; pipes[id].clear = 0; }
  st = {
    sig: { L: -99, R: -99 }, started: false, stillT: 0, stalls: eng.stalls, reversing: false, rev: 0, tech: 0,
    s: 0, sStops: 0, sStopped: false, parked: false, parkT: 0, armN: false, armS: false, gears: new Set(), itemT: 0, bendT: null,
    lightT: -1, lineDone: {}, rampStop: false, rampRef: 0, neutT: 0, railStop: false, railGear: null, walkStop: false, prevNose: 0, zones: {},
  };
}
resetSchool();

// 扣分。key 相同的在 gap 秒內只扣一次
function pen(n, text, key = text, gap = 2) {
  if (school.done || (cool[key] ?? -1e9) > app.time - gap) return;
  cool[key] = app.time;
  school.score -= n;
  school.log.push({ n, text });
  toast(`${text}　−${n} 分`, 'bad');
}
// 其他技術操作（起步、油門、離合器、煞車操作不當）：每次 2 分，最多扣 18 分
export function schoolTech(why) {
  if (st.tech >= 18) return;
  st.tech += 2;
  pen(2, why, 'tech', 0);
}
// 擦撞圍牆
export function schoolCrash() { pen(16, '擦撞場地設施', 'crash', 3); }

function advance() {
  school.cur++;
  st.rev = 0; st.parked = false; st.itemT = app.time;
  if (school.cur < ITEMS.length) toast(`下一項：${school.cur + 1} ${ITEMS[school.cur]}`);
}
function finish() {
  school.done = true;
  game.lapDone = true;
}
// 這一項開始之後（或開始前 4 秒內）有沒有打過那一邊的方向燈
const signaled = (side, since) => st.sig[side] >= since - 4;

// 車身會不會撞到圍牆（x, z, h：後軸的世界座標與朝向）
const CORNER = [[-1.25, -3.3], [1.25, -3.3], [-1.25, 8.7], [1.25, 8.7]];
export function schoolBlocked(wx, wz, h) {
  const fx = Math.sin(h), fz = Math.cos(h);
  for (const [lx, lz] of CORNER) {
    const x = wx - OX + lx * fz + lz * fx, z = wz - OZ - lx * fx + lz * fz;
    if (x < BOUND.x0 + 0.2 || x > BOUND.x1 - 0.2 || z < BOUND.z0 + 0.2 || z > BOUND.z1 - 0.2) return true;
  }
  return false;
}

// 四個車輪 [左右, 前後, 半個胎寬]。後軸是雙輪，一組約 0.6 公尺寬
const WHEEL = [[-0.98, 0, 0.3], [0.98, 0, 0.3], [-1.13, WHEELBASE, 0.17], [1.13, WHEELBASE, 0.17]];
const wheels = [[0, 0], [0, 0], [0, 0], [0, 0]];
function distSeg(px, pz, s) {
  const dx = s[2] - s[0], dz = s[3] - s[1], t = clamp(((px - s[0]) * dx + (pz - s[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - s[0] - dx * t, pz - s[1] - dz * t);
}
const inRect = (r) => wheels.every(([x, z]) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);

// 轉彎要打方向燈的路口：圓形範圍 [中心 x, z, 半徑, 名稱]。在範圍裡往前開、轉了 40 度以上，就要打那一邊的燈（進入範圍前 4 秒到離開之間打過就算）
const TURNS = [[...W(5, 5), 9, '曲線進退入口'], [XA2, ALLEY.z, 8, '曲巷出入口'], [XA2, GZ, 7, '車庫出口']];
// 停止線（往北開）：停車時車頭不可以超過
const STOPS = { 11: [RAIL.stop, '平交道'], 12: [XWALK.stop, '行人穿越道'] };

export function updateSchool(dt) {
  if (school.done) return;
  const x = bus.x - OX, z = bus.z - OZ, fx = Math.sin(bus.h), fz = Math.cos(bus.h);
  const fax = x + fx * WHEELBASE, faz = z + fz * WHEELBASE;   // 前軸中心
  const noseZ = z + fz * 8.7;                                  // 車頭
  const kmh = Math.abs(bus.v) * 3.6, t = app.time;
  school.time += dt;
  st.stillT = Math.abs(bus.v) < 0.05 ? st.stillT + dt : 0;
  const still = st.stillT > 0.6;
  if (bus.signal && !bus.hazard) st.sig[bus.signal] = t;
  WHEEL.forEach(([lx, lz], k) => { wheels[k][0] = x + lx * fz + lz * fx; wheels[k][1] = z - lx * fx + lz * fz; });

  // 起步：起駛前要先打左燈
  if (!st.started && bus.v > 0.5) { st.started = true; st.itemT = t; if (t - st.sig.L > 3) pen(16, '起駛前未打方向燈'); }
  // 倒車次數（倒車入庫、路邊停車、曲巷調頭都限倒車 1 次）
  if (bus.v < -0.3 && !st.reversing) { st.reversing = true; st.rev++; }
  else if (bus.v > 0.3) st.reversing = false;

  // 在哪一段車道上
  const onA2 = Math.abs(x - XA2) < 4.5 && z < ZJ, onA1 = Math.abs(x - XA1) < 4 && z > 96 && z < ZS + 6;
  const onB1 = Math.abs(x - XB1) < 4 && z > NEND[1] - 6 && z < 40, onB2 = Math.abs(x - XB2) < 4 && z > 40 && z < ZS;
  const cur = school.cur, onRamp = onB2 && faz > RAMP.up0 && z < RAMP.dn1, onRail = onA1 && faz < RAIL.z0 && z > RAIL.z1;

  // 熄火：一般 8 分；坡道上 16 分；換檔測試區與平交道上 32 分
  if (eng.stalls !== st.stalls) {
    st.stalls = eng.stalls;
    if (onRamp) pen(16, '坡道上熄火', 'stall', 0);
    else if (onRail) pen(32, '平交道上熄火', 'stall', 0);
    else if (cur === 6 && onB1 && z > GEAR.z0 && z < GEAR.z1) pen(32, '換檔測試中熄火', 'stall', 0);
    else pen(8, '熄火', 'stall', 0);
  }

  // 壓線：車輪剛壓上去的那一刻扣一次；離開一秒後才會再算
  for (const id in pipes) {
    const g = pipes[id];
    let hit = false;
    if (x > g.box[0] - 12 && x < g.box[2] + 12 && z > g.box[1] - 12 && z < g.box[3] + 12) {
      for (const sg of g.segs) { for (let k = 0; k < 4; k++) if (distSeg(wheels[k][0], wheels[k][1], sg) < WHEEL[k][2] + 0.05) { hit = true; break; } if (hit) break; }
    }
    if (hit) {
      if (!g.touch) {
        g.touch = true;
        sfx.thump(0.25);
        if (id === 'white') pen(32, '車輪壓到白線', 'p-white', 0);
        else if (id === 's') { if (bus.v >= 0) pen(32, '曲線進退前進壓管線', 'p-s', 0); else pen(16, '曲線進退倒車壓管線', 'p-s', 0); }
        else if (id === 'park') pen(16, '路邊停車壓管線', 'p-park', 9999);
        else if (id === 'alley') pen(16, '曲巷調頭壓管線', 'p-alley', 9999);   // 只扣一次
        else if (id === 'garage') pen(16, '倒車入庫壓管線', 'p-garage', 9999);
        else if (id === 'gear') pen(32, '換檔測試壓管線', 'p-gear', 0);
        else if (id === 'bridge') pen(32, '狹橋壓管線', 'p-bridge', 0);
        else pen(16, '坡道壓管線', 'p-ramp', 0);
      }
      g.clear = 0;
    } else if (g.touch && (g.clear += dt) > 1) g.touch = false;
  }

  // 路口轉彎的方向燈：一格一格累加朝向的變化，離開範圍時看往哪邊轉了多少
  for (let k = 0; k < TURNS.length; k++) {
    const [cx, cz, r, name] = TURNS[k], inside = Math.hypot(x + fx * 3 - cx, z + fz * 3 - cz) < r, zn = st.zones[k];
    if (inside && !zn) st.zones[k] = { t, h: bus.h, sum: 0 };
    else if (inside) {
      // 一格一格累加，迴轉 180 度才分得出左右。倒車時的轉向不算（例如倒車退出曲線進退），從倒車那裡重新算
      if (bus.v < 0) { zn.sum = 0; zn.t = t; } else zn.sum += Math.atan2(Math.sin(bus.h - zn.h), Math.cos(bus.h - zn.h));
      zn.h = bus.h;
    }
    else if (zn) {
      const side = zn.sum < 0 ? 'R' : 'L';
      if (Math.abs(zn.sum) > 0.7 && bus.v > 0.3 && st.sig[side] < zn.t - 4) pen(16, `${name}${side === 'R' ? '右' : '左'}轉未打方向燈`, 'turn' + k);
      st.zones[k] = null;
    }
  }

  // ── 各考驗項目 ──
  if (cur === 0) {
    // 曲線進退：前進通過、車尾過了出口後停車，再倒車退回車道（車頭朝前）。用曲線進退自己的座標判斷
    const [lx, lz] = toS(x, z), [flx] = toS(fax, faz), along = -fx * SS - fz * SC;   // along：車頭跟車道方向一致的程度
    const inStop = flx > S.x + 6 && lz < S.endZ + S.half + 1;                       // 出口後的停車區
    if (st.s === 0 && flx > S.x0 && Math.abs(lz) < 5) st.s = 1;
    else if (st.s === 1 && inStop && lx > S.x + 0.3 && still) { st.s = 2; toast('前進完成。倒車沿原路退出來', 'good'); }
    else if (st.s === 2 && lx < H && along > 0.7 && Math.abs(lz) < 14) { st.s = 3; toast('曲線進退完成', 'good'); advance(); }
    // 中途停車：每次 8 分，最多扣兩次
    if (st.s && flx > S.x0 + 0.5 && !inStop && still) { if (!st.sStopped) { st.sStopped = true; if (++st.sStops <= 2) pen(8, '曲線進退中途停車', 'sstop', 0); } }
    else if (!still) st.sStopped = false;
    if (st.s === 0 && lx < H && lz < -14) { pen(32, '漏考：曲線進退', 'skip0'); advance(); }
  } else if (cur === 1) {
    // 路邊停車：四個輪子都停進格子裡
    if (!st.parked && still && inRect(PARK)) {
      st.parked = true; st.parkT = t;
      toast('停妥。打左方向燈駛出', 'good');
      if (st.rev > 1) pen(16, '路邊停車倒車超過 1 次');
    }
    if (st.parked && x < XA2 + 1.3) { if (st.sig.L < st.parkT) pen(16, '駛出停車格未打方向燈'); advance(); }
    else if (!st.parked && onA2 && z < PARK.z0 - 8.5) { pen(32, '漏考：路邊停車', 'skip1'); advance(); }
  } else if (cur === 2) {
    // 曲巷調頭：右轉進直巷，到底左轉進北段，倒車直直退到南段，再左轉從直巷出來
    const a = ALLEY;
    if (x > a.cx - a.half && z < a.z - a.half - 1) st.armN = true;
    if (st.armN && x > a.cx - a.half && z > a.z + a.half + 1) st.armS = true;
    if (st.armN && st.armS && x < EA && Math.abs(z - a.z) < 9) { if (st.rev > 1) pen(16, '曲巷調頭倒車超過 1 次'); toast('曲巷調頭完成', 'good'); advance(); }
    else if (!st.armN && onA2 && z < a.z - 13) { pen(32, '漏考：曲巷調頭', 'skip2'); advance(); }
  } else if (cur === 3) {
    // 倒車入庫：往前開過車庫（留倒車的空間），倒車一次停進去，四個輪子都在車庫內
    if (!st.parked && still && inRect(GARAGE)) {
      st.parked = true;
      toast('停妥。打右方向燈駛出', 'good');
      if (st.rev > 1) pen(16, '倒車入庫倒車超過 1 次');
    }
    if (st.parked && x < XA2 + 2) advance();
    else if (!st.parked && z < ZN + 1) { pen(32, '漏考：倒車入庫', 'skip3'); advance(); }
  } else if (cur === 4) {
    // 右彎：北端半圓前面的右彎
    if (st.bendT === null && z < ZN + 4) st.bendT = t;
    if (z < RB_END[1] + 0.5 && x > XA2) { if (!signaled('R', st.bendT ?? t)) pen(16, '右彎未打方向燈'); st.bendT = null; advance(); }
  } else if (cur === 5) {
    // 左彎：北端的半圓，回正之後才是換檔的起點
    if (onB1 && z > NEND[1] + 1 && fz > 0.9) { if (!signaled('L', st.itemT)) pen(16, '左彎未打方向燈'); advance(); }
  } else if (cur === 6) {
    // 換檔穩定測試：45 公尺內依序換到 3 檔（離合器接上才算）
    if (onB1 && z >= GEAR.z0 && z < GEAR.z1 && eng.gear !== 'N' && eng.gear !== 'R' && eng.clutch < 0.4) st.gears.add(eng.gear);
    if (onB1 && z >= GEAR.z1) {
      if (![...st.gears].some((gr) => +gr >= 3)) pen(16, '45 公尺內未換到 3 檔');
      else if (st.gears.has('1') && !st.gears.has('2')) pen(16, '未依序換檔');
      advance();
    }
  } else if (cur === 7) {
    if (onB1 && z > BRIDGE.z1) advance();
  } else if (cur === 8) {
    // 紅綠燈：車頭接近時變黃燈再變紅燈，停在停止線後面等綠燈。車頭不可以超過停止線
    if (st.lightT < 0 && faz > LIGHT_Z - 15) st.lightT = 0;
    if (st.prevNose <= LIGHT_Z && noseZ > LIGHT_Z && school.light === 'r') pen(32, '闖紅燈（車頭超越停止線）', 'redlight', 9999);
    if (still && school.light !== 'g' && noseZ > LIGHT_Z && noseZ < LIGHT_Z + 6) pen(32, '停車時車頭超越停止線', 'redlight', 9999);
    if (onB1 && faz > LIGHT_Z + 2) advance();
  } else if (cur === 9) {
    // 上坡起步：前輪停在兩條白線之間，再起步；倒退 15 公分以上扣分
    if (!st.rampStop && still && faz >= RAMP.stop0 && faz <= RAMP.stop1) { st.rampStop = true; st.rampRef = faz; toast('停妥。坡道起步，不可以倒退', 'good'); }
    if (st.rampStop === true) {
      st.rampRef = Math.max(st.rampRef, faz);
      if (st.rampRef - faz > 0.15 && faz < RAMP.up1) pen(16, '上坡倒退 15 公分以上', 'roll', 9999);
    }
    if (!st.rampStop && faz > RAMP.stop1 + 0.6) { st.rampStop = 'miss'; pen(16, '未在坡道的限定範圍內停車'); }
    // 下坡不可以放空檔滑行
    st.neutT = faz > RAMP.top1 && z < RAMP.dn1 && eng.gear === 'N' && kmh > 2 ? st.neutT + dt : 0;
    if (st.neutT > 0.8) pen(32, '下坡放空檔行駛', 'neutral', 9999);
    if (onB2 && z > RAMP.dn1) advance();
  } else if (cur === 10) {
    // 左彎：南端的半圓
    if (onA1 && z < ZS + 4 && fz < -0.8) { if (!signaled('L', st.itemT)) pen(16, '左彎未打方向燈'); advance(); }
  } else if (cur === 11) {
    // 鐵路平交道：車速降到 15 公里以下，在停止線前停車察看；在平交道上不可以換檔
    if (faz < RAIL.stop + 12 && faz > RAIL.stop && kmh > 15) pen(16, '接近平交道未減速', 'railfast', 9999);
    if (still && noseZ >= RAIL.stop && noseZ < RAIL.stop + 6) st.railStop = true;
    if (st.prevNose >= RAIL.stop && noseZ < RAIL.stop) { if (!st.railStop) pen(32, '平交道未在停止線前停車察看'); }
    if (st.railGear === null && faz < RAIL.z0) st.railGear = eng.gear;
    if (st.railGear !== null && onRail && eng.gear !== st.railGear) { pen(32, '在平交道上換檔', 'railshift', 9999); st.railGear = eng.gear; }
    if (onA1 && z < RAIL.z1) advance();
  } else if (cur === 12) {
    // 行人穿越道：在停止線前停車
    if (still && noseZ >= XWALK.stop && noseZ < XWALK.stop + 6) st.walkStop = true;
    if (st.prevNose >= XWALK.stop && noseZ < XWALK.stop && !st.walkStop) pen(32, '行人穿越道未在停止線前停車');
    if (onA1 && z < XWALK.z1) advance();
  } else {
    // 終點：車頭停在終點線前 3.5 公尺內
    if (still && noseZ < FINISH + 3.5 && noseZ >= FINISH - 0.3) { toast('抵達終點', 'good'); finish(); }
    else if (noseZ < FINISH - 3) { pen(16, '未停在終點線前'); finish(); }
  }
  // 平交道、行人穿越道：停車時車頭超過停止線
  const sl = STOPS[cur];
  if (sl && still && noseZ < sl[0] && noseZ > sl[0] - 6 && !st.lineDone[cur]) { st.lineDone[cur] = true; pen(32, `${sl[1]}停車時車頭超越停止線`); }
  st.prevNose = noseZ;

  // 紅綠燈的燈號：車頭離停止線 15 公尺時開始變燈，黃燈 2 秒、紅燈 8 秒，之後一直是綠燈
  if (st.lightT >= 0) st.lightT += dt;
  school.light = st.lightT < 0 || st.lightT > 10 ? 'g' : st.lightT < 2 ? 'y' : 'r';
  const on = 'ryg'.indexOf(school.light), ON = [0xff2a2a, 0xffc400, 0x2cff70], OFF = [0x3a0808, 0x3a2f05, 0x06361a];
  lampMats.forEach((m, k) => m.color.setHex(k === on ? ON[k] : OFF[k]));
}

// 回到目前這一項的起點（鍵盤 Backspace；卡住時用）。回傳後軸的世界座標與朝向
export function schoolResetPose() {
  const [x, z, h] = RESET[Math.min(school.cur, RESET.length - 1)];
  st.s = 0; st.parked = false; st.armN = st.armS = false; st.rev = 0; st.zones = {}; st.bendT = null; st.itemT = app.time;
  return { x: x + OX, z: z + OZ, h };
}

// 目前這一項的名稱、目標位置（場地座標）與操作提示
export function schoolInfo() {
  const cur = Math.min(school.cur, ITEMS.length - 1), z = bus.z - OZ, faz = z + Math.cos(bus.h) * WHEELBASE;
  let hint = '';
  if (!st.started) hint = '打左方向燈起步，往前左偏，再打右燈右轉進曲線進退';
  else if (cur === 0) hint = st.s === 0 ? '打右方向燈，右轉進曲線進退' : st.s === 1 ? '曲線進退：先左彎再右彎，車輪不要壓到黃色壓管，車尾過了出口再停車' : '倒車沿原路退出來，退回車道、車頭朝前，再順著左偏往前';
  else if (cur === 1) hint = st.parked ? '打左方向燈，駛出停車格' : z > PARK.z1 + 10 ? '順著左偏往前，接到路邊停車那條路' : '路邊停車：開過右邊的停車格，倒車一次停進去（四輪都要在格內）';
  else if (cur === 2) hint = !st.armN ? '曲巷調頭：打右燈右轉進巷子，到底左轉' : !st.armS ? '倒車直直退到另一頭' : '左轉開出巷子，出去打右燈右轉';
  else if (cur === 3) hint = st.parked ? '打右方向燈，右轉駛出車庫' : '倒車入庫：往前開過右邊的車庫，倒車一次停進去（四輪都要在車庫內）';
  else if (cur === 4) hint = '往前直行，打右方向燈右彎';
  else if (cur === 5) hint = '打左方向燈，沿著半圓左彎，直接接到換檔的直線';
  else if (cur === 6) hint = '直線換檔：45 公尺內依序換到 3 檔，不要壓到兩側的壓管';
  else if (cur === 7) hint = '狹橋：減速，左右輪各走進兩條黑管中間的輪道';
  else if (cur === 8) hint = school.light === 'g' ? '紅綠燈：綠燈通過' : '紅綠燈：車頭停在停止線後面等綠燈';
  else if (cur === 9) hint = st.rampStop === true ? (faz < RAMP.up1 ? '坡道起步：離合器放到車身開始抖，再放開煞車' : '下坡不要放空檔') : '紅綠燈後左偏，再上坡：輪子走在黑管中間的輪道，前輪停在兩條白線之間';
  else if (cur === 10) hint = '下坡後打左方向燈，沿著半圓左彎，直接接到平交道那條直線';
  else if (cur === 11) hint = '鐵路平交道：減速到 15 公里以下，車頭停在停止線前再通過，途中不要換檔';
  else if (cur === 12) hint = '行人穿越道：車頭停在停止線前再通過';
  else hint = '終點：把車頭停在終點線前';
  return { n: cur + 1, total: ITEMS.length, name: ITEMS[cur], target: TARGET[cur], hint };
}