// 到站服務：開關門、乘客上下車、車資與下一站
import { CAP, rand, warp } from './config.js';
import { stops, updateFigs, beam } from './world.js';
import { resetRules, checkArrive, startDepart } from './rules.js';
import { bus, bg, game, zone, app, placeBusAt } from './state.js';
import { setGear } from './engine.js';
import { toast, addMoney } from './ui.js';
import { sfx } from './audio.js';

export function setNextStop(i) {
  game.next = i;
  game.bell = false;
  const s = stops[i], w = warp(s.x, s.z);
  game.timeLeft = ((Math.abs(s.x - bg.x) + Math.abs(s.z - bg.z)) / 6 + 25) * game.timeMul;
  stops.forEach((o) => (o.zoneMat.opacity = o === s ? 0.5 : 0.15));
  beam.position.set(w.x, 25, w.z);
}

export function resetBus() {
  if (bus.doors) return;
  const s = stops[(game.next + stops.length - 1) % stops.length];
  placeBusAt(s.x, s.z, s.heading);
  setGear('N');
  bus.hand = true;
  resetRules();
  toast('已回到 ' + s.name);
}

export function toggleDoors() {
  if (!app.running || app.paused) return;
  if (!bus.doors) {
    if (Math.abs(bus.v) > 0.2) { toast('請先完全停車'); return; }
    bus.doors = true;
    sfx.doorOpen();
    if (zone.inZone) {
      checkArrive();
      const s = stops[game.next];
      const alight = game.onboard.filter((d) => d === game.next).length;
      game.service = {
        stop: game.next, alight, fare: 0, t: 0.7, done: false,
        board: Math.min(s.waiting, CAP - (game.onboard.length - alight)),
        perfect: Math.abs(zone.along) < 1.5 && Math.abs(zone.lat) < 0.8,
        onTime: game.timeLeft > 0,
      };
    }
  } else {
    if (game.service && !game.service.done) { toast('乘客上下車中…'); return; }
    bus.doors = false;
    sfx.doorClose();
    if (game.service) {
      game.service = null;
      startDepart();
      const n = (game.next + 1) % stops.length;
      if (n === 0) { addMoney(100, '完成一圈'); game.lapDone = true; }
      setNextStop(n);
    }
  }
}

export function updateService(dt) {
  if (!game.service) game.timeLeft -= dt;
  // 下車鈴：快到站時（150 公尺內），車上有人要在這一站下車就會按鈴
  if (!game.bell && !bus.doors && zone.dist > 20 && zone.dist < 150 && game.onboard.includes(game.next)) { game.bell = true; sfx.bell(); }
  // 各站陸續有新乘客來候車
  for (const s of stops) {
    if (s.waiting >= s.max || (game.service && game.service.stop === s.idx)) continue;
    s.regen -= dt;
    if (s.regen <= 0) { s.waiting++; s.regen = rand(5, 11) / s.crowd; updateFigs(s); }
  }

  const sv = game.service;
  if (!sv || sv.done || bus.doorT < 1) return;
  sv.t -= dt;
  if (sv.t > 0) return;
  sv.t = 0.3;
  const s = stops[sv.stop];
  if (sv.alight > 0) {
    game.onboard.splice(game.onboard.indexOf(sv.stop), 1);
    sv.alight--; game.served++;
  } else if (sv.board > 0) {
    s.waiting--; updateFigs(s);
    game.onboard.push((sv.stop + 1 + Math.floor(Math.random() * (stops.length - 1))) % stops.length);
    sv.board--; sv.fare += 15; game.money += 15;
  } else {
    sv.done = true;
    if (sv.fare) toast(`車資收入 +$${sv.fare}`, 'good');
    if (sv.perfect) addMoney(20, '完美停靠');
    if (sv.onTime) addMoney(30, '準點到站');
  }
}