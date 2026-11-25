// 공용 창: 숫자판, 페이지 미리보기, 영역 고르기, 도안 보기
import { renderPage, pageSize } from './pdf.js';
import { ChartView } from './chartview.js';
import { esc, icon } from './ui.js';
import { clamp } from './core.js';
import { rectPicker } from './rectpicker.js';

// 단 번호 입력 키패드
export function keypad(R, current) {
  return new Promise((resolve) => {
    let val = '';
    const el = document.createElement('div');
    el.className = 'scrim sheet-scrim';
    el.innerHTML = `<div class="sheet keypad" role="dialog" aria-modal="true">
      <div class="kp-head"><b>몇 단으로 갈까요?</b><span class="muted small">${R.hi >= 9999 ? `${R.lo}단 이상` : `${R.lo}~${R.hi}단`}</span></div>
      <div class="kp-row"><div class="kp-disp"><span class="num" id="kv"></span><span>단</span></div><button type="button" class="btn primary" id="kgo">이동</button></div>
      <div class="kp-note muted small" id="kn"></div>
      <div class="kp-grid">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '취소', '0', '지움']
        .map((k) => `<button type="button" class="kp-key${/\d/.test(k) ? ' num' : ' fn'}" data-k="${k}">${k}</button>`).join('')}</div></div>`;
    const kv = el.querySelector('#kv');
    const kn = el.querySelector('#kn');
    const kgo = el.querySelector('#kgo');
    const upd = () => {
      kv.textContent = val || '';
      const n = parseInt(val, 10);
      const ok = Number.isFinite(n) && n >= R.lo && n <= R.hi;
      kgo.disabled = !ok;
      kn.textContent = !val ? `지금 ${current}단` : ok ? `이동하면 ${n - 1 >= R.lo ? `${n - 1}단까지 뜬 것으로` : '처음부터 시작으로'} 표시됩니다` : `${R.lo}~${R.hi} 사이로 적어주세요`;
    };
    const done = (v) => { el.remove(); resolve(v); };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (b) {
        const k = b.dataset.k;
        if (k === '취소') return done(null);
        if (k === '지움') val = val.slice(0, -1);
        else if (val.length < 4) val += k;
        upd();
      } else if (e.target === el) done(null);
    });
    kgo.addEventListener('click', () => done(parseInt(val, 10)));
    document.getElementById('layer').appendChild(el);
    upd();
  });
}

// 한 페이지를 크게 보기 (두 손가락이나 +/−로 확대). 고르면 true
export function previewPage(doc, pageNum, pickLabel) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'docv';
    el.innerHTML = `<div class="docv-top"><b>${pageNum}쪽</b><span class="k-spacer"></span>
      <button type="button" class="icon-btn" data-x aria-label="닫기">${icon.close}</button></div>
      <div class="pv-full" id="pvfull"></div>
      <div class="footer"><button type="button" class="btn" data-x>닫기</button><button type="button" class="btn primary" data-pick>${esc(pickLabel)}</button></div>`;
    document.getElementById('layer').appendChild(el);
    const cv = new ChartView(el.querySelector('#pvfull'), { doc, pageNum, area: { x: 0, y: 0, w: 1, h: 1 }, maxZoom: 8 });
    cv.init().catch(() => {});
    const done = (v) => { cv.destroy(); el.remove(); resolve(v); };
    el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => done(false)));
    el.querySelector('[data-pick]').addEventListener('click', () => done(true));
  });
}

// 페이지에서 사각형 영역 하나를 고른다. 페이지는 ‹ › 로 넘길 수 있다. 고르면 {page, area}
export function pickRegion(doc, { title, page, area }) {
  return new Promise((resolve) => {
    let pg = page;
    const el = document.createElement('div');
    el.className = 'docv';
    el.innerHTML = `<div class="docv-top"><b>${esc(title)}</b><span class="k-spacer"></span>
        <button type="button" class="icon-btn" data-x aria-label="닫기">${icon.close}</button></div>
      <div class="pg-step"><button type="button" class="btn" data-d="-1" aria-label="이전 페이지">‹</button><b id="pgno"></b><button type="button" class="btn" data-d="1" aria-label="다음 페이지">›</button></div>
      <p class="hint pad">기호 설명 부분을 손가락으로 끌어서 감싸주세요. 모서리를 끌면 크기를 바꿉니다.</p>
      <div class="pv-box" id="rpv"></div>
      <div class="footer"><button type="button" class="btn" data-x>취소</button><button type="button" class="btn primary" data-ok>저장</button></div>`;
    document.getElementById('layer').appendChild(el);
    const picker = rectPicker(el.querySelector('#rpv'), doc, { page: pg, area: area || { x: 0.1, y: 0.1, w: 0.8, h: 0.4 } });
    const show = async () => {
      el.querySelector('#pgno').textContent = `${pg}쪽 / ${doc.numPages}`;
      await picker.setPage(pg);
    };
    el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
      const n = clamp(pg + +b.dataset.d, 1, doc.numPages);
      if (n !== pg) { pg = n; show(); }
    }));
    const done = (v) => { picker.destroy(); el.remove(); resolve(v); };
    el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => done(null)));
    el.querySelector('[data-ok]').addEventListener('click', () => done({ page: pg, area: picker.area() }));
    requestAnimationFrame(show);
  });
}

// 도안 전체 보기
export async function openDoc(doc) {
  const el = document.createElement('div');
  el.className = 'docv';
  el.innerHTML = `<div class="docv-top"><b>도안</b><span class="k-spacer"></span>
    <button type="button" class="btn" data-z="-1" aria-label="축소">−</button><button type="button" class="btn" data-z="1" aria-label="확대">+</button>
    <button type="button" class="icon-btn" data-x aria-label="닫기">${icon.close}</button></div><div class="docv-pages"></div>`;
  document.getElementById('layer').appendChild(el);
  const box = el.querySelector('.docv-pages');
  const sizes = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => pageSize(doc, i + 1)));
  const zooms = [1, 1.6, 2.4, 3.5];
  let zi = 0;
  let io = null;
  const build = () => {
    io?.disconnect();
    const cw = (box.clientWidth - 24) * zooms[zi];
    box.innerHTML = sizes.map((s, i) =>
      `<div class="docv-page" data-p="${i + 1}" style="width:${cw}px;height:${(cw * s.h) / s.w}px"><canvas></canvas><span class="docv-no">${i + 1}쪽</span></div>`).join('');
    io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (!e.isIntersecting || e.target.dataset.r) continue;
        e.target.dataset.r = '1';
        renderPage(doc, +e.target.dataset.p, e.target.querySelector('canvas'), cw).catch(() => {});
      }
    }, { root: box, rootMargin: '800px' });
    box.querySelectorAll('.docv-page').forEach((x) => io.observe(x));
  };
  build();
  el.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => {
    const frac = box.scrollTop / Math.max(1, box.scrollHeight);
    zi = clamp(zi + +b.dataset.z, 0, zooms.length - 1);
    build();
    box.scrollTop = frac * box.scrollHeight;
  }));
  el.querySelector('[data-x]').addEventListener('click', () => { io?.disconnect(); el.remove(); });
}
