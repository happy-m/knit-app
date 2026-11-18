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

export function calibrated(part) {
  if (isText(part)) return !!(part.text && part.text.area);
  const c = part.cal || {};
  return !!(c.area && validPair(c.rows, 'y') && validPair(c.cols, 'x') && c.mode);
}

export function validPair(pair, key) {
  if (!pair || !pair.a || !pair.b) return false;
  const { a, b } = pair;
  return (
    Number.isInteger(a.n) && Number.isInteger(b.n) && a.n !== b.n &&
    typeof a[key] === 'number' && typeof b[key] === 'number' && Math.abs(a[key] - b[key]) > 0.002
  );
}

export function rowsOf(part) {
  return axis(part.cal.rows, 'y');
}
export function colsOf(part) {
  return axis(part.cal.cols, 'x');
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
  if (m.type === 'round') return true;
  return (knitIndex(part, p) % 2 === 0) === (m.first !== 'WS');
}

export function repeatTotal(part) {
  const r = part.cal.mode?.repeat;
  return r === null || r === undefined || r === '' ? null : Number(r);
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
  if (p.rep > 1) {
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
