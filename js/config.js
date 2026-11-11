// 常數與小工具
export const N = 6;            // 每邊街廓數
export const CELL = 80;        // 路口間距 (m)
export const W = 14;           // 路寬：雙向各兩線
export const HALF = W / 2;
export const WORLD = N * CELL;
export const LANE_IN = 1.75, LANE_OUT = 5.25;
export const WHEELBASE = 6, CAP = 30, LIMIT_KMH = 50;

// 動力系統
export const IDLE = 600, REDLINE = 2400;
export const GEAR_TOP = { 1: 15, 2: 27, 3: 42, 4: 60, 5: 80, 6: 100, R: 12 };       // 2400 rpm 時的時速
export const GEAR_ACC = { 1: 3.0, 2: 2.3, 3: 1.7, 4: 1.25, 5: 0.9, 6: 0.65, R: 2.6 }; // 引擎滿扭力時的加速度
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

function band(v, tol) {
  const l = ((v % CELL) + CELL) % CELL;
  return l <= HALF + tol || l >= CELL - HALF - tol;
}
export function onRoad(x, z, tol = 0) {
  const lo = -HALF - tol, hi = WORLD + HALF + tol;
  if (x < lo || x > hi || z < lo || z > hi) return false;
  return band(x, tol) || band(z, tol);
}
export const $ = (id) => document.getElementById(id);