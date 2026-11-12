// 儀表、提示文字與小地圖
import { N, CELL, WORLD, ROAD_V, ROAD_H, CAP, LIMIT_KMH, CLUTCH_BITE, SHIFT_UP, SHIFT_DOWN, warp, clamp, $ } from './config.js';
import { stops, ROUTE_NODES, roundRect } from './world.js';
import { cars } from './traffic.js';
import { bus, bg, eng, game, zone, input, busCenter } from './state.js';
import { lampOn } from './signals.js';
import { waitingDepart, signalOn } from './rules.js';

// 只有內容變了才去動畫面元素，省下每一格重排版面的時間
const cache = {};
function text(id, v) { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } }
function cls(id, name, on) { const k = id + '.' + name; if (cache[k] !== on) { cache[k] = on; $(id).classList.toggle(name, on); } }
function style(id, prop, v) { const k = id + ':' + prop; if (cache[k] !== v) { cache[k] = v; $(id).style[prop] = v; } }

// ───────── 指針式儀表（半圓形）─────────
// 時速表 0～100 km/h，超過速限的區段是紅色；轉速表 0～3000 rpm，綠色區是省油的 1000～1700，紅色區是 2400 以上
const TACH_MAX = 3000, SPEED_MAX = 100;
function buildGauge(svgId, needleId, max, minor, major, label, zones) {
  const NS = 'http://www.w3.org/2000/svg', svg = $(svgId), cx = 60, cy = 58, R = 48;
  const pt = (v, r) => { const a = Math.PI * (1 - v / max); return [cx + Math.cos(a) * r, cy - Math.sin(a) * r]; };
  const add = (tag, attrs, txt) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (txt !== undefined) e.textContent = txt;
    svg.insertBefore(e, $(needleId));
  };
  for (const [v0, v1, color] of [[0, max, '#2b3542'], ...zones]) {
    const [x0, y0] = pt(v0, R), [x1, y1] = pt(v1, R);
    add('path', { d: `M${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`, stroke: color, 'stroke-width': 5, fill: 'none' });
  }
  for (let v = 0; v <= max; v += minor) {
    const big = v % major === 0, [x0, y0] = pt(v, R + 2.5), [x1, y1] = pt(v, R - (big ? 8 : 5));
    add('line', { x1: x0.toFixed(1), y1: y0.toFixed(1), x2: x1.toFixed(1), y2: y1.toFixed(1), stroke: '#dfe6ee', 'stroke-width': big ? 1.6 : 0.8 });
    if (big) {
      const [tx, ty] = pt(v, R - 15);
      add('text', { x: tx.toFixed(1), y: (ty + 3).toFixed(1), 'text-anchor': 'middle', 'font-size': 8.5, fill: '#dfe6ee', 'font-weight': 700 }, label(v));
    }
  }
}
buildGauge('speedo', 'speedNeedle', SPEED_MAX, 10, 20, (v) => v, [[LIMIT_KMH, SPEED_MAX, '#d43c3c']]);
buildGauge('tach', 'tachNeedle', TACH_MAX, 250, 500, (v) => v / 100, [[1000, 1700, '#2f9e63'], [2400, TACH_MAX, '#d43c3c']]);

// ───────── 小地圖 ─────────
// 道路、路線、站牌不會變，先畫在另一張畫布上，每次只要貼上去再畫會動的東西
const mapCtx = $('map').getContext('2d'), S = 200, PAD = 14;
const base = document.createElement('canvas');
base.width = base.height = S;
const K = (S - PAD * 2) / (WORLD + 40), tmp = {};
// 格子座標 → 小地圖上的位置（跟著道路的彎度）
function P(x, z) { warp(x, z, tmp); return [PAD + (tmp.x + 20) * K, PAD + (tmp.z + 20) * K]; }
function path(g, pts) { pts.forEach(([x, z], n) => g[n ? 'lineTo' : 'moveTo'](...P(x, z))); }
function line(g, ax, az, bx, bz) {
  const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 25)), pts = [];
  for (let k = 0; k <= n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  path(g, pts);
}
function drawBase() {
  const g = base.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.fillStyle = 'rgba(14,20,30,.78)';
  roundRect(g, 0, 0, S, S, 14); g.fill();
  g.strokeStyle = '#5a6272'; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i <= N; i++) {
    g.lineWidth = Math.max(2, ROAD_V[i].half * 2 * K);
    g.beginPath(); line(g, i * CELL, 0, i * CELL, WORLD); g.stroke();
    g.lineWidth = Math.max(2, ROAD_H[i].half * 2 * K);
    g.beginPath(); line(g, 0, i * CELL, WORLD, i * CELL); g.stroke();
  }
  g.strokeStyle = '#3fa9ff'; g.lineWidth = 3;
  g.beginPath();
  ROUTE_NODES.forEach(([i, j], n) => {
    const [a, b] = ROUTE_NODES[(n + 1) % ROUTE_NODES.length];
    if (n === 0) g.moveTo(...P(i * CELL, j * CELL));
    const m = Math.max(1, Math.round(Math.hypot(a - i, b - j) * 4));
    for (let k = 1; k <= m; k++) g.lineTo(...P((i + (a - i) * k / m) * CELL, (j + (b - j) * k / m) * CELL));
  });
  g.closePath(); g.stroke();
}
function drawMap() {
  const g = mapCtx;
  g.clearRect(0, 0, S, S);
  g.drawImage(base, 0, 0);
  g.fillStyle = '#c9ced6';
  for (const c of cars) { const d = c.kind === 'scooter' ? 2 : 3, [x, z] = P(c.x, c.z); g.fillRect(x - d / 2, z - d / 2, d, d); }
  // 站牌：圓圈裡寫第幾站；第 1 站（起點）是綠色，下一站是黃色
  g.font = 'bold 17px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  stops.forEach((s, n) => {
    const on = n === game.next, [x, z] = P(s.x, s.z);
    g.fillStyle = on ? '#ffd54a' : n === 0 ? '#35d07f' : '#fff';
    g.beginPath(); g.arc(x, z, on ? 13 : 10.5, 0, 7); g.fill();
    g.fillStyle = '#10141c';
    g.fillText(n + 1, x, z + 1);
  });
  const c = busCenter(), fx = Math.sin(bus.h), fz = Math.cos(bus.h), x = PAD + (c.x + 20) * K, z = PAD + (c.z + 20) * K;
  g.fillStyle = '#18e0a0'; g.strokeStyle = '#03241a'; g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x + fx * 11, z + fz * 11);
  g.lineTo(x - fx * 8 - fz * 7.5, z - fz * 8 + fx * 7.5);
  g.lineTo(x - fx * 8 + fz * 7.5, z - fz * 8 - fx * 7.5);
  g.closePath(); g.fill(); g.stroke();
}
// 換關卡後呼叫：重畫小地圖的底圖
export function resetHud() { drawBase(); }

let frameNo = 0;
export function updateHud() {
  const s = stops[game.next], kmh = Math.round(Math.abs(bus.v) * 3.6);
  text('money', '$' + game.money);
  text('pax', `${game.onboard.length}/${CAP}`);
  text('stopNo', `下一站 · 第 ${game.next + 1}/${stops.length} 站${game.next === 0 ? '（起點）' : ''}`);
  text('stopName', s.name);
  text('stopDist', Math.round(zone.dist) + ' m');
  const t = Math.ceil(Math.abs(game.timeLeft)), late = game.timeLeft < 0;
  text('stopTimer', (late ? '誤點 ' : '') + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'));
  cls('stopTimer', 'late', late);
  text('kmh', kmh);
  cls('kmh', 'over', kmh > LIMIT_KMH);
  style('speedNeedle', 'transform', `rotate(${Math.round(clamp(Math.abs(bus.v) * 3.6 / SPEED_MAX, 0, 1) * 180 - 90)}deg)`);
  cls('speedNeedle', 'red', kmh > LIMIT_KMH);
  text('gearTxt', eng.gear);
  cls('gearBox', 'off', !eng.on);
  const num = +eng.gear, coupled = eng.clutch < 0.25 && num;
  text('shiftTip', !coupled ? '' : eng.rpm > SHIFT_UP && num < 6 ? '▲' : eng.rpm < SHIFT_DOWN && num > 1 ? '▼' : '');
  style('tachNeedle', 'transform', `rotate(${Math.round(clamp(eng.rpm / TACH_MAX, 0, 1) * 180 - 90)}deg)`);
  cls('tachNeedle', 'red', eng.rpm > 2400);
  text('rpmTxt', Math.round(eng.rpm / 10) * 10);
  style('clutchFill', 'height', Math.round(eng.clutch * 100) + '%');
  style('gasFill', 'height', Math.round(input.gas * 100) + '%');
  style('brakeFill', 'height', Math.round(input.brake * 100) + '%');
  cls('clutch', 'free', eng.clutch >= CLUTCH_BITE);

  cls('indL', 'on', lampOn('L'));
  cls('indR', 'on', lampOn('R'));
  cls('sigL', 'on', bus.signal === 'L');
  cls('sigR', 'on', bus.signal === 'R');
  cls('hazard', 'on', bus.hazard);
  cls('hazard', 'lit', bus.hazard && bus.blink);
  cls('hand', 'on', bus.hand);
  cls('ign', 'on', eng.on);
  text('ignTxt', eng.on ? '熄火' : eng.crank > 0 ? '發動中' : '發動');
  cls('ign', 'crank', eng.crank > 0);
  cls('wPark', 'on', bus.hand);
  cls('wDoor', 'on', bus.doors);
  cls('wStop', 'on', game.bell);

  const tx = s.x - bg.x, tz = s.z - bg.z;
  style('arrow', 'transform', `rotate(${Math.atan2(-tx * bg.fz + tz * bg.fx, tx * bg.fx + tz * bg.fz).toFixed(2)}rad)`);

  let hint = '';
  const sv = game.service, still = Math.abs(bus.v) < 0.2;
  if (eng.crank > 0) hint = '發動中…按住「發動」，離合器不要放';
  else if (!eng.on) hint = eng.clutch >= CLUTCH_BITE ? '按住儀表旁的「發動」直到引擎點著' : '引擎未發動：左手把離合器踩到底，再按住「發動」';
  else if (bus.doors) hint = sv && !sv.done ? '乘客上下車中…' : '按「車門」關門發車';
  else if (waitingDepart() && !signalOn('L')) hint = '起步前先打左方向燈';
  else if (zone.inZone) hint = still ? '按「車門」開門' : '請在停靠區內停車';
  else if (zone.dist < 45 && zone.along < 0 && !still && !signalOn('R')) hint = '進站前先打右方向燈';
  else if (zone.dist < 12 && still) hint = '請對準黃色停靠區';
  else if (bus.hand && (eng.gear !== 'N' || !still)) hint = '手煞車還拉著：按儀表左邊的「P」放開';
  else if (still && game.served === 0 && game.onboard.length === 0) {
    hint = eng.gear === 'N' ? '左手離合器踩到底 → 右手把排檔桿拖進 1 檔' : eng.clutch > 0.3 ? '慢慢放離合器，同時補一點油門' : '';
  }
  text('hint', hint);
  if (frameNo++ % 4 === 0) drawMap();   // 小地圖不用每一格都重畫
}