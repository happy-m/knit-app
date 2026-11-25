// 격자 계산과 진행 위치 규칙 (화면과 무관한 순수 함수)

// 한 축의 격자. key: 'y'(단) 또는 'x'(코)
// pair.table([[번호, 좌표], ...])이 있으면 번호마다 읽은 실제 위치를 쓴다.
// 차트 사이에 빈 공간이 있어도 그대로 맞는다. 없으면 두 지점 사이를 같은 간격으로 나눈다.
export function axis(pair, key) {
  const { a, b } = pair;
  const lo = Math.min(a.n, b.n);
  const hi = Math.max(a.n, b.n);
  const step = (b[key] - a[key]) / (b.n - a.n);
  const t = Array.isArray(pair.table) && pair.table.length >= 3
    ? pair.table.slice().sort((p, q) => p[0] - q[0]) : null;
  if (!t) {
    const pitch = Math.abs(step);
    return {
      lo, hi, pitch, table: false,
      at: (n) => a[key] + (n - a.n) * step,
      pitchAt: () => pitch,
      nearest: (v) => Math.round(a.n + (v - a[key]) / step),
    };
  }
  const seg = (i) => (t[i + 1][1] - t[i][1]) / (t[i + 1][0] - t[i][0]);
  const at = (n) => {
    if (n <= t[0][0]) return t[0][1] + (n - t[0][0]) * seg(0);
    const L = t.length - 1;
    if (n >= t[L][0]) return t[L][1] + (n - t[L][0]) * seg(L - 1);
    let i = 0;
    while (t[i + 1][0] < n) i++;
    return t[i][1] + (n - t[i][0]) * seg(i);
  };
  // 한 칸 크기: 양옆 칸과의 거리 중 작은 쪽 (빈 공간 쪽은 무시된다)
  const pitchAt = (n) => Math.min(Math.abs(at(n) - at(n - 1)), Math.abs(at(n + 1) - at(n)));
  const diffs = [];
  for (let n = lo; n < hi; n++) diffs.push(Math.abs(at(n + 1) - at(n)));
  diffs.sort((p, q) => p - q);
  const pitch = diffs[Math.floor(diffs.length / 2)] || Math.abs(step);
  const nearest = (v) => {
    let best = lo;
    let bd = Infinity;
    for (let n = lo - 1; n <= hi + 1; n++) {
      const d = Math.abs(at(n) - v);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  return { lo, hi, pitch, table: true, at, pitchAt, nearest };
}

export const isText = (part) => part.kind === 'text';
export const isCirc = (part) => part.kind === 'circ';
// 'chart' | 'text' | 'circ'
export const kindOf = (part) => (isText(part) ? 'text' : isCirc(part) ? 'circ' : 'chart');
const ringOk = (r) => !!(r && r.a && r.b && r.c && Number.isInteger(r.n) && r.n >= 1);

// ---- 구간 ----
// 파트 하나가 여러 페이지(또는 한 페이지의 일부)에 걸칠 수 있다.
// part.segs = [{ page, area, rows, cols }] (글 설명 파트는 { page, area })
// 예전 형식(part.page + part.cal.area/rows/cols, part.text.area)은 구간 1개로 바꿔 읽는다.
export function segsOf(part) {
  if (!Array.isArray(part.segs) || !part.segs.length) {
    if (isText(part)) part.segs = [{ page: part.page, area: part.text?.area || null }];
    else if (isCirc(part)) part.segs = [{ page: part.page, area: null, ring: null }];
    else {
      const c = part.cal || {};
      part.segs = [{ page: part.page, area: c.area || null, rows: c.rows || null, cols: c.cols || null }];
    }
  }
  return part.segs;
}

// 구간 하나만 보는 가짜 파트. 한 페이지용 화면 코드를 그대로 쓰기 위한 것
export function segPart(part, i) {
  const s = segsOf(part)[i];
  return {
    ...part,
    segIndex: i,
    page: s.page,
    cal: { ...(part.cal || {}), area: s.area, rows: s.rows, cols: s.cols },
    text: isText(part) ? { ...(part.text || {}), area: s.area } : part.text,
  };
}

export function segReady(part, s) {
  if (isText(part)) return !!s.area;
  if (isCirc(part)) return !!(s.area && ringOk(s.ring));
  return !!(s.area && validPair(s.rows, 'y') && validPair(s.cols, 'x'));
}

export function calibrated(part) {
  const segs = segsOf(part);
  if (!segs.every((s) => segReady(part, s))) return false;
  return isText(part) || isCirc(part) ? true : !!part.cal?.mode;
}

export function validPair(pair, key) {
  if (!pair || !pair.a || !pair.b) return false;
  const { a, b } = pair;
  return (
    Number.isInteger(a.n) && Number.isInteger(b.n) && a.n !== b.n &&
    typeof a[key] === 'number' && typeof b[key] === 'number' && Math.abs(a[key] - b[key]) > 0.002
  );
}

// 구간 하나(segPart)면 그 구간의 격자, 파트 전체면 모든 구간을 합친 단 범위({lo, hi})
export function rowsOf(part) {
  if (isCirc(part)) return { lo: 1, hi: segsOf(part)[0]?.ring?.n || 1 };
  if (part.segIndex !== undefined) return axis(part.cal.rows, 'y');
  const ax = segsOf(part).filter((s) => validPair(s.rows, 'y')).map((s) => axis(s.rows, 'y'));
  if (!ax.length) return { lo: 1, hi: 1 };
  return { lo: Math.min(...ax.map((a) => a.lo)), hi: Math.max(...ax.map((a) => a.hi)) };
}
export function colsOf(part) {
  return axis(part.cal.cols, 'x');
}

// 이 단이 들어 있는 구간 번호. 어디에도 없으면 가장 가까운 구간
export function segForRow(part, row) {
  const segs = segsOf(part);
  let best = 0;
  let bd = Infinity;
  segs.forEach((s, i) => {
    if (!validPair(s.rows, 'y')) return;
    const a = axis(s.rows, 'y');
    const d = row < a.lo ? a.lo - row : row > a.hi ? row - a.hi : 0;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// 구간들이 걸친 페이지를 짧게: "5쪽", "5~6쪽", "5·8쪽"
export function pagesLabel(part) {
  const ps = [];
  for (const s of segsOf(part)) if (ps[ps.length - 1] !== s.page) ps.push(s.page);
  if (ps.length === 1) return `${ps[0]}쪽`;
  const run = ps.every((p, i) => i === 0 || p === ps[i - 1] + 1);
  return run ? `${ps[0]}~${ps[ps.length - 1]}쪽` : `${ps.join('·')}쪽`;
}

export function startProgress(part) {
  return { row: rowsOf(part).lo, rep: 1, mark: null, done: false };
}

// 처음부터 센 순번 (0부터). 세로 반복을 넘어가도 이어서 센다
export function knitIndex(part, p = part.progress) {
  const R = rowsOf(part);
  return (p.rep - 1) * (R.hi - R.lo + 1) + (p.row - R.lo);
}

// 지금 단을 겉면에서 뜨는지. 원통뜨기는 항상 겉면
export function isRightSide(part, p = part.progress) {
  const m = part.cal.mode;
  if (!m || m.type === 'round') return true;
  return (knitIndex(part, p) % 2 === 0) === (m.first !== 'WS');
}

// 차트 전체 반복 횟수. 반복 기능을 새로 설계하는 동안은 꺼 둔다 (항상 '반복 없음').
// 예전에 적어 둔 값(part.cal.mode.repeat)은 지우지 않고 남겨 두어 새 기능으로 옮길 수 있게 한다.
export function repeatTotal() {
  return null;
}

// 다음 단. 결과: 'next' | 'repeat' | 'finished'
export function nextRow(part) {
  const R = rowsOf(part);
  const p = part.progress;
  const total = repeatTotal(part);
  if (p.done) return 'finished';
  p.mark = null;
  if (p.row < R.hi) {
    p.row += 1;
    return 'next';
  }
  if (total !== null && (total === 0 || p.rep < total)) {
    p.rep += 1;
    p.row = R.lo;
    return 'repeat';
  }
  p.done = true;
  return 'finished';
}

export function prevRow(part) {
  const R = rowsOf(part);
  const p = part.progress;
  p.mark = null;
  if (p.done) {
    p.done = false;
    return true;
  }
  if (p.row > R.lo) {
    p.row -= 1;
    return true;
  }
  if (repeatTotal(part) !== null && p.rep > 1) {
    p.rep -= 1;
    p.row = R.hi;
    return true;
  }
  return false;
}

export function jumpTo(part, row) {
  const R = rowsOf(part);
  const p = part.progress;
  p.row = Math.max(R.lo, Math.min(R.hi, row));
  p.mark = null;
  p.done = false;
}

export function partStatus(part) {
  if (!calibrated(part)) return 'setup';
  if (part.progress?.done) return 'done';
  if (part.progress?.touched) return 'active';
  return 'ready';
}
