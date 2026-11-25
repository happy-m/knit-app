// 공통: 화면 뿌리, 이동, 라우터, 머리줄
import { esc, icon, clearLayer } from './ui.js';

export const app = document.getElementById('app');

export const go = (h) => { location.hash = h; };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export let cleanups = [];

export const onCleanup = (fn) => cleanups.push(fn);

let routes = [];
export const setRoutes = (r) => { routes = r; };

export async function route() {
  cleanups.forEach((f) => { try { f(); } catch {} });
  cleanups = [];
  clearLayer();
  const h = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      try {
        await fn(...m.slice(1));
      } catch (e) {
        console.error(e);
        app.innerHTML = `<div class="wrap"><div class="card"><b>화면을 열지 못했습니다.</b><p class="hint">${esc(e.message || e)}</p><a class="btn" href="#/">처음으로</a></div></div>`;
      }
      return;
    }
  }
  go('#/');
}
window.addEventListener('hashchange', route);

export function header(back, title, sub = '', right = '') {
  return `<div class="head">
    <a class="icon-btn" href="${back}" aria-label="뒤로">${icon.back}</a>
    <div class="head-t"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</div>`;
}
