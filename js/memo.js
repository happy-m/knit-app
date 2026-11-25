// 단 메모
import * as db from './db.js';
import { esc, toast, sheet } from './ui.js';

export const memosOf = (part) => (Array.isArray(part.memos) ? part.memos : (part.memos = []));

export const memoAt = (part, row) => memosOf(part).find((m) => m.row === row);

export const nextMemo = (part, row) => memosOf(part).filter((m) => m.row > row).sort((a, b) => a.row - b.row)[0];

// 메모 쓰기 창. 단 번호도 여기서 바로 적는다. {row, text} 저장, {del:true} 삭제, null 취소
export function memoDialog(part, row) {
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
export async function editMemo(part, row) {
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
export async function memoList(part, canJump, curRow = 1) {
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
export async function rowMenu(part, row) {
  const n = memosOf(part).length;
  return sheet(`지금 ${row}단`, [
    { label: '다른 단으로 이동 (번호 입력)', value: 'jump' },
    { label: '메모 달기 (단 번호를 적어서)', value: 'memo' },
    ...(n ? [{ label: `메모 전체 보기 (${n}개)`, value: 'list' }] : []),
  ]);
}

export function memoCardHtml(part, pr) {
  const m = !pr.done && memoAt(part, pr.row);
  return m ? `<b>${pr.row}단 메모</b><span>${esc(m.text).replace(/\n/g, '<br>')}</span>` : '';
}

export function memoHint(part, pr) {
  if (pr.done) return '';
  if (memoAt(part, pr.row)) return '<span class="rc-memo">✎ 이 단에 메모</span>';
  const nx = nextMemo(part, pr.row);
  return nx ? `<span class="rc-memo soft">다음 메모 ${nx.row}단 · ${nx.row - pr.row}단 남음</span>` : '';
}
