// 격자 계산과 진행 위치 규칙 (화면과 무관한 순수 함수)

// 두 지점(a, b)의 좌표와 번호로 한 축의 격자를 만든다. key: 'y'(단) 또는 'x'(코)
export function axis(pair, key) {
  const { a, b } = pair;
  const step = (b[key] - a[key]) / (b.n - a.n); // 번호 1당 이동량 (부호 있음)
  return {
    lo: Math.min(a.n, b.n),
    hi: Math.max(a.n, b.n),
    pitch: Math.abs(step),
    at: (n) => a[key] + (n - a.n) * step,
    nearest: (v) => Math.round(a.n + (v - a[key]) / step),
  };
}

export function calibrated(part) {
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
