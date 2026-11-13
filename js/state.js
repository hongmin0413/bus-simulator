// 各模組共用的狀態
import { IDLE, BODY_MID, BUS_MASS, PAX_MASS, warp, unwarp, warpH, unwarpH } from './config.js';

// 公車位置以後軸中心為準（世界座標）；h 為朝向，前進方向 = (sin h, cos h)
// brakeP: 煞車氣壓（跟著踏板走，但有一點延遲）；wiper / wiperT: 雨刷開關與擺動的進度；
// y / pitch: 後軸所在的地面高度與車身仰角（上坡為正），只有駕訓班的坡道會用到；
// roll: 轉彎時車身往外側傾斜的角度（正值 = 往左倒）；hand: 手煞車；signal: 'L'／'R'／null 方向燈；hazard: 雙黃燈；blink: 閃爍中此刻是否亮
export const bus = { x: 0, z: 0, h: 0, y: 0, pitch: 0, v: 0, steer: 0, steerFrac: 0, doors: false, doorT: 0, jolt: 0, roll: 0, brakeP: 0, wiper: false, wiperT: 0, hand: true, signal: null, hazard: false, blink: false };
// 公車在格子座標上的位置（車身中心）與朝向；車流、行人、停靠、違規判定都用這個。每格由 refreshGrid 更新
export const bg = { x: 0, z: 0, h: 0, fx: 0, fz: 1 };
// clutch: 踏板深度 0(放開)~1(踩到底)；crank: 啟動馬達還要轉幾秒（> 0 表示正在發動）
// tq: 離合器正在傳遞的扭力大小（變速箱有沒有在出力）
// lug: 半離合把引擎轉速拖到怠速以下的程度 0～1（車身會抖）；stalls: 熄火了幾次
export const eng = { gear: 'N', clutch: 0, rpm: IDLE, on: true, thr: 0, crank: 0, tq: 0, lug: 0, stalls: 0 };
// timeMul: 關卡的到站時限倍率；lapDone: 剛跑完一圈（main.js 看到後顯示結算）
export const game = { money: 0, served: 0, next: 0, timeLeft: 0, onboard: [], service: null, timeMul: 1, lapDone: false, bell: false };   // bell: 這一站有人按了下車鈴
export const zone = { inZone: false, along: 0, lat: 0, dist: 0 };
export const input = { gas: 0, brake: 0, clutch: 0, clutchSlow: false, left: false, right: false, drag: null };
export const tilt = { active: false, sign: 1, zero: 0, raw: 0, val: 0, ux: 0, uy: 0, needCal: true };
// level: 目前關卡編號；school: 這一關是不是駕訓班（封閉場地，不載客）；sens: 轉向靈敏度 0 低／1 中／2 高
// orbit: 車外視角繞著公車轉的角度與距離（yaw 0 = 正後方；pitch 越大越俯視）。切換視角時會記住，重新開始或換關卡時回到 ORBIT0
export const ORBIT0 = { yaw: 0, pitch: 0.35, dist: 20 };
export const app = { orbit: { ...ORBIT0, drag: false }, running: false, paused: false, level: 0, school: false, sens: 1, camMode: 0, muted: false, time: 0 };

// 載重係數：空車重 ÷ 目前總重（空車 = 1，載滿約 0.74）。同樣的力，加速度要乘上這個數
export const loadFactor = () => BUS_MASS / (BUS_MASS + game.onboard.length * PAX_MASS);
// 車身中心（世界座標）
export const busCenter = () => ({ x: bus.x + Math.sin(bus.h) * BODY_MID, z: bus.z + Math.cos(bus.h) * BODY_MID });
export function refreshGrid() {
  unwarp(bus.x + Math.sin(bus.h) * BODY_MID, bus.z + Math.cos(bus.h) * BODY_MID, bg);
  bg.h = unwarpH(bg.x, bg.z, bus.h);
  bg.fx = Math.sin(bg.h); bg.fz = Math.cos(bg.h);
}
// 把公車放到格子座標 (x, z)（車身中心）、朝向 h
export function placeBusAt(x, z, h) {
  const w = warp(x, z);
  bus.h = warpH(x, z, h);
  bus.x = w.x - Math.sin(bus.h) * BODY_MID;
  bus.z = w.z - Math.cos(bus.h) * BODY_MID;
  bus.v = 0; bus.steer = 0;
  refreshGrid();
}