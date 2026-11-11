// 場景、城市、紅綠燈、路線與站牌
import * as THREE from '../lib/three.module.js';   // three 0.160.0，直接放在版本庫裡，GitHub Pages 才載得到
import { N, CELL, W, HALF, WORLD, LANE_OUT, rand, pick, rightOf, hasLight, $ } from './config.js';
import { app } from './state.js';

export { THREE };

export const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbcd8ee);
scene.fog = new THREE.Fog(0xbcd8ee, 160, 560);
export const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 900);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.5));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(120, 200, 60);
scene.add(sun);

export const UNIT = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D(), tmpColor = new THREE.Color();
export function instanced(geo, mat, items) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, k) => {
    dummy.position.set(it.x, it.y, it.z);
    dummy.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    dummy.updateMatrix();
    m.setMatrixAt(k, dummy.matrix);
    if (it.c !== undefined) m.setColorAt(k, tmpColor.set(it.c));
  });
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
export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

// ───────── 城市 ─────────
{
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), lambert(0x6f9d5b));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(WORLD / 2, -0.06, WORLD / 2);
  scene.add(grass);
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + W, WORLD + W), lambert(0x3b3e44));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(WORLD / 2, 0, WORLD / 2);
  scene.add(asphalt);

  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#e9e6df'; g.fillRect(0, 0, 128, 256);
  for (let r = 0; r < 12; r++) for (let c = 0; c < 6; c++) {
    g.fillStyle = Math.random() < 0.2 ? '#ffe9a8' : '#42586e';
    g.fillRect(6 + c * 20.5, 8 + r * 20.5, 13, 13);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const wall = lambert(0xffffff, { map: tex }), roof = lambert(0x8a8f96);
  const palette = [0xf2e3c9, 0xd9e4ec, 0xe8c9b0, 0xcfd8c0, 0xe6e6e6, 0xc9cfe0, 0xf0d6d6, 0xb9c7d1];

  const blocks = [], buildings = [], trunks = [], crowns = [];
  const size = CELL - W;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
    const park = Math.random() < 0.17;
    blocks.push({ x: cx, y: 0.1, z: cz, sx: size, sy: 0.2, sz: size, c: park ? 0x5f9e4c : 0xa3a39c });
    if (park) {
      for (let k = 0; k < 14; k++) {
        const x = cx + rand(-size / 2 + 5, size / 2 - 5), z = cz + rand(-size / 2 + 5, size / 2 - 5), s = rand(0.8, 1.4);
        trunks.push({ x, y: 0.2 + s, z, sx: 0.5, sy: 2 * s, sz: 0.5 });
        crowns.push({ x, y: 0.2 + 4.4 * s, z, sx: s, sy: s, sz: s });
      }
      continue;
    }
    const lot = (size - 8) / 2;
    for (const ox of [-1, 1]) for (const oz of [-1, 1]) {
      const bh = Math.random() < 0.2 ? rand(40, 70) : rand(10, 34);
      buildings.push({
        x: cx + ox * (lot / 2 + 1), y: 0.2 + bh / 2, z: cz + oz * (lot / 2 + 1),
        sx: rand(lot * 0.6, lot * 0.92), sy: bh, sz: rand(lot * 0.6, lot * 0.92), c: pick(palette),
      });
    }
  }
  instanced(UNIT, lambert(0xffffff), blocks);
  instanced(UNIT, [wall, wall, roof, roof, wall, wall], buildings);
  if (trunks.length) {
    instanced(UNIT, lambert(0x6b4a2f), trunks);
    instanced(new THREE.ConeGeometry(2.4, 5, 7), lambert(0x3f7f3a), crowns);
  }

  // 標線：雙黃中線、白色車道線、停止線
  const yellow = [], white = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) {
    const a = i * CELL, s0 = j * CELL + HALF, s1 = (j + 1) * CELL - HALF, mid = (s0 + s1) / 2, len = s1 - s0;
    // 有紅綠燈的路口：停止線後移，前面留給斑馬線（縱向道路的兩端是 v0 / v1，橫向道路是 h0 / h1）
    const v0 = hasLight(i, j), v1 = hasLight(i, j + 1), h0 = hasLight(j, i), h1 = hasLight(j + 1, i);
    yellow.push({ x: a, y: 0.02, z: mid, sx: 0.35, sy: 0.02, sz: len });
    white.push({ x: a - 3.5, y: 0.02, z: s1 - (v1 ? 5 : 0.6), sx: 7, sy: 0.02, sz: 0.5 });
    white.push({ x: a + 3.5, y: 0.02, z: s0 + (v0 ? 5 : 0.6), sx: 7, sy: 0.02, sz: 0.5 });
    yellow.push({ x: mid, y: 0.02, z: a, sx: len, sy: 0.02, sz: 0.35 });
    white.push({ x: s1 - (h1 ? 5 : 0.6), y: 0.02, z: a + 3.5, sx: 0.5, sy: 0.02, sz: 7 });
    white.push({ x: s0 + (h0 ? 5 : 0.6), y: 0.02, z: a - 3.5, sx: 0.5, sy: 0.02, sz: 7 });
    for (let k = -6.5; k <= 6.5; k++) {   // 斑馬線
      if (v0) white.push({ x: a + k, y: 0.02, z: s0 + 2.3, sx: 0.5, sy: 0.02, sz: 3 });
      if (v1) white.push({ x: a + k, y: 0.02, z: s1 - 2.3, sx: 0.5, sy: 0.02, sz: 3 });
      if (h0) white.push({ x: s0 + 2.3, y: 0.02, z: a + k, sx: 3, sy: 0.02, sz: 0.5 });
      if (h1) white.push({ x: s1 - 2.3, y: 0.02, z: a + k, sx: 3, sy: 0.02, sz: 0.5 });
    }
    for (let t = s0 + 9; t < s1 - 9; t += 8) for (const o of [-3.5, 3.5]) {
      white.push({ x: a + o, y: 0.02, z: t, sx: 0.18, sy: 0.02, sz: 3 });
      white.push({ x: t, y: 0.02, z: a + o, sx: 3, sy: 0.02, sz: 0.18 });
    }
  }
  // 機車待轉區：每個有紅綠燈的路口、每個行車方向的右前角各一格白框
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) for (const d of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]) {
    const r = rightOf(d), cx = i * CELL + r.x * 7 + d.x * 5.2, cz = j * CELL + r.z * 7 + d.z * 5.2;
    // 框的長邊沿行車方向 3.4 公尺，短邊 1.5 公尺
    const lx = Math.abs(d.x) * 3.4 + Math.abs(r.x) * 1.5, lz = Math.abs(d.z) * 3.4 + Math.abs(r.z) * 1.5;
    white.push({ x: cx - lx / 2, y: 0.02, z: cz, sx: 0.14, sy: 0.02, sz: lz });
    white.push({ x: cx + lx / 2, y: 0.02, z: cz, sx: 0.14, sy: 0.02, sz: lz });
    white.push({ x: cx, y: 0.02, z: cz - lz / 2, sx: lx, sy: 0.02, sz: 0.14 });
    white.push({ x: cx, y: 0.02, z: cz + lz / 2, sx: lx, sy: 0.02, sz: 0.14 });
  }
  instanced(UNIT, basic(0xe0b020), yellow);
  instanced(UNIT, basic(0xdddddd), white);
}

// ───────── 紅綠燈 ─────────
// axis: 0 = 沿 x 行駛, 1 = 沿 z 行駛
function phaseState(group, axis) {
  const t = (app.time + group * 11) % 22;
  if (axis === 1) return t < 9 ? 'g' : t < 11 ? 'y' : 'r';
  return t < 11 ? 'r' : t < 20 ? 'g' : 'y';
}
export const lightState = (i, j, axis) => phaseState((i + j) % 2, axis);
// 該方向的紅燈還剩幾秒（不是紅燈時回傳 0）
export function redLeft(i, j, axis) {
  const t = (app.time + ((i + j) % 2) * 11) % 22;
  return axis === 1 ? (t >= 11 ? 22 - t : 0) : (t < 11 ? 11 - t : 0);
}
const LAMP_ON = [0xff2a2a, 0xffc400, 0x2cff70], LAMP_OFF = [0x3a0808, 0x3a2f05, 0x06361a];
const lampMats = {};
{
  const poles = [], housings = [], lamps = {};
  const dirs = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) for (const d of dirs) {
    const r = rightOf(d), grp = (i + j) % 2, axis = d.x !== 0 ? 0 : 1;
    const px = i * CELL + d.x * (HALF + 1.5) + r.x * (HALF + 1.5);
    const pz = j * CELL + d.z * (HALF + 1.5) + r.z * (HALF + 1.5);
    poles.push({ x: px, y: 3, z: pz, sx: 0.3, sy: 6, sz: 0.3 });
    housings.push({ x: px, y: 6.3, z: pz, sx: d.x ? 0.6 : 1, sy: 2.7, sz: d.x ? 1 : 0.6 });
    for (let k = 0; k < 3; k++) (lamps[`${grp}${axis}${k}`] ||= []).push({ x: px - d.x * 0.35, y: 7.15 - k * 0.85, z: pz - d.z * 0.35 });
  }
  instanced(UNIT, lambert(0x4a4f57), poles);
  instanced(UNIT, lambert(0x1c1f24), housings);
  const sphere = new THREE.SphereGeometry(0.34, 12, 8);
  for (const key in lamps) {
    lampMats[key] = basic(0x000000);
    instanced(sphere, lampMats[key], lamps[key]);
  }
}
export function updateLights() {
  for (let g = 0; g < 2; g++) for (let a = 0; a < 2; a++) {
    const on = 'ryg'.indexOf(phaseState(g, a));
    for (let k = 0; k < 3; k++) lampMats[`${g}${a}${k}`].color.setHex(k === on ? LAMP_ON[k] : LAMP_OFF[k]);
  }
}

// ───────── 路線與站牌（依關卡重建）─────────
export const ROUTE_NODES = [];   // 目前關卡的路線轉折點，內容會被 buildRoute 換掉
export const stops = [];
const stopGroups = [];
const FIG_COLORS = [0xe57373, 0x64b5f6, 0xffd54f, 0x81c784, 0xba68c8, 0xff8a65, 0x4dd0e1, 0xf06292];
const figBody = new THREE.CylinderGeometry(0.2, 0.26, 1.15, 8), figHead = new THREE.SphereGeometry(0.2, 10, 8);
const skin = lambert(0xf1c9a5), steel = lambert(0x59636e);

function textSprite(text) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(16,40,90,.92)';
  roundRect(g, 4, 4, 504, 120, 28); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 68px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
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
  }
  stopGroups.length = 0; stops.length = 0; ROUTE_NODES.length = 0;
  ROUTE_NODES.push(...level.nodes);
  level.stops.forEach(([leg, seg], idx) => {   // [路段, 第幾個街廓]
    const a = ROUTE_NODES[leg], b = ROUTE_NODES[(leg + 1) % ROUTE_NODES.length];
    const d = { x: Math.sign(b[0] - a[0]), z: Math.sign(b[1] - a[1]) }, r = rightOf(d);
    const px = (a[0] + d.x * (seg + 0.5)) * CELL, pz = (a[1] + d.z * (seg + 0.5)) * CELL;
    const s = {
      idx, name: level.names[idx], d, r, heading: Math.atan2(d.x, d.z),
      x: px + r.x * LANE_OUT, z: pz + r.z * LANE_OUT,   // 停靠區中心（外側車道）
      waiting: Math.floor(rand(1, 6)), regen: rand(5, 12), figs: [],
    };
    const grp = new THREE.Group();
    grp.position.set(px + r.x * (HALF + 2.2), 0.2, pz + r.z * (HALF + 2.2));
    grp.rotation.y = s.heading; // 區域 +z = 行駛方向，區域 +x = 朝向車道
    box(grp, lambert(0x2a6fb5), 1.7, 0.15, 4.2, 0, 2.6, 0);
    box(grp, lambert(0x9fc4dd, { transparent: true, opacity: 0.6 }), 0.08, 2.1, 4, -0.75, 1.4, 0);
    box(grp, steel, 0.12, 2.6, 0.12, 0.7, 1.3, 1.95);
    box(grp, steel, 0.12, 2.6, 0.12, 0.7, 1.3, -1.95);
    box(grp, lambert(0x7a5a3a), 0.45, 0.1, 3, -0.4, 0.5, 0);
    box(grp, steel, 0.1, 3, 0.1, 0.6, 1.5, 3.2);
    box(grp, lambert(0x1565c0), 0.12, 0.8, 0.8, 0.6, 2.8, 3.2);
    const label = textSprite(s.name);
    label.position.set(0, 4.2, 0);
    grp.add(label);
    grp.userData.label = label;
    s.zoneMat = basic(0xffd54a, { transparent: true, opacity: 0.25, depthWrite: false });
    box(grp, s.zoneMat, 3, 0.02, 13, HALF + 2.2 - LANE_OUT, -0.17, 0);
    for (let k = 0; k < 6; k++) {
      const f = new THREE.Group();
      const body = new THREE.Mesh(figBody, lambert(pick(FIG_COLORS)));
      body.position.y = 0.58;
      const head = new THREE.Mesh(figHead, skin);
      head.position.y = 1.36;
      f.add(body, head);
      f.position.set(rand(0.1, 0.5), 0, -1.6 + k * 0.65);
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