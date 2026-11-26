// 반복 화면: 구간 반복(몇 단~몇 단을 몇 번)과 전체 반복(차트 전체를 몇 번)을 정하고 고친다
// 계산은 knitting.js에 있다 (repsOf, nextRow …)
import { uid } from '../db.js';
import { esc, toast } from '../ui.js';
import { repsOf, activeRange, wholeRepeat, knitIndex, rangeProblem, endRange } from '../model/progress.js';

const layer = () => document.getElementById('layer');
const num = (el) => { const v = parseInt((el.value || '').replace(/\D/g, ''), 10); return Number.isInteger(v) ? v : null; };
const timesTxt = (t, unit) => (t ? `${t}${unit}` : '횟수 미정');

// 단 카드에 넣는 줄: "처음부터 47단째" (반복이 있을 때만)
export function repLines(part, pr) {
  const reps = repsOf(part);
  if ((!reps.ranges.length && !reps.whole) || pr.done) return '';
  return `<span class="rc-line small rc-rep muted">처음부터 <b class="num">${knitIndex(part, pr) + 1}</b>단째</span>`;
}

// 단 카드 아래 반복 띠에 넣는 말: "3~6단 반복 · 9회차", "전체 반복 · 2번째 / 12개". 반복이 없으면 ''
export function repBarText(part, pr) {
  const reps = repsOf(part);
  if (!reps.ranges.length && !reps.whole) return '';
  const out = [];
  const a = pr.done ? null : activeRange(part, pr);
  if (a) out.push(`${a.range.from}~${a.range.to}단 반복 · <b class="num">${a.iter}${a.range.times ? `/${a.range.times}` : ''}회차</b>`);
  const w = wholeRepeat(part, pr);
  if (w) out.push(`${a ? '' : '전체 반복 · '}<b class="num">${w.now}번째</b>${w.times ? ` / ${w.times}개` : ''}`);
  if (!out.length) out.push(`구간 반복 ${reps.ranges.map((g) => `${g.from}~${g.to}단`).join(', ')}`);
  return `<span aria-hidden="true">↻</span> ${out.join(' · ')}`;
}

// '다음 단' 결과에 따라 짧게 알릴 말. 알릴 게 없으면 ''
export function repNote(part, res) {
  const pr = part.progress;
  if (res === 'range') {
    const a = activeRange(part, pr);
    return a ? `${a.range.from}~${a.range.to}단 반복 <b>${a.iter}${a.range.times ? `/${a.range.times}` : ''}회차</b>` : '';
  }
  if (res === 'repeat') {
    const w = wholeRepeat(part, pr);
    return `${w.now - 1}번째 완료 · <b>${w.now}번째</b> 시작`;
  }
  return '';
}

// 파트 목록에 붙는 짧은 설명
export function repSummary(part) {
  const reps = repsOf(part);
  const bits = [];
  if (reps.ranges.length) bits.push(`구간 반복 ${reps.ranges.length}개`);
  if (reps.whole) bits.push(`전체 ${timesTxt(reps.whole.times, '번')}`);
  return bits.join(' · ');
}

// 숫자 칸 몇 개짜리 작은 입력 창. fields: [{ key, label, value, unit, optional }], extra: 아래쪽 버튼 [{ label, value, danger }]
function form(title, hint, fields, extra = []) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'scrim';
    el.innerHTML = `<form class="dialog rep-form" role="dialog" aria-modal="true">
      <div class="dialog-title">${esc(title)}</div>
      ${hint ? `<p class="small muted">${hint}</p>` : ''}
      ${extra.filter((x) => x.top).map((x) => `<button type="button" class="btn rep-extra rep-pick" data-extra="${x.value}">${x.label}</button>`).join('')}
      <div class="rep-fields">${fields.map((f) => `<label><span>${f.label}</span>
        <span class="suffix"><input class="input num" data-k="${f.key}" inputmode="numeric" pattern="[0-9]*" value="${f.value ?? ''}" placeholder="${f.optional ? '미정' : ''}"><span>${f.unit}</span></span></label>`).join('')}</div>
      ${extra.filter((x) => !x.top).map((x) => `<button type="button" class="btn${x.danger ? ' danger' : ''} rep-extra" data-extra="${x.value}">${x.label}</button>`).join('')}
      <div class="dialog-btns"><button type="button" class="btn" data-x>취소</button><button class="btn primary">저장</button></div></form>`;
    const done = (v) => { el.remove(); resolve(v); };
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      el.querySelectorAll('[data-k]').forEach((i) => { out[i.dataset.k] = num(i); });
      done(out);
    });
    el.querySelector('[data-x]').addEventListener('click', () => done(null));
    el.querySelectorAll('[data-extra]').forEach((b) => b.addEventListener('click', () => done({ extra: b.dataset.extra })));
    layer().appendChild(el);
    // 도안에서 고르는 버튼이 있으면 자판을 바로 띄우지 않는다 (자판이 버튼을 가린다)
    if (!extra.some((x) => x.top)) setTimeout(() => el.querySelector('input')?.focus(), 50);
  });
}

// 도안에서 단을 탭해 시작·끝 단을 고르는 중인지. 뜨기 화면이 탭을 이쪽으로 넘긴다
let picking = null;
export const rowPick = {
  armed: () => !!picking,
  tap: (row) => picking?.tap(row),
};

// 위쪽에 안내 띠를 띄우고 도안에서 두 단을 탭받는다. { from, to } 또는 취소하면 null
function pickRows() {
  return new Promise((resolve) => {
    const bar = document.createElement('div');
    bar.className = 'pick-bar';
    let from = null;
    const draw = () => {
      bar.innerHTML = `<span>${from === null ? '반복 <b>시작 단</b>을 도안에서 탭하세요' : `시작 ${from}단 · <b>끝 단</b>을 탭하세요`}</span><button type="button">취소</button>`;
    };
    const done = (v) => {
      picking = null;
      bar.remove();
      window.removeEventListener('hashchange', cancel);
      resolve(v);
    };
    const cancel = () => done(null);
    bar.addEventListener('click', (e) => { if (e.target.closest('button')) cancel(); });
    window.addEventListener('hashchange', cancel);
    picking = {
      tap(row) {
        if (from === null) { from = row; draw(); return; }
        done({ from: Math.min(from, row), to: Math.max(from, row) });
      },
    };
    draw();
    layer().appendChild(bar);
  });
}

async function editRange(part, g, pre, viaPick) {
  const isNew = !g;
  if (viaPick) {
    const got = await pickRows();
    if (!got) return false;
    return editRange(part, g, got);
  }
  const p = part.progress;
  const cur = g && activeRange(part, p)?.range === g ? activeRange(part, p).iter : null;
  const r = await form(isNew ? '구간 반복 추가' : `${g.from}~${g.to}단 반복`,
    '끝 단에서 <b>다음 단</b>을 누르면 시작 단으로 돌아갑니다. 횟수를 비우면 직접 끝낼 때까지 반복합니다.', [
      { key: 'from', label: '시작', value: pre?.from ?? g?.from ?? p.row, unit: '단' },
      { key: 'to', label: '끝', value: pre?.to ?? g?.to ?? '', unit: '단' },
      { key: 'times', label: '횟수', value: g?.times ?? '', unit: '회', optional: true },
      ...(cur ? [{ key: 'iter', label: '지금', value: cur, unit: '회차' }] : []),
    ], [
      { label: '도안에서 시작·끝 단 고르기', value: 'pick', top: true },
      ...(isNew ? [] : [
      ...(cur && !g.times ? [{ label: '이 반복 끝내고 다음 단으로', value: 'end' }] : []),
      { label: '이 반복 지우기', value: 'del', danger: true }]),
    ]);
  if (!r) return false;
  if (r.extra === 'pick') {
    const got = await pickRows();
    if (!got && isNew) return false;
    return editRange(part, g, got || pre);
  }
  const reps = repsOf(part);
  if (r.extra === 'del') {
    reps.ranges = reps.ranges.filter((x) => x !== g);
    if (p.rr) delete p.rr[g.id];
    return true;
  }
  if (r.extra === 'end') { endRange(part, g); return true; }
  const next = { id: g?.id || uid(), from: r.from, to: r.to, times: r.times && r.times > 0 ? r.times : null };
  if (next.times === 1) { toast('1회는 반복이 아니에요. 2회 이상을 적거나 비워 두세요.'); return editRange(part, g, next); }
  const bad = rangeProblem(part, next);
  if (bad) { toast(bad); return editRange(part, g, next); }
  if (isNew) reps.ranges.push(next); else Object.assign(g, next);
  reps.ranges.sort((a, b) => a.from - b.from);
  if (r.iter) (p.rr ||= {})[next.id] = Math.max(1, next.times ? Math.min(r.iter, next.times) : r.iter);
  return true;
}

async function editWhole(part) {
  const reps = repsOf(part);
  const p = part.progress;
  const isText = part.kind === 'text';
  const w = reps.whole;
  const r = await form('전체 반복', '차트(또는 설명) 전체를 여러 번 뜹니다. 모티브처럼 같은 것을 여러 장 뜰 때 쓰세요. 개수를 비우면 직접 끝낼 때까지 셉니다.', [
    ...(isText ? [{ key: 'goal', label: '한 번에 몇 단', value: part.text?.goal ?? '', unit: '단' }] : []),
    { key: 'times', label: '몇 개', value: w?.times ?? '', unit: '개', optional: true },
    ...(w ? [{ key: 'now', label: '지금', value: p.rep || 1, unit: '번째' }] : []),
  ], w ? [{ label: '전체 반복 끄기', value: 'del', danger: true }] : []);
  if (!r) return false;
  if (r.extra === 'del') { reps.whole = null; p.rep = 1; return true; }
  if (isText) {
    // 글 도안은 한 번이 몇 단인지 알아야 처음으로 돌아갈 수 있다
    if (!r.goal || r.goal < 1) { toast('한 번에 몇 단인지 적어주세요.'); return editWhole(part); }
    if (r.goal < p.row) { toast(`지금 ${p.row}단을 뜨는 중이라 그보다 작게는 못 정해요.`); return editWhole(part); }
    (part.text ||= {}).goal = r.goal;
  }
  reps.whole = { times: r.times && r.times > 1 ? r.times : null };
  if (r.now) p.rep = Math.max(1, reps.whole.times ? Math.min(r.now, reps.whole.times) : r.now);
  return true;
}

// 반복 목록 시트. save(): 파트 저장. 무엇이든 바뀌었으면 true
export function repeatSheet(part, save) {
  return new Promise((resolve) => {
    let changed = false;
    const el = document.createElement('div');
    el.className = 'scrim sheet-scrim';
    const draw = () => {
      const reps = repsOf(part);
      const p = part.progress;
      const act = p.done ? null : activeRange(part, p);
      const w = wholeRepeat(part, p);
      el.innerHTML = `<div class="sheet tool-sheet" role="dialog" aria-modal="true">
        <div class="sheet-title">반복</div>
        <div class="label">구간 반복 · 몇 단부터 몇 단까지를 여러 번</div>
        ${reps.ranges.map((g, i) => `<button type="button" class="rep-item" data-range="${i}">
          <b>${g.from}~${g.to}단 × ${timesTxt(g.times, '회')}</b>
          <span>${act?.range === g ? `지금 ${act.iter}회차` : '고치기'}</span></button>`).join('')}
        <div class="rep-add"><button type="button" class="btn dashed" data-addpick>+ 도안에서 고르기</button><button type="button" class="btn dashed" data-add>+ 단 번호 입력</button></div>
        <div class="label">전체 반복 · 차트 전체를 여러 번 (모티브 등)</div>
        <button type="button" class="${w ? 'rep-item' : 'btn dashed'}" data-whole>${w
          ? `<b>전체 × ${timesTxt(w.times, '개')}</b><span>지금 ${w.now}번째</span>` : '+ 전체 반복 켜기'}</button>
        <button type="button" class="sheet-item sheet-cancel" data-x>닫기</button></div>`;
    };
    const run = async (fn) => {
      el.hidden = true;
      if (await fn()) { changed = true; await save(); }
      el.hidden = false;
      draw();
    };
    el.addEventListener('click', (e) => {
      const rg = e.target.closest('[data-range]');
      if (rg) return run(() => editRange(part, repsOf(part).ranges[+rg.dataset.range]));
      if (e.target.closest('[data-addpick]')) return run(() => editRange(part, null, null, true));
      if (e.target.closest('[data-add]')) return run(() => editRange(part, null));
      if (e.target.closest('[data-whole]')) return run(() => editWhole(part));
      if (e.target.closest('[data-x]') || e.target === el) { el.remove(); resolve(changed); }
    });
    draw();
    layer().appendChild(el);
  });
}
