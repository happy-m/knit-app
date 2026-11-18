import * as db from './db.js';
import { loadPdf, openPdfData, renderPage, pageSize, forgetPdf } from './pdf.js';
import { ChartView } from './chartview.js';
import { esc, icon, ro, eul, toast, dialog, ask, sheet, clearLayer } from './ui.js';
import {
  calibrated, validPair, axis, rowsOf, colsOf, startProgress, knitIndex, isRightSide,
  repeatTotal, nextRow, prevRow, jumpTo, partStatus, isText,
} from './knitting.js';

const APP_VERSION = 14;
const app = document.getElementById('app');
const go = (h) => { location.hash = h; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let cleanups = [];
const onCleanup = (fn) => cleanups.push(fn);
let pending = null; // 새 작품으로 고른 PDF (작품을 만들기 전까지 메모리에만 둔다)

// ---------- 라우터 ----------
const routes = [
  [/^#\/?$/, viewHome],
  [/^#\/new$/, viewNew],
  [/^#\/p\/([\w-]+)$/, viewProject],
  [/^#\/padd\/([\w-]+)$/, viewPartAdd],
  [/^#\/cal\/([\w-]+)\/([1-4])$/, viewCal],
  [/^#\/k\/([\w-]+)$/, viewKnit],
  [/^#\/txt\/([\w-]+)$/, viewTextSetup],
];

async function route() {
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

function header(back, title, sub = '', right = '') {
  return `<div class="head">
    <a class="icon-btn" href="${back}" aria-label="뒤로">${icon.back}</a>
    <div class="head-t"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</div>`;
}

function partMeta(part) {
  if (isText(part)) return `글 설명 · ${part.page}쪽${part.text?.goal ? ` · 목표 ${part.text.goal}단` : ''}`;
  if (!calibrated(part)) return `${part.page}쪽 · 설정 중`;
  const R = rowsOf(part);
  const m = part.cal.mode;
  const rep = repeatTotal(part);
  return `${m.type === 'round' ? '원통' : '평면'} · ${R.lo}~${R.hi}단 · ${part.page}쪽` +
    (rep !== null ? ` · ${rep === 0 ? '계속' : rep + '회'} 반복` : '');
}

function partHref(part) {
  if (isText(part)) return calibrated(part) ? `#/k/${part.id}` : `#/txt/${part.id}`;
  return calibrated(part) ? `#/k/${part.id}` : `#/cal/${part.id}/1`;
}

function currentPart(proj, parts) {
  return parts.find((x) => x.id === proj.lastPartId) || parts.find((x) => partStatus(x) !== 'done') || parts[0];
}

// ---------- 1. 작품 목록 ----------
async function viewHome() {
  const projects = (await db.all('projects')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const cards = [];
  for (const p of projects) {
    const parts = await db.partsOf(p.id);
    const done = parts.filter((x) => partStatus(x) === 'done').length;
    const cur = currentPart(p, parts);
    let curHtml = '<span class="muted">아직 파트가 없습니다</span>';
    if (cur) {
      const st = partStatus(cur);
      const badge =
        st === 'setup' ? '<span class="tag-red">격자 맞추기 필요</span>'
        : st === 'done' ? `<span class="tag-done">${icon.check}완료</span>`
        : isText(cur)
          ? `<span class="num pill-hl">${cur.progress?.row ?? 1}단</span>${cur.text.goal ? `<span class="num muted">/ ${cur.text.goal}단</span>` : ''}`
          : `<span class="num pill-hl">${cur.progress?.row ?? rowsOf(cur).lo}단</span><span class="num muted">/ ${rowsOf(cur).hi}단</span>`;
      curHtml = `<span class="cur-name">${esc(cur.name)}</span>${badge}`;
    }
    const resume = cur ? partHref(cur) : `#/padd/${p.id}`;
    cards.push(`<div class="card proj">
      <div class="proj-head"><h2>${esc(p.name)}</h2>${p.size ? `<span class="muted">사이즈 ${esc(p.size)}</span>` : ''}</div>
      <div class="proj-cur"><div class="label">지금 뜨는 파트</div><div class="cur-line">${curHtml}</div></div>
      <div class="bar"><i style="width:${parts.length ? (done / parts.length) * 100 : 0}%"></i></div>
      <div class="muted small">파트 ${parts.length}개 중 ${done}개 완료</div>
      <a class="btn primary" href="${resume}">${cur ? '이어서 뜨기' : '파트 추가하기'}</a>
      <a class="link-btn" href="#/p/${p.id}">파트 목록 보기</a>
    </div>`);
  }
  app.innerHTML = `
    <div class="head home-head"><h1 class="big-title">내 작품</h1>
      <label class="btn primary small">${icon.plus}새 작품<input type="file" accept="application/pdf,.pdf" hidden></label></div>
    <div class="page"><div class="wrap">
      ${cards.join('')}
      <label class="empty-card"><input type="file" accept="application/pdf,.pdf" hidden>
        <b>도안 PDF로 새 작품 만들기</b><span>파일 앱에서 PDF를 고르면 폰 안에 저장됩니다</span></label>
      <p class="hint center">도안과 기록은 이 기기 안에만 저장됩니다. · 버전 ${APP_VERSION}</p>
    </div></div>`;
  app.querySelectorAll('input[type=file]').forEach((inp) =>
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      inp.value = '';
      if (!f) return;
      const buf = await f.arrayBuffer();
      let doc;
      try {
        doc = await openPdfData(buf);
      } catch {
        toast('PDF를 열 수 없습니다. 다른 파일을 골라주세요.');
        return;
      }
      pending = { buf, name: f.name.replace(/\.pdf$/i, ''), fileName: f.name, pages: doc.numPages, bytes: f.size };
      doc.destroy();
      go('#/new');
    })
  );
}

// ---------- 등록 1. 새 작품 ----------
async function viewNew() {
  if (!pending) return go('#/');
  const mb = (pending.bytes / 1048576).toFixed(1);
  app.innerHTML = `${header('#/', '새 작품', '도안 PDF로 만들기')}
    <div class="page"><form class="wrap" id="f">
      <div class="card file-card"><span class="file-ico">${icon.file}</span>
        <span class="file-t"><b>${esc(pending.fileName)}</b><span class="muted small">${pending.pages}쪽 · ${mb}MB · 폰 안에 저장됨</span></span></div>
      <div class="field"><label for="pname">작품 이름</label><input id="pname" class="input" value="${esc(pending.name)}" autocomplete="off" required></div>
      <div class="field"><label for="psize">내가 뜰 사이즈 (선택)</label><input id="psize" class="input" autocomplete="off" placeholder="예: 1">
        <span class="hint">사이즈별로 차트가 따로 있는 도안이면 적어두세요. 화면에 계속 표시합니다.</span></div>
    </form></div>
    <div class="footer"><button class="btn primary" form="f">작품 만들고 파트 추가하기</button></div>`;
  app.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = app.querySelector('#pname').value.trim();
    if (!name) return;
    const fileId = db.uid();
    await db.put('files', pending.buf, fileId);
    const proj = {
      id: db.uid(), name, size: app.querySelector('#psize').value.trim(), fileId,
      fileName: pending.fileName, pages: pending.pages, created: Date.now(), updated: Date.now(), lastPartId: null,
    };
    await db.put('projects', proj);
    pending = null;
    location.replace(`#/padd/${proj.id}`);
  });
}

// ---------- 2. 파트 목록 ----------
async function viewProject(pid) {
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
      <div class="label">뜨는 순서</div>
      ${rows.join('') || '<p class="hint">아직 파트가 없습니다. 뜨는 순서대로 파트를 추가하세요.</p>'}
      <a class="btn dashed" href="#/padd/${pid}">${icon.plus}파트 추가</a>
    </div></div>`;
  app.querySelector('#doc').addEventListener('click', async () => openDoc(await loadPdf(proj.fileId)));
  app.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => partActions(b.dataset.more, proj, parts)));
  app.querySelector('#pmore').addEventListener('click', async () => {
    const v = await sheet(proj.name, [
      { label: '작품 이름 바꾸기', value: 'rename' },
      { label: '사이즈 바꾸기', value: 'size' },
      { label: '작품 삭제', value: 'delete', danger: true },
    ]);
    if (v === 'rename') {
      const n = await ask('작품 이름', proj.name);
      if (n) { proj.name = n; await db.put('projects', proj); route(); }
    } else if (v === 'size') {
      const n = await ask('내가 뜰 사이즈', proj.size || '');
      if (n !== null) { proj.size = n; await db.put('projects', proj); route(); }
    } else if (v === 'delete') {
      const ok = await dialog({
        title: `${esc(proj.name)} 삭제`,
        body: '도안 PDF와 모든 파트, 진행 기록이 이 기기에서 지워집니다. 되돌릴 수 없습니다.',
        buttons: [{ label: '취소', value: false }, { label: '삭제', value: true, danger: true }],
      });
      if (!ok) return;
      for (const x of parts) await db.del('parts', x.id);
      await db.del('files', proj.fileId);
      forgetPdf(proj.fileId);
      await db.del('projects', proj.id);
      go('#/');
    }
  });
}

async function partActions(id, proj, parts) {
  const part = parts.find((x) => x.id === id);
  const i = parts.indexOf(part);
  const v = await sheet(part.name, [
    { label: isText(part) ? '설명 영역·목표 단수 고치기' : '격자 다시 맞추기', value: 'cal' },
    { label: '복제 (왼팔·오른팔처럼 같은 차트를 한 번 더)', value: 'dup' },
    { label: '이름 바꾸기', value: 'rename' },
    ...(i > 0 ? [{ label: '위로 옮기기', value: 'up' }] : []),
    ...(i < parts.length - 1 ? [{ label: '아래로 옮기기', value: 'down' }] : []),
    ...(part.progress ? [{ label: '진행 위치를 처음으로', value: 'reset' }] : []),
    { label: '파트 삭제', value: 'delete', danger: true },
  ]);
  if (!v) return;
  if (v === 'cal') return go(isText(part) ? `#/txt/${id}` : `#/cal/${id}/1`);
  if (v === 'rename') {
    const n = await ask('파트 이름', part.name);
    if (n) { part.name = n; await db.put('parts', part); }
  } else if (v === 'dup') {
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

// ---------- 등록 2. 파트 추가 ----------
async function viewPartAdd(pid) {
  const proj = await db.get('projects', pid);
  if (!proj) return go('#/');
  const parts = await db.partsOf(pid);
  const doc = await loadPdf(proj.fileId);
  let page = null;
  app.innerHTML = `${header(`#/p/${pid}`, '파트 추가', `${esc(proj.name)}${proj.size ? ` · 사이즈 ${esc(proj.size)}` : ''}`)}
    <div class="page"><div class="wrap">
      <div class="field"><label for="ptname">파트 이름</label><input id="ptname" class="input" autocomplete="off" placeholder="예: 뒷판"></div>
      <div class="field"><span class="label">도안 형태</span>
        <div class="seg"><button type="button" data-kind="chart" aria-pressed="true">기호 차트</button><button type="button" data-kind="text" aria-pressed="false">글 설명만</button></div></div>
      <div class="label" id="pagelabel">차트가 있는 페이지를 고르세요</div>
      <p class="hint">페이지를 탭하면 크게 볼 수 있습니다.</p>
      <div class="thumbs" id="thumbs">${Array.from({ length: doc.numPages }, (_, i) =>
        `<button type="button" class="thumb" data-p="${i + 1}" aria-pressed="false"><span class="thumb-img"><canvas></canvas></span><span class="num">${i + 1}쪽</span></button>`).join('')}</div>
    </div></div>
    <div class="footer"><button class="btn primary" id="next" disabled>다음: 영역 지정</button></div>`;
  const nameIn = app.querySelector('#ptname');
  const nextBtn = app.querySelector('#next');
  let kind = 'chart';
  app.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.kind;
    app.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    app.querySelector('#pagelabel').textContent = kind === 'text' ? '설명이 있는 페이지를 고르세요' : '차트가 있는 페이지를 고르세요';
    nextBtn.textContent = kind === 'text' ? '다음: 설명 영역' : '다음: 영역 지정';
  }));
  const check = () => { nextBtn.disabled = !(nameIn.value.trim() && page); };
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
      const ok = await previewPage(doc, p, '이 페이지로 고르기');
      if (!ok) return;
      app.querySelectorAll('.thumb').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      t.setAttribute('aria-pressed', 'true');
      page = p;
      check();
      if (!nameIn.value.trim()) nameIn.focus();
    });
  });
  nextBtn.addEventListener('click', async () => {
    const part = {
      id: db.uid(), projectId: pid, name: nameIn.value.trim(), page,
      order: parts.length ? parts[parts.length - 1].order + 1 : 0, cal: {}, progress: null, created: Date.now(),
      kind,
    };
    if (kind === 'text') part.text = { area: null, goal: null };
    await db.put('parts', part);
    location.replace(kind === 'text' ? `#/txt/${part.id}` : `#/cal/${part.id}/1`);
  });
}

// ---------- 격자 맞추기 1~4단계 ----------
const STEP_LABELS = ['영역', '단 번호', '코 번호', '뜨는 방식'];
function stepsHtml(now) {
  return `<div class="steps">${STEP_LABELS.map((l, i) => {
    const n = i + 1;
    const cls = n < now ? 'done' : n === now ? 'now' : '';
    return `<div class="step ${cls}"><span class="num">${n}</span><span>${l}</span></div>`;
  }).join('')}</div>`;
}

async function viewCal(id, stepStr) {
  const step = +stepStr;
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  const proj = await db.get('projects', part.projectId);
  const doc = await loadPdf(proj.fileId);
  part.cal = part.cal || {};
  if (step > 1 && !part.cal.area) return location.replace(`#/cal/${id}/1`);
  if (step > 2 && !validPair(part.cal.rows, 'y')) return location.replace(`#/cal/${id}/2`);
  if (step > 3 && !validPair(part.cal.cols, 'x')) return location.replace(`#/cal/${id}/3`);
  const back = step === 1 ? `#/p/${proj.id}` : `#/cal/${id}/${step - 1}`;
  const save = () => db.put('parts', part);
  const top = header(back, '격자 맞추기', `${esc(part.name)} · ${part.page}쪽`) + stepsHtml(step);
  if (step === 1) return calArea(part, proj, doc, top, save);
  if (step === 2 || step === 3) return calPoints(part, doc, top, save, step);
  return calMode(part, proj, top, save);
}

async function calArea(part, proj, doc, top, save) {
  app.innerHTML = `${top}
    <p class="lead">차트 영역을 자동으로 잡아 둡니다. 원하는 차트만 쓰려면 모서리를 끌어 고치세요. <b>대충</b> 감싸도 바로 옆 번호 칸은 자동으로 들어갑니다.</p>
    <div class="pv-box" id="pv"></div>
    <p class="hint pad">손가락으로 끌어서 그리고, 모서리를 끌어 크기를 고칩니다. 번호 칸이 글자로 읽히는 도안이면 위아래로 떨어진 차트도 한 파트로 묶을 수 있습니다. 사이의 빈 공간은 번호 칸 위치로 맞춥니다.</p>
    <button type="button" class="link-btn" id="autoarea">차트 영역 자동으로 다시 잡기</button>
    <div class="footer"><button type="button" class="btn" id="pg">페이지 바꾸기 (${part.page}쪽)</button>
      <button type="button" class="btn primary" id="next" ${part.cal.area ? '' : 'disabled'}>다음: 단 번호</button></div>`;
  const box = app.querySelector('#pv');
  const nextBtn = app.querySelector('#next');
  let A = part.cal.area ? { ...part.cal.area } : null;
  let W = 0, H = 0;
  box.innerHTML = '<div class="pv-stage"><canvas></canvas><div class="pv-rect" hidden><i class="h tl"></i><i class="h tr"></i><i class="h bl"></i><i class="h br"></i></div></div>';
  const stage = box.querySelector('.pv-stage');
  const canvas = box.querySelector('canvas');
  const rect = box.querySelector('.pv-rect');
  const draw = () => {
    if (!A) { rect.hidden = true; return; }
    rect.hidden = false;
    Object.assign(rect.style, { left: A.x * W + 'px', top: A.y * H + 'px', width: A.w * W + 'px', height: A.h * H + 'px' });
  };
  const layout = async () => {
    const sz = await pageSize(doc, part.page);
    const cssW = Math.min(box.clientWidth - 2, ((box.clientHeight - 2) * sz.w) / sz.h);
    W = cssW;
    H = (cssW * sz.h) / sz.w;
    stage.style.width = W + 'px';
    stage.style.height = H + 'px';
    await renderPage(doc, part.page, canvas, cssW);
    draw();
  };
  const applyProposal = async (manual) => {
    const prop = await proposeArea(doc, part.page);
    if (!prop) {
      if (manual) toast('이 페이지에서는 번호 칸을 찾지 못했습니다. 손가락으로 끌어 직접 감싸주세요.');
      return;
    }
    A = prop;
    part.cal.area = A;
    // 영역이 바뀌면 예전 기준점은 다시 잡도록 지운다
    part.cal.rows = null;
    part.cal.cols = null;
    await save();
    nextBtn.disabled = false;
    draw();
    toast('차트 영역을 자동으로 잡았습니다. 맞지 않으면 모서리를 끌어 고치세요.', { ms: 4500 });
  };
  if (!A) await applyProposal(false);
  app.querySelector('#autoarea').addEventListener('click', () => applyProposal(true));
  const ro2 = new ResizeObserver(() => { clearTimeout(ro2.t); ro2.t = setTimeout(layout, 200); });
  ro2.observe(box);
  onCleanup(() => ro2.disconnect());

  let anchor = null;
  const pt = (e) => {
    const r = stage.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / W, 0, 1), clamp((e.clientY - r.top) / H, 0, 1)];
  };
  stage.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    anchor = [x, y];
    if (A) {
      const corners = [[A.x, A.y], [A.x + A.w, A.y], [A.x, A.y + A.h], [A.x + A.w, A.y + A.h]];
      for (let i = 0; i < 4; i++) {
        const [cx, cy] = corners[i];
        if (Math.hypot((cx - x) * W, (cy - y) * H) < 28) { anchor = corners[3 - i]; break; }
      }
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!anchor) return;
    const [x, y] = pt(e);
    A = { x: Math.min(x, anchor[0]), y: Math.min(y, anchor[1]), w: Math.abs(x - anchor[0]), h: Math.abs(y - anchor[1]) };
    draw();
  });
  const up = async () => {
    if (!anchor) return;
    anchor = null;
    if (!A || A.w * W < 16 || A.h * H < 16) { A = part.cal.area ? { ...part.cal.area } : null; draw(); return; }
    // 사각형 바로 바깥에 번호 칸이 걸쳐 있으면 영역을 넓혀 포함시킨다 (대충 그려도 되도록)
    A = await growToLabels(doc, part.page, A);
    draw();
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
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  nextBtn.addEventListener('click', () => go(`#/cal/${part.id}/2`));
  app.querySelector('#pg').addEventListener('click', async () => {
    const v = await sheet('차트가 있는 페이지', Array.from({ length: doc.numPages }, (_, i) => ({ label: `${i + 1}쪽`, value: i + 1, current: i + 1 === part.page })));
    if (!v || v === part.page) return;
    part.page = v;
    part.cal = {};
    await save();
    route();
  });
}

async function calPoints(part, doc, top, save, step) {
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
      글자로 된 도안은 자동으로 잡아 둡니다. 빨간 선이 칸과 맞으면 다음으로, 조금 어긋나면 미세 조정을 쓰세요.</p>
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
      <button type="button" class="btn primary" id="next">${isRow ? '다음: 코 번호' : '다음: 뜨는 방식'}</button></div>`;
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
        ? `${missing.join(', ')} 지점을 차트에서 찍어주세요. 확대하면 정확하게 찍을 수 있습니다.`
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
  for (const k of ['a', 'b']) {
    app.querySelector(`#n-${k}`).addEventListener('input', async (e) => {
      const v = parseInt(e.target.value.replace(/\D/g, ''), 10);
      pair[k].n = Number.isFinite(v) ? v : null;
      pair[k].auto = false;
      pair.table = null;
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
  nextBtn.addEventListener('click', () => go(`#/cal/${part.id}/${step + 1}`));
  refresh();
}

async function calMode(part, proj, top, save) {
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
      <div class="field"><label for="rep" class="label">무늬 반복 (차트에 한 단위만 그려진 경우)</label>
        <div class="suffix"><input id="rep" class="input num" inputmode="numeric" placeholder="반복 없음" value="${m.repeat ?? ''}"><span>회</span></div>
        <span class="hint">이 차트를 위로 몇 번 반복하는지 적습니다. 넣으면 마지막 단 다음에 첫 단으로 돌아가고 회차가 올라갑니다. 횟수가 정해지지 않았으면 0을 넣고 직접 끝냅니다.</span></div>
    </div></div>
    <div class="footer"><button type="button" class="btn" id="list">저장하고 목록으로</button><button type="button" class="btn primary" id="start">완료하고 뜨기 시작</button></div>`;
    app.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { m.type = b.dataset.type; render(); }));
    app.querySelectorAll('[data-first]').forEach((b) => b.addEventListener('click', () => { m.first = b.dataset.first; render(); }));
    app.querySelector('#rep').addEventListener('change', (e) => {
      const v = e.target.value.replace(/\D/g, '');
      m.repeat = v === '' ? null : parseInt(v, 10);
    });
    const finish = async (dest) => {
      const v = app.querySelector('#rep').value.replace(/\D/g, '');
      m.repeat = v === '' ? null : parseInt(v, 10);
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

// PDF 글자 층에서 숫자만 모아 둔다 (영역 안쪽, 정규화 좌표)
async function readNumberLabels(page, area, margin = 0) {
  try {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const out = [];
    for (const it of tc.items) {
      const s = (it.str || '').trim();
      if (!/^\d{1,3}$/.test(s)) continue;
      const [a, b, , d, e, f] = it.transform;
      const h = Math.hypot(b, d) || it.height || 0;
      const w = it.width || h * 0.6 * s.length;
      const [x1, y1] = vp.convertToViewportPoint(e, f);
      const [x2, y2] = vp.convertToViewportPoint(e + w, f + h);
      const cx = (x1 + x2) / 2 / vp.width;
      const cy = (y1 + y2) / 2 / vp.height;
      if (cx < area.x - margin || cx > area.x + area.w + margin || cy < area.y - margin || cy > area.y + area.h + margin) continue;
      out.push({ n: parseInt(s, 10), cx, cy, hw: Math.abs(x2 - x1) / 2 / vp.width, hh: Math.abs(y2 - y1) / 2 / vp.height });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// 찍은 두 번호 칸과 같은 줄(단: 같은 세로줄, 코: 같은 가로줄)에 있는 번호를 모두 모아 번호별 위치표를 만든다
function buildTable(labels, pair, key) {
  const { a, b } = pair;
  if (!labels || !a.auto || !b.auto || !validPair(pair, key)) return null;
  const cross = key === 'y' ? 'x' : 'y';
  const lo = Math.min(a.n, b.n);
  const hi = Math.max(a.n, b.n);
  const near = (l) => [a, b].some((an) => {
    const tol = 3 * Math.max(cross === 'x' ? an.hw || 0 : an.hh || 0, 0.004);
    return Math.abs((cross === 'x' ? l.cx : l.cy) - an[cross]) < tol;
  });
  const lin = (n) => a[key] + ((n - a.n) * (b[key] - a[key])) / (b.n - a.n);
  const byN = new Map();
  for (const l of labels) {
    if (l.n < lo || l.n > hi || !near(l)) continue;
    const v = key === 'y' ? l.cy : l.cx;
    if (!byN.has(l.n)) byN.set(l.n, []);
    byN.get(l.n).push(v);
  }
  byN.set(a.n, [a[key]]);
  byN.set(b.n, [b[key]]);
  let rows = [...byN.entries()].map(([n, vs]) => {
    vs.sort((p, q) => Math.abs(p - lin(n)) - Math.abs(q - lin(n)));
    const v0 = vs[0];
    const same = vs.filter((v) => Math.abs(v - v0) < 0.004);
    return [n, same.reduce((s, v) => s + v, 0) / same.length];
  }).sort((p, q) => p[0] - q[0]);
  // 번호 순서와 위치 순서가 어긋나는 값은 버린다
  const dir = Math.sign((b[key] - a[key]) / (b.n - a.n));
  const kept = [];
  for (const r of rows) {
    if (!kept.length || Math.sign(r[1] - kept[kept.length - 1][1]) === dir) kept.push(r);
  }
  rows = kept;
  if (rows.length < 3 || rows[0][0] !== lo || rows[rows.length - 1][0] !== hi) return null;
  return rows.map(([n, v]) => [n, Math.round(v * 1e6) / 1e6]);
}

async function growToLabels(doc, pageNum, A) {
  try {
    const page = await doc.getPage(pageNum);
    const near = await readNumberLabels(page, A, 0.035);
    if (!near) return A;
    let x1 = A.x, y1 = A.y, x2 = A.x + A.w, y2 = A.y + A.h;
    for (const l of near) {
      x1 = Math.min(x1, l.cx - l.hw * 2);
      x2 = Math.max(x2, l.cx + l.hw * 2);
      y1 = Math.min(y1, l.cy - l.hh * 2);
      y2 = Math.max(y2, l.cy + l.hh * 2);
    }
    x1 = clamp(x1, 0, 1); y1 = clamp(y1, 0, 1); x2 = clamp(x2, 0, 1); y2 = clamp(y2, 0, 1);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  } catch {
    return A;
  }
}

// 번호 칸이 한 줄로 이어진 곳(단: 세로줄, 코: 가로줄)을 찾아 가장 긴 연속 번호의 양 끝을 돌려준다
function autoDetect(labels, key) {
  if (!labels) return null;
  const cross = key === 'y' ? 'cx' : 'cy';
  const along = key === 'y' ? 'cy' : 'cx';
  const size = key === 'y' ? 'hw' : 'hh';
  const groups = [];
  for (const l of [...labels].sort((p, q) => p[cross] - q[cross])) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(l[cross] - g.c) < Math.max(l[size], 0.004) * 1.6) {
      g.items.push(l);
      g.c = (g.c * (g.items.length - 1) + l[cross]) / g.items.length;
    } else groups.push({ c: l[cross], items: [l] });
  }
  let best = null;
  for (const g of groups) {
    const it = g.items.sort((p, q) => p[along] - q[along]);
    let start = 0;
    for (let i = 1; i <= it.length; i++) {
      const ok = i < it.length && Math.abs(it[i].n - it[i - 1].n) === 1 &&
        (i - start < 2 || Math.sign(it[i].n - it[i - 1].n) === Math.sign(it[start + 1].n - it[start].n));
      if (!ok) {
        const len = i - start;
        if (len >= 3 && (!best || len > best.len)) best = { len, first: it[start], last: it[i - 1], items: it.slice(start, i) };
        start = i;
      }
    }
  }
  if (!best) return null;
  const [lo, hi] = best.first.n < best.last.n ? [best.first, best.last] : [best.last, best.first];
  return { lo, hi, items: best.items };
}

// 페이지에서 단 번호 줄과 코 번호 줄을 찾아, 둘을 감싸는 영역을 제안한다
async function proposeArea(doc, pageNum) {
  try {
    const page = await doc.getPage(pageNum);
    const labels = await readNumberLabels(page, { x: 0, y: 0, w: 1, h: 1 });
    if (!labels) return null;
    const r = autoDetect(labels, 'y');
    const c = autoDetect(labels, 'x');
    const items = [...(r ? r.items : []), ...(c ? c.items : [])];
    if (!r || items.length < 6) return null;
    let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
    for (const l of items) {
      x1 = Math.min(x1, l.cx - l.hw * 2);
      x2 = Math.max(x2, l.cx + l.hw * 2);
      y1 = Math.min(y1, l.cy - l.hh * 2);
      y2 = Math.max(y2, l.cy + l.hh * 2);
    }
    if (x2 - x1 < 0.05 || y2 - y1 < 0.05) return null;
    return growToLabels(doc, pageNum, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  } catch {
    return null;
  }
}

function nearestLabel(labels, nx, ny) {
  let best = null;
  let bd = Infinity;
  for (const l of labels) {
    // 글자 상자 크기로 나눈 거리: 상자 안이면 1 이하
    const d = Math.hypot((nx - l.cx) / Math.max(l.hw, 0.004), (ny - l.cy) / Math.max(l.hh, 0.004));
    if (d < bd) { bd = d; best = l; }
  }
  return bd <= 4 ? best : null;
}

// ---------- 뜨기 화면 ----------
async function viewKnit(id) {
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  if (isText(part)) return viewTextKnit(part);
  if (!calibrated(part)) return location.replace(`#/cal/${id}/1`);
  const proj = await db.get('projects', part.projectId);
  const parts = await db.partsOf(proj.id);
  const doc = await loadPdf(proj.fileId);
  if (!part.progress) part.progress = startProgress(part);
  const p = () => part.progress;
  const R = rowsOf(part);
  const C = colsOf(part);
  const idx = parts.findIndex((x) => x.id === id);
  const nextPart = parts[idx + 1];
  proj.lastPartId = id;
  proj.updated = Date.now();
  await db.put('projects', proj);

  app.innerHTML = `<div class="knit">
    <div class="k-main">
      <div class="k-top">
        <a class="icon-btn" href="#/p/${proj.id}" aria-label="파트 목록으로">${icon.back}</a>
        <button type="button" class="part-switch" id="sw" aria-label="다른 파트로 바꾸기">
          <span class="ps-t"><span class="ps-name">${esc(part.name)}</span><span class="ps-sub">${proj.size ? `사이즈 ${esc(proj.size)} · ` : ''}파트 ${idx + 1}/${parts.length}</span></span>${icon.chev}</button>
        <span class="k-spacer"></span>
        <span class="dir-chip" id="dir"></span>
        <button type="button" class="btn" id="docbtn">도안</button>
      </div>
      <div class="k-chart" id="chart"></div>
    </div>
    <div class="k-ctrl">
      <button type="button" class="row-card" id="rowcard" aria-label="단 번호를 입력해 이동"></button>
      <button type="button" class="next-btn" id="next">다음 단</button>
      <button type="button" class="btn prev-btn" id="prev">${icon.undo}이전 단</button>
    </div></div>`;

  const save = async () => {
    part.updated = Date.now();
    await db.put('parts', part);
  };
  const snapshot = () => JSON.stringify(part.progress);
  const restore = async (s) => {
    part.progress = JSON.parse(s);
    await save();
    refresh(true);
  };

  const decorate = (v) => {
    const [w] = v.size();
    const pr = p();
    const edge = (r) => [R.at(r) - R.pitchAt(r) / 2, R.at(r) + R.pitchAt(r) / 2];
    let h = '';
    const lastDone = pr.done ? R.hi : pr.row - 1;
    if (lastDone >= R.lo) {
      const [a1, a2] = edge(R.lo);
      const [b1, b2] = edge(lastDone);
      const y1 = v.n2p(0, Math.min(a1, b1))[1];
      const y2 = v.n2p(0, Math.max(a2, b2))[1];
      h += `<i class="shade" style="left:0;top:${y1}px;width:${w}px;height:${y2 - y1}px"></i>`;
    }
    if (!pr.done) {
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
    return h;
  };

  const rowcard = app.querySelector('#rowcard');
  const nextBtn = app.querySelector('#next');
  const prevBtn = app.querySelector('#prev');
  const dirEl = app.querySelector('#dir');

  const refresh = (follow) => {
    const pr = p();
    const total = repeatTotal(part);
    const rs = isRightSide(part);
    const round = part.cal.mode.type === 'round';
    dirEl.innerHTML = pr.done ? `${icon.check}다 떴습니다`
      : `${rs ? icon.left : icon.right}${round ? '원통' : rs ? '겉면' : '안면'}<span class="dir-long"> · ${rs ? '왼쪽' : '오른쪽'}으로 읽기</span>`;
    rowcard.innerHTML = `<span class="rc-top"><span>${pr.done ? '완료' : '지금'}</span><span class="rc-jump">${icon.edit}단 이동</span></span>
      <span class="rc-num"><span class="num rc-big">${pr.row}</span><span class="rc-u">단</span><span class="num muted">/ ${R.hi}</span></span>
      ${pr.done ? `<span class="tag-done">${icon.check}${esc(part.name)} 완료</span>`
        : pr.mark !== null && pr.mark !== undefined ? `<span class="rc-line"><i class="mk"></i>코 표시 <b class="num">${pr.mark}</b>번 칸</span>`
        : '<span class="rc-line muted">코 표시 없음</span>'}
      ${total !== null ? `<span class="rc-line small">반복 <b class="num">${pr.rep}/${total || '∞'}</b>회차 · 처음부터 <b class="num">${knitIndex(part) + 1}</b>단째</span>` : ''}`;
    nextBtn.disabled = !!pr.done;
    nextBtn.textContent = pr.done ? '다 떴습니다' : '다음 단';
    cv.redraw();
    if (follow) {
      // 세로로는 현재 단을 따라가고, 가로로는 코 표시가 있을 때만 그쪽으로 옮긴다
      const y = R.at(pr.done ? R.hi : pr.row);
      if (pr.mark !== null && pr.mark !== undefined) cv.scrollTo(C.at(pr.mark), y, { x: 'center', smooth: follow !== 'first' });
      else cv.scrollTo((C.at(C.lo) + C.at(C.hi)) / 2, y, { x: follow === 'first' ? 'center' : 'keep', smooth: follow !== 'first' });
    }
  };

  const sz = await pageSize(doc, part.page);
  const pitchPt = R.pitch * sz.h;
  const key = `knit.rowPx.${id}`;
  let rowPx = 26;
  try { rowPx = +localStorage.getItem(key) || 26; } catch {}

  const cv = new ChartView(app.querySelector('#chart'), {
    doc, pageNum: part.page, area: part.cal.area, decorate,
    onScale: (s) => { try { localStorage.setItem(key, String(s * pitchPt)); } catch {} },
    onTap: async (nx, ny) => {
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
  onCleanup(() => { cv.destroy(); if (window.__cv === cv) window.__cv = null; });
  await cv.init(rowPx / pitchPt);
  refresh('first');

  nextBtn.addEventListener('click', async () => {
    const snap = snapshot();
    const res = nextRow(part);
    part.progress.touched = true;
    await save();
    refresh(true);
    if (res === 'finished') {
      if (nextPart) {
        const yes = await dialog({
          title: `<span class="ok">${icon.check}${esc(part.name)} 완료</span>`,
          body: `마지막 단까지 떴습니다.<br>다음 파트 <span class="pill-hl">${esc(nextPart.name)}</span>${ro(nextPart.name)} 넘어갈까요?`,
          buttons: [{ label: '아니오', value: false }, { label: '네', value: true, primary: true }],
        });
        if (yes) go(partHref(nextPart));
      } else {
        toast(`<b>${esc(part.name)}</b>${eul(part.name)} 다 떴습니다`, { action: '취소', onAction: () => restore(snap) });
      }
    } else {
      toast(`<b>${part.progress.row}단</b>으로 넘어갔습니다${res === 'repeat' ? ` · 반복 ${part.progress.rep}회차` : ''}`,
        { action: '취소', onAction: () => restore(snap) });
    }
  });
  prevBtn.addEventListener('click', async () => {
    if (!prevRow(part)) { toast('첫 단입니다'); return; }
    part.progress.touched = true;
    await save();
    refresh(true);
  });
  rowcard.addEventListener('click', async () => {
    const r = await keypad(R, p().row);
    if (r === null || r === undefined) return;
    const snap = snapshot();
    jumpTo(part, r);
    part.progress.touched = true;
    await save();
    refresh(true);
    toast(`<b>${r}단</b>으로 이동했습니다`, { action: '취소', onAction: () => restore(snap) });
  });
  app.querySelector('#sw').addEventListener('click', async () => {
    const v = await sheet('파트 바꾸기', parts.map((x) => {
      const st = partStatus(x);
      return {
        label: x.name, value: x.id, current: x.id === id,
        sub: st === 'done' ? '완료' : st === 'setup' ? '격자 맞추기 필요' : st === 'active' ? `${x.progress.row}단` : '시작 전',
      };
    }));
    if (v && v !== id) go(partHref(parts.find((x) => x.id === v)));
  });
  app.querySelector('#docbtn').addEventListener('click', () => openDoc(doc));

  // 뜨는 동안 화면 켜두기
  let lock = null;
  const keepAwake = async () => {
    try { lock = await navigator.wakeLock?.request('screen'); } catch {}
  };
  keepAwake();
  const vis = () => { if (document.visibilityState === 'visible') keepAwake(); };
  document.addEventListener('visibilitychange', vis);
  onCleanup(() => {
    document.removeEventListener('visibilitychange', vis);
    lock?.release?.().catch(() => {});
  });
}

// ---------- 글 설명 파트: 설명 영역과 목표 단수 ----------
async function viewTextSetup(id) {
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  const proj = await db.get('projects', part.projectId);
  const doc = await loadPdf(proj.fileId);
  part.text = part.text || { area: null, goal: null };
  // 영역을 따로 안 그려도 넘어갈 수 있게 처음에는 페이지 전체로 둔다
  let A = part.text.area ? { ...part.text.area } : { x: 0.03, y: 0.03, w: 0.94, h: 0.94 };
  app.innerHTML = `${header(`#/p/${proj.id}`, part.name, `글 설명 · ${part.page}쪽`)}
    <p class="lead">뜨면서 볼 <b>설명 부분을 사각형으로</b> 감싸주세요. 그대로 두면 페이지 전체를 봅니다.</p>
    <div class="pv-box" id="pv"></div>
    <div class="pin-row"><div class="pin-col">
      <label for="goal" class="label">목표 단수 (선택)</label>
      <div class="suffix"><input id="goal" class="input num" inputmode="numeric" placeholder="정해진 단수가 없으면 비워두세요" value="${part.text.goal ?? ''}"><span>단</span></div>
    </div></div>
    <button type="button" class="link-btn" id="pg">페이지 바꾸기 (${part.page}쪽)</button>
    <div class="footer"><button type="button" class="btn" id="list">저장하고 목록으로</button><button type="button" class="btn primary" id="start">완료하고 뜨기 시작</button></div>`;
  const box = app.querySelector('#pv');
  box.innerHTML = '<div class="pv-stage"><canvas></canvas><div class="pv-rect"><i class="h tl"></i><i class="h tr"></i><i class="h bl"></i><i class="h br"></i></div></div>';
  const stage = box.querySelector('.pv-stage');
  const rect = box.querySelector('.pv-rect');
  let W = 0, H = 0;
  const draw = () => Object.assign(rect.style, { left: A.x * W + 'px', top: A.y * H + 'px', width: A.w * W + 'px', height: A.h * H + 'px' });
  const layout = async () => {
    const sz = await pageSize(doc, part.page);
    const cssW = Math.min(box.clientWidth - 2, ((box.clientHeight - 2) * sz.w) / sz.h);
    W = cssW;
    H = (cssW * sz.h) / sz.w;
    stage.style.width = W + 'px';
    stage.style.height = H + 'px';
    await renderPage(doc, part.page, stage.querySelector('canvas'), cssW);
    draw();
  };
  await layout();
  let anchor = null;
  const pt = (e) => {
    const r = stage.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / W, 0, 1), clamp((e.clientY - r.top) / H, 0, 1)];
  };
  stage.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    anchor = [x, y];
    const corners = [[A.x, A.y], [A.x + A.w, A.y], [A.x, A.y + A.h], [A.x + A.w, A.y + A.h]];
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = corners[i];
      if (Math.hypot((cx - x) * W, (cy - y) * H) < 28) { anchor = corners[3 - i]; break; }
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!anchor) return;
    const [x, y] = pt(e);
    const nA = { x: Math.min(x, anchor[0]), y: Math.min(y, anchor[1]), w: Math.abs(x - anchor[0]), h: Math.abs(y - anchor[1]) };
    if (nA.w * W > 16 && nA.h * H > 16) { A = nA; draw(); }
  });
  const up = () => { anchor = null; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  const finish = async (dest) => {
    const g = parseInt(app.querySelector('#goal').value.replace(/\D/g, ''), 10);
    part.text = { area: A, goal: Number.isFinite(g) && g > 0 ? g : null };
    part.kind = 'text';
    if (!part.progress) part.progress = { row: 1, line: null, done: false };
    await db.put('parts', part);
    go(dest);
  };
  app.querySelector('#list').addEventListener('click', () => finish(`#/p/${proj.id}`));
  app.querySelector('#start').addEventListener('click', () => finish(`#/k/${part.id}`));
  app.querySelector('#pg').addEventListener('click', async () => {
    const v = await sheet('설명이 있는 페이지', Array.from({ length: doc.numPages }, (_, i) => ({ label: `${i + 1}쪽`, value: i + 1, current: i + 1 === part.page })));
    if (!v || v === part.page) return;
    part.page = v;
    part.text.area = null;
    await db.put('parts', part);
    route();
  });
}

// PDF 글자 층에서 줄 단위 위치를 모은다 (영역 안, 정규화 좌표)
async function readTextLines(page, area) {
  try {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const boxes = [];
    for (const it of tc.items) {
      if (!(it.str || '').trim()) continue;
      const [, b, , d, e, f] = it.transform;
      const h = Math.hypot(b, d) || it.height || 0;
      const [x1, y1] = vp.convertToViewportPoint(e, f);
      const [, y2] = vp.convertToViewportPoint(e, f + h);
      const top = Math.min(y1, y2) / vp.height;
      const bot = Math.max(y1, y2) / vp.height;
      const cx = x1 / vp.width;
      if (cx < area.x || cx > area.x + area.w || bot < area.y || top > area.y + area.h) continue;
      boxes.push({ top, bot, c: (top + bot) / 2 });
    }
    boxes.sort((p, q) => p.c - q.c);
    const lines = [];
    for (const bx of boxes) {
      const L = lines[lines.length - 1];
      if (L && Math.abs(bx.c - L.c) < (L.bot - L.top) * 0.5) {
        L.top = Math.min(L.top, bx.top);
        L.bot = Math.max(L.bot, bx.bot);
      } else lines.push({ ...bx });
    }
    return lines;
  } catch {
    return [];
  }
}

// ---------- 글 설명 파트: 뜨기 화면 ----------
async function viewTextKnit(part) {
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

  app.innerHTML = `<div class="knit text-knit">
    <div class="k-main">
      <div class="k-top">
        <a class="icon-btn" href="#/p/${proj.id}" aria-label="파트 목록으로">${icon.back}</a>
        <button type="button" class="part-switch" id="sw" aria-label="다른 파트로 바꾸기">
          <span class="ps-t"><span class="ps-name">${esc(part.name)}</span><span class="ps-sub">${proj.size ? `사이즈 ${esc(proj.size)} · ` : ''}파트 ${idx + 1}/${parts.length}</span></span>${icon.chev}</button>
        <span class="k-spacer"></span>
        <button type="button" class="btn" id="docbtn">도안</button>
      </div>
      <div class="k-chart" id="chart"></div>
      <p class="hint pad k-hint">읽고 있는 줄을 탭하면 형광펜 띠가 옮겨갑니다.</p>
    </div>
    <div class="k-ctrl">
      <button type="button" class="row-card" id="rowcard" aria-label="단 번호를 입력해 이동"></button>
      <button type="button" class="next-btn" id="next">다음 단</button>
      <button type="button" class="btn prev-btn" id="prev">${icon.undo}이전 단</button>
    </div></div>`;

  const save = async () => { part.updated = Date.now(); await db.put('parts', part); };
  const snapshot = () => JSON.stringify(part.progress);
  const restore = async (s) => { part.progress = JSON.parse(s); await save(); refresh(); };

  const decorate = (v) => {
    const L = p().line;
    if (!L) return '';
    const [w] = v.size();
    const y1 = v.n2p(0, L.top)[1];
    const y2 = v.n2p(0, L.bot)[1];
    return `<i class="band" style="left:0;top:${y1 - 2}px;width:${w}px;height:${y2 - y1 + 4}px"></i>`;
  };
  const rowcard = app.querySelector('#rowcard');
  const nextBtn = app.querySelector('#next');
  const refresh = () => {
    const pr = p();
    const pct = goal ? Math.min(100, ((pr.done ? goal : pr.row - 1) / goal) * 100) : 0;
    rowcard.innerHTML = `<span class="rc-top"><span>${pr.done ? '완료' : '지금 뜨는 단'}</span><span class="rc-jump">${icon.edit}단 이동</span></span>
      <span class="rc-num"><span class="num rc-big">${pr.row}</span><span class="rc-u">단</span>${goal ? `<span class="num muted">/ ${goal}</span>` : ''}</span>
      ${goal ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}
      <span class="rc-line small muted">${pr.done ? `${esc(part.name)} 완료` : `${pr.row > 1 ? `${pr.row - 1}단까지 떴습니다` : '첫 단을 뜨는 중'}${goal ? ` · 목표까지 ${Math.max(0, goal - pr.row + 1)}단` : ''}`}</span>`;
    nextBtn.disabled = !!pr.done;
    nextBtn.textContent = pr.done ? '다 떴습니다' : '다음 단';
    cv.redraw();
  };

  const zKey = `knit.textScale.${id}`;
  const cv = new ChartView(app.querySelector('#chart'), {
    doc, pageNum: part.page, area: part.text.area, decorate,
    onScale: (s) => { try { localStorage.setItem(zKey, String(s)); } catch {} },
    onTap: async (nx, ny) => {
      const lines = await linesP;
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
      p().line = cur && Math.abs(cur.top - L.top) < 0.002 ? null : { top: L.top, bot: L.bot };
      await save();
      refresh();
    },
  });
  window.__cv = cv;
  onCleanup(() => { cv.destroy(); if (window.__cv === cv) window.__cv = null; });
  let saved = 0;
  try { saved = +localStorage.getItem(zKey) || 0; } catch {}
  await cv.init(saved || undefined);
  const linesP = readTextLines(cv.page, part.text.area);
  if (!saved) {
    // 처음 열 때는 글자가 읽힐 만큼(줄 높이 약 15px) 확대해서 시작한다
    const lines = await linesP;
    const hs = lines.map((l) => l.bot - l.top).sort((a, b) => a - b);
    const h = hs[Math.floor(hs.length / 2)];
    if (h) cv.setScale(Math.max(cv.s, 15 / (h * cv.H1)));
  }
  const L0 = p().line;
  cv.scrollTo(part.text.area.x, L0 ? L0.top : part.text.area.y, { x: 'start', yFrac: L0 ? 0.35 : 0 });
  refresh();

  nextBtn.addEventListener('click', async () => {
    const snap = snapshot();
    const pr = p();
    if (goal && pr.row >= goal) {
      pr.done = true;
      await save();
      refresh();
      if (nextPart) {
        const yes = await dialog({
          title: `<span class="ok">${icon.check}${esc(part.name)} 완료</span>`,
          body: `목표 단수까지 떴습니다.<br>다음 파트 <span class="pill-hl">${esc(nextPart.name)}</span>${ro(nextPart.name)} 넘어갈까요?`,
          buttons: [{ label: '아니오', value: false }, { label: '네', value: true, primary: true }],
        });
        if (yes) go(partHref(nextPart));
      } else {
        toast(`<b>${esc(part.name)}</b>${eul(part.name)} 다 떴습니다`, { action: '취소', onAction: () => restore(snap) });
      }
      return;
    }
    pr.row += 1;
    pr.touched = true;
    await save();
    refresh();
    toast(`<b>${pr.row}단</b>으로 넘어갔습니다`, { action: '취소', onAction: () => restore(snap) });
  });
  app.querySelector('#prev').addEventListener('click', async () => {
    const pr = p();
    if (pr.done) pr.done = false;
    else if (pr.row > 1) pr.row -= 1;
    else { toast('첫 단입니다'); return; }
    pr.touched = true;
    await save();
    refresh();
  });
  rowcard.addEventListener('click', async () => {
    const r = await keypad(R, p().row);
    if (r === null || r === undefined) return;
    const snap = snapshot();
    p().row = r;
    p().done = false;
    p().touched = true;
    await save();
    refresh();
    toast(`<b>${r}단</b>으로 이동했습니다`, { action: '취소', onAction: () => restore(snap) });
  });
  app.querySelector('#sw').addEventListener('click', async () => {
    const v = await sheet('파트 바꾸기', parts.map((x) => {
      const st = partStatus(x);
      return { label: x.name, value: x.id, current: x.id === id,
        sub: st === 'done' ? '완료' : st === 'setup' ? '설정 필요' : st === 'active' ? `${x.progress.row}단` : '시작 전' };
    }));
    if (v && v !== id) go(partHref(parts.find((x) => x.id === v)));
  });
  app.querySelector('#docbtn').addEventListener('click', () => openDoc(doc));
  let lock = null;
  const keepAwake = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch {} };
  keepAwake();
  const vis = () => { if (document.visibilityState === 'visible') keepAwake(); };
  document.addEventListener('visibilitychange', vis);
  onCleanup(() => { document.removeEventListener('visibilitychange', vis); lock?.release?.().catch(() => {}); });
}

// 단 번호 입력 키패드
function keypad(R, current) {
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
function previewPage(doc, pageNum, pickLabel) {
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

// 도안 전체 보기
async function openDoc(doc) {
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
route();
