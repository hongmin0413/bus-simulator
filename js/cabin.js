// 駕駛艙：合併內裝、共用儀表圖集；指針／警示燈／方向盤與雨刷跟隨真實模擬狀態。
import { BODY_Z, LIMIT_KMH, clamp } from './config.js';
import { THREE, boxGeo, vcMat, basic } from './world.js';
import { bus, eng } from './state.js';
import { lampOn } from './signals.js';

export const cabin = new THREE.Group();
cabin.position.z = BODY_Z;
// 眼睛位於左駕座位；稍低、稍前移，讓路面與儀表上緣同時進入視野。
export const DRIVER_EYE = Object.freeze(new THREE.Vector3(0.7, 2.22, 7.5));
const DARK = 0x171d23, TRIM = 0x343e46, EDGE = 0x626e76, METAL = 0xa2acb0, YELLOW = 0xd6b541;
const parts = [], wipers = [];
const WIPER_REST = -1.45, WIPER_SWEEP = 1.75;
const PANEL_W = 1.04, PANEL_H = 0.39;

// 僅合併本模組擁有的暫存幾何；不複製共用 UNIT，也不增加每格合併工作。
function mergeColored(geometries) {
  const sources = geometries.map((g) => g.index ? g.toNonIndexed() : g);
  const count = sources.reduce((n, g) => n + g.attributes.position.count, 0);
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const data = new Float32Array(count * 3);
    let offset = 0;
    for (const g of sources) {
      data.set(g.attributes[name].array, offset);
      offset += g.attributes[name].array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(data, 3));
  }
  for (let i = 0; i < sources.length; i++) {
    if (sources[i] !== geometries[i]) sources[i].dispose();
    geometries[i].dispose();
  }
  return merged;
}
function colored(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const colors = new Float32Array(n * 3), normals = g.attributes.normal.array;
  for (let i = 0; i < n; i++) {
    const shade = 0.84 + 0.16 * Math.max(0, normals[i * 3 + 1]);
    colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// 台面在儀表罩下方讓位，不能讓前方實體台面遮掉下半部錶面。
function dashSection(x, width, top) {
  const profile = new THREE.Shape();
  profile.moveTo(-7.96, 1.12); profile.lineTo(-8.89, 1.12);
  profile.lineTo(-8.89, top - 0.18); profile.lineTo(-8.72, top);
  profile.lineTo(-8.2, top); profile.lineTo(-7.96, top - 0.18);
  profile.closePath();
  const geo = new THREE.ExtrudeGeometry(profile, { depth: width, steps: 1, bevelEnabled: false, curveSegments: 1 });
  geo.rotateY(Math.PI / 2); geo.translate(x, 0, 0);
  return colored(geo, TRIM);
}
parts.push(dashSection(-1.21, 1.26, 1.7), dashSection(0.05, 1.16, 1.52));
const C = [
  [1.24, 0.035, 0.12, -0.58, 1.695, 8.69, EDGE],
  [1.13, 0.035, 0.12, 0.65, 1.515, 8.69, EDGE],
  [2.4, 0.025, 0.04, 0, 1.42, 7.99, DARK],
  // 擋風玻璃橡膠封邊與有亮面的 A 柱；保留實體結構，不放透明玻璃遮罩。
  [0.075, 1.68, 0.085, 1.215, 2.46, 8.98, TRIM],
  [0.014, 1.64, 0.095, 1.171, 2.46, 8.98, EDGE],
  [0.075, 1.68, 0.085, -1.215, 2.46, 8.98, TRIM],
  [0.014, 1.64, 0.095, -1.171, 2.46, 8.98, EDGE],
  [2.45, 0.12, 0.12, 0, 3.27, 8.94, DARK],
  [0.86, 0.19, 0.035, 0.7, 2.98, 8.78, TRIM],
  // 駕駛側窗台、窗軌與車門側的雙色內飾。
  [0.08, 0.9, 2.8, 1.235, 1.05, 7.55, TRIM],
  [0.13, 0.055, 2.8, 1.2, 1.53, 7.55, EDGE],
  [0.018, 0.018, 2.65, 1.125, 1.56, 7.6, DARK],
  [0.06, 0.07, 2.8, 1.235, 3.3, 7.55, TRIM],
  [0.06, 1.72, 0.08, 1.235, 2.43, 6.2, TRIM],
  [1.8, 0.06, 3.2, 0.37, 0.97, 7.4, 0x555d64],
  [0.76, 0.06, 1.9, -0.9, 0.6, 8.0, 0x555d64],
  [0.045, 0.37, 1.9, -0.52, 0.8, 8.0, YELLOW],
  [2.5, 0.05, 3.2, 0, 3.4, 7.4, TRIM],
  [0.08, 2.55, 0.1, -1.24, 2.05, 7.02, TRIM],
  [0.065, 0.55, 1.85, -1.23, 0.72, 8.0, TRIM],
  [0.065, 0.055, 1.85, -1.23, 1.98, 8.0, EDGE],
  [0.3, 0.72, 0.3, -0.35, 1.35, 8.05, TRIM],
  [0.32, 0.045, 0.32, -0.35, 1.73, 8.05, EDGE],
];
// 除霧出風口：嵌入台面的細槽，所有百葉都併入同一個內裝 mesh。
for (const x of [-0.82, -0.28, 0.27, 0.83]) {
  const top = x > 0 ? 1.52 : 1.7;
  C.push([0.37, 0.012, 0.12, x, top + 0.012, 8.58, DARK]);
  for (let k = 0; k < 5; k++) C.push([0.32, 0.012, 0.009, x, top + 0.02, 8.54 + k * 0.019, EDGE]);
}
// 前門踏階止滑條，避免用整片亮黃色平面。
for (let k = 0; k < 6; k++) C.push([0.53, 0.012, 0.016, -0.9, 0.638, 7.5 + k * 0.17, DARK]);
parts.push(boxGeo(C));
for (const [x, y, z, height] of [[-0.62, 1.78, 8.69, 1.55], [-0.51, 1.95, 7.14, 1.95]]) {
  const rail = new THREE.CylinderGeometry(0.025, 0.025, height, 8);
  rail.translate(x, y, z);
  parts.push(colored(rail, YELLOW));
}

// 儀表與側台共用一張圖集，載入後不再重畫 Canvas。
const atlas = document.createElement('canvas');
atlas.width = 1024; atlas.height = 512;
const g = atlas.getContext('2d');
g.fillStyle = '#192127'; g.fillRect(0, 0, 1024, 512);
function dial(cx, max, minor, major, unit, label, zone) {
  const cy = 172, r = 132;
  const pt = (v, radius) => {
    const a = (135 + 270 * v / max) * Math.PI / 180;
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
  };
  const face = g.createRadialGradient(cx, cy - 45, 8, cx, cy, r);
  face.addColorStop(0, '#34404a'); face.addColorStop(1, '#10171d');
  g.fillStyle = face; g.beginPath(); g.arc(cx, cy, r + 6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#65747d'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = '#99a9b0'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r - 3, 0, Math.PI * 2); g.stroke();
  for (const [v0, v1, color] of zone) {
    g.strokeStyle = color; g.lineWidth = 7; g.beginPath();
    g.arc(cx, cy, r - 13, (135 + 270 * v0 / max) * Math.PI / 180, (135 + 270 * v1 / max) * Math.PI / 180); g.stroke();
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let v = 0; v <= max; v += minor) {
    const big = v % major === 0, a = pt(v, r - 15), b = pt(v, r - (big ? 34 : 25));
    g.strokeStyle = '#dce5e9'; g.lineWidth = big ? 3 : 1.5;
    g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    if (big) { const p = pt(v, r - 53); g.fillStyle = '#e2e9ec'; g.font = 'bold 22px sans-serif'; g.fillText(label(v), ...p); }
  }
  g.fillStyle = '#a9bac3'; g.font = '19px sans-serif'; g.fillText(unit, cx, cy + 48);
  g.fillStyle = '#71848e'; g.font = '14px sans-serif'; g.fillText('CITY TRANSIT', cx, cy + 70);
}
dial(260, 100, 5, 20, 'km/h', (v) => v, [[LIMIT_KMH, 100, '#d56d50']]);
dial(764, 3000, 125, 500, 'r/min ×100', (v) => v / 100, [[1000, 1700, '#559576'], [2400, 3000, '#d56d50']]);
g.font = 'bold 21px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#82959e';
const lampX = [170, 400, 624, 854];
for (let i = 0; i < lampX.length; i++) g.fillText(['◀', 'P', '車門', '▶'][i], lampX[i], 52);
g.fillStyle = '#303a41'; g.fillRect(20, 390, 984, 110);
for (let i = 0; i < 4; i++) {
  const x = 36 + i * 248;
  g.fillStyle = '#111a20'; g.fillRect(x, 405, 218, 50);
  g.strokeStyle = '#64737c'; g.lineWidth = 2; g.strokeRect(x + 2, 407, 214, 46);
  g.fillStyle = i === 2 ? '#b56a52' : '#9aaeb6'; g.fillRect(x + 89, 418, 40, 22);
  g.fillStyle = '#c6d1d5'; g.font = 'bold 20px sans-serif'; g.fillText(['雨刷', '車門', '雙黃燈', '喇叭'][i], x + 109, 478);
}
const texture = new THREE.CanvasTexture(atlas);
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = 2;
const panelMat = basic(0xffffff, { map: texture });
function panelPlane(w, h, v0, v1) {
  const geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  return new THREE.Mesh(geo, panelMat);
}
const panel = new THREE.Group();
panel.position.set(0.65, 1.78, 8.47);
panel.rotation.set(0.32, Math.PI, 0); panel.updateMatrix();
const face = panelPlane(PANEL_W, PANEL_H, 0.25, 1);
face.position.z = 0.026; panel.add(face); cabin.add(panel);
const pod = boxGeo([
  [1.1, 0.47, 0.14, 0, 0, -0.055, DARK],
  [1.1, 0.035, 0.19, 0, 0.24, -0.025, TRIM],
  [0.025, 0.42, 0.02, -0.525, 0, 0.025, EDGE],
  [0.025, 0.42, 0.02, 0.525, 0, 0.025, EDGE],
]);
pod.applyMatrix4(panel.matrix); parts.push(pod);
const side = panelPlane(0.68, 0.17, 0, 0.25);
side.position.set(-0.38, 1.65, 8.17); side.rotation.set(0.62, Math.PI, 0);
cabin.add(side);
// 左側實體撥桿與固定座；無額外的互動面，操作仍是既有觸控／鍵盤。
parts.push(boxGeo([[0.07, 0.06, 0.25, 0.99, 1.76, 8.04, DARK], [0.22, 0.035, 0.035, 1.04, 1.78, 7.96, EDGE]]));
cabin.add(new THREE.Mesh(mergeColored(parts), vcMat));

// 兩根指針同一次 draw；只上傳兩筆 instance 矩陣。
const needleGeo = new THREE.BufferGeometry();
needleGeo.setAttribute('position', new THREE.Float32BufferAttribute([0.108, 0, 0, -0.025, 0.006, 0, -0.025, -0.006, 0], 3));
needleGeo.setIndex([0, 1, 2]);
const needles = new THREE.InstancedMesh(needleGeo, basic(0xf39b69), 2);
needles.frustumCulled = false; needles.instanceMatrix.setUsage(THREE.DynamicDrawUsage); panel.add(needles);
const lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.035, 0.012), basic(0xffffff), 4);
lamps.frustumCulled = false; panel.add(lamps);
const dummy = new THREE.Object3D(), lampColor = new THREE.Color();
for (let i = 0; i < 4; i++) {
  dummy.position.set((lampX[i] / 1024 - 0.5) * PANEL_W, (0.5 - 22 / 384) * PANEL_H, 0.03);
  dummy.updateMatrix(); lamps.setMatrixAt(i, dummy.matrix);
}
let lastSpeed = NaN, lastRPM = NaN, lastLamps = -1;

// 同一個 mesh 的厚輪圈、金屬輪輻與喇叭蓋，方向盤轉動時不帶動轉向柱。
const pivot = new THREE.Group();
pivot.position.set(0.7, 1.88, 8.1); pivot.rotation.x = 1.0;
const wheel = new THREE.Mesh(mergeColored([
  colored(new THREE.TorusGeometry(0.27, 0.025, 8, 36), 0x3a4248),
  boxGeo([
    [0.46, 0.04, 0.024, 0, 0, 0, METAL],
    [0.045, 0.23, 0.024, 0, -0.12, 0, METAL],
    [0.18, 0.14, 0.065, 0, 0, 0.015, DARK],
    [0.11, 0.014, 0.003, 0, 0.017, 0.049, EDGE],
  ]),
]), vcMat);
pivot.add(wheel);
pivot.add(new THREE.Mesh(boxGeo([[0.11, 0.11, 0.48, 0, 0, 0.29, DARK]]), vcMat));
cabin.add(pivot);
const wiperGeo = boxGeo([[0.025, 0.8, 0.018, 0, 0.4, 0, 0x141b20], [0.038, 0.46, 0.025, 0, 0.53, 0, 0x080c10]]);
for (const x of [0.22, -0.75]) {
  const wp = new THREE.Mesh(wiperGeo, vcMat);
  wp.position.set(x, 1.69, 8.94); cabin.add(wp); wipers.push(wp);
}

export function updateCabin() {
  wheel.rotation.z = bus.steerFrac * Math.PI * 6;
  const angle = WIPER_REST + (1 - Math.cos(bus.wiperT * 2 * Math.PI)) / 2 * WIPER_SWEEP;
  for (const wp of wipers) wp.rotation.z = angle;
  const speed = clamp(Math.abs(bus.v) * 3.6, 0, 100), rpm = clamp(eng.rpm, 0, 3000);
  if (speed !== lastSpeed || rpm !== lastRPM) {
    for (let i = 0; i < 2; i++) {
      dummy.position.set(((i ? 764 : 260) / 1024 - 0.5) * PANEL_W, (0.5 - 172 / 384) * PANEL_H, 0.031);
      dummy.rotation.set(0, 0, -(135 + 270 * (i ? rpm / 3000 : speed / 100)) * Math.PI / 180);
      dummy.updateMatrix(); needles.setMatrixAt(i, dummy.matrix);
    }
    needles.instanceMatrix.needsUpdate = true;
    lastSpeed = speed; lastRPM = rpm;
  }
  const bits = (lampOn('L') ? 1 : 0) | (bus.hand ? 2 : 0) | (bus.doors ? 4 : 0) | (lampOn('R') ? 8 : 0);
  if (bits !== lastLamps) {
    for (let i = 0; i < 4; i++) lamps.setColorAt(i, lampColor.setHex(bits & (1 << i) ? (i === 1 ? 0xee634d : i === 2 ? 0xe3b451 : 0x6ecb95) : 0x26343a));
    lamps.instanceColor.needsUpdate = true;
    lastLamps = bits;
  }
}
updateCabin();