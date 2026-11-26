// 첫 화면(작품 목록), 새 작품, 백업
import * as db from '../db.js';
import { openPdfData, forgetPdf } from '../pdf.js';
import { buildBackup, readBackup, restoreBackup } from '../model/backup.js';
import { esc, icon, eul, toast, dialog, ask, sheet } from '../ui.js';
import { rowsOf, partStatus, isText } from '../model/knitting.js';
import { progressFrac } from '../model/progress.js';
import { APP_VERSION } from '../version.js';
import { app, go, clamp, route, header } from '../core.js';
import { partHref, currentPart } from '../partnav.js';
import { photoIdsOf } from './info.js';

export let pending = null; // 새 작품으로 고른 PDF (작품을 만들기 전까지 메모리에만 둔다)

export async function viewHome() {
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
        if (hi && hi < 9999) pct = progressFrac(cur) * 100;
        center = `${row}단`; ringCls = String(row).length > 2 ? 'is-long' : '';
      }
      bits.push(`파트 ${done}/${parts.length}`);
    } else {
      bits.push('파트를 추가하세요');
    }
    if (p.size) bits.push(esc(p.size));
    const resume = cur && !alert ? partHref(cur) : null;
    cards.push(`<div class="swipe" data-id="${p.id}"><button type="button" class="sw-del" tabindex="-1">삭제</button><div class="card proj-row sw-row">
      <a class="pr-main" href="#/p/${p.id}">
        <span class="ring ${ringCls}" style="--p:${pct}%"><span>${center}</span></span>
        <span class="pr-t"><b>${esc(p.name)}</b><span class="pr-sub">${bits.join(' · ')}</span></span>
      </a>
      ${resume ? `<a class="play" href="${resume}" aria-label="${esc(p.name)} 이어서 뜨기"><svg viewBox="0 0 16 16" width="16" height="16"><path d="M4.5 2.5l9 5.5-9 5.5z" fill="currentColor"/></svg></a>` : ''}
    </div></div>`);
  }
  app.innerHTML = `
    <div class="head home-head"><h1 class="big-title">내 작품</h1>
      <label class="btn primary small">${icon.plus}새 작품<input type="file" accept="application/pdf,.pdf" hidden></label></div>
    <div class="page"><div class="wrap">
      ${cards.join('')}
      ${projects.length ? '' : `<label class="empty-card"><input type="file" accept="application/pdf,.pdf" hidden>
        <b>${icon.plus}도안 PDF로 새 작품</b><span>파일 앱에서 도안 PDF를 고르면 시작해요</span></label>`}
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
  bindSwipeRows(projects);
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

// 작품 하나를 지운다 (파트·도안 PDF·기록 모두)
export async function removeProject(proj) {
  for (const id of photoIdsOf(proj)) await db.del('files', id);
  for (const x of await db.partsOf(proj.id)) await db.del('parts', x.id);
  const others = (await db.all('projects')).filter((x) => x.id !== proj.id && x.fileId === proj.fileId);
  if (!others.length) {
    await db.del('files', proj.fileId);
    forgetPdf(proj.fileId);
  }
  await db.del('projects', proj.id);
}

export async function confirmRemoveProject(proj) {
  const ok = await dialog({
    title: `${esc(proj.name)} 삭제`,
    body: '도안 PDF와 모든 파트, 진행 기록이 이 기기에서 지워집니다. 되돌릴 수 없습니다.',
    buttons: [{ label: '취소', value: false }, { label: '삭제', value: true, danger: true }],
  });
  if (!ok) return false;
  await removeProject(proj);
  toast(`${esc(proj.name)}${eul(proj.name)} 지웠습니다`);
  return true;
}

// 첫 화면 작품 줄: 왼쪽으로 밀면 삭제 버튼, 길게 누르면 메뉴
export function bindSwipeRows(projects) {
  const OPEN = 88;
  let openRow = null;
  const setX = (row, x, anim) => {
    row.style.transition = anim ? 'transform .2s ease' : 'none';
    row.style.transform = x ? `translateX(${x}px)` : '';
    row.closest('.swipe').classList.toggle('open', x < 0);
  };
  const closeOpen = () => { if (openRow) { setX(openRow, 0, true); openRow = null; } };
  const byId = (id) => projects.find((x) => x.id === id);
  const menu = async (id) => {
    closeOpen();
    const proj = byId(id);
    if (!proj) return;
    navigator.vibrate?.(10);
    const v = await sheet(proj.name, [
      { label: '열기', value: 'open' },
      { label: '작품 이름 바꾸기', value: 'rename' },
      { label: '작품 삭제', value: 'delete', danger: true },
    ]);
    if (v === 'open') go(`#/p/${id}`);
    else if (v === 'rename') {
      const n = await ask('작품 이름', proj.name);
      if (n) { proj.name = n; await db.put('projects', proj); route(); }
    } else if (v === 'delete' && await confirmRemoveProject(proj)) route();
  };
  app.querySelectorAll('.swipe').forEach((wrap) => {
    const row = wrap.querySelector('.sw-row');
    const id = wrap.dataset.id;
    let st = null;
    let timer = null;
    let swallow = false; // 밀거나 길게 누른 뒤 따라오는 클릭은 무시
    row.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      if (openRow && openRow !== row) closeOpen();
      st = { x: e.clientX, y: e.clientY, base: openRow === row ? -OPEN : 0, dir: null, id: e.pointerId };
      swallow = false;
      clearTimeout(timer);
      timer = setTimeout(() => { if (st && !st.dir) { st = null; swallow = true; menu(id); } }, 550);
    });
    row.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.dir && Math.hypot(dx, dy) > 8) {
        clearTimeout(timer);
        st.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        if (st.dir === 'h') { try { row.setPointerCapture(e.pointerId); } catch {} }
      }
      if (st.dir === 'h') setX(row, clamp(st.base + dx, -OPEN - 24, 0), false);
    });
    const end = (e) => {
      clearTimeout(timer);
      if (!st) return;
      if (st.dir === 'h') {
        swallow = true;
        const dx = e.clientX - st.x;
        const open = st.base + dx < -OPEN / 2;
        setX(row, open ? -OPEN : 0, true);
        openRow = open ? row : openRow === row ? null : openRow;
      } else if (!st.dir && openRow === row) {
        swallow = true;
        closeOpen();
      }
      st = null;
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', (e) => { clearTimeout(timer); if (st?.dir === 'h') end(e); st = null; });
    row.addEventListener('click', (e) => { if (swallow) { e.preventDefault(); e.stopPropagation(); swallow = false; } }, true);
    row.addEventListener('contextmenu', (e) => e.preventDefault());
    wrap.querySelector('.sw-del').addEventListener('click', async () => {
      const proj = byId(id);
      if (proj && await confirmRemoveProject(proj)) route();
      else closeOpen();
    });
  });
}

export async function exportBackup() {
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

export async function importBackup(file) {
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

export async function viewNew() {
  if (!pending) return go('#/');
  const mb = (pending.bytes / 1048576).toFixed(1);
  app.innerHTML = `${header('#/', '새 작품', '도안 PDF로 만들기')}
    <div class="page"><form class="wrap" id="f">
      <div class="card file-card"><span class="file-ico">${icon.file}</span>
        <span class="file-t"><b>${esc(pending.fileName)}</b><span class="muted small">${pending.pages}쪽 · ${mb}MB · 폰 안에 저장됨</span></span></div>
      <div class="field"><label for="pname">작품 이름</label><input id="pname" class="input" value="${esc(pending.name)}" autocomplete="off" required></div>
      <div class="field"><label for="psize">내가 뜰 사이즈 (선택)</label><input id="psize" class="input" autocomplete="off" placeholder="예: M">
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
