import * as db from './db.js';
import { loadPdf, openPdfData, renderPage, pageSize, forgetPdf } from './pdf.js';
import { ChartView } from './chartview.js';
import { buildBackup, readBackup, restoreBackup } from './backup.js';
import { esc, icon, ro, eul, toast, dialog, ask, sheet, clearLayer } from './ui.js';
import {
  calibrated, validPair, axis, rowsOf, colsOf, startProgress, knitIndex, isRightSide,
  repeatTotal, nextRow, prevRow, jumpTo, partStatus, isText,
  segsOf, segPart, segReady, segForRow, pagesLabel,
} from './knitting.js';
import { StackView } from './stackview.js';
import { readSizeGroups, findSizeInfo } from './sizes.js';
import { scanVideos, isYoutube, hostOf } from './videos.js';

const APP_VERSION = '1.14.3';
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
  [/^#\/cal\/([\w-]+)\/([1-4])(?:\/(\d+))?$/, viewCal],
  [/^#\/k\/([\w-]+)$/, viewKnit],
  [/^#\/txt\/([\w-]+)(?:\/(\d+))?$/, viewTextSetup],
  [/^#\/pedit\/([\w-]+)$/, viewPartEdit],
  [/^#\/info\/([\w-]+)$/, viewInfo],
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
  const pages = pagesLabel(part);
  if (isText(part)) return `글 설명 · ${pages}${part.text?.goal ? ` · 목표 ${part.text.goal}단` : ''}`;
  if (!calibrated(part)) return `${pages} · 설정 중`;
  const R = rowsOf(part);
  const m = part.cal.mode;
  const rep = repeatTotal(part);
  return `${m.type === 'round' ? '원통' : '평면'} · ${R.lo}~${R.hi}단 · ${pages}` +
    (rep !== null ? ` · ${rep === 0 ? '계속' : rep + '회'} 반복` : '');
}

function partHref(part) {
  if (calibrated(part)) return `#/k/${part.id}`;
  const i = segsOf(part).findIndex((s) => !segReady(part, s));
  if (isText(part)) return `#/txt/${part.id}/${Math.max(0, i)}`;
  return i < 0 ? `#/cal/${part.id}/4` : `#/cal/${part.id}/1/${i}`;
}

// 격자 맞추기 주소. 1~3단계는 구간마다, 4단계(뜨는 방식)는 파트 전체에 한 번
function calUrl(id, step, seg = 0) {
  return step >= 4 ? `#/cal/${id}/4` : `#/cal/${id}/${step}/${seg}`;
}
// 다음 단계: 3단계 다음은 다음 구간의 1단계, 마지막 구간이면 4단계
function calNextUrl(part, step) {
  const seg = part.segIndex ?? 0;
  if (step < 3) return calUrl(part.id, step + 1, seg);
  return seg + 1 < segsOf(part).length ? calUrl(part.id, 1, seg + 1) : calUrl(part.id, 4);
}
function calPrevUrl(part, step, seg, projId) {
  if (step === 4) return calUrl(part.id, 3, segsOf(part).length - 1);
  if (step > 1) return calUrl(part.id, step - 1, seg);
  return seg > 0 ? calUrl(part.id, 3, seg - 1) : `#/p/${projId}`;
}
// 구간이 여럿이면 지금 어느 구간인지 칩으로 보여준다
function segChips(part, now, ready) {
  const segs = segsOf(part);
  if (segs.length < 2) return '';
  return `<div class="seg-chips">${segs.map((sg, i) => {
    const ok = ready(sg, i) && i !== now;
    return `<span class="chip${i === now ? ' on' : ok ? ' ok' : ''}">${i + 1} · ${sg.page}쪽${ok ? ' ✓' : ''}</span>`;
  }).join('')}</div>`;
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
    const bits = [];
    let pct = 0, center = '–', ringCls = 'is-empty', alert = false;
    if (cur) {
      const st = partStatus(cur);
      bits.push(esc(cur.name));
      if (st === 'setup') {
        bits.push('<span class="red">' + (isText(cur) ? '영역 지정 필요' : '격자 맞추기 필요') + '</span>');
        center = '!'; ringCls = 'is-alert'; alert = true;
      } else if (st === 'done') {
        bits.push('완료');
        pct = 100; center = icon.check; ringCls = 'is-done';
      } else {
        const lo = isText(cur) ? 1 : rowsOf(cur).lo;
        const hi = isText(cur) ? cur.text.goal : rowsOf(cur).hi;
        const row = cur.progress?.row ?? lo;
        bits.push(hi && hi < 9999 ? `${row} / ${hi}단` : `${row}단`);
        if (hi && hi < 9999) pct = Math.max(0, Math.min(100, ((row - lo) / (hi - lo + 1)) * 100));
        center = `${row}단`; ringCls = String(row).length > 2 ? 'is-long' : '';
      }
      bits.push(`파트 ${done}/${parts.length}`);
    } else {
      bits.push('파트를 추가하세요');
    }
    if (p.size) bits.push(esc(p.size));
    const resume = cur && !alert ? partHref(cur) : null;
    cards.push(`<div class="card proj-row">
      <a class="pr-main" href="#/p/${p.id}">
        <span class="ring ${ringCls}" style="--p:${pct}%"><span>${center}</span></span>
        <span class="pr-t"><b>${esc(p.name)}</b><span class="pr-sub">${bits.join(' · ')}</span></span>
      </a>
      ${resume ? `<a class="play" href="${resume}" aria-label="${esc(p.name)} 이어서 뜨기"><svg viewBox="0 0 16 16" width="16" height="16"><path d="M4.5 2.5l9 5.5-9 5.5z" fill="currentColor"/></svg></a>` : ''}
    </div>`);
  }
  app.innerHTML = `
    <div class="head home-head"><h1 class="big-title">내 작품</h1>
      <label class="btn primary small">${icon.plus}새 작품<input type="file" accept="application/pdf,.pdf" hidden></label></div>
    <div class="page"><div class="wrap">
      ${cards.join('')}
      <label class="empty-card"><input type="file" accept="application/pdf,.pdf" hidden>
        <b>${icon.plus}도안 PDF로 새 작품</b></label>
      <div class="card backup-card">
        <div class="label">백업</div>
        <p class="small muted">도안과 기록은 이 앱 안에만 저장돼서, 홈 화면 아이콘을 지우면 함께 지워집니다. 백업 파일을 '파일' 앱이나 iCloud Drive에 저장해 두면 다시 설치한 뒤 되살릴 수 있어요.</p>
        <div class="backup-btns">
          <button type="button" class="btn" id="bk-out">백업 내보내기</button>
          <label class="btn">백업 가져오기<input type="file" id="bk-in" hidden></label>
        </div>
      </div>
      <p class="hint center">v${APP_VERSION}</p>
    </div></div>`;
  app.querySelector('#bk-out').addEventListener('click', exportBackup);
  const bkIn = app.querySelector('#bk-in');
  bkIn.addEventListener('change', async () => {
    const f = bkIn.files[0];
    bkIn.value = '';
    if (f) await importBackup(f);
  });
  app.querySelectorAll('input[type=file]:not(#bk-in)').forEach((inp) =>
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

// ---------- 백업 ----------
async function exportBackup() {
  const projects = await db.all('projects');
  if (!projects.length) return toast('아직 백업할 작품이 없습니다.');
  let bk;
  try {
    bk = await buildBackup();
  } catch {
    return toast('백업 파일을 만들지 못했습니다.');
  }
  const mb = (bk.blob.size / 1048576).toFixed(1);
  const ok = await dialog({
    title: '백업 파일이 준비됐어요',
    body: `작품 ${bk.count}개 · ${mb}MB<br>다음 화면에서 <b>'파일에 저장'</b>을 골라 iCloud Drive나 '나의 iPhone'에 저장하세요.`,
    buttons: [{ label: '취소', value: false }, { label: '저장하기', value: true, primary: true }],
  });
  if (!ok) return;
  const file = new File([bk.blob], bk.name, { type: 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = bk.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function importBackup(file) {
  let bk;
  try {
    bk = await readBackup(file);
  } catch {
    return toast('백업 파일이 아니거나 손상된 파일입니다.');
  }
  const when = new Date(bk.meta.created);
  const ok = await dialog({
    title: '백업을 가져올까요?',
    body: `${when.getFullYear()}.${when.getMonth() + 1}.${when.getDate()}에 만든 백업 · 작품 ${bk.meta.projects.length}개<br>같은 작품이 이미 있으면 백업 내용으로 바뀝니다. 다른 작품은 그대로 둡니다.`,
    buttons: [{ label: '취소', value: false }, { label: '가져오기', value: true, primary: true }],
  });
  if (!ok) return;
  try {
    const ids = await restoreBackup(bk);
    ids.forEach((id) => forgetPdf(id));
  } catch {
    return toast('가져오는 중 문제가 생겼습니다. 저장공간을 확인해 주세요.');
  }
  toast(`작품 ${bk.meta.projects.length}개를 가져왔습니다.`);
  route();
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
      for (const x of parts) await db.del('parts', x.id);
      await db.del('files', proj.fileId);
      forgetPdf(proj.fileId);
      await db.del('projects', proj.id);
      go('#/');
    }
  });
}

// ---------- 내 사이즈 ----------
const ORD = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟'];
function sizeOrdinal(i, n) {
  if (n === 3 && i === 1) return '괄호 안 숫자';
  return `${ORD[i] || i + 1} 번째 숫자`;
}

// 도안의 사이즈 표기를 보여 주고 내 사이즈(몇 번째 숫자인지)를 고른다. 저장하면 true
async function sizeSheet(proj) {
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
      <div class="field"><label for="szname">사이즈 이름 (선택)</label><input id="szname" class="input" autocomplete="off" placeholder="예: 슬림핏 S" value="${esc(proj.size || '')}"></div>
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

// ---------- 작품 정보 ----------
const NEEDLE_KINDS = ['줄바늘', '막대바늘', '장갑바늘', '코바늘', '기타'];

function fmtDate(d) {
  return d ? d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, dd) => `${y}.${+m}.${+dd}`) : '';
}

function infoLines(info) {
  if (!info) return [];
  const out = [];
  const yarns = (info.yarns || []).filter((y) => y.name || y.color || y.amount);
  if (yarns.length) out.push(['실', yarns.map((y) => [y.name, y.color, y.amount].filter(Boolean).map(esc).join(' · ')).join('<br>')]);
  const needles = (info.needles || []).filter((n) => n.mm || n.note);
  if (needles.length) out.push(['바늘', needles.map((n) => [n.kind, n.mm ? `${n.mm}mm` : '', n.note].filter(Boolean).map(esc).join(' · ')).join('<br>')]);
  const g = info.gauge || {};
  if (g.sts || g.rows) out.push(['게이지', `${esc(g.sts || '?')}코 × ${esc(g.rows || '?')}단 <span class="muted">(10cm)</span>${g.note ? ` · ${esc(g.note)}` : ''}`]);
  if (info.start || info.end) out.push(['기간', `${fmtDate(info.start) || '?'} ~ ${fmtDate(info.end) || '뜨는 중'}`]);
  if (info.memo) out.push(['메모', esc(info.memo).replace(/\n/g, '<br>')]);
  return out;
}

function infoCard(proj) {
  const lines = infoLines(proj.info);
  if (!lines.length) {
    return `<a class="btn dashed" href="#/info/${proj.id}">${icon.plus}작품 정보 적기 (실·바늘·게이지·날짜·메모)</a>`;
  }
  return `<a class="card info-card" href="#/info/${proj.id}">
    <div class="info-head"><span class="label">작품 정보</span><span class="small muted">고치기</span></div>
    <dl class="info-dl">${lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></a>`;
}

async function viewInfo(pid) {
  const proj = await db.get('projects', pid);
  if (!proj) return go('#/');
  const info = proj.info || {};
  info.yarns = info.yarns?.length ? info.yarns : [{}];
  info.needles = info.needles?.length ? info.needles : [{ kind: '줄바늘' }];
  info.gauge = info.gauge || {};
  const yarnRow = (y, i) => `<div class="rep-row" data-i="${i}">
      <input class="input" data-k="name" placeholder="실 이름 (예: 메리노 울)" value="${esc(y.name || '')}" autocomplete="off">
      <div class="rep-two"><input class="input" data-k="color" placeholder="색·로트" value="${esc(y.color || '')}" autocomplete="off">
      <input class="input" data-k="amount" placeholder="양 (예: 5볼)" value="${esc(y.amount || '')}" autocomplete="off"></div>
      ${i > 0 ? `<button type="button" class="link-btn rm" data-rm="yarns">이 실 지우기</button>` : ''}</div>`;
  const needleRow = (n, i) => `<div class="rep-row" data-i="${i}"><div class="rep-two">
      <select class="input" data-k="kind">${NEEDLE_KINDS.map((k) => `<option${k === n.kind ? ' selected' : ''}>${k}</option>`).join('')}</select>
      <input class="input" data-k="mm" inputmode="decimal" placeholder="굵기 mm" value="${esc(n.mm || '')}" autocomplete="off"></div>
      <input class="input" data-k="note" placeholder="용도 (예: 고무단, 몸판 · 80cm)" value="${esc(n.note || '')}" autocomplete="off">
      ${i > 0 ? `<button type="button" class="link-btn rm" data-rm="needles">이 바늘 지우기</button>` : ''}</div>`;
  const render = () => {
    app.innerHTML = `${header(`#/p/${pid}`, '작품 정보', esc(proj.name))}
    <div class="page"><form class="wrap" id="f">
      <div class="label">실</div>
      <div id="yarns">${info.yarns.map(yarnRow).join('')}</div>
      <button type="button" class="btn dashed" data-add="yarns">${icon.plus}실 추가</button>
      <div class="label">바늘</div>
      <div id="needles">${info.needles.map(needleRow).join('')}</div>
      <button type="button" class="btn dashed" data-add="needles">${icon.plus}바늘 추가</button>
      <div class="label">게이지 <span class="muted small">(10cm × 10cm)</span></div>
      <div class="rep-two">
        <div class="field"><label for="g-sts">코</label><input id="g-sts" class="input" inputmode="decimal" value="${esc(info.gauge.sts || '')}"></div>
        <div class="field"><label for="g-rows">단</label><input id="g-rows" class="input" inputmode="decimal" value="${esc(info.gauge.rows || '')}"></div>
      </div>
      <input id="g-note" class="input" placeholder="무늬·바늘 (예: 메리야스, 4mm)" value="${esc(info.gauge.note || '')}" autocomplete="off">
      <div class="label">기간</div>
      <div class="rep-two">
        <div class="field"><label for="d-start">시작한 날</label><input id="d-start" class="input" type="date" value="${esc(info.start || '')}"></div>
        <div class="field"><label for="d-end">완성한 날</label><input id="d-end" class="input" type="date" value="${esc(info.end || '')}"></div>
      </div>
      <div class="label">메모</div>
      <textarea id="memo" class="input area" rows="5" placeholder="수정한 점, 실 남은 양, 다음에 참고할 것…">${esc(info.memo || '')}</textarea>
      <p class="hint center">적는 대로 바로 저장됩니다.</p>
    </form></div>`;
    bind();
  };
  const collect = () => {
    for (const key of ['yarns', 'needles']) {
      app.querySelectorAll(`#${key} .rep-row`).forEach((row) => {
        const o = info[key][+row.dataset.i];
        row.querySelectorAll('[data-k]').forEach((el) => { o[el.dataset.k] = el.value.trim(); });
      });
    }
    const v = (id) => app.querySelector(id).value.trim();
    info.gauge = { sts: v('#g-sts'), rows: v('#g-rows'), note: v('#g-note') };
    info.start = v('#d-start');
    info.end = v('#d-end');
    info.memo = app.querySelector('#memo').value.replace(/\s+$/, '');
  };
  let t;
  const save = async () => {
    collect();
    const clean = {
      ...info,
      yarns: info.yarns.filter((y) => y.name || y.color || y.amount),
      needles: info.needles.filter((n) => n.mm || n.note),
    };
    const fresh = await db.get('projects', pid);
    fresh.info = clean;
    fresh.updated = Date.now();
    await db.put('projects', fresh);
  };
  const bind = () => {
    const f = app.querySelector('#f');
    f.addEventListener('submit', (e) => e.preventDefault());
    f.addEventListener('input', () => { clearTimeout(t); t = setTimeout(save, 400); });
    f.addEventListener('change', save);
    f.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      collect();
      const key = b.dataset.add;
      const last = info[key][info[key].length - 1] || {};
      info[key].push(key === 'needles' ? { kind: last.kind || '줄바늘' } : {});
      await save();
      render();
      const rows = app.querySelectorAll(`#${key} .rep-row`);
      rows[rows.length - 1].querySelector('input')?.focus();
    }));
    f.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      collect();
      info[b.dataset.rm].splice(+b.closest('.rep-row').dataset.i, 1);
      await save();
      render();
    }));
  };
  cleanups.push(() => { if (app.querySelector('#f')) { clearTimeout(t); save(); } });
  render();
}

async function partActions(id, proj, parts) {
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

// ---------- 등록 2. 파트 추가 ----------
function viewPartAdd(pid) {
  return partForm(pid, null);
}
async function viewPartEdit(id) {
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  return partForm(part.projectId, part);
}

// 파트 추가와 고치기는 같은 화면을 쓴다 (이름·형태·페이지 여러 장)
async function partForm(pid, editing) {
  const proj = await db.get('projects', pid);
  if (!proj) return go('#/');
  const parts = await db.partsOf(pid);
  const doc = await loadPdf(proj.fileId);
  const pages = editing ? segsOf(editing).map((x) => x.page) : []; // 고른 순서대로
  app.innerHTML = `${header(`#/p/${pid}`, editing ? '파트 고치기' : '파트 추가', `${esc(proj.name)}${proj.size ? ` · 사이즈 ${esc(proj.size)}` : ''}`)}
    <div class="page"><div class="wrap">
      <div class="field"><label for="ptname">파트 이름</label><input id="ptname" class="input" autocomplete="off" placeholder="예: 뒷판" value="${esc(editing?.name || '')}"></div>
      <div class="field"><span class="label">도안 형태</span>
        <div class="seg"><button type="button" data-kind="chart" aria-pressed="true">기호 차트</button><button type="button" data-kind="text" aria-pressed="false">글 설명만</button></div></div>
      <div class="label" id="pagelabel">차트가 있는 페이지를 고르세요</div>
      <p class="hint">페이지를 탭하면 크게 보고 고를 수 있습니다. 다음 쪽으로 이어지면 <b>순서대로 여러 장</b> 고르세요. 고른 페이지를 다시 누르면 빠집니다.${editing ? ' 그대로 둔 페이지는 영역·격자 설정이 유지됩니다.' : ''}</p>
      <div class="pick-order" id="order" hidden></div>
      <div class="thumbs" id="thumbs">${Array.from({ length: doc.numPages }, (_, i) =>
        `<button type="button" class="thumb" data-p="${i + 1}" aria-pressed="false"><span class="thumb-img"><canvas></canvas></span><span class="num">${i + 1}쪽</span></button>`).join('')}</div>
    </div></div>
    <div class="footer"><button class="btn primary" id="next" disabled>다음: 영역 지정</button></div>`;
  const nameIn = app.querySelector('#ptname');
  const nextBtn = app.querySelector('#next');
  let kind = editing ? (isText(editing) ? 'text' : 'chart') : 'chart';
  const setKind = (k) => {
    kind = k;
    app.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.kind === k)));
    app.querySelector('#pagelabel').textContent = kind === 'text' ? '설명이 있는 페이지를 고르세요' : '차트가 있는 페이지를 고르세요';
  };
  app.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    setKind(b.dataset.kind);
    check();
  }));
  // 고치기에서 더 설정할 게 남는지: 새 페이지가 있거나 형태가 바뀌면 설정 화면으로 이어간다
  const needsSetup = () => !editing || kind !== (isText(editing) ? 'text' : 'chart') ||
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
      const ok = await previewPage(doc, p, pages.length ? `${pages.length + 1}번째로 고르기` : '이 페이지로 고르기');
      if (!ok) return;
      pages.push(p);
      check();
      if (!nameIn.value.trim()) nameIn.focus();
    });
  });
  const blank = (pg) => (kind === 'text' ? { page: pg, area: null } : { page: pg, area: null, rows: null, cols: null });
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
    const oldKind = isText(part) ? 'text' : 'chart';
    if (kind !== oldKind) {
      const ok = await dialog({
        title: '도안 형태 바꾸기',
        body: `${kind === 'text' ? '글 설명' : '기호 차트'}로 바꾸면 ${oldKind === 'chart' ? '격자 설정과 ' : ''}진행 위치가 처음으로 돌아갑니다. 영역은 그대로 둡니다.`,
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
      return kind === 'text' ? { page: x.page, area: x.area } : kind !== oldKind ? { page: x.page, area: x.area, rows: null, cols: null } : x;
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

// ---------- 격자 맞추기 1~4단계 ----------
const STEP_LABELS = ['영역', '단 번호', '코 번호', '뜨는 방식'];
function stepsHtml(now) {
  return `<div class="steps">${STEP_LABELS.map((l, i) => {
    const n = i + 1;
    const cls = n < now ? 'done' : n === now ? 'now' : '';
    return `<div class="step ${cls}"><span class="num">${n}</span><span>${l}</span></div>`;
  }).join('')}</div>`;
}

async function viewCal(id, stepStr, segStr) {
  const step = +stepStr;
  const part = await db.get('parts', id);
  if (!part) return go('#/');
  const proj = await db.get('projects', part.projectId);
  const doc = await loadPdf(proj.fileId);
  part.cal = part.cal || {};
  const segs = segsOf(part);
  const seg = clamp(+(segStr || 0), 0, segs.length - 1);
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
  const top = header(back, '격자 맞추기', `${esc(part.name)} · ${vp.page}쪽${segTxt}`) + stepsHtml(step) +
    segChips(part, seg, (sg) => !!(sg.area && validPair(sg.rows, 'y') && validPair(sg.cols, 'x')));
  if (step === 1) return calArea(vp, proj, doc, top, save);
  return calPoints(vp, doc, top, save, step);
}

async function calArea(part, proj, doc, top, save) {
  app.innerHTML = `${top}
    <p class="lead">차트 영역을 자동으로 잡아 둡니다. 원하는 차트만 쓰려면 모서리를 끌어 고치세요. <b>대충</b> 감싸도 바로 옆 번호 칸은 자동으로 들어갑니다.</p>
    <div class="pv-box" id="pv"></div>
    <p class="hint pad">손가락으로 끌어서 그리고, 모서리를 끌어 크기를 고칩니다. 번호 칸이 글자로 읽히는 도안이면 위아래로 떨어진 차트도 한 파트로 묶을 수 있습니다. 사이의 빈 공간은 번호 칸 위치로 맞춥니다.</p>
    <button type="button" class="link-btn" id="autoarea">차트 영역 자동으로 다시 잡기</button>
    <div class="footer"><button type="button" class="btn" id="pg">페이지 다시 고르기</button>
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
  nextBtn.addEventListener('click', () => go(calNextUrl(part, 1)));
  app.querySelector('#pg').addEventListener('click', () => go(`#/pedit/${part.id}`));
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
      // "12", "→ 8", "7 ←", "8단" 처럼 화살표나 '단'이 붙은 번호도 읽는다
      const raw = (it.str || '').trim();
      const mm = raw.match(/^(?:[→←⇒⇐➝➜▶◀<>\-–—\s]|단)*(\d{1,3})(?:[→←⇒⇐➝➜▶◀<>\-–—.\s]|단)*$/);
      if (!mm) continue;
      const s = mm[1];
      const [a, b, , d, e, f] = it.transform;
      const h = Math.hypot(b, d) || it.height || 0;
      const w = it.width || h * 0.6 * s.length;
      const [x1, y1] = vp.convertToViewportPoint(e, f);
      const [x2, y2] = vp.convertToViewportPoint(e + w, f + h);
      const cx = (x1 + x2) / 2 / vp.width;
      const cy = (y1 + y2) / 2 / vp.height;
      if (cx < area.x - margin || cx > area.x + area.w + margin || cy < area.y - margin || cy > area.y + area.h + margin) continue;
      // 화살표가 붙어 있으면 상자 폭을 숫자 부분만큼으로 줄인다
      const hw = (Math.abs(x2 - x1) / 2 / vp.width) * (s.length / Math.max(1, raw.replace(/\s/g, '').length));
      out.push({ n: parseInt(s, 10), cx, cy, hw, hh: Math.abs(y2 - y1) / 2 / vp.height });
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
  // 단 번호가 왼쪽(짝수)·오른쪽(홀수)에 번갈아 적힌 차트: 두 세로줄을 합친 것도 후보로 본다
  const cands = groups.map((g) => g.items);
  if (key === 'y') {
    const big = groups.filter((g) => g.items.length >= 2);
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) cands.push([...big[i].items, ...big[j].items]);
  }
  for (const items of cands) {
    const it = items.slice().sort((p, q) => p[along] - q[along]);
    // 번호 간격과 위치 간격이 같은 비율로 이어지는 구간을 찾는다
    // (1,2,3…뿐 아니라 35,30,25…5,1처럼 띄엄띄엄 적힌 번호도 된다)
    let start = 0;
    let unit = null;
    let dir = 0;
    for (let i = 1; i <= it.length; i++) {
      let ok = false;
      if (i < it.length) {
        const dn = it[i].n - it[i - 1].n;
        const dp = it[i][along] - it[i - 1][along];
        const u = dn ? Math.abs(dp / dn) : 0;
        const sg = Math.sign(dn);
        ok = dn !== 0 && Math.abs(dn) <= 10 && u > 0 &&
          (i - start < 2 ? true : sg === dir && Math.abs(u - unit) < unit * 0.2);
        if (ok) {
          if (i - start < 2) { unit = u; dir = sg; } else unit = (unit * (i - start - 1) + u) / (i - start);
        }
      }
      if (!ok) {
        const len = i - start;
        const span = Math.abs(it[i - 1].n - it[start].n);
        if (len >= 3 && (!best || span > best.span || (span === best.span && len > best.len))) {
          best = { len, span, first: it[start], last: it[i - 1], items: it.slice(start, i) };
        }
        start = i;
        unit = null;
        dir = 0;
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

  app.innerHTML = `<div class="knit">
    <div class="k-main">
      <div class="k-top">
        <a class="icon-btn" href="#/p/${proj.id}" aria-label="파트 목록으로">${icon.back}</a>
        <button type="button" class="part-switch" id="sw" aria-label="다른 파트로 바꾸기">
          <span class="ps-t"><span class="ps-name">${esc(part.name)}</span><span class="ps-sub">${proj.size ? `사이즈 ${esc(proj.size)} · ` : ''}파트 ${idx + 1}/${parts.length}</span></span>${icon.chev}</button>
        <span class="k-spacer"></span>
        <span class="dir-chip" id="dir"></span>
        <button type="button" class="btn" id="legbtn">기호</button>
        <button type="button" class="btn" id="vidbtn">영상</button>
        <button type="button" class="btn" id="docbtn">도안</button>
      </div>
      ${segs.length > 1 ? '<div class="seg-chips k-segs" id="segs"></div>' : ''}
      <div class="k-chart" id="chart"></div>
      <button type="button" class="memo-card" id="memocard" hidden></button>
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
    // 메모가 있는 단은 왼쪽에 ✎ 표시
    for (const m of memosOf(part)) {
      if (m.row < R.lo || m.row > R.hi) continue;
      const y = v.n2p(0, R.at(m.row))[1];
      h += `<span class="memo-dot" style="left:4px;top:${y}px">✎</span><span class="memo-dot" style="left:${w - 26}px;top:${y}px">✎</span>`;
    }
    return h;
  };

  const rowcard = app.querySelector('#rowcard');
  const memoEl = app.querySelector('#memocard');
  let memoShownFor = null;
  const showMemo = (pr) => {
    const h = memoCardHtml(part, pr);
    memoEl.hidden = !h;
    memoEl.innerHTML = h;
    // 메모가 있는 단에 새로 오면 카드를 한 번 깜빡여 알린다
    const key = h ? pr.row : null;
    if (key !== null && key !== memoShownFor) { memoEl.classList.remove('pop'); void memoEl.offsetWidth; memoEl.classList.add('pop'); }
    memoShownFor = key;
  };
  memoEl.addEventListener('click', async () => { if (await editMemo(part, p().row)) refresh(false); });
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
    rowcard.innerHTML = `<span class="rc-top"><span>${pr.done ? '완료' : '지금'}</span><span class="rc-jump">${icon.edit}이동·메모</span></span>
      <span class="rc-num"><span class="num rc-big">${pr.row}</span><span class="rc-u">단</span><span class="num muted">/ ${RR.hi}</span></span>
      ${pr.done ? `<span class="tag-done">${icon.check}${esc(part.name)} 완료</span>`
        : pr.mark !== null && pr.mark !== undefined ? `<span class="rc-line"><i class="mk"></i>코 표시 <b class="num">${pr.mark}</b>번 칸</span>`
        : '<span class="rc-line muted">코 표시 없음</span>'}
      ${total !== null ? `<span class="rc-line small">반복 <b class="num">${pr.rep}/${total || '∞'}</b>회차 · 처음부터 <b class="num">${knitIndex(part) + 1}</b>단째</span>` : ''}
      ${memoHint(part, pr)}`;
    showMemo(pr);
    nextBtn.disabled = !!pr.done;
    nextBtn.textContent = pr.done ? '다 떴습니다' : '다음 단';
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
    const snap = snapshot();
    const res = nextRow(part);
    part.progress.touched = true;
    await save();
    const moved = await followSeg();
    refresh(moved ? 'first' : true);
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
      // 평소에는 알림 없이 넘어간다 (되돌리기는 '이전 단'). 반복이 새로 시작되거나 페이지가 바뀔 때만 짧게 알린다
      const note = [res === 'repeat' ? `반복 <b>${part.progress.rep}회차</b> 시작` : '', moved ? `<b>${moved}쪽</b> 차트로 넘어왔어요` : ''].filter(Boolean).join(' · ');
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
  rowcard.addEventListener('click', async () => {
    const act = await rowMenu(part, p().row);
    let r;
    if (act === 'memo') { if (await editMemo(part, p().row)) refresh(false); return; }
    if (act === 'list') r = await memoList(part, true, p().row);
    else if (act === 'jump') r = await keypad(RR, p().row);
    if (r === null || r === undefined) return;
    const snap = snapshot();
    jumpTo(part, r);
    part.progress.touched = true;
    await save();
    const moved = await followSeg();
    refresh(moved ? 'first' : true);
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
  app.querySelector('#legbtn').addEventListener('click', () => toggleLegend(proj, doc));
  app.querySelector('#vidbtn').addEventListener('click', () => videoMenu(proj, doc));

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
async function viewTextSetup(id, segStr) {
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
  let A = sg.area ? { ...sg.area } : { x: 0.03, y: 0.03, w: 0.94, h: 0.94 };
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
  const box = app.querySelector('#pv');
  box.innerHTML = '<div class="pv-stage"><canvas></canvas><div class="pv-rect"><i class="h tl"></i><i class="h tr"></i><i class="h bl"></i><i class="h br"></i></div></div>';
  const stage = box.querySelector('.pv-stage');
  const rect = box.querySelector('.pv-rect');
  let W = 0, H = 0;
  const draw = () => Object.assign(rect.style, { left: A.x * W + 'px', top: A.y * H + 'px', width: A.w * W + 'px', height: A.h * H + 'px' });
  const layout = async () => {
    const sz = await pageSize(doc, page);
    const cssW = Math.min(box.clientWidth - 2, ((box.clientHeight - 2) * sz.w) / sz.h);
    W = cssW;
    H = (cssW * sz.h) / sz.w;
    stage.style.width = W + 'px';
    stage.style.height = H + 'px';
    await renderPage(doc, page, stage.querySelector('canvas'), cssW);
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
    sg.area = A;
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
    sg.area = A; // 지금 잡던 영역은 남겨 두고 이동
    await db.put('parts', part);
    go(`#/pedit/${part.id}`);
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
        ${proj.sizes ? `<button type="button" class="sz-chip" id="szchip" aria-pressed="true">사이즈 ${esc(proj.sizes.labels?.[proj.sizes.idx] ?? proj.sizes.idx + 1)}</button>` : ''}
        <button type="button" class="btn" id="legbtn">기호</button>
        <button type="button" class="btn" id="vidbtn">영상</button>
        <button type="button" class="btn" id="docbtn">도안</button>
      </div>
      <div class="k-chart" id="chart"></div>
      <button type="button" class="memo-card" id="memocard" hidden></button>
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
    let h = sizeMarks(i, v);
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
  const memoEl = app.querySelector('#memocard');
  let memoShownFor = null;
  const showMemo = (pr) => {
    const h = memoCardHtml(part, pr);
    memoEl.hidden = !h;
    memoEl.innerHTML = h;
    // 메모가 있는 단에 새로 오면 카드를 한 번 깜빡여 알린다
    const key = h ? pr.row : null;
    if (key !== null && key !== memoShownFor) { memoEl.classList.remove('pop'); void memoEl.offsetWidth; memoEl.classList.add('pop'); }
    memoShownFor = key;
  };
  memoEl.addEventListener('click', async () => { if (await editMemo(part, p().row)) refresh(false); });
  const nextBtn = app.querySelector('#next');
  const refresh = () => {
    const pr = p();
    const pct = goal ? Math.min(100, ((pr.done ? goal : pr.row - 1) / goal) * 100) : 0;
    rowcard.innerHTML = `<span class="rc-top"><span>${pr.done ? '완료' : '지금 뜨는 단'}</span><span class="rc-jump">${icon.edit}이동·메모</span></span>
      <span class="rc-num"><span class="num rc-big">${pr.row}</span><span class="rc-u">단</span>${goal ? `<span class="num muted">/ ${goal}</span>` : ''}</span>
      ${goal ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}
      <span class="rc-line small muted">${pr.done ? `${esc(part.name)} 완료` : `${pr.row > 1 ? `${pr.row - 1}단까지 떴습니다` : '첫 단을 뜨는 중'}${goal ? ` · 목표까지 ${Math.max(0, goal - pr.row + 1)}단` : ''}`}</span>
      ${memoHint(part, pr)}`;
    showMemo(pr);
    nextBtn.disabled = !!pr.done;
    nextBtn.textContent = pr.done ? '다 떴습니다' : '다음 단';
    cv.redraw();
  };

  const zKey = `knit.textScale.${id}`;
  const segs = segsOf(part);
  let linesP = null;
  const cv = new StackView(app.querySelector('#chart'), {
    doc, pieces: segs.map((sg) => ({ page: sg.page, area: sg.area })), decorate,
    onScale: (sc) => { try { localStorage.setItem(zKey, String(sc)); } catch {} },
    onTap: async (i, nx, ny) => {
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
    const act = await rowMenu(part, p().row);
    let r;
    if (act === 'memo') { if (await editMemo(part, p().row)) refresh(); return; }
    if (act === 'list') r = await memoList(part, true, p().row);
    else if (act === 'jump') r = await keypad(R, p().row);
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
  app.querySelector('#legbtn').addEventListener('click', () => toggleLegend(proj, doc));
  app.querySelector('#vidbtn').addEventListener('click', () => videoMenu(proj, doc));
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

// ---------- 단 메모 ----------
const memosOf = (part) => (Array.isArray(part.memos) ? part.memos : (part.memos = []));
const memoAt = (part, row) => memosOf(part).find((m) => m.row === row);
const nextMemo = (part, row) => memosOf(part).filter((m) => m.row > row).sort((a, b) => a.row - b.row)[0];

// 메모 쓰기 창. 단 번호도 여기서 바로 적는다. {row, text} 저장, {del:true} 삭제, null 취소
function memoDialog(part, row) {
  return new Promise((resolve) => {
    const orig = memoAt(part, row);
    const el = document.createElement('div');
    el.className = 'scrim';
    el.innerHTML = `<form class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-title">단 메모</div>
      <div class="memo-row"><input class="input num" id="memo-row" inputmode="numeric" value="${row}" aria-label="단 번호"><span>단에</span></div>
      <textarea class="input area" id="memo-in" rows="4" placeholder="예: 여기서 목 라인 시작 · 양쪽 1코씩 줄임">${esc(orig?.text || '')}</textarea>
      <div class="dialog-btns"><button type="button" class="btn danger" data-del ${orig ? '' : 'hidden'}>삭제</button><button type="button" class="btn" data-x>취소</button><button class="btn primary">저장</button></div></form>`;
    const rowIn = el.querySelector('#memo-row');
    const txt = el.querySelector('#memo-in');
    let typed = false;
    txt.addEventListener('input', () => { typed = true; });
    // 단 번호를 바꾸면 그 단의 기존 메모를 불러온다 (아직 아무것도 안 적었을 때)
    const cur = () => parseInt(rowIn.value.replace(/\D/g, ''), 10);
    rowIn.addEventListener('input', () => {
      const m = memoAt(part, cur());
      if (!typed) txt.value = m?.text || '';
      el.querySelector('[data-del]').hidden = !m;
    });
    const done = (v) => { el.remove(); resolve(v); };
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const r = cur();
      if (!Number.isInteger(r) || r < 1) { rowIn.focus(); toast('단 번호를 적어주세요'); return; }
      const v = txt.value.trim();
      done(v ? { row: r, text: v } : memoAt(part, r) ? { row: r, del: true } : null);
    });
    el.querySelector('[data-x]').addEventListener('click', () => done(null));
    el.querySelector('[data-del]').addEventListener('click', () => done({ row: cur(), del: true }));
    document.getElementById('layer').appendChild(el);
    setTimeout(() => txt.focus(), 50);
  });
}

// 메모 달기·고치기 (row는 처음에 채워 둘 단 번호). 바뀌었으면 true
async function editMemo(part, row) {
  const r = await memoDialog(part, row);
  if (!r) return false;
  const m = memoAt(part, r.row);
  if (r.del) part.memos = memosOf(part).filter((x) => x !== m);
  else if (m) m.text = r.text;
  else memosOf(part).push({ row: r.row, text: r.text });
  part.memos.sort((a, b) => a.row - b.row);
  part.updated = Date.now();
  await db.put('parts', part);
  toast(r.del ? `${r.row}단 메모를 지웠습니다` : `${r.row}단 메모를 저장했습니다`);
  return true;
}

// 메모 목록. canJump면 고른 메모의 단으로 이동할지도 묻고, 이동할 단 번호를 돌려준다
async function memoList(part, canJump, curRow = 1) {
  const list = memosOf(part).slice().sort((a, b) => a.row - b.row);
  const row = await sheet(`${part.name} · 단 메모 ${list.length}개`, [
    { label: '+ 새 메모', value: 'new' },
    ...list.map((m) => ({ label: `${m.row}단`, sub: esc(m.text.length > 40 ? m.text.slice(0, 40) + '…' : m.text), value: m.row })),
  ]);
  if (row === undefined) return null;
  if (row === 'new') { await editMemo(part, curRow); return null; }
  if (!canJump) { await editMemo(part, row); return null; }
  const v = await sheet(`${row}단 메모`, [{ label: '메모 고치기', value: 'edit' }, { label: '이 단으로 이동', value: 'jump' }]);
  if (v === 'edit') { await editMemo(part, row); return null; }
  return v === 'jump' ? row : null;
}

// 단 카드를 눌렀을 때: 단 이동 / 메모
async function rowMenu(part, row) {
  const n = memosOf(part).length;
  return sheet(`지금 ${row}단`, [
    { label: '다른 단으로 이동 (번호 입력)', value: 'jump' },
    { label: '메모 달기 (단 번호를 적어서)', value: 'memo' },
    ...(n ? [{ label: `메모 전체 보기 (${n}개)`, value: 'list' }] : []),
  ]);
}

function memoCardHtml(part, pr) {
  const m = !pr.done && memoAt(part, pr.row);
  return m ? `<b>${pr.row}단 메모</b><span>${esc(m.text).replace(/\n/g, '<br>')}</span>` : '';
}
function memoHint(part, pr) {
  if (pr.done) return '';
  if (memoAt(part, pr.row)) return '<span class="rc-memo">✎ 이 단에 메모</span>';
  const nx = nextMemo(part, pr.row);
  return nx ? `<span class="rc-memo soft">다음 메모 ${nx.row}단 · ${nx.row - pr.row}단 남음</span>` : '';
}

// ---------- 기호 설명(범례) ----------
// 페이지에서 사각형 영역 하나를 고른다. 페이지는 ‹ › 로 넘길 수 있다. 고르면 {page, area}
function pickRegion(doc, { title, page, area }) {
  return new Promise((resolve) => {
    let pg = page;
    let A = area ? { ...area } : { x: 0.1, y: 0.1, w: 0.8, h: 0.4 };
    const el = document.createElement('div');
    el.className = 'docv';
    el.innerHTML = `<div class="docv-top"><b>${esc(title)}</b><span class="k-spacer"></span>
        <button type="button" class="icon-btn" data-x aria-label="닫기">${icon.close}</button></div>
      <div class="pg-step"><button type="button" class="btn" data-d="-1" aria-label="이전 페이지">‹</button><b id="pgno"></b><button type="button" class="btn" data-d="1" aria-label="다음 페이지">›</button></div>
      <p class="hint pad">기호 설명 부분을 손가락으로 끌어서 감싸주세요. 모서리를 끌면 크기를 바꿉니다.</p>
      <div class="pv-box" id="rpv"><div class="pv-stage"><canvas></canvas><div class="pv-rect"><i class="h tl"></i><i class="h tr"></i><i class="h bl"></i><i class="h br"></i></div></div></div>
      <div class="footer"><button type="button" class="btn" data-x>취소</button><button type="button" class="btn primary" data-ok>저장</button></div>`;
    document.getElementById('layer').appendChild(el);
    const box = el.querySelector('#rpv');
    const stage = el.querySelector('.pv-stage');
    const rect = el.querySelector('.pv-rect');
    let W = 0, H = 0;
    const draw = () => Object.assign(rect.style, { left: A.x * W + 'px', top: A.y * H + 'px', width: A.w * W + 'px', height: A.h * H + 'px' });
    const layout = async () => {
      el.querySelector('#pgno').textContent = `${pg}쪽 / ${doc.numPages}`;
      const sz = await pageSize(doc, pg);
      const cssW = Math.min(box.clientWidth - 2, ((box.clientHeight - 2) * sz.w) / sz.h);
      W = cssW;
      H = (cssW * sz.h) / sz.w;
      stage.style.width = W + 'px';
      stage.style.height = H + 'px';
      draw();
      await renderPage(doc, pg, stage.querySelector('canvas'), cssW);
    };
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
    el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
      const n = clamp(pg + +b.dataset.d, 1, doc.numPages);
      if (n !== pg) { pg = n; layout(); }
    }));
    const done = (v) => { el.remove(); resolve(v); };
    el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => done(null)));
    el.querySelector('[data-ok]').addEventListener('click', () => done({ page: pg, area: A }));
    requestAnimationFrame(layout);
  });
}

// 기호 설명이 있을 법한 페이지: 뜨개 약어·기호 이름이 가장 많이 나오는 페이지
async function guessLegendPage(doc) {
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
function legendsOf(proj) {
  if (!Array.isArray(proj.legends)) proj.legends = proj.legend ? [proj.legend] : [];
  delete proj.legend;
  return proj.legends;
}
const legendPages = (proj) => [...new Set(legendsOf(proj).map((l) => l.page))].join('·');

async function saveLegends(proj) {
  proj.updated = Date.now();
  await db.put('projects', proj);
}

// 영역 하나 추가 (i가 있으면 그 영역 다시 잡기). 저장했으면 true
async function pickLegend(proj, doc, i) {
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
async function setupLegend(proj, doc) {
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
async function manageLegends(proj, doc) {
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
let legendCv = null;
async function toggleLegend(proj, doc) {
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
function closeLegend() {
  legendCv?.destroy();
  legendCv = null;
  document.querySelector('.legend-pop')?.remove();
}

// ---------- 참고 영상 ----------
async function runVideoScan(proj, doc) {
  const t = toast('도안에서 QR 코드와 링크를 찾는 중…', { ms: 120000 });
  let found = [];
  try {
    found = await scanVideos(doc, (n, total) => { const sp = t.querySelector('span'); if (sp) sp.textContent = `도안에서 QR 코드와 링크를 찾는 중… ${n}/${total}쪽`; });
  } catch {
    t.remove();
    toast('QR 코드를 읽지 못했습니다');
    return;
  }
  t.remove();
  // 직접 넣은 링크는 남기고, 이름을 바꿔 둔 영상은 그 이름을 유지한다
  const old = proj.videos || [];
  const merged = found.map((f) => ({ ...f, title: old.find((o) => o.url === f.url && o.renamed)?.title || f.title, renamed: !!old.find((o) => o.url === f.url && o.renamed) }));
  for (const o of old) if (o.src === 'manual' && !merged.some((m) => m.url === o.url)) merged.push(o);
  proj.videos = merged;
  proj.videosScanned = true;
  proj.updated = Date.now();
  await db.put('projects', proj);
  toast(found.length ? `영상·링크 ${found.length}개를 찾았습니다` : '도안에서 QR 코드나 링크를 찾지 못했습니다');
}

const videoTitle = (v) => v.title || `${v.page ? `${v.page}쪽 ` : ''}${isYoutube(v.url) ? '영상' : '링크'}`;

// 영상 버튼: 목록을 보여 주고 고르면 유튜브(또는 그 링크)로 연다
async function videoMenu(proj, doc) {
  if (!proj.videosScanned) await runVideoScan(proj, doc);
  const list = proj.videos || [];
  const v = await sheet(list.length ? `참고 영상 ${list.length}개` : '참고 영상 (아직 없음)', [
    ...list.map((x, i) => ({
      label: videoTitle(x),
      sub: esc(`${isYoutube(x.url) ? '▶ 유튜브' : /영상|동영상|video/i.test(x.title || '') ? '▶ 영상' : '🔗 링크'}${x.page ? ` · ${x.page}쪽 ${x.src === 'qr' ? 'QR' : '링크'}` : ' · 직접 추가'} · ${hostOf(x.url)}`),
      value: i,
    })),
    { label: '+ 링크 직접 추가', value: 'add' },
    ...(list.length ? [{ label: '목록 고치기 (이름 바꾸기·빼기)', value: 'edit' }] : []),
    { label: '도안에서 다시 찾기', value: 'rescan' },
  ]);
  if (v === undefined) return;
  if (typeof v === 'number') { window.open(list[v].url, '_blank', 'noopener'); return; }
  if (v === 'rescan') { await runVideoScan(proj, doc); return videoMenu(proj, doc); }
  if (v === 'add') {
    const url = await ask('영상 링크', '', { placeholder: 'https://youtu.be/…', label: '유튜브 공유 버튼에서 복사한 주소를 붙여넣으세요' });
    if (!url) return videoMenu(proj, doc);
    if (!/^https?:\/\//i.test(url)) { toast('http로 시작하는 주소를 넣어주세요'); return videoMenu(proj, doc); }
    const title = await ask('영상 이름', '', { placeholder: '예: 감아코 영상' });
    (proj.videos = proj.videos || []).push({ url, title: title || '', page: null, src: 'manual', renamed: !!title });
    await db.put('projects', proj);
    return videoMenu(proj, doc);
  }
  if (v === 'edit') {
    const i = await sheet('어떤 영상을 고칠까요?', list.map((x, k) => ({ label: videoTitle(x), value: k })));
    if (i === undefined) return videoMenu(proj, doc);
    const a = await sheet(videoTitle(list[i]), [{ label: '이름 바꾸기', value: 'rename' }, { label: '목록에서 빼기', value: 'rm', danger: true }]);
    if (a === 'rename') {
      const n = await ask('영상 이름', list[i].title || '');
      if (n) { list[i].title = n; list[i].renamed = true; }
    } else if (a === 'rm') list.splice(i, 1);
    await db.put('projects', proj);
    return videoMenu(proj, doc);
  }
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
// iOS: 화면 전체가 핀치·더블탭으로 확대되지 않게 막는다 (차트는 자체 확대 사용)
for (const t of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
route();
navigator.storage?.persist?.().catch(() => {});
// iOS: 화면 전체가 핀치·더블탭으로 확대되지 않게 막는다 (차트는 자체 확대 사용)
for (const t of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
