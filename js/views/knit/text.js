// 뜨기 화면: 글 설명 도안 (단은 숫자로 세고, 읽는 줄에 형광펜 띠)
import { StackView } from '../../widgets/stackview.js';
import { esc, toast } from '../../ui.js';
import { calibrated, segsOf } from '../../model/knitting.js';
import { readSizeGroups } from '../../model/sizes.js';
import { app, clamp, onCleanup } from '../../core.js';
import { readTextLines } from '../../model/labels.js';
import { rowPick } from '../../sheets/reps.js';
import { knitShell, loadKnit, knitControls } from './shell.js';

export async function viewTextKnit(part) {
  const id = part.id;
  if (!calibrated(part)) return location.replace(`#/txt/${id}`);
  const ctx = await loadKnit(part);
  const { doc, proj } = ctx;
  if (!part.progress) part.progress = { row: 1, line: null, done: false };
  const p = () => part.progress;
  const R = { lo: 1, get hi() { return part.text.goal || 9999; } };
  app.innerHTML = knitShell(ctx, part, { cls: 'text-knit', top: `${proj.sizes ? `<button type="button" class="sz-chip" id="szchip" aria-pressed="true">사이즈 ${esc(proj.sizes.labels?.[proj.sizes.idx] ?? proj.sizes.idx + 1)}</button>` : ''}`, afterChart: `<p class="hint pad k-hint">읽는 줄을 탭하면 형광펜이 옮겨가고, 그 단의 줄로 기억합니다.</p>` });

  // 내 사이즈 숫자 강조 (작품에 사이즈를 정해 두었을 때)
  const SZ = proj.sizes;
  let szOn = !!SZ;
  let szGroups = null;
  const sizeMarks = (i, v) => {
    if (!szOn || !szGroups?.[i]) return '';
    const box = (b, cls) => {
      const [x1, y1] = v.n2p(b.x, b.y);
      const [x2, y2] = v.n2p(b.x + b.w, b.y + b.h);
      return `<i class="${cls}" style="left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px"></i>`;
    };
    let h = '';
    for (const g of szGroups[i]) {
      if (g.nums.length !== SZ.n) continue;
      g.nums.forEach((b, j) => { if (j === SZ.idx) h += box(b, 'sz-on'); else if (SZ.dim) h += box(b, 'sz-dim'); });
      if (SZ.dim) g.parens.forEach((b) => { h += box(b, 'sz-dim'); });
    }
    return h;
  };
  // 읽는 줄 강조: 위아래를 살짝 흐리게 덮고, 글자 아래에 글자 길이만큼 얇은 밑줄 (글자 위에는 아무것도 안 덮음)
  const decorate = (i, v) => {
    const L = p().line;
    const h = sizeMarks(i, v) + ctl.pins.html(i, v.n2p);
    if (!L) return h;
    const [w, ht] = v.size();
    if ((L.seg ?? 0) !== i) return `<i class="ruler-dim" style="left:0;top:0;width:${w}px;height:${ht}px"></i>` + h;
    const t = v.n2p(0, L.top)[1];
    const b = v.n2p(0, L.bot)[1];
    const pad = Math.max(3, (b - t) * 0.3);
    const y1 = t - pad;
    const y2 = b + pad;
    // 글자 좌우 끝 (예전에 저장한 줄에는 없어서 그때는 영역 폭 전체)
    const sg = segs[i].area;
    const x1 = v.n2p(L.left ?? sg.x, 0)[0];
    const x2 = v.n2p(L.right ?? sg.x + sg.w, 0)[0];
    return `<i class="ruler-dim" style="left:0;top:0;width:${w}px;height:${Math.max(0, y1)}px"></i>` +
      `<i class="ruler-dim" style="left:0;top:${y2}px;width:${w}px;height:${Math.max(0, ht - y2)}px"></i>` +
      `<i class="ruler-line" style="left:${x1 - 2}px;top:${b + 2}px;width:${x2 - x1 + 4}px"></i>` + h;
  };
  // 단이 바뀌면 읽는 줄도 따라간다.
  //   1) 그 단에서 직접 탭해 둔 줄 (part.text.lineAt) — 반복으로 같은 단에 돌아왔을 때 같은 줄을 비추려고 기억한다
  //   2) "5단: …"처럼 그 단 번호로 시작하는 줄. 같은 번호가 여러 군데면, 단 번호가 줄면(이전 단·반복 처음으로) 지금 줄보다 위쪽,
  //      늘면 아래쪽에서 가장 가까운 것
  //   3) 둘 다 없으면 그대로 둔다
  const at = (seg, top) => seg * 10 + top;
  const lineFor = async (row, back) => {
    const mine = part.text.lineAt?.[row];
    if (mine) return mine;
    const all = linesP ? await linesP : [];
    const cur = p().line;
    const ck = cur ? at(cur.seg ?? 0, cur.top) : back ? Infinity : -1;
    let best = null;
    let bd = Infinity;
    all.forEach((ls, i) => ls.forEach((l) => {
      if (!l.row || row < l.row || row > l.rowTo) return;
      const k = at(i, l.top);
      const wrongSide = back ? k > ck + 0.001 : k < ck - 0.001;
      const d = (l.rowTo - l.row) * 1000 + (wrongSide ? 100 : 0) + Math.abs(k - ck);
      if (d < bd) { bd = d; best = { seg: i, top: l.top, bot: l.bot, left: l.left, right: l.right }; }
    }));
    return best;
  };
  let lastRow = p().row;
  const sync = async () => {
    const back = p().row < lastRow;
    lastRow = p().row;
    if (p().done) return null;
    const L = await lineFor(p().row, back);
    const cur = p().line;
    if (!L || (cur && (cur.seg ?? 0) === L.seg && Math.abs(cur.top - L.top) < 0.002)) return null;
    p().line = { ...L };
    await ctl.save();
    return { how: 'line' };
  };
  const followLine = () => {
    const L = p().line;
    if (L) cv.scrollTo(L.seg ?? 0, segs[L.seg ?? 0].area.x, L.top, { x: 'keep', yFrac: 0.35 });
  };
  const ctl = knitControls({
    ctx, part, range: R, total: () => part.text.goal, finished: '목표 단수까지 떴습니다.', sync,
    lines: (pr) => {
      const goal = part.text.goal;
      const pct = goal ? Math.min(100, ((pr.done ? goal : pr.row - 1) / goal) * 100) : 0;
      return `${goal ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}
      <span class="rc-line small muted">${pr.done ? `${esc(part.name)} 완료` : `${pr.row > 1 ? `${pr.row - 1}단까지 떴습니다` : '첫 단을 뜨는 중'}${goal ? ` · 목표까지 ${Math.max(0, goal - pr.row + 1)}단` : ''}`}</span>`;
    },
    redraw: (how) => { cv.redraw(); if (how === 'line') followLine(); },
  });

  const zKey = `knit.textScale.${id}`;
  const segs = segsOf(part);
  let linesP = null;
  const cv = new StackView(app.querySelector('#chart'), {
    doc, pieces: segs.map((sg) => ({ page: sg.page, area: sg.area })), decorate,
    onScale: (sc) => { try { localStorage.setItem(zKey, String(sc)); } catch {} },
    onTap: async (i, nx, ny) => {
      if (ctl.pins.armed()) return ctl.pins.place({ seg: i, x: nx, y: ny, label: `${segs[i].page}쪽` });
      const lines = (await linesP)[i] || [];
      if (rowPick.armed()) {
        // "5단: …"처럼 단 번호로 시작하는 줄을 탭하면 그 번호를 고른다
        const hit = lines.find((l) => ny >= l.top - 0.004 && ny <= l.bot + 0.004);
        if (hit?.row) return rowPick.tap(hit.row);
        return toast("단 번호로 시작하는 줄(예: '5단: …')을 탭해 주세요. 안 되면 취소하고 번호로 입력하세요.");
      }
      let L = null;
      if (lines.length) {
        let bd = Infinity;
        for (const l of lines) {
          const d = ny < l.top ? l.top - ny : ny > l.bot ? ny - l.bot : 0;
          if (d < bd) { bd = d; L = l; }
        }
        if (bd > 0.03) L = null;
      }
      if (!L) L = { top: ny - 0.008, bot: ny + 0.008 };
      const cur = p().line;
      const off = cur && (cur.seg ?? 0) === i && Math.abs(cur.top - L.top) < 0.002;
      p().line = off ? null : { seg: i, top: L.top, bot: L.bot, left: L.left, right: L.right };
      // 이 단에서 읽는 줄로 기억한다 (반복으로 이 단에 다시 오면 이 줄로)
      const at = (part.text.lineAt ||= {});
      if (off) delete at[p().row]; else at[p().row] = { ...p().line };
      await ctl.save();
      ctl.refresh();
    },
  });
  window.__cv = cv;
  onCleanup(() => { cv.destroy(); if (window.__cv === cv) window.__cv = null; });
  let saved = 0;
  try { saved = +localStorage.getItem(zKey) || 0; } catch {}
  await cv.init(saved || undefined);
  linesP = Promise.all(cv.pieces.map((pc) => readTextLines(pc.page, pc.area)));
  if (SZ) {
    Promise.all(cv.pieces.map((pc) => readSizeGroups(pc.page, pc.area))).then((g) => { szGroups = g; cv.redraw(); });
    app.querySelector('#szchip').addEventListener('click', (e) => {
      szOn = !szOn;
      e.currentTarget.setAttribute('aria-pressed', String(szOn));
      cv.redraw();
      toast(szOn ? '내 사이즈 숫자를 강조합니다' : '강조를 껐습니다 (원래 도안 그대로)');
    });
  }
  if (!saved) {
    // 처음 열 때는 글자가 읽힐 만큼(줄 높이 약 15px) 확대해서 시작한다
    const lines = (await linesP)[0];
    const hs = lines.map((l) => l.bot - l.top).sort((a, b) => a - b);
    const h = hs[Math.floor(hs.length / 2)];
    if (h) cv.setScale(Math.max(cv.s, 15 / (h * cv.pieces[0].H1)));
  }
  if (!p().line) await sync();
  const L0 = p().line;
  const s0 = L0 ? clamp(L0.seg ?? 0, 0, segs.length - 1) : 0;
  cv.scrollTo(s0, segs[s0].area.x, L0 ? L0.top : segs[0].area.y, { x: 'start', yFrac: L0 ? 0.35 : 0 });
  ctl.refresh();
}
