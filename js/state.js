// 各模組共用的狀態
import { IDLE } from './config.js';

// 公車位置以後軸中心為準；h 為朝向，前進方向 = (sin h, cos h)
// hand: 手煞車；signal: 'L'／'R'／null 方向燈；hazard: 雙黃燈；blink: 閃爍中此刻是否亮
export const bus = { x: 0, z: 0, h: 0, v: 0, steer: 0, steerFrac: 0, doors: false, doorT: 0, jolt: 0, hand: true, signal: null, hazard: false, blink: false };
// clutch: 踏板深度 0(放開)~1(踩到底)
export const eng = { gear: 'N', clutch: 0, rpm: IDLE, on: true, thr: 0 };
// timeMul: 關卡的到站時限倍率；lapDone: 剛跑完一圈（main.js 看到後顯示結算）；lapStart: 這一圈開始時的金額
export const game = { money: 0, served: 0, laps: 0, next: 0, timeLeft: 0, onboard: [], service: null, timeMul: 1, lapDone: false, lapStart: 0 };
export const zone = { inZone: false, along: 0, lat: 0, dist: 0 };
export const input = { gas: 0, brake: 0, clutch: 0, clutchSlow: false, left: false, right: false, drag: null };
export const tilt = { active: false, sign: 1, zero: 0, raw: 0, val: 0, ux: 0, uy: 0, needCal: true };
// level: 目前關卡編號；sens: 轉向靈敏度 0 低／1 中／2 高
// orbit: 車外視角繞著公車轉的角度（yaw 0 = 正後方；pitch 越大越俯視）
export const ORBIT0 = { yaw: 0, pitch: 0.35 };
export const app = { orbit: { ...ORBIT0, drag: false }, running: false, paused: false, level: 0, sens: 1, camMode: 0, muted: false, time: 0 };

export const busCenter = () => ({ x: bus.x + Math.sin(bus.h) * 3, z: bus.z + Math.cos(bus.h) * 3 });
export function placeBusAt(x, z, h) {
  bus.h = h;
  bus.x = x - Math.sin(h) * 3;
  bus.z = z - Math.cos(h) * 3;
  bus.v = 0; bus.steer = 0;
}