// 뜨기 화면: 원형·타원형 차트 (고리 하나가 한 단)
import { pageSize } from '../../pdf.js';
import { ChartView } from '../../widgets/chartview.js';
import { esc, toast } from '../../ui.js';
import { calibrated, segsOf } from '../../model/knitting.js';
import { startProgress, repsOf } from '../../model/progress.js';
import { ringGeom, ringOnView, stadium } from '../../model/circ.js';
import { app, onCleanup } from '../../core.js';
import { partHref } from '../../partnav.js';
import { memosOf } from '../../sheets/memo.js';
import { rowPick } from '../../sheets/reps.js';
import { knitShell, loadKnit, knitControls } from './shell.js';

export async function viewCircKnit(part) {
  const id = part.id;
  if (!calibrated(part)) return location.replace(partHref(part));
  const ctx = await loadKnit(part);
  const { doc } = ctx;
  const sg = segsOf(part)[0];
  const ring = sg.ring;
  const sz = await pageSize(doc, sg.page);
  if (!part.progress) part.progress = startProgress(part);
  const p = () => part.progress;
  const R = { lo: 1, hi: ring.n };

  app.innerHTML = knitShell(ctx, part);

  // 다 뜬 단(안쪽)은 흐리게, 지금 단은 안팎 고리 사이를 옅게 칠하고 테두리에 노란 선
  const decorate = (v) => {
    const pr = p();
    const [w, ht] = v.size();
    const g = ringOnView(ring, v, sz.w, sz.h);
    const cur = pr.done ? ring.n + 1 : pr.row;
    const inner = stadium(g.Apx, g.Bpx, g.rpx(cur - 1));
    let paths = '';
    if (cur > 1) paths += `<path d="${inner}" class="rg-done"/>`;
    if (!pr.done) {
      const outer = stadium(g.Apx, g.Bpx, g.rpx(cur));
      paths += `<path d="${outer} ${inner}" class="rg-now" fill-rule="evenodd"/>`;
      paths += `<path d="${outer}" class="rg-line"/>`;
      if (inner) paths += `<path d="${inner}" class="rg-line"/>`;
    }
    // 구간 반복: 안팎 테두리를 점선으로
    for (const rg of repsOf(part).ranges) {
      if (rg.from > ring.n) continue;
      const out = g.rpx(Math.min(rg.to, ring.n));
      const inn = stadium(g.Apx, g.Bpx, g.rpx(rg.from - 1));
      paths += `<path d="${stadium(g.Apx, g.Bpx, out)}" class="rg-rep"/>`;
      if (inn) paths += `<path d="${inn}" class="rg-rep"/>`;
    }
    for (const m of memosOf(part)) {
      if (m.row < 1 || m.row > ring.n) continue;
      const [x, y] = [g.Bpx[0] + g.rpx(m.row - 0.5), g.Bpx[1]];
      paths += `<g class="rg-memo"><circle cx="${x}" cy="${y}" r="10"/><text x="${x}" y="${y + 4}" text-anchor="middle">✎</text></g>`;
    }
    return `<svg class="ring-ov" width="${w}" height="${ht}">${paths}</svg>` + ctl.pins.html(0, v.n2p.bind(v));
  };

  // 지금 단의 고리가 보이도록 (오른쪽 끝 기준)
  const follow = () => {
    const pr = p();
    const [x, y] = ringGeom(ring, sz.w, sz.h).midPoint(pr.done ? ring.n : pr.row);
    cv.scrollTo(x, y, { x: 'center', yFrac: 0.5, smooth: true });
  };
  const ctl = knitControls({
    ctx, part, range: R, total: () => ring.n, finished: '마지막 단까지 떴습니다.',
    lines: (pr) => `<span class="bar"><i style="width:${Math.min(100, ((pr.done ? ring.n : pr.row - 1) / ring.n) * 100)}%"></i></span>
      <span class="rc-line small muted">${pr.done ? `${esc(part.name)} 완료` : pr.row > 1 ? `${pr.row - 1}단까지 떴습니다` : '첫 단을 뜨는 중'}</span>`,
    redraw: (how) => { cv.redraw(); if (how) follow(); },
  });

  const key = `knit.circScale.${id}`;
  let saved = 0;
  try { saved = +localStorage.getItem(key) || 0; } catch {}
  const cv = new ChartView(app.querySelector('#chart'), {
    doc, pageNum: sg.page, area: sg.area, decorate,
    onScale: (sc) => { try { localStorage.setItem(key, String(sc)); } catch {} },
    onTap: (nx, ny) => {
      if (rowPick.armed()) return rowPick.tap(ringGeom(ring, sz.w, sz.h).roundAt(nx, ny));
      if (ctl.pins.armed()) return ctl.pins.place({ seg: 0, x: nx, y: ny, label: `${ringGeom(ring, sz.w, sz.h).roundAt(nx, ny)}단` });
      toast('다른 단으로 가려면 그 단을 <b>길게</b> 누르세요');
    },
    onLong: async (nx, ny) => {
      if (rowPick.armed()) return;
      const r = ringGeom(ring, sz.w, sz.h).roundAt(nx, ny);
      if (r === p().row && !p().done) return;
      await ctl.jump(r);
    },
  });
  window.__cv = cv;
  onCleanup(() => { cv.destroy(); if (window.__cv === cv) window.__cv = null; });
  await cv.init(saved || undefined);
  ctl.refresh(false);
}

