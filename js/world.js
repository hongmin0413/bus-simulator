// 場景、城市（道路、標線、街廓）、紅綠燈與行人號誌、路線與站牌
import * as THREE from '../lib/three.module.js';   // three 0.160.0，直接放在版本庫裡，GitHub Pages 才載得到
import {
  N, CELL, WORLD, ROAD_V, ROAD_H, ownRoad, crossRoad, cornerR, curbBack, XWALK, STOP_LINE, EDGE, hasBox, stopDist,
  warp, warpH, rand, pick, rightOf, hasLight, $,
} from './config.js';
import { app } from './state.js';

export { THREE };

// 手機很容易發燙，所以解析度不開太高（省電模式再降，見 main.js 的 applyGfx）
export const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbcd8ee);
scene.fog = new THREE.Fog(0xbcd8ee, 160, 520);
export const camera = new THREE.PerspectiveCamera(66, 1, 0.3, 700);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.5));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(120, 200, 60);
scene.add(sun);

export const UNIT = new THREE.BoxGeometry(1, 1, 1);
const FLAT = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // 平貼地面的單位方塊（標線用）
const dummy = new THREE.Object3D(), tmpColor = new THREE.Color();
// items：{ x, y, z, sx, sy, sz, ry, c }，都是世界座標
export function instanced(geo, mat, items) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, k) => {
    dummy.position.set(it.x, it.y, it.z);
    dummy.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    dummy.rotation.y = it.ry ?? 0;
    dummy.updateMatrix();
    m.setMatrixAt(k, dummy.matrix);
    if (it.c !== undefined) m.setColorAt(k, tmpColor.set(it.c));
  });
  m.frustumCulled = false;   // 散在整個城市，不能用單一包圍球裁切
  scene.add(m);
  return m;
}
export const lambert = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });
export const basic = (color, extra) => new THREE.MeshBasicMaterial({ color, ...extra });
export function box(parent, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(UNIT, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// 把很多個方塊合併成一個幾何體（顏色寫在頂點上），一台車、一座候車亭只要畫一次，手機負擔小很多
// parts：[sx, sy, sz, x, y, z, 顏色]
export const vcMat = lambert(0xffffff, { vertexColors: true });
const boxTpl = UNIT.toNonIndexed();
export function boxGeo(parts) {
  const P = boxTpl.attributes.position.array, Nm = boxTpl.attributes.normal.array, n = P.length;
  const pos = new Float32Array(n * parts.length), nor = new Float32Array(n * parts.length), col = new Float32Array(n * parts.length);
  parts.forEach(([sx, sy, sz, x, y, z, c], k) => {
    tmpColor.set(c);
    for (let i = 0, o = k * n; i < n; i += 3, o += 3) {
      pos[o] = P[i] * sx + x; pos[o + 1] = P[i + 1] * sy + y; pos[o + 2] = P[i + 2] * sz + z;
      col[o] = tmpColor.r; col[o + 1] = tmpColor.g; col[o + 2] = tmpColor.b;
    }
    nor.set(Nm, k * n);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (draw) draw(g);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.g = g;
  return tex;
}

// ───────── 城市 ─────────
// 以下的位置都先用格子座標算，再經過 warp 推歪成世界座標
const DIRS = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
// 格子座標上的一條線段（a → b），切成小段後各自擺到世界座標，彎路上才會跟著彎
function seg(list, ax, az, bx, bz, wid, y = 0.03) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
  for (let k = 0; k < n; k++) {
    const p = warp(ax + (bx - ax) * k / n, az + (bz - az) * k / n), q = warp(ax + (bx - ax) * (k + 1) / n, az + (bz - az) * (k + 1) / n);
    list.push({ x: (p.x + q.x) / 2, y, z: (p.z + q.z) / 2, sx: wid, sz: Math.hypot(q.x - p.x, q.z - p.z), ry: Math.atan2(q.x - p.x, q.z - p.z) });
  }
}
// 把幾個擠出來的多邊形合併成一個幾何體
function mergeGeos(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.set(ng.attributes.position.array, o); nor.set(ng.attributes.normal.array, o);
    o += ng.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, o), 3));
  return out;
}
// 格子座標上的矩形外框，取樣後轉成世界座標的點。r 是四個角的圓角半徑，順序為 (x0,z0)、(x1,z0)、(x1,z1)、(x0,z1)；0 = 直角
function outline(x0, x1, z0, z1, r) {
  const pts = [], add = (x, z) => { const w = warp(x, z); pts.push(new THREE.Vector2(w.x, w.z)); };
  const edge = (ax, az, bx, bz) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 7));
    for (let k = 0; k < n; k++) add(ax + (bx - ax) * k / n, az + (bz - az) * k / n);
  };
  const arc = (cx, cz, a0, R) => { if (R) for (let k = 0; k <= 6; k++) { const a = a0 + (Math.PI / 2) * k / 6; add(cx + Math.cos(a) * R, cz + Math.sin(a) * R); } };
  edge(x0 + r[0], z0, x1 - r[1], z0); arc(x1 - r[1], z0 + r[1], -Math.PI / 2, r[1]);
  edge(x1, z0 + r[1], x1, z1 - r[2]); arc(x1 - r[2], z1 - r[2], 0, r[2]);
  edge(x1 - r[2], z1, x0 + r[3], z1); arc(x0 + r[3], z1 - r[3], Math.PI / 2, r[3]);
  edge(x0, z1 - r[3], x0, z0 + r[0]); arc(x0 + r[0], z0 + r[0], Math.PI, r[0]);
  return pts;
}
// 把外框擠成 20 公分高的平台（人行道、草地），頂面在 y = 0.2
function slab(shape) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.2, 0);
  return g;
}
{
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 200, WORLD + 200), lambert(0x3b3e44));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(WORLD / 2, 0, WORLD / 2);
  scene.add(asphalt);
  // 城市外圍的草地：一大片挖掉城市範圍
  const outer = new THREE.Shape([new THREE.Vector2(-1200, -1200), new THREE.Vector2(WORLD + 1200, -1200), new THREE.Vector2(WORLD + 1200, WORLD + 1200), new THREE.Vector2(-1200, WORLD + 1200)]);
  outer.holes.push(new THREE.Path(outline(-ROAD_V[0].half, WORLD + ROAD_V[N].half, -ROAD_H[0].half, WORLD + ROAD_H[N].half, [0, 0, 0, 0])));
  scene.add(new THREE.Mesh(slab(outer), lambert(0x6f9d5b)));

  const tex = canvasTex(128, 256, (g) => {
    g.fillStyle = '#e9e6df'; g.fillRect(0, 0, 128, 256);
    for (let r = 0; r < 12; r++) for (let c = 0; c < 6; c++) {
      g.fillStyle = Math.random() < 0.2 ? '#ffe9a8' : '#42586e';
      g.fillRect(6 + c * 20.5, 8 + r * 20.5, 13, 13);
    }
  });
  const wall = lambert(0xffffff, { map: tex }), roof = lambert(0x8a8f96);
  const palette = [0xf2e3c9, 0xd9e4ec, 0xe8c9b0, 0xcfd8c0, 0xe6e6e6, 0xc9cfe0, 0xf0d6d6, 0xb9c7d1];

  const paved = [], parks = [], buildings = [], trunks = [], crowns = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x0 = i * CELL + ROAD_V[i].half, x1 = (i + 1) * CELL - ROAD_V[i + 1].half;
    const z0 = j * CELL + ROAD_H[j].half, z1 = (j + 1) * CELL - ROAD_H[j + 1].half;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
    const park = Math.random() < 0.17;
    (park ? parks : paved).push(slab(new THREE.Shape(outline(x0, x1, z0, z1, [cornerR(i, j), cornerR(i + 1, j), cornerR(i + 1, j + 1), cornerR(i, j + 1)]))));
    if (park) {
      for (let k = 0; k < 14; k++) {
        const w = warp(cx + rand(-sx / 2 + 6, sx / 2 - 6), cz + rand(-sz / 2 + 6, sz / 2 - 6)), s = rand(0.8, 1.4);
        trunks.push({ x: w.x, y: 0.2 + s, z: w.z, sx: 0.5, sy: 2 * s, sz: 0.5 });
        crowns.push({ x: w.x, y: 0.2 + 4.4 * s, z: w.z, sx: s, sy: s, sz: s });
      }
      continue;
    }
    // 每個街廓四棟樓；離路邊留一段人行道，樓的方向跟著路的彎度轉
    const lx = (sx - 12) / 2, lz = (sz - 12) / 2;
    for (const ox of [-1, 1]) for (const oz of [-1, 1]) {
      const bh = Math.random() < 0.2 ? rand(40, 70) : rand(10, 34);
      const gx = cx + ox * (lx / 2 + 1.5), gz = cz + oz * (lz / 2 + 1.5), w = warp(gx, gz);
      buildings.push({
        x: w.x, y: 0.2 + bh / 2, z: w.z, ry: (warpH(gx, gz, 0) + warpH(gx, gz, Math.PI / 2) - Math.PI / 2) / 2,
        sx: rand(lx * 0.55, lx * 0.82), sy: bh, sz: rand(lz * 0.55, lz * 0.82), c: pick(palette),
      });
    }
  }
  scene.add(new THREE.Mesh(mergeGeos(paved), lambert(0xa3a39c)));
  if (parks.length) scene.add(new THREE.Mesh(mergeGeos(parks), lambert(0x5f9e4c)));
  instanced(UNIT, [wall, wall, roof, roof, wall, wall], buildings);
  if (trunks.length) {
    instanced(UNIT, lambert(0x6b4a2f), trunks);
    instanced(new THREE.ConeGeometry(2.4, 5, 7), lambert(0x3f7f3a), crowns);
  }

  // ── 標線 ──
  const yellow = [], white = [], icons = [];
  // 沿著 d 方向的虛線：從 (x, z) 往 d 畫 len 公尺，線段 4 公尺、間隔 6 公尺
  const dashed = (list, x, z, d, len, wid) => {
    for (let t = 1; t + 4 <= len; t += 10) seg(list, x + d.x * t, z + d.z * t, x + d.x * (t + 4), z + d.z * (t + 4), wid);
  };
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (const d of DIRS) {
    // 從路口 (i, j) 沿 d 開往路口 (ti, tj) 的這半邊道路
    const ti = i + d.x, tj = j + d.z;
    if (ti < 0 || ti > N || tj < 0 || tj > N) continue;
    const road = ownRoad(d, i, j), r = rightOf(d), lit = hasLight(ti, tj);
    const tx = ti * CELL, tz = tj * CELL, hc = crossRoad(d, ti, tj).half;
    const uStop = stopDist(d, ti, tj, false);                                             // 汽車停止線離前方路口中心的距離
    const uFrom = CELL - crossRoad(d, i, j).half - (hasLight(i, j) ? STOP_LINE : 0.8);    // 這一段從哪裡開始（離前方路口中心）
    // 這條線段上離前方路口 u 公尺、離中線 lat 公尺（右側為正）的點
    const P = (u, lat) => [tx - d.x * u + r.x * lat, tz - d.z * u + r.z * lat];
    const line = (list, u0, lat0, u1, lat1, wid) => seg(list, ...P(u0, lat0), ...P(u1, lat1), wid);

    // 中線：大道與一般道路是雙黃線，巷道是黃虛線（每段路只畫一次）
    if (d.x + d.z > 0) {
      const u0 = hc + (lit ? STOP_LINE : 0.8);
      if (road.n > 1) { line(yellow, u0, 0.2, uFrom, 0.2, 0.14); line(yellow, u0, -0.2, uFrom, -0.2, 0.14); }
      else dashed(yellow, ...P(uFrom, 0), d, uFrom - u0, 0.14);
    }
    // 車道線：白虛線，接近路口的最後 18 公尺改成白實線（禁止變換車道）
    for (let k = 1; k < road.n; k++) {
      const lat = road.bounds[k], solid = Math.min(18, (uFrom - uStop) / 3);
      line(white, uStop, lat, uStop + solid, lat, 0.14);
      dashed(white, ...P(uFrom, lat), d, uFrom - uStop - solid, 0.14);
    }
    line(white, uStop, road.half - EDGE, uFrom, road.half - EDGE, 0.12);   // 路面邊線
    // 停止線；有機車停等區的話，前面再多一個白框
    line(white, uStop, 0.3, uStop, road.half - EDGE, 0.4);
    if (hasBox(d, ti, tj)) {
      const u1 = hc + STOP_LINE, w = road.half - EDGE;
      line(white, u1, 0.3, u1, w, 0.3);
      line(white, u1, 0.4, uStop, 0.4, 0.2);
      line(white, u1, w, uStop, w, 0.2);
      for (const lane of road.lanes) {
        const [gx, gz] = P((u1 + uStop) / 2, lane), p = warp(gx, gz);
        icons.push({ x: p.x, y: 0.035, z: p.z, sx: 1.5, sz: 2.4, ry: warpH(gx, gz, Math.atan2(d.x, d.z)) });
      }
    }
    // 斑馬線：橫跨整條路
    if (lit) {
      const reach = road.half + curbBack(cornerR(ti, tj), XWALK + 1.5) - 0.6;   // 轉角是圓的，斑馬線兩端要多畫一段才碰得到路緣
      for (let lat = -Math.floor(reach); lat <= reach; lat += 1) line(white, hc + XWALK, lat, hc + XWALK + 3, lat, 0.5);
    }
    // 機車待轉區：前方路口的右前角，橫向道路停止線的前面
    if (lit) {
      const c = turnBox(d, ti, tj), ha = 1.8, hb = 0.8;   // 沿行車方向長 3.6 公尺、寬 1.6 公尺
      const Q = (a, b) => [c.x + d.x * a + r.x * b, c.z + d.z * a + r.z * b];
      seg(white, ...Q(-ha, -hb), ...Q(ha, -hb), 0.14); seg(white, ...Q(-ha, hb), ...Q(ha, hb), 0.14);
      seg(white, ...Q(-ha, -hb), ...Q(-ha, hb), 0.14); seg(white, ...Q(ha, -hb), ...Q(ha, hb), 0.14);
    }
  }
  const markMat = (color, extra) => basic(color, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...extra });
  instanced(FLAT, markMat(0xe0b020), yellow);
  instanced(FLAT, markMat(0xdddddd), white);
  // 機車停等區裡的機車圖案
  const moto = canvasTex(64, 96, (g) => {
    g.strokeStyle = g.fillStyle = '#e6e6e6'; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.arc(32, 20, 9, 0, 7); g.stroke();
    g.beginPath(); g.arc(32, 76, 9, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(32, 30); g.lineTo(32, 66); g.moveTo(18, 34); g.lineTo(46, 34); g.stroke();
    g.fillRect(24, 44, 16, 18);
  });
  instanced(FLAT, markMat(0xffffff, { map: moto, transparent: true, depthWrite: false }), icons);
}
// 機車待轉區的中心（格子座標）：朝 d 開進路口 (i, j) 時的右前角
export function turnBox(d, i, j) {
  const r = rightOf(d), ho = ownRoad(d, i, j).half, hc = crossRoad(d, i, j).half;
  const a = Math.min(hc - 2.3, hc * 0.5 + 0.6), b = ho + 1.5;
  return { x: i * CELL + d.x * a + r.x * b, z: j * CELL + d.z * a + r.z * b };
}

// ───────── 紅綠燈 ─────────
// axis: 0 = 沿 x 行駛, 1 = 沿 z 行駛。一個週期 36 秒：綠 14、黃 3、紅 19（兩個方向之間各有 1 秒全紅）
const CYCLE = 36, GREEN = 14, YELLOW = 3;
const phaseT = (group, axis) => (app.time + (group + (axis ? 0 : 1)) * (CYCLE / 2)) % CYCLE;
function phaseState(group, axis) {
  const t = phaseT(group, axis);
  return t < GREEN ? 'g' : t < GREEN + YELLOW ? 'y' : 'r';
}
export const lightState = (i, j, axis) => phaseState((i + j) % 2, axis);
// 該方向的紅燈還剩幾秒（不是紅燈時回傳 0）
function redLeftOf(group, axis) {
  const t = phaseT(group, axis);
  return t >= GREEN + YELLOW ? CYCLE - t : 0;
}
export const redLeft = (i, j, axis) => redLeftOf((i + j) % 2, axis);
// 行人能不能開始過「axis 方向的那條路」：那條路的車是紅燈，而且至少還有 1 秒
export const walkLeft = (i, j, axis) => Math.max(0, redLeft(i, j, axis) - 1);

const LAMP_ON = [0xff2a2a, 0xffc400, 0x2cff70], LAMP_OFF = [0x3a0808, 0x3a2f05, 0x06361a];
const lampMats = {}, countMats = {}, pedNumMats = {}, pedManMats = {};
const KEYS = ['00', '01', '10', '11'];   // 群組 + 方向
const digitTex = () => canvasTex(64, 64);
function drawDigits(tex, text, color) {
  const g = tex.userData.g;
  g.fillStyle = '#060708'; g.fillRect(0, 0, 64, 64);
  if (text !== '') {
    g.fillStyle = color; g.font = 'bold 46px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 32, 35);
  }
  tex.needsUpdate = true;
}
// 行人號誌的小人：紅色站著、綠色走路
function manTex(color, walking) {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#060708'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = g.fillStyle = color; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.arc(32, 12, 6, 0, 7); g.fill();
    g.beginPath();
    g.moveTo(32, 21); g.lineTo(32, 40);
    if (walking) { g.moveTo(32, 40); g.lineTo(21, 57); g.moveTo(32, 40); g.lineTo(44, 55); g.moveTo(32, 25); g.lineTo(20, 35); g.moveTo(32, 25); g.lineTo(45, 32); }
    else { g.moveTo(32, 40); g.lineTo(27, 58); g.moveTo(32, 40); g.lineTo(37, 58); g.moveTo(32, 25); g.lineTo(24, 39); g.moveTo(32, 25); g.lineTo(40, 39); }
    g.stroke();
  });
}
const MAN_RED = manTex('#ff3b30', false), MAN_GREEN = manTex('#2cff70', true);
{
  const grey = [], black = [], lamps = {}, counts = {}, pedNums = {}, pedMen = {};
  const face = new THREE.PlaneGeometry(1, 1);
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) for (const d of DIRS) {
    // 朝 d 開進路口 (i, j) 的車看的燈：在路口對面的右側立一根桿子，橫桿伸到車道上方，掛一組橫式燈頭
    const r = rightOf(d), key = `${(i + j) % 2}${d.x !== 0 ? 0 : 1}`;
    const ho = ownRoad(d, i, j).half, hc = crossRoad(d, i, j).half, hd = Math.atan2(d.x, d.z);
    const R = cornerR(i, j), k0 = R * 0.3 + 1;   // 桿子立在圓角內側的人行道上
    const gx = i * CELL + d.x * (hc + k0) + r.x * (ho + k0), gz = j * CELL + d.z * (hc + k0) + r.z * (ho + k0);
    const p = warp(gx, gz), h = warpH(gx, gz, hd), fx = Math.sin(h), fz = Math.cos(h), lx = fz, lz = -fx;   // (lx, lz)：駕駛看過去的左邊
    const arm = ho * 0.75 + k0, hx = p.x + lx * arm, hz = p.z + lz * arm;                                 // 燈頭中心
    grey.push({ x: p.x, y: 3.3, z: p.z, sx: 0.28, sy: 6.6, sz: 0.28 });
    grey.push({ x: p.x + lx * (arm + 2) / 2, y: 6.5, z: p.z + lz * (arm + 2) / 2, sx: arm + 2, sy: 0.18, sz: 0.18, ry: h });
    black.push({ x: hx, y: 6.5, z: hz, sx: 3.0, sy: 1.0, sz: 0.5, ry: h });
    for (let k = 0; k < 3; k++) (lamps[key + k] ||= []).push({ x: hx + lx * (0.9 - k * 0.9) - fx * 0.2, y: 6.5, z: hz + lz * (0.9 - k * 0.9) - fz * 0.2 });
    // 紅燈倒數：掛在燈頭左邊
    black.push({ x: hx + lx * 2.15, y: 6.5, z: hz + lz * 2.15, sx: 1.1, sy: 1.0, sz: 0.4, ry: h });
    (counts[key] ||= []).push({ x: hx + lx * 2.15 - fx * 0.22, y: 6.5, z: hz + lz * 2.15 - fz * 0.22, sx: 0.95, sy: 0.85, ry: h + Math.PI });
    // 桿子上再掛一組直式的輔助燈頭
    black.push({ x: p.x - fx * 0.3, y: 3.6, z: p.z - fz * 0.3, sx: 0.6, sy: 1.9, sz: 0.4, ry: h });
    for (let k = 0; k < 3; k++) (lamps[key + k] ||= []).push({ x: p.x - fx * 0.48, y: 4.2 - k * 0.6, z: p.z - fz * 0.48, sx: 0.7, sy: 0.7, sz: 0.7 });

    // 行人號誌：這一側斑馬線（橫越 d 方向的路）的兩端各一個，面向對面
    const pw = ho + curbBack(R, XWALK + 1.5) + 0.9;   // 行人號誌離路中線多遠：站在退後的路緣內側
    for (const side of [1, -1]) {
      const qx = i * CELL - d.x * (hc + XWALK + 1.5) + r.x * side * pw, qz = j * CELL - d.z * (hc + XWALK + 1.5) + r.z * side * pw;
      const q = warp(qx, qz), a = warpH(qx, qz, Math.atan2(-r.x * side, -r.z * side)), nx = Math.sin(a), nz = Math.cos(a);
      grey.push({ x: q.x, y: 1.4, z: q.z, sx: 0.14, sy: 2.4, sz: 0.14 });
      black.push({ x: q.x, y: 2.95, z: q.z, sx: 0.5, sy: 1.0, sz: 0.3, ry: a });
      (pedNums[key] ||= []).push({ x: q.x + nx * 0.16, y: 3.19, z: q.z + nz * 0.16, sx: 0.42, sy: 0.42, ry: a });
      (pedMen[key] ||= []).push({ x: q.x + nx * 0.16, y: 2.71, z: q.z + nz * 0.16, sx: 0.42, sy: 0.42, ry: a });
    }
  }
  instanced(UNIT, lambert(0x4a4f57), grey);
  instanced(UNIT, lambert(0x1c1f24), black);
  const sphere = new THREE.SphereGeometry(0.36, 12, 8);
  for (const key in lamps) {
    lampMats[key] = basic(0x000000);
    instanced(sphere, lampMats[key], lamps[key]);
  }
  for (const key of KEYS) {
    countMats[key] = basic(0xffffff, { map: digitTex() });
    pedNumMats[key] = basic(0xffffff, { map: digitTex() });
    pedManMats[key] = basic(0xffffff, { map: MAN_RED });
    instanced(face, countMats[key], counts[key]);
    instanced(face, pedNumMats[key], pedNums[key]);
    instanced(face, pedManMats[key], pedMen[key]);
  }
}
const shown = {};   // 各號誌目前顯示的內容，有變才重畫貼圖
export function updateLights() {
  for (let g = 0; g < 2; g++) for (let a = 0; a < 2; a++) {
    const key = `${g}${a}`, st = phaseState(g, a), on = 'ryg'.indexOf(st), left = redLeftOf(g, a);
    for (let k = 0; k < 3; k++) lampMats[key + k].color.setHex(k === on ? LAMP_ON[k] : LAMP_OFF[k]);
    // 車用號誌：紅燈倒數
    const cv = st === 'r' ? String(Math.ceil(left)) : '';
    if (shown[key + 'v'] !== cv) { shown[key + 'v'] = cv; drawDigits(countMats[key].map, cv, '#ff3b30'); }
    // 行人號誌：橫越這條路的行人，在車子紅燈時是綠燈（最後 5 秒閃爍），其餘時間紅燈並倒數還要等多久
    const walk = left > 1, t = phaseT(g, a);
    const num = walk ? Math.ceil(left - 1) : Math.ceil(t < GREEN + YELLOW ? GREEN + YELLOW - t : CYCLE - t + GREEN + YELLOW);
    const pv = (walk ? 'g' : 'r') + num;
    if (shown[key + 'p'] !== pv) { shown[key + 'p'] = pv; drawDigits(pedNumMats[key].map, String(num), walk ? '#2cff70' : '#ff3b30'); }
    const man = pedManMats[key], blinkOff = walk && left < 6 && (app.time * 2) % 1 < 0.5;
    if (man.map !== (walk ? MAN_GREEN : MAN_RED)) { man.map = walk ? MAN_GREEN : MAN_RED; man.needsUpdate = true; }
    man.color.setHex(blinkOff ? 0x202020 : 0xffffff);
  }
}

// ───────── 路線與站牌（依關卡重建）─────────
export const ROUTE_NODES = [];   // 目前關卡的路線轉折點，內容會被 buildRoute 換掉
export const stops = [];
const stopGroups = [];
const FIG_COLORS = [0xe57373, 0x64b5f6, 0xffd54f, 0x81c784, 0xba68c8, 0xff8a65, 0x4dd0e1, 0xf06292];
const figBody = new THREE.CylinderGeometry(0.2, 0.26, 1.15, 8), figHead = new THREE.SphereGeometry(0.2, 10, 8);
const skin = lambert(0xf1c9a5), figMats = FIG_COLORS.map((c) => lambert(c));
const FIGS = 12;          // 每一站最多畫幾個候車的人
const SHELTER_X = -4.3;   // 候車亭中心在停靠區中心的右邊（區域 -x）多遠
// 候車亭：屋頂、柱子、長椅、站牌桿與站牌，合併成一個幾何體，所有站共用
const shelterGeo = boxGeo([
  [1.7, 0.15, 4.2, 0, 2.8, 0, 0x2a6fb5], [0.12, 2.6, 0.12, 0.7, 1.5, 1.95, 0x59636e], [0.12, 2.6, 0.12, 0.7, 1.5, -1.95, 0x59636e],
  [0.45, 0.1, 3, -0.4, 0.7, 0, 0x7a5a3a], [0.1, 3, 0.1, 0.6, 1.7, 3.2, 0x59636e], [0.12, 0.8, 0.8, 0.6, 3.0, 3.2, 0x1565c0],
].map((p) => { p[3] += SHELTER_X; return p; }));
const glassMat = lambert(0x9fc4dd, { transparent: true, opacity: 0.6 });

function textSprite(text) {
  const tex = canvasTex(512, 128, (g) => {
    g.fillStyle = 'rgba(16,40,90,.92)';
    roundRect(g, 4, 4, 504, 120, 28); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 64px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 68, 480);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(7, 1.75, 1);
  return s;
}

export const updateFigs = (s) => s.figs.forEach((f, k) => (f.visible = k < s.waiting));

// level: js/levels.js 的一筆關卡設定
export function buildRoute(level) {
  for (const g of stopGroups) {
    scene.remove(g);
    g.userData.label.material.map.dispose();
    g.userData.label.material.dispose();
    g.userData.zoneMat.dispose();
  }
  stopGroups.length = 0; stops.length = 0; ROUTE_NODES.length = 0;
  ROUTE_NODES.push(...level.nodes);
  level.stops.forEach(([leg, block], idx) => {   // [路段, 第幾個街廓]
    const a = ROUTE_NODES[leg], b = ROUTE_NODES[(leg + 1) % ROUTE_NODES.length];
    const d = { x: Math.sign(b[0] - a[0]), z: Math.sign(b[1] - a[1]) }, r = rightOf(d);
    const road = ownRoad(d, a[0], a[1]), lat = road.half - EDGE - 1.75;   // 停靠位置：車身右側離路緣約半公尺
    const px = (a[0] + d.x * (block + 0.5)) * CELL, pz = (a[1] + d.z * (block + 0.5)) * CELL;
    const s = {
      idx, name: level.names[idx], d, r, heading: Math.atan2(d.x, d.z),
      x: px + r.x * lat, z: pz + r.z * lat,   // 停靠區中心（格子座標）
      crowd: level.crowd, max: Math.round(12 * level.crowd),   // 這一站最多有幾個人在等
      waiting: Math.floor(rand(3, 10) * level.crowd), regen: rand(5, 11) / level.crowd, figs: [],
    };
    const grp = new THREE.Group(), w = warp(s.x, s.z);
    grp.position.set(w.x, 0, w.z);
    grp.rotation.y = warpH(s.x, s.z, s.heading);   // 區域 +z = 行駛方向，區域 +x = 左邊（車道那一側），候車亭在 -x
    grp.add(new THREE.Mesh(shelterGeo, vcMat));
    box(grp, glassMat, 0.08, 2.1, 4, SHELTER_X - 0.75, 1.6, 0);
    const label = textSprite(`${idx + 1}. ${s.name}`);
    label.position.set(SHELTER_X, 4.4, 0);
    grp.add(label);
    s.zoneMat = basic(0xffd54a, { transparent: true, opacity: 0.25, depthWrite: false });
    const zoneMesh = new THREE.Mesh(FLAT, s.zoneMat);
    zoneMesh.scale.set(3, 1, 13);
    zoneMesh.position.y = 0.05;
    grp.add(zoneMesh);
    grp.userData = { label, zoneMat: s.zoneMat };
    for (let k = 0; k < FIGS; k++) {   // 候車的人排成兩排；人數超過 FIGS 時只畫出 FIGS 個
      const f = new THREE.Group();
      const body = new THREE.Mesh(figBody, pick(figMats));
      body.position.y = 0.58;
      const head = new THREE.Mesh(figHead, skin);
      head.position.y = 1.36;
      f.add(body, head);
      f.position.set(SHELTER_X + (k % 2 ? -0.35 : 0.3) + rand(-0.1, 0.1), 0.2, -1.7 + Math.floor(k / 2) * 0.62);
      grp.add(f);
      s.figs.push(f);
    }
    scene.add(grp);
    stopGroups.push(grp);
    stops.push(s);
    updateFigs(s);
  });
}

// 下一站的指示光柱
export const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(1.3, 1.3, 50, 16, 1, true),
  basic(0x4dff9a, { transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
);
scene.add(beam);