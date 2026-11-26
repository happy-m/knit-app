// 파트 상태 글귀와 화면 주소
import { calibrated, rowsOf, partStatus, isText, segsOf, segReady, pagesLabel, isCirc } from './model/knitting.js';
import { repSummary } from './sheets/reps.js';

export function partMeta(part) {
  const pages = pagesLabel(part);
  const rep = repSummary(part) ? ` · ${repSummary(part)}` : '';
  if (isText(part)) return `글 설명 · ${pages}${part.text?.goal ? ` · 목표 ${part.text.goal}단` : ''}${rep}`;
  if (!calibrated(part)) return `${isCirc(part) ? '원형 · ' : ''}${pages} · 설정 중`;
  if (isCirc(part)) return `원형 · 1~${rowsOf(part).hi}단 · ${pages}${rep}`;
  const R = rowsOf(part);
  const m = part.cal.mode;
  return `${m.type === 'round' ? '원통' : '평면'} · ${R.lo}~${R.hi}단 · ${pages}${rep}`;
}

export function partHref(part) {
  if (calibrated(part)) return `#/k/${part.id}`;
  const i = segsOf(part).findIndex((s) => !segReady(part, s));
  if (isText(part)) return `#/txt/${part.id}/${Math.max(0, i)}`;
  if (isCirc(part)) return calUrl(part.id, segsOf(part)[0].area ? 2 : 1, 0);
  return i < 0 ? `#/cal/${part.id}/4` : `#/cal/${part.id}/1/${i}`;
}

// 격자 맞추기 주소. 1~3단계는 구간마다, 4단계(뜨는 방식)는 파트 전체에 한 번
export function calUrl(id, step, seg = 0) {
  return step >= 4 ? `#/cal/${id}/4` : `#/cal/${id}/${step}/${seg}`;
}

// 다음 단계: 3단계 다음은 다음 구간의 1단계, 마지막 구간이면 4단계
export function calNextUrl(part, step) {
  const seg = part.segIndex ?? 0;
  if (step < 3) return calUrl(part.id, step + 1, seg);
  return seg + 1 < segsOf(part).length ? calUrl(part.id, 1, seg + 1) : calUrl(part.id, 4);
}

export function calPrevUrl(part, step, seg, projId) {
  if (step === 4) return calUrl(part.id, 3, segsOf(part).length - 1);
  if (step > 1) return calUrl(part.id, step - 1, seg);
  return seg > 0 ? calUrl(part.id, 3, seg - 1) : `#/p/${projId}`;
}

// 구간이 여럿이면 지금 어느 구간인지 칩으로 보여준다
export function segChips(part, now, ready) {
  const segs = segsOf(part);
  if (segs.length < 2) return '';
  return `<div class="seg-chips">${segs.map((sg, i) => {
    const ok = ready(sg, i) && i !== now;
    return `<span class="chip${i === now ? ' on' : ok ? ' ok' : ''}">${i + 1} · ${sg.page}쪽${ok ? ' ✓' : ''}</span>`;
  }).join('')}</div>`;
}

export function currentPart(proj, parts) {
  return parts.find((x) => x.id === proj.lastPartId) || parts.find((x) => partStatus(x) !== 'done') || parts[0];
}
