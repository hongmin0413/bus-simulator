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
  toast(`${text} ${n >= 0 ? '+' : '−'}$${Math.abs(n)}`, n >= 0 ? 'good' : 'bad');
}