// 뜨기 화면(기호 차트·원형 차트·글 설명)
import * as db from '../db.js';
import { loadPdf, pageSize } from '../pdf.js';
import { ChartView } from '../chartview.js';
import { StackView } from '../stackview.js';
import { esc, icon, ro, toast, dialog, sheet } from '../ui.js';
import { calibrated, rowsOf, colsOf, startProgress, isRightSide, repsOf, nextRow, prevRow, jumpTo, partStatus, isText, segsOf, segPart, segForRow, isCirc } from '../knitting.js';
import { ringGeom, ringOnView, stadium } from '../circ.js';
import { readSizeGroups } from '../sizes.js';
import { app, go, clamp, onCleanup } from '../core.js';
import { partHref } from '../partnav.js';
import { readTextLines } from '../labels.js';
import { memosOf, editMemo, memoList, rowMenu, memoCardHtml, memoHint } from '../memo.js';
import { toggleLegend } from '../legend.js';
import { keypad, openDoc } from '../dialogs.js';
import { videoMenu } from '../videoui.js';
import { pinControl } from '../pins.js';
import { repLines, repNote, repeatSheet } from '../reps.js';

// ---- 세 가지 뜨기 화면이 함께 쓰는 것 ----

// 화면 뼈대: 위쪽 줄(뒤로·파트 바꾸기·기호·영상·도안), 차트 자리, 메모 카드, 아래 조작부
function knitShell({ proj, part, parts, idx, cls = '', top = '', beforeChart = '', afterChart = '' }) {
  return `<div class="knit ${cls}">
    <div class="k-main">
      <div class="k-top">
        <a class="icon-btn" href="#/p/${proj.id}" aria-label="파트 목록으로">${icon.back}</a>
        <button type="button" class="part-switch" id="sw" aria-label="다른 파트로 바꾸기">
          <span class="ps-t"><span class="ps-name">${esc(part.name)}</span><span class="ps-sub">${proj.size ? `사이즈 ${esc(proj.size)} · ` : ''}파트 ${idx + 1}/${parts.length}</span></span>${icon.chev}</button>
        <span class="k-spacer"></span>
        ${top}
        <button type="button" class="btn" id="legbtn">기호</button>
        <button type="button" class="btn" id="vidbtn">영상</button>
        <button type="button" class="btn" id="docbtn">도안</button>
      </div>
      ${beforeChart}
      <div class="k-chart" id="chart"></div>
      <button type="button" class="memo-card" id="memocard" hidden></button>
      ${afterChart}
    </div>
    <div class="k-ctrl">
      <button type="button" class="row-card" id="rowcard" aria-label="단 번호를 입력해 이동"></button>
      <button type="button" class="next-btn" id="next">다음 단</button>
      <button type="button" class="btn prev-btn" id="prev">${icon.undo}이전 단</button>
    </div></div>`;
}

// 메모 카드: 메모가 있는 단에 새로 오면 한 번 깜빡여 알린다. 카드를 누르면 고치기
function memoCard(part, curRow, onEdited) {
  const el = app.querySelector('#memocard');
  let shownFor = null;
  el.addEventListener('click', async () => { if (await editMemo(part, curRow())) onEdited(); });
  return (pr) => {
    const h = memoCardHtml(part, pr);
    el.hidden = !h;
    el.innerHTML = h;
    const key = h ? pr.row : null;
    if (key !== null && key !== shownFor) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    shownFor = key;
  };
}

// 위쪽 줄 버튼들과 화면 켜두기
function bindKnitCommon({ proj, doc, parts, id }) {
  app.querySelector('#sw').addEventListener('click', async () => {
    const v = await sheet('파트 바꾸기', parts.map((x) => {
      const st = partStatus(x);
      return { label: x.name, value: x.id, current: x.id === id,
        sub: st === 'done' ? '완료' : st === 'setup' ? '설정 필요' : st === 'active' ? `${x.progress.row}단` : '시작 전' };
    }));
    if (v && v !== id) go(partHref(parts.find((x) => x.id === v)));
  });
  app.querySelector('#docbtn').addEventListener('click', () => openDoc(doc));
  app.querySelector('#legbtn').addEventListener('click', () => toggleLegend(proj, doc));
  app.querySelector('#vidbtn').addEventListener('click', () => videoMenu(proj, doc));
  // 뜨는 동안 화면 켜두기
  let lock = null;
  const keepAwake = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch {} };
  keepAwake();
  const vis = () => { if (document.visibilityState === 'visible') keepAwake(); };
  document.addEventListener('visibilitychange', vis);
  onCleanup(() => { document.removeEventListener('visibilitychange', vis); lock?.release?.().catch(() => {}); });
}

// 단 카드: 누르면 도구 시트(단 이동·메모·핀)를 띄우고 고른 일을 한다. moveTo(r): 그 화면 방식대로 r단으로 옮기기
function bindRowCard({ el, part, pins, range, save, restore, onMemoChanged, moveTo }) {
  el.addEventListener('click', async () => {
    const row = part.progress.row;
    const act = await rowMenu(part, row);
    if (await pins.handle(act)) return;
    if (act === 'memo') { if (await editMemo(part, row)) onMemoChanged(); return; }
    if (act === 'reps') { if (await repeatSheet(part, save)) onMemoChanged(); return; }
    let r;
    if (act === 'list') r = await memoList(part, true, row);
    else if (act === 'jump') r = await keypad(range, row);
    if (r === null || r === undefined) return;
    const snap = JSON.stringify(part.progress);
    await moveTo(r);
    toast(`<b>${r}단</b>으로 이동했습니다`, { action: '취소', onAction: () => restore(snap) });
  });
}

// 파트를 다 떴을 때 다음 파트로 넘어갈지 묻는다
async function offerNextPart(part, nextPart, lead) {
  const yes = await dialog({
    title: `<span class="ok">${icon.check}${esc(part.name)} 완료</span>`,
    body: `${lead}<br>다음 파트 <span class="pill-hl">${esc(nextPart.name)}</span>${ro(nextPart.name)} 넘어갈까요?`,
    buttons: [{ label: '아니오', value: false }, { label: '네', value: true, primary: true }],
  });
  if (yes) go(partHref(nextPart));
}

export async function viewCircKnit(part) {
  const id = part.id;
  if (!calibrated(part)) return location.replace(partHref(part));
  const proj = await db.get('projects', part.projectId);
  const parts = await db.partsOf(proj.id);
  const doc = await loadPdf(proj.fileId);
  const sg = segsOf(part)[0];
  const ring = sg.ring;
  const sz = await pageSize(doc, sg.page);
  if (!part.progress) part.progress = startProgress(part);
  const p = () => part.progress;
  const R = { lo: 1, hi: ring.n };
  const idx = parts.findIndex((x) => x.id === id);
  const nextPart = parts[idx + 1];
  proj.lastPartId = id;
  proj.updated = Date.now();
  await db.put('projects', proj);

  app.innerHTML = knitShell({ proj, part, parts, idx });

  const save = async () => { part.updated = Date.now(); await db.put('parts', part); };
  const snapshot = () => JSON.stringify(part.progress);
  const restore = async (s) => { part.progress = JSON.parse(s); await save(); refresh(); };

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
    // 구간 반복: 안팎 테두리를 점선으로, 오른쪽에 횟수
    for (const rg of repsOf(part).ranges) {
      if (rg.from > ring.n) continue;
      const out = g.rpx(Math.min(rg.to, ring.n));
      const inn = stadium(g.Apx, g.Bpx, g.rpx(rg.from - 1));
      paths += `<path d="${stadium(g.Apx, g.Bpx, out)}" class="rg-rep"/>`;
      if (inn) paths += `<path d="${inn}" class="rg-rep"/>`;
      paths += `<text class="rg-rep-t" x="${g.Bpx[0] + out + 4}" y="${g.Bpx[1] - 6}">×${rg.times || '?'}</text>`;
    }
    for (const m of memosOf(part)) {
      if (m.row < 1 || m.row > ring.n) continue;
      const [x, y] = [g.Bpx[0] + g.rpx(m.row - 0.5), g.Bpx[1]];
      paths += `<g class="rg-memo"><circle cx="${x}" cy="${y}" r="10"/><text x="${x}" y="${y + 4}" text-anchor="middle">✎</text></g>`;
    }
    return `<svg class="ring-ov" width="${w}" height="${ht}">${paths}</svg>` + pins.html(0, v.n2p.bind(v));
  };

  const rowcard = app.querySelector('#rowcard');
  const showMemo = memoCard(part, () => p().row, () => refresh());
  const pins = pinControl(part, () => save(), () => cv.redraw());
  const nextBtn = app.querySelector('#next');
  // 지금 단의 고리가 보이도록 (오른쪽 끝 기준)
  const follow = () => {
    const pr = p();
    const [x, y] = ringGeom(ring, sz.w, sz.h).midPoint(pr.done ? ring.n : pr.row);
    cv.scrollTo(x, y, { x: 'center', yFrac: 0.5, smooth: true });
  };
  const refresh = (scroll) => {
    const pr = p();
    const pct = Math.min(100, ((pr.done ? ring.n : pr.row - 1) / ring.n) * 100);
    rowcard.innerHTML = `<span class="rc-top"><span>${pr.done ? '완료' : '지금 뜨는 단'}</span><span class="rc-jump">${icon.edit}이동·메모</span></span>
      <span class="rc-num"><span class="num rc-big">${pr.row}</span><span class="rc-u">단</span><span class="num muted">/ ${ring.n}</span></span>
      <span class="bar"><i style="width:${pct}%"></i></span>
      <span class="rc-line small muted">${pr.done ? `${esc(part.name)} 완료` : pr.row > 1 ? `${pr.row - 1}단까지 떴습니다` : '첫 단을 뜨는 중'}</span>
      ${repLines(part, pr)}
      ${memoHint(part, pr)}`;
    showMemo(pr);
    nextBtn.disabled = !!pr.done;
    nextBtn.textContent = pr.done ? '완료' : '다음 단';
    cv.redraw();
    if (scroll) follow();
  };

  const key = `knit.circScale.${id}`;
  let saved = 0;
  try { saved = +localStorage.getItem(key) || 0; } catch {}
  const cv = new ChartView(app.querySelector('#chart'), {
    doc, pageNum: sg.page, area: sg.area, decorate,
    onScale: (sc) => { try { localStorage.setItem(key, String(sc)); } catch {} },
    onTap: (nx, ny) => {
      if (pins.armed()) return pins.place({ seg: 0, x: nx, y: ny, label: `${ringGeom(ring, sz.w, sz.h).roundAt(nx, ny)}단` });
      toast('다른 단으로 가려면 그 단을 <b>길게</b> 누르세요');
    },
    onLong: async (nx, ny) => {
      const r = ringGeom(ring, sz.w, sz.h).roundAt(nx, ny);
      if (r === p().row && !p().done) return;
      const snap = snapshot();
      jumpTo(part, r);
      p().touched = true;
      await save();
      refresh(false);
      toast(`<b>${r}단</b>으로 이동했습니다`, { action: '취소', onAction: () => restore(snap) });
    },
  });
  window.__cv = cv;
  onCleanup(() => { cv.destroy(); if (window.__cv === cv) window.__cv = null; });
  await cv.init(saved || undefined);
  refresh(false);

  nextBtn.addEventListener('click', async () => {
    const res = nextRow(part);
    p().touched = true;
    await save();
    refresh(true);
    if (res === 'finished' && nextPart) await offerNextPart(part, nextPart, '마지막 단까지 떴습니다.');
    else if (repNote(part, res)) toast(repNote(part, res), { ms: 1800 });
  });
  app.querySelector('#prev').addEventListener('click', async () => {
    if (!prevRow(part)) { toast('첫 단입니다'); return; }
    p().touched = true;
    await save();
    refresh(true);
  });
  bindRowCard({
    el: rowcard, part, pins, range: R, save, restore,
    onMemoChanged: () => refresh(),
    moveTo: async (r) => {
      jumpTo(part, r);
      p().touched = true;
      await save();
      refresh(true);
    },
  });
  bindKnitCommon({ proj, doc, parts, id });
}

export async function viewKnit(id) {
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  if (isText(part)) return viewTextKnit(part);
  if (isCirc(part)) return viewCircKnit(part);
  if (!calibrated(part)) return location.replace(`#/cal/${id}/1`);
  const proj = await db.get('projects', part.projectId);
  const parts = await db.partsOf(proj.id);
  const doc = await loadPdf(proj.fileId);
  if (!part.progress) part.progress = startProgress(part);
  const p = () => part.progress;
  const segs = segsOf(part);
  const RR = rowsOf(part); // 파트 전체 단 범위
  // 지금 화면에 띄운 구간과 그 구간의 격자
  let seg = segForRow(part, part.progress.row);
  let R, C, cv;
  const idx = parts.findIndex((x) => x.id === id);
  const nextPart = parts[idx + 1];
  proj.lastPartId = id;
  proj.updated = Date.now();
  await db.put('projects', proj);

  app.innerHTML = knitShell({ proj, part, parts, idx, top: `<span class="dir-chip" id="dir"></span>`, beforeChart: `${segs.length > 1 ? '<div class="seg-chips k-segs" id="segs"></div>' : ''}` });

  const save = async () => {
    part.updated = Date.now();
    await db.put('parts', part);
  };
  const snapshot = () => JSON.stringify(part.progress);
  const restore = async (s) => {
    part.progress = JSON.parse(s);
    await save();
    const moved = await followSeg();
    refresh(moved ? 'first' : true);
  };

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
    // 구간 반복: 왼쪽에 꺾쇠와 횟수 (이 쪽에 걸친 부분만)
    for (const rg of repsOf(part).ranges) {
      const a = Math.max(rg.from, R.lo);
      const b = Math.min(rg.to, R.hi);
      if (a > b) continue;
      const ys = [...edge(a), ...edge(b)].map((n) => v.n2p(0, n)[1]);
      const y1 = Math.min(...ys);
      const y2 = Math.max(...ys);
      h += `<i class="rep-br" style="top:${y1}px;height:${y2 - y1}px"></i><span class="rep-tag" style="top:${(y1 + y2) / 2}px">×${rg.times || '?'}</span>`;
    }
    // 메모가 있는 단은 왼쪽에 ✎ 표시
    for (const m of memosOf(part)) {
      if (m.row < R.lo || m.row > R.hi) continue;
      const y = v.n2p(0, R.at(m.row))[1];
      h += `<span class="memo-dot" style="left:4px;top:${y}px">✎</span><span class="memo-dot" style="left:${w - 26}px;top:${y}px">✎</span>`;
    }
    return h + pins.html(seg, v.n2p.bind(v));
  };

  const rowcard = app.querySelector('#rowcard');
  const showMemo = memoCard(part, () => p().row, () => refresh(false));
  const pins = pinControl(part, () => save(), () => cv.redraw());
  const nextBtn = app.querySelector('#next');
  const prevBtn = app.querySelector('#prev');
  const dirEl = app.querySelector('#dir');

  const refresh = (follow) => {
    const pr = p();
    const rs = isRightSide(part);
    const round = part.cal.mode.type === 'round';
    dirEl.innerHTML = pr.done ? `${icon.check}완료`
      : `${rs ? icon.left : icon.right}${round ? '원통' : rs ? '겉면' : '안면'}<span class="dir-long"> · ${rs ? '왼쪽' : '오른쪽'}으로 읽기</span>`;
    rowcard.innerHTML = `<span class="rc-top"><span>${pr.done ? '완료' : '지금'}</span><span class="rc-jump">${icon.edit}이동·메모</span></span>
      <span class="rc-num"><span class="num rc-big">${pr.row}</span><span class="rc-u">단</span><span class="num muted">/ ${RR.hi}</span></span>
      ${pr.done ? `<span class="tag-done">${icon.check}${esc(part.name)} 완료</span>`
        : pr.mark !== null && pr.mark !== undefined ? `<span class="rc-line"><i class="mk"></i>코 표시 <b class="num">${pr.mark}</b>번 칸</span>`
        : '<span class="rc-line muted">코 표시 없음</span>'}
      ${repLines(part, pr)}
      ${memoHint(part, pr)}`;
    showMemo(pr);
    nextBtn.disabled = !!pr.done;
    nextBtn.textContent = pr.done ? '완료' : '다음 단';
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
        if (pins.armed()) {
          // 칸 한가운데에 맞춰 꽂는다
          const pr0 = clamp(R.nearest(ny), R.lo, R.hi);
          const pc0 = clamp(C.nearest(nx), C.lo, C.hi);
          return pins.place({ seg, x: C.at(pc0), y: R.at(pr0), label: `${pr0}단 ${pc0}번 칸` });
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
        await save();
        refresh(false);
      },
      onLong: async (nx, ny) => {
        const pr = p();
        const r = clamp(R.nearest(ny), R.lo, R.hi);
        if (r === pr.row && !pr.done) return;
        const snap = snapshot();
        jumpTo(part, r);
        part.progress.touched = true;
        await save();
        refresh(true);
        toast(`<b>${r}단</b>으로 이동했습니다`, { action: '취소', onAction: () => restore(snap) });
      },
    });
    window.__cv = cv;
    await cv.init(rowPx / pitchPt);
  };
  onCleanup(() => { cv?.destroy(); if (window.__cv === cv) window.__cv = null; });

  // 단이 다른 구간으로 넘어가면 그 구간 차트로 바꾼다. 바뀌었으면 페이지 번호를 돌려준다
  const followSeg = async () => {
    const want = segForRow(part, p().row);
    if (want === seg) return null;
    await showSeg(want);
    return segs[want].page;
  };

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
      refresh('first');
      if (i !== segForRow(part, p().row)) toast(`${segs[i].page}쪽 차트를 보는 중입니다. 지금 단은 ${segs[segForRow(part, p().row)].page}쪽에 있어요.`);
    }));
  }

  await showSeg(seg);
  refresh('first');

  nextBtn.addEventListener('click', async () => {
    const res = nextRow(part);
    part.progress.touched = true;
    await save();
    const moved = await followSeg();
    refresh(moved ? 'first' : true);
    if (res === 'finished') {
      if (nextPart) await offerNextPart(part, nextPart, '마지막 단까지 떴습니다.');
    } else {
      // 평소에는 알림 없이 넘어간다 (되돌리기는 '이전 단'). 반복이 새로 시작되거나 페이지가 바뀔 때만 짧게 알린다
      const note = [repNote(part, res), moved ? `<b>${moved}쪽</b> 차트로 넘어왔어요` : ''].filter(Boolean).join(' · ');
      if (note) toast(note, { ms: 1800 });
    }
  });
  prevBtn.addEventListener('click', async () => {
    if (!prevRow(part)) { toast('첫 단입니다'); return; }
    part.progress.touched = true;
    await save();
    const moved = await followSeg();
    refresh(moved ? 'first' : true);
    if (moved) toast(`<b>${moved}쪽</b> 차트로 돌아왔어요`);
  });
  bindRowCard({
    el: rowcard, part, pins, range: RR, save, restore,
    onMemoChanged: () => refresh(false),
    moveTo: async (r) => {
      jumpTo(part, r);
      part.progress.touched = true;
      await save();
      const moved = await followSeg();
      refresh(moved ? 'first' : true);
    },
  });
  bindKnitCommon({ proj, doc, parts, id });
}

export async function viewTextKnit(part) {
  const id = part.id;
  if (!calibrated(part)) return location.replace(`#/txt/${id}`);
  const proj = await db.get('projects', part.projectId);
  const parts = await db.partsOf(proj.id);
  const doc = await loadPdf(proj.fileId);
  if (!part.progress) part.progress = { row: 1, line: null, done: false };
  const p = () => part.progress;
  const goal = part.text.goal;
  const R = { lo: 1, hi: goal || 9999 };
  const idx = parts.findIndex((x) => x.id === id);
  const nextPart = parts[idx + 1];
  proj.lastPartId = id;
  proj.updated = Date.now();
  await db.put('projects', proj);

  app.innerHTML = knitShell({ proj, part, parts, idx, cls: 'text-knit', top: `${proj.sizes ? `<button type="button" class="sz-chip" id="szchip" aria-pressed="true">사이즈 ${esc(proj.sizes.labels?.[proj.sizes.idx] ?? proj.sizes.idx + 1)}</button>` : ''}`, afterChart: `<p class="hint pad k-hint">읽고 있는 줄을 탭하면 형광펜 띠가 옮겨갑니다.</p>` });

  const save = async () => { part.updated = Date.now(); await db.put('parts', part); };
  const restore = async (s) => { part.progress = JSON.parse(s); await save(); refresh(); };

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
  // 읽는 줄 강조: 줄 위아래를 흐리게 덮어 그 줄 글자만 또렷하게 보이게 한다 (글자 위에는 아무것도 안 덮음)
  const decorate = (i, v) => {
    const L = p().line;
    const h = sizeMarks(i, v) + pins.html(i, v.n2p);
    if (!L) return h;
    const [w, ht] = v.size();
    if ((L.seg ?? 0) !== i) return `<i class="ruler-dim" style="left:0;top:0;width:${w}px;height:${ht}px"></i>` + h;
    const t = v.n2p(0, L.top)[1];
    const b = v.n2p(0, L.bot)[1];
    const pad = Math.max(4, (b - t) * 0.35); // 글자 아랫부분이 밑줄에 가리지 않게 넉넉히
    const y1 = t - pad;
    const y2 = b + pad + 5;
    return `<i class="ruler-dim" style="left:0;top:0;width:${w}px;height:${Math.max(0, y1)}px"></i>` +
      `<i class="ruler-dim" style="left:0;top:${y2}px;width:${w}px;height:${Math.max(0, ht - y2)}px"></i>` +
      `<i class="ruler-line" style="left:0;top:${y1}px;width:${w}px;height:${y2 - y1}px"></i>` + h;
  };
  const rowcard = app.querySelector('#rowcard');
  const showMemo = memoCard(part, () => p().row, () => refresh(false));
  const pins = pinControl(part, () => save(), () => cv.redraw());
  const nextBtn = app.querySelector('#next');
  const refresh = () => {
    const pr = p();
    const pct = goal ? Math.min(100, ((pr.done ? goal : pr.row - 1) / goal) * 100) : 0;
    rowcard.innerHTML = `<span class="rc-top"><span>${pr.done ? '완료' : '지금 뜨는 단'}</span><span class="rc-jump">${icon.edit}이동·메모</span></span>
      <span class="rc-num"><span class="num rc-big">${pr.row}</span><span class="rc-u">단</span>${goal ? `<span class="num muted">/ ${goal}</span>` : ''}</span>
      ${goal ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}
      <span class="rc-line small muted">${pr.done ? `${esc(part.name)} 완료` : `${pr.row > 1 ? `${pr.row - 1}단까지 떴습니다` : '첫 단을 뜨는 중'}${goal ? ` · 목표까지 ${Math.max(0, goal - pr.row + 1)}단` : ''}`}</span>
      ${repLines(part, pr)}
      ${memoHint(part, pr)}`;
    showMemo(pr);
    nextBtn.disabled = !!pr.done;
    nextBtn.textContent = pr.done ? '완료' : '다음 단';
    cv.redraw();
  };

  const zKey = `knit.textScale.${id}`;
  const segs = segsOf(part);
  let linesP = null;
  const cv = new StackView(app.querySelector('#chart'), {
    doc, pieces: segs.map((sg) => ({ page: sg.page, area: sg.area })), decorate,
    onScale: (sc) => { try { localStorage.setItem(zKey, String(sc)); } catch {} },
    onTap: async (i, nx, ny) => {
      if (pins.armed()) return pins.place({ seg: i, x: nx, y: ny, label: `${segs[i].page}쪽` });
      const lines = (await linesP)[i] || [];
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
      p().line = cur && (cur.seg ?? 0) === i && Math.abs(cur.top - L.top) < 0.002 ? null : { seg: i, top: L.top, bot: L.bot };
      await save();
      refresh();
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
  const L0 = p().line;
  const s0 = L0 ? clamp(L0.seg ?? 0, 0, segs.length - 1) : 0;
  cv.scrollTo(s0, segs[s0].area.x, L0 ? L0.top : segs[0].area.y, { x: 'start', yFrac: L0 ? 0.35 : 0 });
  refresh();

  nextBtn.addEventListener('click', async () => {
    const res = nextRow(part);
    p().touched = true;
    await save();
    refresh();
    if (res === 'finished' && nextPart) await offerNextPart(part, nextPart, '목표 단수까지 떴습니다.');
    else if (repNote(part, res)) toast(repNote(part, res), { ms: 1800 });
  });
  app.querySelector('#prev').addEventListener('click', async () => {
    if (!prevRow(part)) { toast('첫 단입니다'); return; }
    p().touched = true;
    await save();
    refresh();
  });
  bindRowCard({
    el: rowcard, part, pins, range: R, save, restore,
    onMemoChanged: () => refresh(),
    moveTo: async (r) => {
      p().row = r;
      p().done = false;
      p().touched = true;
      await save();
      refresh();
    },
  });
  bindKnitCommon({ proj, doc, parts, id });
}
