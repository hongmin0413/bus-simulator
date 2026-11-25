// 提示訊息與金額
import { $ } from './config.js';
import { game } from './state.js';

export function toast(text, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = text;
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), 2800);
}
export function addMoney(n, text) {
  game.money += n;
  const s = game.stats;
  if (n < 0) {
    const key = text.endsWith('，乘客站不穩') ? '行車不平順' : text;
    const item = s.penalties[key] || (s.penalties[key] = { count: 0, amount: 0 });
    item.count++;
    item.amount += -n;
    s.penaltyTotal += -n;
  } else if (text === '完美停靠') s.perfect++;
  else if (text === '準點到站') s.onTime++;
  else if (text === '完成一圈') s.lapBonus += n;
  toast(`${text} ${n >= 0 ? '+' : '−'}$${Math.abs(n)}`, n >= 0 ? 'good' : 'bad');
}