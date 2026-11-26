// 격자 맞추기(기호 차트·원형 차트)와 글 설명 영역
import * as db from '../db.js';
import { loadPdf, pageSize } from '../pdf.js';
import { ChartView } from '../widgets/chartview.js';
import { esc, icon, toast } from '../ui.js';
import { validPair, axis, rowsOf, segsOf, segPart, pagesLabel, isCirc } from '../model/knitting.js';
import { startProgress, isRightSide } from '../model/progress.js';
import { validRing, ringOnView, stadium } from '../model/circ.js';
import { app, go, clamp, onCleanup, header } from '../core.js';
import { calUrl, calNextUrl, calPrevUrl, segChips } from '../partnav.js';
import { readNumberLabels, buildTable, growToLabels, autoDetect, proposeArea, nearestLabel } from '../model/labels.js';
import { rectPicker } from '../widgets/rectpicker.js';

export const STEP_LABELS = ['영역', '단 번호', '코 번호', '뜨는 방식'];

export function stepsHtml(now, labels = STEP_LABELS) {
  return `<div class="steps">${labels.map((l, i) => {
    const n = i + 1;
    const cls = n < now ? 'done' : n === now ? 'now' : '';
    return `<div class="step ${cls}"><span class="num">${n}</span><span>${l}</span></div>`;
  }).join('')}</div>`;
}

export async function viewCal(id, stepStr, segStr) {
  const step = +stepStr;
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  const proj = await db.get('projects', part.projectId);
  const doc = await loadPdf(proj.fileId);
  part.cal = part.cal || {};
  const segs = segsOf(part);
  const seg = clamp(+(segStr || 0), 0, segs.length - 1);
  if (isCirc(part)) {
    if (step > 1 && !segs[0].area) return location.replace(calUrl(id, 1, 0));
    if (step > 2) return location.replace(calUrl(id, 2, 0));
    if (step === 2) return calCirc(part, proj, doc);
  }
  // 앞 단계가 안 된 상태로 들어오면 그 단계로 돌려보낸다
  for (let i = 0; i < segs.length && (step === 4 || i <= seg); i++) {
    const sg = segs[i];
    const upto = step === 4 || i < seg ? 4 : step;
    if (upto > 1 && !sg.area) return location.replace(calUrl(id, 1, i));
    if (upto > 2 && !validPair(sg.rows, 'y')) return location.replace(calUrl(id, 2, i));
    if (upto > 3 && !validPair(sg.cols, 'x')) return location.replace(calUrl(id, 3, i));
  }
  const back = calPrevUrl(part, step, seg, proj.id);
  if (step === 4) {
    const top = header(back, '격자 맞추기', `${esc(part.name)} · ${pagesLabel(part)}`) + stepsHtml(4);
    return calMode(part, proj, top, () => db.put('parts', part));
  }
  // 구간 하나만 보는 가짜 파트로 화면을 그리고, 저장할 때 구간에 되돌려 쓴다
  const vp = segPart(part, seg);
  const save = () => {
    const sg = part.segs[seg];
    sg.page = vp.page;
    sg.area = vp.cal.area || null;
    sg.rows = vp.cal.rows || null;
    sg.cols = vp.cal.cols || null;
    if (vp.cal.mode !== undefined) part.cal.mode = vp.cal.mode;
    part.updated = Date.now();
    return db.put('parts', part);
  };
  const segTxt = segs.length > 1 ? ` · 구간 ${seg + 1}/${segs.length}` : '';
  const top = header(back, '격자 맞추기', `${esc(part.name)} · ${vp.page}쪽${segTxt}`) + stepsHtml(step, isCirc(part) ? ['영역', '단 맞추기'] : STEP_LABELS) +
    segChips(part, seg, (sg) => !!(sg.area && validPair(sg.rows, 'y') && validPair(sg.cols, 'x')));
  if (step === 1) return calArea(vp, proj, doc, top, save);
  return calPoints(vp, doc, top, save, step);
}

export async function calArea(part, proj, doc, top, save) {
  app.innerHTML = `${top}
    <p class="lead">차트 영역을 자동으로 잡아 둡니다. 원하는 차트만 쓰려면 모서리를 끌어 고치세요. <b>대충</b> 감싸도 바로 옆 번호 칸은 자동으로 들어갑니다.</p>
    <div class="pv-box" id="pv"></div>
    <p class="hint pad">손가락으로 끌어서 그리고, 모서리를 끌어 크기를 고칩니다. 번호 칸이 글자로 읽히는 도안이면 위아래로 떨어진 차트도 한 파트로 묶을 수 있습니다. 사이의 빈 공간은 번호 칸 위치로 맞춥니다.</p>
    <button type="button" class="link-btn" id="autoarea">차트 영역 자동으로 다시 잡기</button>
    <div class="footer"><button type="button" class="btn" id="pg">페이지 다시 고르기</button>
      <button type="button" class="btn primary" id="next" ${part.cal.area ? '' : 'disabled'}>${isCirc(part) ? '다음: 단 맞추기' : '다음: 단 번호'}</button></div>`;
  const nextBtn = app.querySelector('#next');
  const picker = rectPicker(app.querySelector('#pv'), doc, {
    page: part.page,
    area: part.cal.area,
    onChange: async (drawn) => {
      // 사각형 바로 바깥에 번호 칸이 걸쳐 있으면 영역을 넓혀 포함시킨다 (대충 그려도 되도록)
      const A = await growToLabels(doc, part.page, drawn);
      part.cal.area = A;
      // 새 영역 밖으로 나간 기준점은 지운다 (예전 영역에서 찍은 점이 남아 계산을 틀리게 하지 않도록)
      const inside = (p) => p && typeof p.x === 'number' && p.x >= A.x - 0.002 && p.x <= A.x + A.w + 0.002 && p.y >= A.y - 0.002 && p.y <= A.y + A.h + 0.002;
      for (const f of ['rows', 'cols']) {
        const pr = part.cal[f];
        if (!pr) continue;
        for (const k of ['a', 'b']) if (pr[k] && !inside(pr[k])) pr[k] = {};
      }
      await save();
      nextBtn.disabled = false;
      return A;
    },
  });
  onCleanup(() => picker.destroy());
  const applyProposal = async (manual) => {
    const prop = await proposeArea(doc, part.page);
    if (!prop) {
      if (manual) toast('이 페이지에서는 번호 칸을 찾지 못했습니다. 손가락으로 끌어 직접 감싸주세요.');
      return;
    }
    part.cal.area = prop;
    // 영역이 바뀌면 예전 기준점은 다시 잡도록 지운다
    part.cal.rows = null;
    part.cal.cols = null;
    await save();
    nextBtn.disabled = false;
    picker.setArea(prop);
    toast('차트 영역을 자동으로 잡았습니다. 맞지 않으면 모서리를 끌어 고치세요.', { ms: 4500 });
  };
  if (!part.cal.area) await applyProposal(false);
  app.querySelector('#autoarea').addEventListener('click', () => applyProposal(true));
  nextBtn.addEventListener('click', () => go(calNextUrl(part, 1)));
  app.querySelector('#pg').addEventListener('click', () => go(`#/pedit/${part.id}`));
}

export async function calPoints(part, doc, top, save, step) {
  const isRow = step === 2;
  const key = isRow ? 'y' : 'x';
  const field = isRow ? 'rows' : 'cols';
  const pair = part.cal[field] || { a: {}, b: {} };
  part.cal[field] = pair;
  let active = pair.a[key] === undefined ? 'a' : pair.b[key] === undefined ? 'b' : null;
  let grid = validPair(pair, key);
  app.innerHTML = `${top}
    <p class="lead">${isRow
      ? '<b>단 번호 칸</b>의 맨 아래와 맨 위를 기준으로 삼습니다.'
      : '<b>코 번호 칸</b>의 양 끝을 기준으로 삼습니다.'}
      글자로 된 도안은 자동으로 잡아 둡니다. 번호만 적어도 그 칸을 찾아가니, 꼭 찍지 않아도 됩니다.</p>
    <div class="cal-chart" id="chart"></div>
    <div class="tune" role="group" aria-label="격자 미세 조정">
      <span class="tune-l">미세 조정</span>
      <button type="button" class="btn" data-tune="shift-1" aria-label="${isRow ? '격자를 위로' : '격자를 왼쪽으로'}">${isRow ? '▲' : '◀'}</button>
      <button type="button" class="btn" data-tune="shift1" aria-label="${isRow ? '격자를 아래로' : '격자를 오른쪽으로'}">${isRow ? '▼' : '▶'}</button>
      <button type="button" class="btn" data-tune="scale-1">간격 −</button>
      <button type="button" class="btn" data-tune="scale1">간격 +</button>
    </div>
    <div class="pin-row">
      ${['a', 'b'].map((k) => `<div class="pin-col">
        <button type="button" class="pin-btn" data-pin="${k}"></button>
        <input class="input num" inputmode="numeric" pattern="[0-9]*" id="n-${k}" aria-label="${k.toUpperCase()} 지점의 ${isRow ? '단' : '코'} 번호" placeholder="${isRow ? '단' : '코'} 번호" value="${pair[k].n ?? ''}">
      </div>`).join('')}
    </div>
    <div class="result" id="result"></div>
    <button type="button" class="link-btn" id="auto" hidden>번호 칸 자동으로 다시 찾기</button>
    <div class="footer"><button type="button" class="btn" id="grid" aria-pressed="${grid}">격자 겹쳐 보기</button>
      <button type="button" class="btn primary" id="next">${isRow ? '다음: 코 번호' : (part.segIndex ?? 0) + 1 < segsOf(part).length ? `다음 구간 (${segsOf(part)[(part.segIndex ?? 0) + 1].page}쪽)` : '다음: 뜨는 방식'}</button></div>`;
  const resEl = app.querySelector('#result');
  const nextBtn = app.querySelector('#next');
  const unit = isRow ? '단' : '번';

  const decorate = (v) => {
    const [w, h] = v.size();
    let s = '';
    const lines = (pr, k, cls) => {
      if (!validPair(pr, k)) return;
      const ax = axis(pr, k);
      if (ax.hi - ax.lo > 600) return;
      for (let n = ax.lo; n <= ax.hi; n++) {
        for (const val of [ax.at(n) - ax.pitchAt(n) / 2, ax.at(n) + ax.pitchAt(n) / 2]) {
          if (k === 'y') s += `<i class="gl ${cls}" style="left:0;top:${v.n2p(0, val)[1]}px;width:${w}px;height:1px"></i>`;
          else s += `<i class="gl ${cls}" style="top:0;left:${v.n2p(val, 0)[0]}px;height:${h}px;width:1px"></i>`;
        }
      }
    };
    if (grid && !active) {
      lines(part.cal.rows, 'y', isRow ? '' : 'weak');
      if (!isRow) lines(part.cal.cols, 'x', '');
    }
    for (const k of ['a', 'b']) {
      const p = pair[k];
      if (p[key] === undefined) continue;
      const [px, py] = v.n2p(p.x ?? 0, p.y ?? 0);
      // 다시 찍을 점은 흐리게 해서 아래 칸이 보이게 한다
      const ghost = active === k ? ' ghost' : '';
      if (!ghost) {
        s += isRow
          ? `<i class="guide" style="left:0;top:${py}px;width:${w}px;height:2px"></i>`
          : `<i class="guide" style="top:0;left:${px}px;height:${h}px;width:2px"></i>`;
      }
      // 찍은 자리는 가운데가 빈 고리로, 글자 표시는 비켜서 그려 번호 칸을 가리지 않는다
      s += `<span class="pin-ring${ghost}" style="left:${px}px;top:${py}px"></span>`;
      s += `<span class="pin${ghost}" style="left:${px}px;top:${py}px">${k.toUpperCase()}</span>`;
    }
    return s;
  };

  const refresh = () => {
    for (const k of ['a', 'b']) {
      const b = app.querySelector(`[data-pin=${k}]`);
      const set = pair[k][key] !== undefined;
      b.setAttribute('aria-pressed', String(active === k));
      b.innerHTML = `<span class="pin-dot">${k.toUpperCase()}</span>${active === k ? '찍을 차례' : set ? '다시 찍기' : '찍기'}`;
    }
    cv.redraw();
    const ok = validPair(pair, key);
    nextBtn.disabled = !ok;
    if (ok) {
      const ax = axis(pair, key);
      const total = ax.hi - ax.lo + 1;
      const read = pair.table ? pair.table.length : 0;
      resEl.innerHTML = `${icon.check}<span>${ax.lo}${unit}부터 ${ax.hi}${unit}까지 <b>${total}${isRow ? '단' : '칸'}</b>` +
        (read ? ` · 번호 칸 ${read}개를 읽어 ${isRow ? '단' : '칸'}마다 위치를 맞췄습니다${read < total ? ' (나머지는 사이를 나눠 계산)' : ''}` : '으로 계산했습니다') + '</span>';
      resEl.className = 'result ok';
    } else {
      const missing = ['a', 'b'].filter((k) => pair[k][key] === undefined).map((k) => k.toUpperCase());
      resEl.textContent = missing.length
        ? `${missing.join(', ')} 지점을 차트에서 찍거나, 아래 칸에 번호를 적어주세요.`
        : '두 지점의 번호를 서로 다르게 적어주세요.';
      resEl.className = 'result';
    }
  };

  const cv = new ChartView(app.querySelector('#chart'), {
    doc, pageNum: part.page, area: part.cal.area, decorate,
    onTap: async (nx, ny) => {
      let k = active;
      if (!k) {
        // 두 점이 다 찍혀 있으면 더 가까운 점을 옮긴다
        const v = key === 'y' ? ny : nx;
        k = Math.abs(pair.a[key] - v) <= Math.abs(pair.b[key] - v) ? 'a' : 'b';
      }
      // PDF에 글자로 들어 있는 번호 칸을 찍었으면, 번호를 읽어 채우고 점을 칸 가운데에 맞춘다
      const hit = labels ? nearestLabel(labels, nx, ny) : null;
      pair[k].x = hit ? hit.cx : nx;
      pair[k].y = hit ? hit.cy : ny;
      if (hit) {
        pair[k].n = hit.n;
        app.querySelector(`#n-${k}`).value = String(hit.n);
      }
      pair[k].auto = !!hit;
      pair[k].est = false;
      pair[k].hw = hit ? hit.hw : undefined;
      pair[k].hh = hit ? hit.hh : undefined;
      pair.table = buildTable(labels, pair, key);
      const other = k === 'a' ? 'b' : 'a';
      active = pair[other][key] === undefined ? other : null;
      if (validPair(pair, key) && !grid) {
        grid = true;
        app.querySelector('#grid').setAttribute('aria-pressed', 'true');
      }
      await save();
      refresh();
      if (!hit) {
        toast('번호를 읽지 못했습니다. 아래 칸에 번호를 직접 적어주세요.');
        app.querySelector(`#n-${k}`).focus({ preventScroll: true });
      }
    },
  });
  window.__cv = cv;
  onCleanup(() => { cv.destroy(); if (window.__cv === cv) window.__cv = null; });
  await cv.init();
  const labels = await readNumberLabels(cv.page, part.cal.area);
  const autoBtn = app.querySelector('#auto');
  const runAuto = async () => {
    const found = autoDetect(labels, key);
    if (!found) return false;
    for (const [k, l] of [['a', found.lo], ['b', found.hi]]) {
      pair[k] = { x: l.cx, y: l.cy, n: l.n, auto: true, hw: l.hw, hh: l.hh };
      app.querySelector(`#n-${k}`).value = String(l.n);
    }
    pair.table = buildTable(labels, pair, key);
    active = null;
    grid = true;
    app.querySelector('#grid').setAttribute('aria-pressed', 'true');
    await save();
    refresh();
    const ax = axis(pair, key);
    cv.scrollTo(pair.b.x, pair.b.y, { x: 'center', yFrac: 0.3 });
    toast(`번호 칸을 자동으로 찾았습니다 (${ax.lo}~${ax.hi}). 빨간 선이 칸과 맞는지만 확인하세요.`, { ms: 4500 });
    return true;
  };
  if (labels) {
    autoBtn.hidden = false;
    autoBtn.addEventListener('click', async () => {
      if (!(await runAuto())) toast('번호 칸을 찾지 못했습니다. 직접 찍어주세요.');
    });
    if (!validPair(pair, key)) await runAuto();
  }
  app.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => { active = b.dataset.pin; refresh(); }));
  // 번호만 적어도 위치를 정한다: PDF에 그 번호 글자가 있으면 그 칸에, 없으면 영역 끝에 맞춰 대략 잡는다
  const placeByNumber = (k) => {
    const n = pair[k].n;
    if (!Number.isInteger(n)) return false;
    const other = pair[k === 'a' ? 'b' : 'a'];
    const cands = (labels || []).filter((l) => l.n === n);
    if (cands.length) {
      // 같은 번호가 여러 곳이면 다른 점과 같은 줄(단은 세로줄, 코는 가로줄)에 있는 것을 고른다
      const perp = key === 'y' ? 'x' : 'y';
      const ref = other[perp] ?? pair[k][perp];
      const l = ref === undefined ? cands[0]
        : cands.reduce((m, c) => (Math.abs(c['c' + perp] - ref) < Math.abs(m['c' + perp] - ref) ? c : m));
      pair[k] = { x: l.cx, y: l.cy, n, auto: true, hw: l.hw, hh: l.hh };
      pair.table = buildTable(labels, pair, key);
      return 'label';
    }
    // 글자로 된 번호가 없는 도안: 직접 찍은 점이 없을 때만 영역 끝에 맞춰 추정한다
    const est = (q) => q[key] === undefined || q.est;
    if (!est(pair.a) || !est(pair.b) || !Number.isInteger(other.n) || other.n === n) return false;
    const A = part.cal.area;
    const lo = Math.min(pair.a.n, pair.b.n), hi = Math.max(pair.a.n, pair.b.n);
    const cnt = hi - lo + 1;
    for (const q of [pair.a, pair.b]) {
      const t = (q.n - lo + 0.5) / cnt; // 0~1, 번호가 작은 쪽부터
      // 단: 1단이 아래, 코: 1번 칸이 오른쪽 (일반적인 기호 도안)
      if (key === 'y') { q.y = A.y + A.h * (1 - t); q.x = A.x + A.w - 0.01; }
      else { q.x = A.x + A.w * (1 - t); q.y = A.y + A.h - 0.01; }
      q.est = true;
      q.auto = false;
    }
    pair.table = null;
    return 'est';
  };
  const timers = {};
  for (const k of ['a', 'b']) {
    app.querySelector(`#n-${k}`).addEventListener('input', async (e) => {
      const v = parseInt(e.target.value.replace(/\D/g, ''), 10);
      pair[k].n = Number.isFinite(v) ? v : null;
      pair[k].auto = false;
      pair.table = null;
      clearTimeout(timers[k]);
      // 다 적을 때까지 잠깐 기다렸다가 자리를 찾는다
      timers[k] = setTimeout(async () => {
        const how = placeByNumber(k);
        if (how) {
          active = pair.a[key] === undefined ? 'a' : pair.b[key] === undefined ? 'b' : null;
          if (validPair(pair, key)) {
            grid = true;
            app.querySelector('#grid').setAttribute('aria-pressed', 'true');
          }
          if (how === 'est') toast('차트 영역 끝에 맞춰 대략 잡았습니다. 빨간 선을 보고 미세 조정으로 맞춰주세요.', { ms: 4500 });
        }
        await save();
        refresh();
        if (how === 'label') cv.scrollTo(pair[k].x, pair[k].y, { x: 'center', yFrac: 0.4, smooth: true });
      }, 600);
      await save();
      refresh();
    });
  }
  // 미세 조정: 격자 전체를 조금 옮기거나 간격을 조금 넓히고 좁힌다 (한 번에 칸 크기의 1/5)
  app.querySelectorAll('[data-tune]').forEach((bt) => bt.addEventListener('click', async () => {
    if (!validPair(pair, key)) { toast('먼저 두 지점을 정해주세요'); return; }
    const ax = axis(pair, key);
    const d = ax.pitch / 5;
    const t = bt.dataset.tune;
    const map = t.startsWith('shift')
      ? (v) => v + d * (t === 'shift1' ? 1 : -1)
      : (() => {
        const span = Math.abs(pair.b[key] - pair.a[key]) || 1;
        const s = 1 + (d / span) * (t === 'scale1' ? 1 : -1);
        const o = pair.a[key];
        return (v) => o + (v - o) * s;
      })();
    pair.a[key] = map(pair.a[key]);
    pair.b[key] = map(pair.b[key]);
    if (pair.table) pair.table = pair.table.map(([n, v]) => [n, map(v)]);
    grid = true;
    app.querySelector('#grid').setAttribute('aria-pressed', 'true');
    await save();
    refresh();
  }));
  app.querySelector('#grid').addEventListener('click', (e) => {
    grid = !grid;
    e.currentTarget.setAttribute('aria-pressed', String(grid));
    cv.redraw();
  });
  nextBtn.addEventListener('click', () => go(calNextUrl(part, step)));
  refresh();
}

export async function calMode(part, proj, top, save) {
  const R = rowsOf(part);
  const m = part.cal.mode || { type: 'flat', first: 'RS', repeat: null };
  const preview = () => {
    const tmp = { cal: { ...part.cal, mode: m } };
    const rows = [];
    for (let i = 3; i >= 0; i--) {
      const r = R.lo + i;
      if (r > R.hi) continue;
      const rs = isRightSide(tmp, { row: r, rep: 1 });
      rows.push(`<div class="pv-row"><span class="num">${r}단</span><span class="muted pv-side">${m.type === 'round' ? '' : rs ? '겉면' : '안면'}</span>
        <i class="pv-line"></i>${rs ? icon.left : icon.right}<span class="muted small">${rs ? '오른쪽에서 왼쪽' : '왼쪽에서 오른쪽'}</span></div>`);
    }
    return rows.join('');
  };
  const render = () => {
    app.innerHTML = `${top}<div class="page"><div class="wrap">
      <div class="field"><span class="label">어떻게 뜨나요?</span>
        <div class="seg"><button type="button" data-type="flat" aria-pressed="${m.type === 'flat'}">평면뜨기</button><button type="button" data-type="round" aria-pressed="${m.type === 'round'}">원통뜨기</button></div>
        <span class="hint">평면은 단마다 읽는 방향이 바뀌고, 원통은 항상 같은 방향입니다</span></div>
      ${m.type === 'flat' ? `<div class="field"><span class="label">첫 단(${R.lo}단)은 어느 면인가요?</span>
        <div class="seg"><button type="button" data-first="RS" aria-pressed="${m.first !== 'WS'}">겉면</button><button type="button" data-first="WS" aria-pressed="${m.first === 'WS'}">안면</button></div></div>` : ''}
      <div class="field"><span class="label">이렇게 읽게 됩니다</span><div class="card flush">${preview()}</div></div>
    </div></div>
    <div class="footer"><button type="button" class="btn" id="list">저장하고 목록으로</button><button type="button" class="btn primary" id="start">완료하고 뜨기 시작</button></div>`;
    app.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { m.type = b.dataset.type; render(); }));
    app.querySelectorAll('[data-first]').forEach((b) => b.addEventListener('click', () => { m.first = b.dataset.first; render(); }));
    const finish = async (dest) => {
      part.cal.mode = { ...m };
      if (!part.progress) part.progress = startProgress(part);
      const R2 = rowsOf(part);
      part.progress.row = clamp(part.progress.row, R2.lo, R2.hi);
      await save();
      go(dest);
    };
    app.querySelector('#list').addEventListener('click', () => finish(`#/p/${proj.id}`));
    app.querySelector('#start').addEventListener('click', () => finish(`#/k/${part.id}`));
  };
  render();
}

// A·B: 시작 사슬 줄 양 끝 (원형이면 가운데 한 점), C: 마지막 단의 바깥 테두리
export async function calCirc(part, proj, doc) {
  const sg = segsOf(part)[0];
  const ring = sg.ring || { n: null, off: 0, gap: 1 };
  sg.ring = ring;
  const sz = await pageSize(doc, sg.page);
  const PINS = ['a', 'b', 'c'];
  let active = PINS.find((k) => !ring[k]) || null;
  const top = header(calUrl(part.id, 1, 0), '격자 맞추기', `${esc(part.name)} · ${sg.page}쪽`) + stepsHtml(2, ['영역', '단 맞추기']);
  app.innerHTML = `${top}
    <p class="lead" id="lead"></p>
    <div class="cal-chart" id="chart"></div>
    <div class="tune" role="group" aria-label="고리 미세 조정">
      <span class="tune-l">미세 조정</span>
      <button type="button" class="btn" data-tune="off-1" aria-label="고리를 안쪽으로">안쪽</button>
      <button type="button" class="btn" data-tune="off1" aria-label="고리를 바깥쪽으로">바깥</button>
      <button type="button" class="btn" data-tune="gap-1">간격 −</button>
      <button type="button" class="btn" data-tune="gap1">간격 +</button>
    </div>
    <div class="pin-row">${PINS.map((k) => `<div class="pin-col"><button type="button" class="pin-btn" data-pin="${k}"></button></div>`).join('')}</div>
    <div class="pin-row circ-n"><label for="ring-n">C는 몇 단의 바깥 테두리?</label>
      <input class="input num" id="ring-n" inputmode="numeric" pattern="[0-9]*" placeholder="단" value="${ring.n ?? ''}"><span>단</span></div>
    <div class="result" id="result"></div>
    <div class="footer"><button type="button" class="btn" id="list">저장하고 목록으로</button><button type="button" class="btn primary" id="next">완료하고 뜨기 시작</button></div>`;
  const resEl = app.querySelector('#result');
  const nextBtn = app.querySelector('#next');
  const lead = app.querySelector('#lead');
  const save = async () => { part.updated = Date.now(); await db.put('parts', part); };
  const tip = {
    a: '<b>A</b>: 시작 사슬 줄의 <b>한쪽 끝</b>을 찍으세요. 원형(매직링)이면 <b>가운데</b>를 찍으세요.',
    b: '<b>B</b>: 시작 사슬 줄의 <b>다른 쪽 끝</b>을 찍으세요. 원형이면 <b>A를 한 번 더</b> 찍으세요.',
    c: '<b>C</b>: <b>마지막 단의 바깥 테두리</b> 한 곳을 찍고, 아래에 그 단 번호를 적으세요.',
  };

  const decorate = (v) => {
    let h = '';
    const [w, ht] = v.size();
    if (validRing(ring)) {
      const g = ringOnView(ring, v, sz.w, sz.h);
      let paths = `<path d="${stadium(g.Apx, g.Bpx, Math.max(1.5, g.rpx(0)))}" class="rg-start"/>`;
      if (ring.n <= 200) for (let k = 1; k <= ring.n; k++) paths += `<path d="${stadium(g.Apx, g.Bpx, g.rpx(k))}" class="rg"/>`;
      h += `<svg class="ring-ov" width="${w}" height="${ht}">${paths}</svg>`;
    }
    for (const k of PINS) {
      const q = ring[k];
      if (!q) continue;
      const [px, py] = v.n2p(q.x, q.y);
      const ghost = active === k ? ' ghost' : '';
      h += `<span class="pin-ring${ghost}" style="left:${px}px;top:${py}px"></span><span class="pin${ghost}" style="left:${px}px;top:${py}px">${k.toUpperCase()}</span>`;
    }
    return h;
  };
  const refresh = () => {
    for (const k of PINS) {
      const b = app.querySelector(`[data-pin=${k}]`);
      b.setAttribute('aria-pressed', String(active === k));
      b.innerHTML = `<span class="pin-dot">${k.toUpperCase()}</span>${active === k ? '찍을 차례' : ring[k] ? '다시 찍기' : '찍기'}`;
    }
    lead.innerHTML = active ? tip[active] : '빨간 고리가 각 단의 바깥 테두리와 맞는지 보세요. 어긋나면 미세 조정으로 맞추고, 점을 다시 찍어도 됩니다.';
    cv.redraw();
    const ok = validRing(ring);
    nextBtn.disabled = !ok;
    if (ok) {
      const circle = Math.hypot((ring.a.x - ring.b.x) * sz.w, (ring.a.y - ring.b.y) * sz.h) < 2;
      resEl.innerHTML = `${icon.check}<span>${circle ? '원형' : '타원형'} · 1단부터 ${ring.n}단까지 <b>${ring.n}단</b></span>`;
      resEl.className = 'result ok';
    } else {
      const miss = PINS.filter((k) => !ring[k]).map((k) => k.toUpperCase());
      resEl.textContent = miss.length ? `${miss.join(', ')} 지점을 찍어주세요.` : 'C가 몇 단의 테두리인지 적어주세요.';
      resEl.className = 'result';
    }
  };
  const cv = new ChartView(app.querySelector('#chart'), {
    doc, pageNum: sg.page, area: sg.area, decorate,
    onTap: async (nx, ny) => {
      let k = active;
      if (!k) {
        // 다 찍혀 있으면 가장 가까운 점을 옮긴다
        const d = (q) => Math.hypot((q.x - nx) * sz.w, (q.y - ny) * sz.h);
        k = PINS.reduce((m, x) => (d(ring[x]) < d(ring[m]) ? x : m), 'a');
      }
      let pt = { x: nx, y: ny };
      // B를 A 바로 옆에 찍으면 원형으로 보고 A와 같은 자리로
      if (k === 'b' && ring.a) {
        const px = Math.hypot((ring.a.x - nx) * sz.w, (ring.a.y - ny) * sz.h) * cv.s;
        if (px < 22) pt = { ...ring.a };
      }
      ring[k] = pt;
      active = PINS.find((x) => !ring[x]) || null;
      if (k === 'c' && !ring.n) app.querySelector('#ring-n').focus();
      await save();
      refresh();
    },
  });
  window.__cv = cv;
  onCleanup(() => { cv.destroy(); if (window.__cv === cv) window.__cv = null; });
  await cv.init();
  app.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => {
    active = active === b.dataset.pin ? null : b.dataset.pin;
    refresh();
  }));
  app.querySelector('#ring-n').addEventListener('input', async (e) => {
    const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
    ring.n = Number.isInteger(n) && n > 0 ? n : null;
    await save();
    refresh();
  });
  app.querySelectorAll('[data-tune]').forEach((b) => b.addEventListener('click', async () => {
    if (!validRing(ring)) return;
    const t = b.dataset.tune;
    if (t.startsWith('off')) ring.off = +((ring.off || 0) + (t === 'off1' ? 0.1 : -0.1)).toFixed(2);
    else ring.gap = +Math.max(0.2, (ring.gap || 1) * (t === 'gap1' ? 1.02 : 1 / 1.02)).toFixed(4);
    await save();
    refresh();
  }));
  const finish = async (dest) => {
    if (!part.progress) part.progress = startProgress(part);
    part.progress.row = clamp(part.progress.row, 1, ring.n);
    await save();
    go(dest);
  };
  app.querySelector('#list').addEventListener('click', () => finish(`#/p/${part.projectId}`));
  nextBtn.addEventListener('click', () => finish(`#/k/${part.id}`));
  refresh();
}

export async function viewTextSetup(id, segStr) {
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  const proj = await db.get('projects', part.projectId);
  const doc = await loadPdf(proj.fileId);
  part.text = part.text || { goal: null };
  const segs = segsOf(part);
  const si = clamp(+(segStr || 0), 0, segs.length - 1);
  const sg = segs[si];
  const last = si === segs.length - 1;
  const page = sg.page;
  // 영역을 따로 안 그려도 넘어갈 수 있게 처음에는 페이지 전체로 둔다
  const A = sg.area ? { ...sg.area } : { x: 0.03, y: 0.03, w: 0.94, h: 0.94 };
  const back = si > 0 ? `#/txt/${id}/${si - 1}` : `#/p/${proj.id}`;
  app.innerHTML = `${header(back, part.name, `글 설명 · ${page}쪽${segs.length > 1 ? ` · 구간 ${si + 1}/${segs.length}` : ''}`)}
    ${segChips(part, si, (x) => !!x.area)}
    <p class="lead">${segs.length > 1
      ? `${page}쪽에서 <b>이 파트에 해당하는 설명만</b> 사각형으로 감싸주세요. 같은 페이지의 나머지는 다른 파트가 쓸 수 있습니다.`
      : '뜨면서 볼 <b>설명 부분을 사각형으로</b> 감싸주세요. 그대로 두면 페이지 전체를 봅니다.'}</p>
    <div class="pv-box" id="pv"></div>
    ${last ? `<div class="pin-row"><div class="pin-col">
      <label for="goal" class="label">목표 단수 (선택)</label>
      <div class="suffix"><input id="goal" class="input num" inputmode="numeric" placeholder="정해진 단수가 없으면 비워두세요" value="${part.text.goal ?? ''}"><span>단</span></div>
    </div></div>` : ''}
    <button type="button" class="link-btn" id="pg">페이지 다시 고르기</button>
    <div class="footer"><button type="button" class="btn" id="list">저장하고 목록으로</button>${last
      ? '<button type="button" class="btn primary" id="start">완료하고 뜨기 시작</button>'
      : `<button type="button" class="btn primary" id="start">다음 구간 (${segs[si + 1].page}쪽)</button>`}</div>`;
  const picker = rectPicker(app.querySelector('#pv'), doc, { page, area: A });
  onCleanup(() => picker.destroy());
  await picker.layout();
  const finish = async (dest) => {
    sg.area = picker.area();
    const gi = app.querySelector('#goal');
    if (gi) {
      const g = parseInt(gi.value.replace(/\D/g, ''), 10);
      part.text.goal = Number.isFinite(g) && g > 0 ? g : null;
    }
    part.kind = 'text';
    if (!part.progress) part.progress = { row: 1, line: null, done: false };
    part.updated = Date.now();
    await db.put('parts', part);
    go(dest);
  };
  app.querySelector('#list').addEventListener('click', () => finish(`#/p/${proj.id}`));
  app.querySelector('#start').addEventListener('click', () => finish(last ? `#/k/${part.id}` : `#/txt/${part.id}/${si + 1}`));
  app.querySelector('#pg').addEventListener('click', async () => {
    sg.area = picker.area(); // 지금 잡던 영역은 남겨 두고 이동
    await db.put('parts', part);
    go(`#/pedit/${part.id}`);
  });
}
