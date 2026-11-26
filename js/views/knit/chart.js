// 뜨기 화면: 기호 차트 (격자의 한 줄이 한 단)
import { pageSize } from '../../pdf.js';
import { ChartView } from '../../widgets/chartview.js';
import { esc, icon, toast } from '../../ui.js';
import { calibrated, rowsOf, colsOf, segsOf, segPart, segForRow } from '../../model/knitting.js';
import { startProgress, isRightSide, repsOf } from '../../model/progress.js';
import { app, clamp, onCleanup } from '../../core.js';
import { memosOf } from '../../sheets/memo.js';
import { rowPick } from '../../sheets/reps.js';
import { knitShell, loadKnit, knitControls } from './shell.js';

export async function viewChartKnit(part) {
  const id = part.id;
  if (!calibrated(part)) return location.replace(`#/cal/${id}/1`);
  const ctx = await loadKnit(part);
  const { doc } = ctx;
  if (!part.progress) part.progress = startProgress(part);
  const p = () => part.progress;
  const segs = segsOf(part);
  const RR = rowsOf(part); // 파트 전체 단 범위
  // 지금 화면에 띄운 구간과 그 구간의 격자
  let seg = segForRow(part, part.progress.row);
  let R, C, cv;
  app.innerHTML = knitShell(ctx, part, { top: `<span class="dir-chip" id="dir"></span>`, beforeChart: `${segs.length > 1 ? '<div class="seg-chips k-segs" id="segs"></div>' : ''}` });

  const decorate = (v) => {
    const [w] = v.size();
    const pr = p();
    const edge = (r) => [R.at(r) - R.pitchAt(r) / 2, R.at(r) + R.pitchAt(r) / 2];
    let h = '';
    const lastDone = Math.min(pr.done ? RR.hi : pr.row - 1, R.hi);
    if (lastDone >= R.lo) {
      const [a1, a2] = edge(R.lo);
      const [b1, b2] = edge(lastDone);
      const y1 = v.n2p(0, Math.min(a1, b1))[1];
      const y2 = v.n2p(0, Math.max(a2, b2))[1];
      h += `<i class="shade" style="left:0;top:${y1}px;width:${w}px;height:${y2 - y1}px"></i>`;
    }
    if (!pr.done && pr.row >= R.lo && pr.row <= R.hi) {
      const [e1, e2] = edge(pr.row);
      const y1 = v.n2p(0, Math.min(e1, e2))[1];
      const y2 = v.n2p(0, Math.max(e1, e2))[1];
      h += `<i class="band" style="left:0;top:${y1}px;width:${w}px;height:${y2 - y1}px"></i>`;
      if (pr.mark !== null && pr.mark !== undefined) {
        const cx = C.at(pr.mark);
        const x1 = v.n2p(cx - C.pitchAt(pr.mark) / 2, 0)[0];
        const x2 = v.n2p(cx + C.pitchAt(pr.mark) / 2, 0)[0];
        h += `<i class="mark" style="left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px"></i>`;
        h += `<span class="mark-tag" style="left:${(x1 + x2) / 2}px;top:${y1}px">${pr.mark}번 칸</span>`;
      }
    }
    // 구간 반복: 왼쪽 가장자리에 꺾쇠만 (횟수는 단 카드에 나온다)
    for (const rg of repsOf(part).ranges) {
      const a = Math.max(rg.from, R.lo);
      const b = Math.min(rg.to, R.hi);
      if (a > b) continue;
      const ys = [...edge(a), ...edge(b)].map((n) => v.n2p(0, n)[1]);
      const y1 = Math.min(...ys);
      const y2 = Math.max(...ys);
      h += `<i class="rep-br" style="top:${y1}px;height:${y2 - y1}px"></i>`;
    }
    // 메모가 있는 단은 왼쪽에 ✎ 표시
    for (const m of memosOf(part)) {
      if (m.row < R.lo || m.row > R.hi) continue;
      const y = v.n2p(0, R.at(m.row))[1];
      h += `<span class="memo-dot" style="left:4px;top:${y}px">✎</span><span class="memo-dot" style="left:${w - 26}px;top:${y}px">✎</span>`;
    }
    return h + ctl.pins.html(seg, v.n2p.bind(v));
  };

  const dirEl = app.querySelector('#dir');

  // 단이 다른 구간으로 넘어가면 그 구간 차트로 바꾼다
  const sync = async (dir) => {
    const want = segForRow(part, p().row);
    if (want === seg) return null;
    await showSeg(want);
    const pg = segs[want].page;
    return { how: 'first', note: dir === 'next' ? `<b>${pg}쪽</b> 차트로 넘어왔어요` : dir === 'prev' ? `<b>${pg}쪽</b> 차트로 돌아왔어요` : '' };
  };
  const ctl = knitControls({
    ctx, part, range: RR, total: () => RR.hi, label: '지금', finished: '마지막 단까지 떴습니다.', sync,
    lines: (pr) => (pr.done ? `<span class="tag-done">${icon.check}${esc(part.name)} 완료</span>`
      : pr.mark !== null && pr.mark !== undefined ? `<span class="rc-line"><i class="mk"></i>코 표시 <b class="num">${pr.mark}</b>번 칸</span>`
      : '<span class="rc-line muted">코 표시 없음</span>'),
    redraw: (how) => redraw(how),
  });

  const redraw = (follow) => {
    const pr = p();
    const rs = isRightSide(part);
    const round = part.cal.mode.type === 'round';
    dirEl.innerHTML = pr.done ? `${icon.check}완료`
      : `${rs ? icon.left : icon.right}${round ? '원통' : rs ? '겉면' : '안면'}<span class="dir-long"> · ${rs ? '왼쪽' : '오른쪽'}으로 읽기</span>`;
    segBar?.querySelectorAll('[data-seg]').forEach((b) => {
      const i = +b.dataset.seg;
      b.classList.toggle('on', i === seg);
      b.classList.toggle('here', i === segForRow(part, pr.row) && i !== seg);
    });
    cv.redraw();
    if (follow) {
      // 세로로는 현재 단을 따라가고, 가로로는 코 표시가 있을 때만 그쪽으로 옮긴다
      const y = R.at(clamp(pr.done ? RR.hi : pr.row, R.lo, R.hi));
      if (pr.mark !== null && pr.mark !== undefined) cv.scrollTo(C.at(pr.mark), y, { x: 'center', smooth: follow !== 'first' });
      else cv.scrollTo((C.at(C.lo) + C.at(C.hi)) / 2, y, { x: follow === 'first' ? 'center' : 'keep', smooth: follow !== 'first' });
    }
  };

  const key = `knit.rowPx.${id}`;
  let rowPx = 26;
  try { rowPx = +localStorage.getItem(key) || 26; } catch {}

  // 구간 i의 차트를 띄운다 (구간이 바뀌면 다시 부른다)
  const showSeg = async (i) => {
    seg = i;
    const vp = segPart(part, i);
    R = rowsOf(vp);
    C = colsOf(vp);
    const sz = await pageSize(doc, vp.page);
    const pitchPt = R.pitch * sz.h;
    if (cv) { cv.destroy(); if (window.__cv === cv) window.__cv = null; }
    const host = app.querySelector('#chart');
    const old = host.cloneNode(false);
    host.replaceWith(old);
    cv = new ChartView(old, {
      doc, pageNum: vp.page, area: vp.cal.area, decorate,
      onScale: (sc) => { try { rowPx = sc * pitchPt; localStorage.setItem(key, String(rowPx)); } catch {} },
      onTap: async (nx, ny) => {
        if (rowPick.armed()) return rowPick.tap(clamp(R.nearest(ny), R.lo, R.hi));
        if (ctl.pins.armed()) {
          // 칸 한가운데에 맞춰 꽂는다
          const pr0 = clamp(R.nearest(ny), R.lo, R.hi);
          const pc0 = clamp(C.nearest(nx), C.lo, C.hi);
          return ctl.pins.place({ seg, x: C.at(pc0), y: R.at(pr0), label: `${pr0}단 ${pc0}번 칸` });
        }
        const pr = p();
        if (pr.done) return;
        const r = R.nearest(ny);
        if (r !== pr.row) {
          toast('다른 단으로 가려면 그 단을 <b>길게</b> 누르세요');
          return;
        }
        const c = clamp(C.nearest(nx), C.lo, C.hi);
        pr.mark = pr.mark === c ? null : c;
        pr.touched = true;
        await ctl.save();
        ctl.refresh(false);
      },
      onLong: async (nx, ny) => {
        if (rowPick.armed()) return;
        const pr = p();
        const r = clamp(R.nearest(ny), R.lo, R.hi);
        if (r === pr.row && !pr.done) return;
        await ctl.jump(r);
      },
    });
    window.__cv = cv;
    await cv.init(rowPx / pitchPt);
  };
  onCleanup(() => { cv?.destroy(); if (window.__cv === cv) window.__cv = null; });

  const segBar = app.querySelector('#segs');
  if (segBar) {
    segBar.innerHTML = segs.map((sg, i) => {
      const a = rowsOf(segPart(part, i));
      return `<button type="button" class="chip" data-seg="${i}">${sg.page}쪽 · ${a.lo}~${a.hi}단</button>`;
    }).join('');
    segBar.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', async () => {
      const i = +b.dataset.seg;
      if (i === seg) return;
      await showSeg(i);
      ctl.refresh('first');
      if (i !== segForRow(part, p().row)) toast(`${segs[i].page}쪽 차트를 보는 중입니다. 지금 단은 ${segs[segForRow(part, p().row)].page}쪽에 있어요.`);
    }));
  }

  await showSeg(seg);
  ctl.refresh('first');
}

