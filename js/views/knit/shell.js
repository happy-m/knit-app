// 뜨기 화면 세 가지(기호 차트·원형 차트·글 설명)가 함께 쓰는 뼈대와 조작
import * as db from '../../db.js';
import { loadPdf } from '../../pdf.js';
import { esc, icon, ro, toast, dialog, sheet } from '../../ui.js';
import { partStatus } from '../../model/knitting.js';
import { nextRow, prevRow, jumpTo } from '../../model/progress.js';
import { app, go, onCleanup } from '../../core.js';
import { partHref } from '../../partnav.js';
import { editMemo, memoList, rowMenu, memoCardHtml, memoHint } from '../../sheets/memo.js';
import { toggleLegend } from '../../sheets/legend.js';
import { keypad, openDoc } from '../../sheets/dialogs.js';
import { videoMenu } from '../../sheets/videoui.js';
import { pinControl } from '../../sheets/pins.js';
import { repLines, repBarText, repNote, repeatSheet } from '../../sheets/reps.js';

// ---- 세 가지 뜨기 화면이 함께 쓰는 것 ----

// 화면 뼈대: 위쪽 줄(뒤로·파트 바꾸기·기호·영상·도안), 차트 자리, 메모 카드, 아래 조작부
export function knitShell({ proj, parts, idx }, part, { cls = '', top = '', beforeChart = '', afterChart = '' } = {}) {
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
      <div class="k-sub">
        <button type="button" class="btn prev-btn" id="prev" aria-label="이전 단">${icon.undo}</button>
        <button type="button" class="btn memo-btn" id="memobtn" aria-label="메모 입력">${icon.memo}</button>
      </div>
      <button type="button" class="rep-bar" id="repbar" hidden></button>
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

// 파트를 다 떴을 때 다음 파트로 넘어갈지 묻는다
async function offerNextPart(part, nextPart, lead) {
  const yes = await dialog({
    title: `<span class="ok">${icon.check}${esc(part.name)} 완료</span>`,
    body: `${lead}<br>다음 파트 <span class="pill-hl">${esc(nextPart.name)}</span>${ro(nextPart.name)} 넘어갈까요?`,
    buttons: [{ label: '아니오', value: false }, { label: '네', value: true, primary: true }],
  });
  if (yes) go(partHref(nextPart));
}


// 뜨기 화면을 열 때 필요한 것을 불러오고, 이 파트를 '마지막으로 뜬 파트'로 적어 둔다
export async function loadKnit(part) {
  const proj = await db.get('projects', part.projectId);
  const parts = await db.partsOf(proj.id);
  const doc = await loadPdf(proj.fileId);
  const idx = parts.findIndex((x) => x.id === part.id);
  proj.lastPartId = part.id;
  proj.updated = Date.now();
  await db.put('projects', proj);
  return { proj, parts, doc, idx, nextPart: parts[idx + 1] };
}

// 세 화면이 똑같이 하는 일: 단 카드 그리기, 다음 단·이전 단·단 이동, 메모·반복·핀, 되돌리기.
// 화면마다 다른 것만 받는다.
//   range: 단 이동 자판의 범위 { lo, hi }      total(): 단 카드의 "/ N" (없으면 null)
//   lines(pr): 단 카드 가운데 줄(HTML)          label: 카드 왼쪽 위 글자
//   finished: 다 떴을 때 다음 파트를 권하는 말
//   redraw(how): 도안 다시 그리기. how가 참이면 지금 단이 보이게 따라간다 ('first'는 처음 띄울 때)
//   sync(dir): 단이 바뀐 직후 화면을 맞춘다(다른 쪽 차트로 바꾸기 등). { how, note }나 null을 돌려준다
export function knitControls({ ctx, part, range, total, lines, label = '지금 뜨는 단', finished, redraw, sync = async () => null }) {
  const p = () => part.progress;
  const rowcard = app.querySelector('#rowcard');
  const nextBtn = app.querySelector('#next');
  const repbar = app.querySelector('#repbar');
  const save = async () => { part.updated = Date.now(); await db.put('parts', part); };
  const pins = pinControl(part, save, () => redraw());
  const showMemo = memoCard(part, () => p().row, () => refresh());

  const refresh = (how) => {
    const pr = p();
    const n = total();
    rowcard.innerHTML = `<span class="rc-top"><span>${pr.done ? '완료' : label}</span><span class="rc-jump">${icon.edit}이동·핀</span></span>
      <span class="rc-num"><span class="num rc-big">${pr.row}</span><span class="rc-u">단</span>${n ? `<span class="num muted">/ ${n}</span>` : ''}</span>
      ${lines(pr)}
      ${repLines(part, pr)}
      ${memoHint(part, pr)}`;
    const bar = repBarText(part, pr);
    repbar.hidden = !bar;
    repbar.innerHTML = bar;
    showMemo(pr);
    nextBtn.disabled = !!pr.done;
    nextBtn.textContent = pr.done ? '완료' : '다음 단';
    redraw(how);
  };
  // 단이 바뀐 뒤: 저장하고, 화면을 맞추고, 다시 그린다
  const settle = async (dir) => {
    p().touched = true;
    await save();
    const m = await sync(dir);
    refresh(m?.how || true);
    return m;
  };
  const restore = async (snap) => {
    part.progress = JSON.parse(snap);
    await save();
    const m = await sync('jump');
    refresh(m?.how || true);
  };
  // r단으로 옮기고 '취소'할 수 있게 알린다
  const jump = async (r) => {
    const snap = JSON.stringify(p());
    jumpTo(part, r);
    await settle('jump');
    toast(`<b>${r}단</b>으로 이동했습니다`, { action: '취소', onAction: () => restore(snap) });
  };

  nextBtn.addEventListener('click', async () => {
    const res = nextRow(part);
    const m = await settle('next');
    if (res === 'finished') {
      if (ctx.nextPart) await offerNextPart(part, ctx.nextPart, finished);
      return;
    }
    // 평소에는 알림 없이 넘어간다 (되돌리기는 '이전 단'). 반복이 새로 시작되거나 쪽이 바뀔 때만 짧게 알린다
    const note = [repNote(part, res), m?.note].filter(Boolean).join(' · ');
    if (note) toast(note, { ms: 1800 });
  });
  app.querySelector('#prev').addEventListener('click', async () => {
    if (!prevRow(part)) { toast('첫 단입니다'); return; }
    const m = await settle('prev');
    if (m?.note) toast(m.note);
  });
  app.querySelector('#memobtn').addEventListener('click', async () => { if (await editMemo(part, p().row)) refresh(); });
  repbar.addEventListener('click', async () => { if (await repeatSheet(part, save)) refresh(); });
  // 단 카드: 누르면 도구 시트(단 이동·메모·반복·핀)를 띄우고 고른 일을 한다
  rowcard.addEventListener('click', async () => {
    const row = p().row;
    const act = await rowMenu(part, row);
    if (await pins.handle(act)) return;
    if (act === 'memo') { if (await editMemo(part, row)) refresh(); return; }
    if (act === 'reps') { if (await repeatSheet(part, save)) refresh(); return; }
    let r;
    if (act === 'list') r = await memoList(part, true, row);
    else if (act === 'jump') r = await keypad(range, row);
    if (r !== null && r !== undefined) await jump(r);
  });
  bindKnitCommon({ ...ctx, id: part.id });

  return { refresh, save, pins, jump };
}
