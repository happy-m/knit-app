// 뜨개한단: 시작점. 주소(#/…)마다 화면을 잇고 앱을 켠다.
import { route, setRoutes } from './core.js';
import { viewHome, viewNew } from './views/home.js';
import { viewProject, viewPartAdd, viewPartEdit } from './views/project.js';
import { viewInfo } from './views/info.js';
import { viewCal, viewTextSetup } from './views/cal.js';
import { viewKnit } from './views/knit/index.js';

setRoutes([
  [/^#\/?$/, viewHome],
  [/^#\/new$/, viewNew],
  [/^#\/p\/([\w-]+)$/, viewProject],
  [/^#\/padd\/([\w-]+)$/, viewPartAdd],
  [/^#\/pedit\/([\w-]+)$/, viewPartEdit],
  [/^#\/info\/([\w-]+)$/, viewInfo],
  [/^#\/cal\/([\w-]+)\/([1-4])(?:\/(\d+))?$/, viewCal],
  [/^#\/txt\/([\w-]+)(?:\/(\d+))?$/, viewTextSetup],
  [/^#\/k\/([\w-]+)$/, viewKnit],
]);
window.addEventListener('hashchange', route);

// ---------- 시작 ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // 새 버전이 설치되면 바로 다시 불러와 새 화면을 보여준다
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
}
navigator.storage?.persist?.().catch(() => {});
// iOS: 화면 전체가 핀치·더블탭으로 확대되지 않게 막는다 (차트는 자체 확대 사용)
for (const t of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
// 시작 화면(아이콘 + 이름)은 화면이 준비되는 동안만 가린다. 일부러 붙잡아 두지 않는다.
// (아이폰은 다시 열 때 마지막 화면을 먼저 보여 주므로, 붙잡아 두면 '메인 → 아이콘 → 메인'으로 깜빡인다)
// 오래 안 쓰다가 켠 경우(index.html에서 판단)에는 아이콘을 1.3초쯤 보여 준 뒤 부드럽게 걷는다
const splashT0 = performance.now();
Promise.resolve(route()).catch(() => {}).finally(() => {
  const el = document.getElementById('splash');
  if (!el) return;
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, Math.max(0, 1300 - (performance.now() - splashT0)));
});
// 마지막으로 쓴 시각을 남겨, 금방 다시 열 때는 시작 화면을 건너뛴다
const markActive = () => { try { localStorage.setItem('knit.lastActive', String(Date.now())); } catch {} };
markActive();
setInterval(() => { if (document.visibilityState === 'visible') markActive(); }, 20000);
document.addEventListener('visibilitychange', markActive);
window.addEventListener('pagehide', markActive);
