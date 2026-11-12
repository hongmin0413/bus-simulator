// 常數與小工具：道路規格、彎曲座標轉換、動力系統數值
export const N = 6;            // 每邊街廓數
export const CELL = 100;       // 路口間距 (m)
export const WORLD = N * CELL;
// CAP：核定載客數。12 公尺市區公車座位加站位大約 60～70 人
export const WHEELBASE = 6, CAP = 65, LIMIT_KMH = 50;
// 公車：長 12 公尺、軸距 6、前懸 2.7、後懸 3.3。BODY_MID 是車身中心在後軸前方多遠；
// BODY_Z 是車身模型（照 z = -3 ~ 9 寫的）要往後移多少，後懸才會是 3.3
export const BODY_MID = 2.7, BODY_Z = -0.3;
// 載重：空車 12 噸，每位乘客 65 公斤（載滿約 16 噸）。乘客越多，同樣的油門加速越慢、同樣的煞車力道減速也越慢
export const BUS_MASS = 12000, PAX_MASS = 65;

// ───────── 道路規格 ─────────
// 三種道路：L 大道（單向三線）、M 一般道路（單向兩線）、S 巷道（單向一線）。
// widths 是由中線往外各車道的寬度；最外側車道特別寬（4.6 公尺），公車旁邊還容得下一台機車。
// EDGE 是最外側車道到人行道之間的路面邊線空間。
export const EDGE = 0.4;
function roadType(name, widths) {
  const lanes = [], bounds = [0];   // lanes：各車道中心離中線的距離；bounds：各車道線離中線的距離
  let x = 0;
  for (const w of widths) { lanes.push(x + w / 2); x += w; bounds.push(x); }
  return { name, n: widths.length, lanes, bounds, half: x + EDGE };
}
const TYPES = { L: roadType('L', [3.3, 3.3, 4.6]), M: roadType('M', [3.4, 4.6]), S: roadType('S', [4.6]) };
// 第 0～6 條路各是哪一種（縱向、橫向各一組）。關卡路線主要走第 1、3、5 條，進階關卡會經過巷道
export const ROAD_V = ['M', 'L', 'S', 'M', 'S', 'L', 'M'].map((k) => TYPES[k]);   // 縱向道路（沿 z），x = i * CELL
export const ROAD_H = ['M', 'L', 'M', 'M', 'S', 'L', 'M'].map((k) => TYPES[k]);   // 橫向道路（沿 x），z = j * CELL
// 朝 d 方向行駛、前後的路口是 (i, j) 時：自己這條路、與之交叉的那條路
export const ownRoad = (d, i, j) => (d.x ? ROAD_H[j] : ROAD_V[i]);
export const crossRoad = (d, i, j) => (d.x ? ROAD_V[i] : ROAD_H[j]);
// 路口轉角人行道的圓角半徑：有大道的路口 10 公尺、兩條巷道交會 6 公尺、其餘 8 公尺
// （實務上市區路口的轉角半徑多在 6～12 公尺，大型車多的幹道用大的）
export const cornerR = (i, j) => (ROAD_V[i].n === 3 || ROAD_H[j].n === 3 ? 10 : ROAD_V[i].n === 1 && ROAD_H[j].n === 1 ? 6 : 8);
// 圓角讓路緣往後退：離路口邊緣 u 公尺的地方，路緣比直線的路邊多退了幾公尺
export const curbBack = (R, u) => (u >= R ? 0 : R - Math.sqrt(R * R - (R - u) * (R - u)));
export const XWALK = 3;           // 斑馬線離路口邊緣的距離，斑馬線寬 3 公尺
export const STOP_LINE = 6.8;     // 停止線離路口邊緣的距離（有機車停等區時，這條是機車的停止線）
export const MOTO_BOX = 4.2;      // 機車停等區的深度；汽車的停止線再往後這麼多
// 該方向有沒有機車停等區：有紅綠燈、而且至少兩線
export const hasBox = (d, i, j) => hasLight(i, j) && ownRoad(d, i, j).n >= 2;
// 汽車（與公車）的停止線離路口中心多遠
export const stopDist = (d, i, j, scooter) =>
  crossRoad(d, i, j).half + (hasLight(i, j) ? STOP_LINE + (!scooter && hasBox(d, i, j) ? MOTO_BOX : 0) : 0.8);

// ───────── 彎曲的城市 ─────────
// 所有邏輯（車流、行人、路線、違規判定）都在「格子座標」上算，道路是直的棋盤；
// 畫面與公車的物理則在「世界座標」，由格子座標經過 warp 平滑地推歪，所以路會彎、路口也不是正的直角。
const WA = 11, WKA = (2 * Math.PI) / 260, WPA = 0.6, WB = 9, WKB = (2 * Math.PI) / 220, WPB = 1.9;
const fx = (z) => WA * Math.sin(z * WKA + WPA), fz = (x) => WB * Math.sin(x * WKB + WPB);
const dfx = (z) => WA * WKA * Math.cos(z * WKA + WPA), dfz = (x) => WB * WKB * Math.cos(x * WKB + WPB);
// 格子座標 → 世界座標（out 可省略）
export function warp(x, z, out = {}) {
  out.x = x + fx(z); out.z = z + fz(x);
  return out;
}
// 世界座標 → 格子座標
export function unwarp(wx, wz, out = {}) {
  let x = wx, z = wz;
  for (let k = 0; k < 5; k++) { x = wx - fx(z); z = wz - fz(x); }
  out.x = x; out.z = z;
  return out;
}
// 在格子座標 (x, z) 朝向 h 的東西，在世界座標裡朝哪個方向
export function warpH(x, z, h) {
  const s = Math.sin(h), c = Math.cos(h);
  return Math.atan2(s + dfx(z) * c, c + dfz(x) * s);
}
// 反過來：世界座標的朝向 → 格子座標的朝向（x, z 為格子座標）
export function unwarpH(x, z, wh) {
  const s = Math.sin(wh), c = Math.cos(wh), a = dfx(z), b = dfz(x);
  return Math.atan2(s - a * c, c - b * s);
}

// ───────── 動力系統 ─────────
export const IDLE = 600, REDLINE = 2400;
// 齒比參考一般 6 速手排大客車（最高檔直接傳動、後軸比約 4.9、22.5 吋輪胎）
export const GEAR_TOP = { 1: 14, 2: 24, 3: 36, 4: 52, 5: 74, 6: 98, R: 12 };          // 2400 rpm 時的時速
export const GEAR_ACC = { 1: 3.2, 2: 2.6, 3: 2.0, 4: 1.6, 5: 1.2, 6: 0.85, R: 2.6 }; // 引擎滿扭力時的加速度
export const SHIFT_UP = 1750, SHIFT_DOWN = 800;   // 儀表提示升檔、降檔的轉速
export const rpmPerMs = (g) => REDLINE / (GEAR_TOP[g] / 3.6);
export const CLUTCH_BITE = 0.75;   // 踏板深度低於此值開始接合
export const CLUTCH_RANGE = 0.5;   // 從開始接合到完全接合的踏板行程

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const rightOf = (d) => ({ x: -d.z, z: d.x });
export const leftOf = (d) => ({ x: d.z, z: -d.x });
export const inGrid = (i, j) => i >= 0 && i <= N && j >= 0 && j <= N;
export const hasLight = (i, j) => i >= 1 && i < N && j >= 1 && j < N;
export const nodeOf = (v) => clamp(Math.round(v / CELL), 0, N);

// 格子座標 (x, z) 是不是在路面上；tol > 0 表示允許超出路緣一點
export function onRoad(x, z, tol = 0) {
  const i = nodeOf(x), j = nodeOf(z), hv = ROAD_V[i].half, hh = ROAD_H[j].half;
  if (x < -ROAD_V[0].half - tol || x > WORLD + ROAD_V[N].half + tol || z < -ROAD_H[0].half - tol || z > WORLD + ROAD_H[N].half + tol) return false;
  const u = Math.abs(x - i * CELL) - hv, w = Math.abs(z - j * CELL) - hh;   // 超出縱向、橫向道路邊緣多少
  if (u <= tol || w <= tol) return true;
  // 路口的四個轉角是圓角：切掉的那一塊也是路面
  const R = cornerR(i, j);
  return u < R && w < R && (R - u) ** 2 + (R - w) ** 2 > (R - tol) ** 2;
}
export const $ = (id) => document.getElementById(id);