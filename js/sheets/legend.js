// 기호 설명(범례)
import * as db from '../db.js';
import { StackView } from '../widgets/stackview.js';
import { icon, dialog, sheet } from '../ui.js';
import { app, onCleanup } from '../core.js';
import { pickRegion } from './dialogs.js';

// 기호 설명이 있을 법한 페이지: 뜨개 약어·기호 이름이 가장 많이 나오는 페이지
export async function guessLegendPage(doc) {
  const re = /기호|약어|범례|겉뜨기|안뜨기|걸러뜨기|K2tog|SSK|SSP|P2tog|M1[LR]?|yo\b|symbol|legend/gi;
  let best = 1, bestN = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const tc = await (await doc.getPage(n)).getTextContent();
      const c = (tc.items.map((it) => it.str).join(' ').match(re) || []).length;
      if (c > bestN) { bestN = c; best = n; }
    } catch {}
  }
  return best;
}

// 작품의 기호 설명 영역들 (여러 페이지·여러 군데 가능). 예전 proj.legend 하나짜리도 읽는다
export function legendsOf(proj) {
  if (!Array.isArray(proj.legends)) proj.legends = proj.legend ? [proj.legend] : [];
  delete proj.legend;
  return proj.legends;
}

export const legendPages = (proj) => [...new Set(legendsOf(proj).map((l) => l.page))].join('·');

export async function saveLegends(proj) {
  proj.updated = Date.now();
  await db.put('projects', proj);
}

// 영역 하나 추가 (i가 있으면 그 영역 다시 잡기). 저장했으면 true
export async function pickLegend(proj, doc, i) {
  const L = legendsOf(proj);
  const old = i !== undefined ? L[i] : null;
  const last = L[L.length - 1];
  const r = await pickRegion(doc, {
    title: old ? `기호 설명 ${i + 1} 다시 잡기` : `기호 설명 영역 ${L.length + 1}`,
    page: old?.page || (last ? Math.min(last.page + 1, doc.numPages) : await guessLegendPage(doc)),
    area: old?.area,
  });
  if (!r) return false;
  if (old) L[i] = r; else L.push(r);
  await saveLegends(proj);
  return true;
}

// 처음 등록: 영역을 잡고, 다른 페이지에도 있으면 이어서 더 잡는다
export async function setupLegend(proj, doc) {
  if (!(await pickLegend(proj, doc))) return false;
  for (;;) {
    const more = await dialog({
      title: '기호 설명이 더 있나요?',
      body: `지금까지 ${legendsOf(proj).length}군데 (${legendPages(proj)}쪽). 다른 페이지나 같은 페이지 다른 곳에도 기호 설명이 있으면 더 잡을 수 있어요.`,
      buttons: [{ label: '다 됐어요', value: false }, { label: '더 잡기', value: true, primary: true }],
    });
    if (!more || !(await pickLegend(proj, doc))) return true;
  }
}

// 기호 설명 영역 고치기 (추가·다시 잡기·빼기)
export async function manageLegends(proj, doc) {
  const L = legendsOf(proj);
  const v = await sheet('기호 설명 영역', [
    { label: '+ 영역 추가', value: 'add' },
    ...L.flatMap((l, i) => [
      { label: `${i + 1}. ${l.page}쪽 다시 잡기`, value: `re:${i}` },
      { label: `${i + 1}. ${l.page}쪽 빼기`, value: `rm:${i}`, danger: true },
    ]),
  ]);
  if (!v) return false;
  if (v === 'add') return pickLegend(proj, doc);
  const [k, n] = v.split(':');
  if (k === 're') return pickLegend(proj, doc, +n);
  L.splice(+n, 1);
  await saveLegends(proj);
  return true;
}

// 뜨기 화면 위에 기호 설명을 띄우거나 닫는다 (여러 영역은 위아래로 이어 붙여 보여 준다)
export let legendCv = null;

export async function toggleLegend(proj, doc) {
  const open = document.querySelector('.legend-pop');
  if (open) { closeLegend(); return; }
  if (!legendsOf(proj).length && !(await setupLegend(proj, doc))) return;
  if (!legendsOf(proj).length) return;
  const el = document.createElement('div');
  el.className = 'legend-pop';
  el.innerHTML = `<div class="lp-top"><b>기호 설명 · ${legendPages(proj)}쪽</b><span class="k-spacer"></span>
      <button type="button" class="link-btn" data-re>영역 고치기</button>
      <button type="button" class="icon-btn" data-x aria-label="닫기">${icon.close}</button></div>
    <div class="lp-view"></div>`;
  app.querySelector('.k-main').appendChild(el);
  legendCv = new StackView(el.querySelector('.lp-view'), { doc, pieces: legendsOf(proj), maxZoom: 6 });
  await legendCv.init();
  el.querySelector('[data-x]').addEventListener('click', closeLegend);
  el.querySelector('[data-re]').addEventListener('click', async () => {
    closeLegend();
    await manageLegends(proj, doc);
    if (legendsOf(proj).length) toggleLegend(proj, doc);
  });
  onCleanup(closeLegend);
}

export function closeLegend() {
  legendCv?.destroy();
  legendCv = null;
  document.querySelector('.legend-pop')?.remove();
}
