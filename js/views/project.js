// 작품 화면(파트 목록), 내 사이즈, 파트 추가·고치기
import * as db from '../db.js';
import { loadPdf, renderPage } from '../pdf.js';
import { esc, icon, toast, dialog, ask, sheet } from '../ui.js';
import { calibrated, rowsOf, partStatus, isText, segsOf, segReady, kindOf } from '../model/knitting.js';
import { findSizeInfo } from '../model/sizes.js';
import { app, go, clamp, onCleanup, route, header } from '../core.js';
import { partMeta, partHref, calUrl } from '../partnav.js';
import { removeProject } from './home.js';
import { infoCard } from './info.js';
import { memosOf, memoList } from '../sheets/memo.js';
import { previewPage, openDoc } from '../sheets/dialogs.js';

export async function viewProject(pid) {
  const proj = await db.get('projects', pid);
  if (!proj) return go('#/');
  const parts = await db.partsOf(pid);
  const rows = parts.map((x, i) => {
    const st = partStatus(x);
    const badge =
      st === 'done' ? `<span class="tag-done">${icon.check}완료</span>`
      : st === 'active' ? `<span class="num pill-hl">${x.progress.row}단</span>`
      : st === 'setup' ? `<span class="tag-red">${isText(x) ? '영역 지정' : '격자 맞추기'}</span>`
      : '<span class="muted small">시작 전</span>';
    return `<div class="part-row${st === 'active' || x.id === proj.lastPartId ? ' is-cur' : ''}${st === 'setup' ? ' is-setup' : ''}">
      <a class="part-main" href="${partHref(x)}"><span class="num part-no">${i + 1}</span>
        <span class="part-t"><span class="part-name">${esc(x.name)}</span><span class="part-meta">${partMeta(x)}</span></span>${badge}</a>
      <button type="button" class="icon-btn" data-more="${x.id}" aria-label="${esc(x.name)} 설정">${icon.more}</button></div>`;
  });
  app.innerHTML = `${header('#/', proj.name, `${proj.size ? `사이즈 ${esc(proj.size)} · ` : ''}PDF ${proj.pages}쪽`,
      `<button type="button" class="icon-btn" id="pmore" aria-label="작품 설정">${icon.more}</button>`)}
    <div class="page"><div class="wrap">
      <button type="button" class="btn" id="doc">도안 보기</button>
      ${infoCard(proj)}
      <div class="label">뜨는 순서</div>
      ${rows.join('') || '<p class="hint">아직 파트가 없습니다. 뜨는 순서대로 파트를 추가하세요.</p>'}
      <a class="btn dashed" href="#/padd/${pid}">${icon.plus}파트 추가</a>
    </div></div>`;
  app.querySelector('#doc').addEventListener('click', async () => openDoc(await loadPdf(proj.fileId)));
  app.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => partActions(b.dataset.more, proj, parts)));
  app.querySelector('#pmore').addEventListener('click', async () => {
    const v = await sheet(proj.name, [
      { label: '작품 이름 바꾸기', value: 'rename' },
      { label: '내 사이즈 (글 설명에서 내 사이즈 숫자 강조)', value: 'size' },
      { label: '작품 정보 (실·바늘·게이지·날짜·메모)', value: 'info' },
      { label: '작품 삭제', value: 'delete', danger: true },
    ]);
    if (v === 'info') return go(`#/info/${proj.id}`);
    if (v === 'rename') {
      const n = await ask('작품 이름', proj.name);
      if (n) { proj.name = n; await db.put('projects', proj); route(); }
    } else if (v === 'size') {
      if (await sizeSheet(proj)) route();
    } else if (v === 'delete') {
      const ok = await dialog({
        title: `${esc(proj.name)} 삭제`,
        body: '도안 PDF와 모든 파트, 진행 기록이 이 기기에서 지워집니다. 되돌릴 수 없습니다.',
        buttons: [{ label: '취소', value: false }, { label: '삭제', value: true, danger: true }],
      });
      if (!ok) return;
      await removeProject(proj);
      go('#/');
    }
  });
}

export const ORD = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟'];

export function sizeOrdinal(i, n) {
  if (n === 3 && i === 1) return '괄호 안 숫자';
  return `${ORD[i] || i + 1} 번째 숫자`;
}

// 도안의 사이즈 표기를 보여 주고 내 사이즈(몇 번째 숫자인지)를 고른다. 저장하면 true
export async function sizeSheet(proj) {
  const doc = await loadPdf(proj.fileId);
  const wait = toast('도안에서 사이즈 표기를 찾는 중…', { ms: 8000 });
  const info = await findSizeInfo(doc);
  wait?.remove?.();
  const cur = proj.sizes || {};
  let idx = Number.isInteger(cur.idx) && cur.idx < info.n ? cur.idx : null;
  let dim = cur.dim !== false;
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'scrim sheet-scrim';
    const exHtml = () => info.examples.map((ex) => `<div>${esc(ex.before)}${ex.values.map((v, j) =>
      `<span class="${j === idx ? 'sz-pv-on' : idx !== null && dim ? 'sz-pv-dim' : ''}">${esc(v)}</span>`).join(' ')}${esc(ex.after)}</div>`).join('');
    const pickHtml = () => Array.from({ length: info.n }, (_, i) =>
      `<button type="button" class="sz-pick" data-i="${i}" aria-pressed="${i === idx}"><b>${esc(info.labels?.[i] ?? String(i + 1))}</b><small>${sizeOrdinal(i, info.n)}</small></button>`).join('');
    el.innerHTML = `<div class="sheet size-sheet" role="dialog" aria-modal="true">
      <div class="sheet-title">내 사이즈</div>
      ${info.n ? `
        ${info.labels ? `<div class="label">도안에서 찾은 사이즈 표기 (${info.labelPage}쪽)</div>
          <div class="sz-found">${info.labelLines.map(esc).join('<br>')}</div>` : ''}
        <div class="label">뜨는 사이즈를 고르세요</div>
        <div class="sz-picks" style="grid-template-columns:repeat(${Math.min(info.n, 4)},1fr)">${pickHtml()}</div>
        ${info.examples.length ? `<div class="label">미리보기</div><div class="sz-found sz-ex">${exHtml()}</div>` : ''}
        <label class="sz-tog"><span>다른 사이즈 숫자는 흐리게</span><input type="checkbox" id="szdim" ${dim ? 'checked' : ''}></label>`
      : '<p class="small muted">이 도안에서는 "36 (39) 43"처럼 사이즈별로 나열된 숫자를 찾지 못했어요. 사이즈 이름만 적어 둘 수 있습니다.</p>'}
      <div class="field"><label for="szname">사이즈 이름 (선택)</label><input id="szname" class="input" autocomplete="off" placeholder="예: M" value="${esc(proj.size || '')}"></div>
      <div class="dialog-btns">${cur.idx !== undefined ? '<button type="button" class="btn" data-off>강조 끄기</button>' : '<button type="button" class="btn" data-x>취소</button>'}<button type="button" class="btn primary" data-ok>저장</button></div>
    </div>`;
    const redraw = () => {
      el.querySelectorAll('.sz-pick').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === idx)));
      const ex = el.querySelector('.sz-ex');
      if (ex) ex.innerHTML = exHtml();
    };
    const done = async (save, off) => {
      if (save) {
        proj.size = el.querySelector('#szname').value.trim();
        if (off) delete proj.sizes;
        else if (idx !== null) proj.sizes = { idx, n: info.n, labels: info.labels, dim };
        proj.updated = Date.now();
        await db.put('projects', proj);
      }
      el.remove();
      resolve(save);
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.sz-pick');
      if (b) {
        idx = +b.dataset.i;
        if (!el.querySelector('#szname').value.trim() && info.labels) el.querySelector('#szname').value = info.labels[idx];
        redraw();
      } else if (e.target.closest('[data-ok]')) done(true);
      else if (e.target.closest('[data-off]')) done(true, true);
      else if (e.target.closest('[data-x]') || e.target === el) done(false);
    });
    el.querySelector('#szdim')?.addEventListener('change', (e) => { dim = e.target.checked; redraw(); });
    document.getElementById('layer').appendChild(el);
  });
}

export async function partActions(id, proj, parts) {
  const part = parts.find((x) => x.id === id);
  const i = parts.indexOf(part);
  const v = await sheet(part.name, [
    { label: isText(part) ? '설명 영역·목표 단수 고치기' : '격자 다시 맞추기', value: 'cal' },
    { label: '이름·형태·페이지 고치기', value: 'edit' },
    { label: memosOf(part).length ? `단 메모 (${memosOf(part).length}개)` : '단 메모 달기', value: 'memos' },
    { label: '복제 (왼팔·오른팔처럼 같은 차트를 한 번 더)', value: 'dup' },
    ...(i > 0 ? [{ label: '위로 옮기기', value: 'up' }] : []),
    ...(i < parts.length - 1 ? [{ label: '아래로 옮기기', value: 'down' }] : []),
    ...(part.progress ? [{ label: '진행 위치를 처음으로', value: 'reset' }] : []),
    { label: '파트 삭제', value: 'delete', danger: true },
  ]);
  if (!v) return;
  if (v === 'cal') return go(isText(part) ? `#/txt/${id}/0` : calUrl(id, 1, 0));
  if (v === 'edit') return go(`#/pedit/${id}`);
  if (v === 'memos') { await memoList(part, false, part.progress?.row || 1); return route(); }
  if (v === 'dup') {
    const n = await ask('새 파트 이름', part.name + ' 2', { label: '같은 격자 설정을 쓰고, 진행 위치는 처음부터 시작합니다' });
    if (!n) return;
    const copy = JSON.parse(JSON.stringify(part));
    copy.id = db.uid();
    copy.name = n;
    copy.progress = null;
    for (const x of parts.slice(i + 1)) { x.order += 1; await db.put('parts', x); }
    copy.order = part.order + 1;
    await db.put('parts', copy);
  } else if (v === 'up' || v === 'down') {
    const other = parts[v === 'up' ? i - 1 : i + 1];
    [part.order, other.order] = [other.order, part.order];
    await db.put('parts', part);
    await db.put('parts', other);
  } else if (v === 'reset') {
    const ok = await dialog({
      title: '진행 위치를 처음으로',
      body: `${esc(part.name)}의 현재 단과 코 표시를 지우고 첫 단부터 시작합니다.`,
      buttons: [{ label: '취소', value: false }, { label: '처음으로', value: true, primary: true }],
    });
    if (!ok) return;
    part.progress = null;
    await db.put('parts', part);
  } else if (v === 'delete') {
    const ok = await dialog({
      title: `${esc(part.name)} 삭제`,
      body: '격자 설정과 진행 기록이 지워집니다. 되돌릴 수 없습니다.',
      buttons: [{ label: '취소', value: false }, { label: '삭제', value: true, danger: true }],
    });
    if (!ok) return;
    await db.del('parts', id);
    if (proj.lastPartId === id) { proj.lastPartId = null; await db.put('projects', proj); }
  }
  route();
}

export function viewPartAdd(pid) {
  return partForm(pid, null);
}

export async function viewPartEdit(id) {
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  return partForm(part.projectId, part);
}

// 파트 추가와 고치기는 같은 화면을 쓴다 (이름·형태·페이지 여러 장)
export async function partForm(pid, editing) {
  const proj = await db.get('projects', pid);
  if (!proj) return go('#/');
  const parts = await db.partsOf(pid);
  const doc = await loadPdf(proj.fileId);
  const pages = editing ? segsOf(editing).map((x) => x.page) : []; // 고른 순서대로
  app.innerHTML = `${header(`#/p/${pid}`, editing ? '파트 고치기' : '파트 추가', `${esc(proj.name)}${proj.size ? ` · 사이즈 ${esc(proj.size)}` : ''}`)}
    <div class="page"><div class="wrap">
      <div class="field"><label for="ptname">파트 이름</label><input id="ptname" class="input" autocomplete="off" placeholder="예: 뒷판" value="${esc(editing?.name || '')}"></div>
      <div class="field"><span class="label">도안 형태</span>
        <div class="seg"><button type="button" data-kind="chart" aria-pressed="true">기호 차트</button><button type="button" data-kind="circ" aria-pressed="false">원형 차트</button><button type="button" data-kind="text" aria-pressed="false">글 설명만</button></div></div>
      <div class="label" id="pagelabel">차트가 있는 페이지를 고르세요</div>
      <p class="hint">페이지를 탭하면 크게 보고 고를 수 있습니다. 다음 쪽으로 이어지면 <b>순서대로 여러 장</b> 고르세요. 고른 페이지를 다시 누르면 빠집니다.${editing ? ' 그대로 둔 페이지는 영역·격자 설정이 유지됩니다.' : ''}</p>
      <div class="pick-order" id="order" hidden></div>
      <div class="thumbs" id="thumbs">${Array.from({ length: doc.numPages }, (_, i) =>
        `<button type="button" class="thumb" data-p="${i + 1}" aria-pressed="false"><span class="thumb-img"><canvas></canvas></span><span class="num">${i + 1}쪽</span></button>`).join('')}</div>
    </div></div>
    <div class="footer"><button class="btn primary" id="next" disabled>다음: 영역 지정</button></div>`;
  const nameIn = app.querySelector('#ptname');
  const nextBtn = app.querySelector('#next');
  let kind = editing ? kindOf(editing) : 'chart';
  const setKind = (k) => {
    kind = k;
    app.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.kind === k)));
    app.querySelector('#pagelabel').textContent = kind === 'text' ? '설명이 있는 페이지를 고르세요'
      : kind === 'circ' ? '원형 차트가 있는 페이지를 고르세요 (한 장)' : '차트가 있는 페이지를 고르세요';
    // 원형 차트는 한 페이지만 쓴다
    if (kind === 'circ' && pages.length > 1) pages.splice(1);
  };
  app.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    setKind(b.dataset.kind);
    check();
  }));
  // 고치기에서 더 설정할 게 남는지: 새 페이지가 있거나 형태가 바뀌면 설정 화면으로 이어간다
  const needsSetup = () => !editing || kind !== kindOf(editing) ||
    pages.some((pg) => !segsOf(editing).some((x) => x.page === pg && segReady(editing, x))) || !calibrated(editing);
  const check = () => {
    nextBtn.disabled = !(nameIn.value.trim() && pages.length);
    const base = !needsSetup() ? '저장' : kind === 'text' ? '다음: 설명 영역' : '다음: 영역 지정';
    nextBtn.textContent = pages.length > 1 && needsSetup() ? `${base} (구간 ${pages.length}개)` : base;
    app.querySelectorAll('.thumb').forEach((t) => {
      const k = pages.indexOf(+t.dataset.p);
      t.setAttribute('aria-pressed', String(k >= 0));
      t.querySelector('.thumb-badge')?.remove();
      if (k >= 0) t.querySelector('.thumb-img').insertAdjacentHTML('beforeend', `<span class="thumb-badge num">${k + 1}</span>`);
    });
    const ord = app.querySelector('#order');
    ord.hidden = pages.length < 2;
    ord.innerHTML = `<span class="muted small">고른 순서</span>${pages.map((p) => `<span class="chip ok">${p}쪽</span>`).join('<span class="muted">→</span>')}`;
  };
  nameIn.addEventListener('input', check);
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (!e.isIntersecting || e.target.dataset.r) continue;
      e.target.dataset.r = '1';
      renderPage(doc, +e.target.dataset.p, e.target.querySelector('canvas'), 96).catch(() => {});
    }
  }, { rootMargin: '300px' });
  onCleanup(() => io.disconnect());
  app.querySelectorAll('.thumb').forEach((t) => {
    io.observe(t);
    t.addEventListener('click', async () => {
      const p = +t.dataset.p;
      if (pages.includes(p)) {
        pages.splice(pages.indexOf(p), 1);
        check();
        return;
      }
      const ok = await previewPage(doc, p, pages.length && kind !== 'circ' ? `${pages.length + 1}번째로 고르기` : '이 페이지로 고르기');
      if (!ok) return;
      if (kind === 'circ') pages.length = 0;
      pages.push(p);
      check();
      if (!nameIn.value.trim()) nameIn.focus();
    });
  });
  const blank = (pg) => (kind === 'text' ? { page: pg, area: null } : kind === 'circ' ? { page: pg, area: null, ring: null }
    : { page: pg, area: null, rows: null, cols: null });
  nextBtn.addEventListener('click', async () => {
    if (!editing) {
      const part = {
        id: db.uid(), projectId: pid, name: nameIn.value.trim(), page: pages[0],
        order: parts.length ? parts[parts.length - 1].order + 1 : 0, cal: {}, progress: null, created: Date.now(),
        kind, segs: pages.map(blank),
      };
      if (kind === 'text') part.text = { goal: null };
      await db.put('parts', part);
      return location.replace(partHref(part));
    }
    const part = editing;
    const oldKind = kindOf(part);
    if (kind !== oldKind) {
      const ok = await dialog({
        title: '도안 형태 바꾸기',
        body: `${{ text: '글 설명', circ: '원형 차트', chart: '기호 차트' }[kind]}로 바꾸면 ${oldKind !== 'text' ? '격자 설정과 ' : ''}진행 위치가 처음으로 돌아갑니다. 영역은 그대로 둡니다.`,
        buttons: [{ label: '취소', value: false }, { label: '바꾸기', value: true, primary: true }],
      });
      if (!ok) return;
    }
    // 그대로 남은 페이지는 기존 구간(영역·격자)을 다시 쓰고, 새 페이지만 빈 구간으로 만든다
    const old = segsOf(part);
    const used = new Map(); // 예전 구간 번호 → 새 구간 번호
    const segs = pages.map((pg, ni) => {
      const j = old.findIndex((x, k) => !used.has(k) && x.page === pg);
      if (j < 0) return blank(pg);
      used.set(j, ni);
      const x = { ...old[j] };
      if (kind === oldKind) return x;
      return { ...blank(x.page), area: x.area };
    });
    part.name = nameIn.value.trim();
    part.segs = segs;
    part.page = pages[0];
    if (kind !== oldKind) {
      part.kind = kind;
      part.cal = {};
      part.progress = null;
      if (kind === 'text') part.text = { goal: part.text?.goal ?? null };
    } else if (part.progress) {
      const L = part.progress.line;
      if (L) {
        const ni = used.get(L.seg ?? 0);
        part.progress.line = ni === undefined ? null : { ...L, seg: ni };
      }
      if (kind === 'chart' && calibrated(part)) {
        const R = rowsOf(part);
        part.progress.row = clamp(part.progress.row, R.lo, R.hi);
      }
    }
    part.updated = Date.now();
    await db.put('parts', part);
    if (calibrated(part)) {
      toast('파트를 고쳤습니다');
      return go(`#/p/${pid}`);
    }
    go(partHref(part));
  });
  setKind(kind);
  check();
}
