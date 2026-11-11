// 儀表、提示文字與小地圖
import { N, CELL, W, WORLD, CAP, LIMIT_KMH, CLUTCH_BITE, SHIFT_UP, SHIFT_DOWN, clamp, $ } from './config.js';
import { stops, ROUTE_NODES, roundRect } from './world.js';
import { cars } from './traffic.js';
import { bus, eng, game, zone, input, busCenter } from './state.js';
import { lampOn } from './signals.js';

const mapCtx = $('map').getContext('2d');
function drawMap() {
  const S = 200, pad = 12, k = (S - pad * 2) / WORLD, g = mapCtx, P = (v) => pad + v * k;
  g.clearRect(0, 0, S, S);
  g.fillStyle = 'rgba(14,20,30,.78)';
  roundRect(g, 0, 0, S, S, 14); g.fill();
  g.strokeStyle = '#5a6272'; g.lineWidth = Math.max(3, W * k); g.lineCap = 'square';
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    g.moveTo(P(i * CELL), P(0)); g.lineTo(P(i * CELL), P(WORLD));
    g.moveTo(P(0), P(i * CELL)); g.lineTo(P(WORLD), P(i * CELL));
  }
  g.stroke();
  g.strokeStyle = '#3fa9ff'; g.lineWidth = 3; g.lineJoin = 'round';
  g.beginPath();
  ROUTE_NODES.forEach(([i, j], n) => g[n ? 'lineTo' : 'moveTo'](P(i * CELL), P(j * CELL)));
  g.closePath(); g.stroke();
  g.fillStyle = '#c9ced6';
  for (const c of cars) { const d = c.kind === 'scooter' ? 2 : 3; g.fillRect(P(c.x) - d / 2, P(c.z) - d / 2, d, d); }
  stops.forEach((s, n) => {
    const on = n === game.next;
    g.fillStyle = on ? '#ffd54a' : '#fff';
    g.beginPath(); g.arc(P(s.x), P(s.z), on ? 7 : 4, 0, 7); g.fill();
  });
  const c = busCenter(), fx = Math.sin(bus.h), fz = Math.cos(bus.h), x = P(c.x), z = P(c.z);
  g.fillStyle = '#18e0a0'; g.strokeStyle = '#03241a'; g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x + fx * 11, z + fz * 11);
  g.lineTo(x - fx * 8 - fz * 7.5, z - fz * 8 + fx * 7.5);
  g.lineTo(x - fx * 8 + fz * 7.5, z - fz * 8 - fx * 7.5);
  g.closePath(); g.fill(); g.stroke();
}

export function updateHud() {
  const s = stops[game.next], kmh = Math.round(Math.abs(bus.v) * 3.6);
  $('money').textContent = '$' + game.money;
  $('pax').textContent = `${game.onboard.length}/${CAP}`;
  $('stopName').textContent = s.name;
  $('stopDist').textContent = Math.round(zone.dist) + ' m';
  const t = Math.ceil(Math.abs(game.timeLeft)), late = game.timeLeft < 0;
  $('stopTimer').textContent = (late ? '誤點 ' : '') + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  $('stopTimer').classList.toggle('late', late);
  $('kmh').textContent = kmh;
  $('kmh').classList.toggle('over', kmh > LIMIT_KMH);
  $('gearTxt').textContent = eng.gear;
  $('gearBox').classList.toggle('off', !eng.on);
  const num = +eng.gear, coupled = eng.clutch < 0.25 && num;
  $('shiftTip').textContent = !coupled ? '' : eng.rpm > SHIFT_UP && num < 6 ? '▲' : eng.rpm < SHIFT_DOWN && num > 1 ? '▼' : '';
  $('tachBar').style.width = clamp(eng.rpm / 2700, 0, 1) * 100 + '%';
  $('tachBar').classList.toggle('red', eng.rpm > 2100);
  $('rpmTxt').textContent = Math.round(eng.rpm / 10) * 10 + ' rpm';
  $('clutchFill').style.height = eng.clutch * 100 + '%';
  $('gasFill').style.height = input.gas * 100 + '%';
  $('brakeFill').style.height = input.brake * 100 + '%';
  $('clutch').classList.toggle('free', eng.clutch >= CLUTCH_BITE);

  const litL = lampOn('L'), litR = lampOn('R');
  $('indL').classList.toggle('on', litL);
  $('indR').classList.toggle('on', litR);
  $('sigL').classList.toggle('on', bus.signal === 'L');
  $('sigR').classList.toggle('on', bus.signal === 'R');
  $('hazard').classList.toggle('on', bus.hazard);
  $('hazard').classList.toggle('lit', bus.hazard && bus.blink);
  $('indP').classList.toggle('on', bus.hand);
  $('hand').classList.toggle('on', bus.hand);

  const c = busCenter(), tx = s.x - c.x, tz = s.z - c.z, fx = Math.sin(bus.h), fz = Math.cos(bus.h);
  $('arrow').style.transform = `rotate(${Math.atan2(-tx * fz + tz * fx, tx * fx + tz * fz)}rad)`;

  let hint = '';
  const sv = game.service, still = Math.abs(bus.v) < 0.2;
  if (!eng.on) hint = '引擎熄火：離合器踩到底重新發動';
  else if (bus.doors) hint = sv && !sv.done ? '乘客上下車中…' : '按「車門」關門發車';
  else if (zone.inZone) hint = still ? '按「車門」開門' : '請在停靠區內停車';
  else if (zone.dist < 12 && still) hint = '請對準黃色停靠區';
  else if (bus.hand && (eng.gear !== 'N' || !still)) hint = '手煞車還拉著：按右下「P」放開';
  else if (still && game.served === 0 && game.onboard.length === 0) {
    hint = eng.gear === 'N' ? '左手離合器踩到底 → 右手把排檔桿拖進 1 檔' : eng.clutch > 0.3 ? '慢慢放離合器，同時補一點油門' : '';
  }
  $('hint').textContent = hint;
  drawMap();
}