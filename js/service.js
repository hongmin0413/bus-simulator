// 到站服務：開關門、乘客上下車、車資與下一站
import { CAP, rand } from './config.js';
import { stops, updateFigs, beam } from './world.js';
import { bus, game, zone, app, busCenter, placeBusAt } from './state.js';
import { setGear } from './engine.js';
import { toast, addMoney } from './ui.js';
import { sfx } from './audio.js';

export function setNextStop(i) {
  game.next = i;
  const s = stops[i], c = busCenter();
  game.timeLeft = ((Math.abs(s.x - c.x) + Math.abs(s.z - c.z)) / 6 + 25) * game.timeMul;
  stops.forEach((o) => (o.zoneMat.opacity = o === s ? 0.5 : 0.15));
  beam.position.set(s.x, 25, s.z);
}

export function resetBus() {
  if (bus.doors) return;
  const s = stops[(game.next + stops.length - 1) % stops.length];
  placeBusAt(s.x, s.z, s.heading);
  setGear('N');
  bus.hand = true;
  toast('已回到 ' + s.name);
}

export function toggleDoors() {
  if (!app.running || app.paused) return;
  if (!bus.doors) {
    if (Math.abs(bus.v) > 0.2) { toast('請先完全停車'); return; }
    bus.doors = true;
    sfx.doorOpen();
    if (zone.inZone) {
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
      const n = (game.next + 1) % stops.length;
      if (n === 0) { game.laps++; addMoney(100, '完成一圈'); game.lapDone = true; }
      setNextStop(n);
    }
  }
}

export function updateService(dt) {
  if (!game.service) game.timeLeft -= dt;
  // 各站陸續有新乘客來候車
  for (const s of stops) {
    if (s.waiting >= 6 || (game.service && game.service.stop === s.idx)) continue;
    s.regen -= dt;
    if (s.regen <= 0) { s.waiting++; s.regen = rand(7, 16); updateFigs(s); }
  }

  const sv = game.service;
  if (!sv || sv.done || bus.doorT < 1) return;
  sv.t -= dt;
  if (sv.t > 0) return;
  sv.t = 0.38;
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