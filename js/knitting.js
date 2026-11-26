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
  return { row: rowsOf(part).lo, rep: 1, rr: {}, mark: null, done: false };
}

// ---- 반복 ----
// part.reps = { ranges: [{ id, from, to, times }], whole: { times } | null }
//   ranges: 구간 반복 (from~to단을 times번). whole: 차트 전체를 times번 (모티브 등). times가 null이면 횟수 미정
// 진행: progress.rr[id] = 그 구간의 지금 회차(1부터), progress.rep = 전체 반복에서 지금 몇 번째(1부터)
export function repsOf(part) {
  if (!part.reps) {
    // 예전 '무늬 반복' 값(0 = 횟수 미정)을 전체 반복으로 옮긴다
    const old = part.cal?.mode?.repeat;
    part.reps = { ranges: [], whole: old === null || old === undefined || old === '' ? null : { times: Number(old) || null } };
  }
  part.reps.ranges = part.reps.ranges || [];
  return part.reps;
}

// 단 범위. 글 설명 파트는 1 ~ 목표 단수(없으면 끝없음)
export function boundsOf(part) {
  if (isText(part)) return { lo: 1, hi: part.text?.goal || Infinity };
  const R = rowsOf(part);
  return { lo: R.lo, hi: R.hi };
}

const rangeAt = (part, row) => repsOf(part).ranges.find((g) => row >= g.from && row <= g.to);
const iterOf = (p, g) => Math.max(1, (p.rr && p.rr[g.id]) || 1);

// 지금 단이 들어 있는 구간 반복과 회차: { range, iter } 또는 null
export function activeRange(part, p = part.progress) {
  const g = rangeAt(part, p.row);
  return g ? { range: g, iter: iterOf(p, g) } : null;
}

// 전체 반복: { times, now } 또는 null
export function wholeRepeat(part, p = part.progress) {
  const w = repsOf(part).whole;
  return w ? { times: w.times || null, now: p.rep || 1 } : null;
}

// 차트를 한 번 다 뜨는 데 드는 단 수 (구간 반복 포함, 횟수 미정 구간은 1번으로 센다)
export function passLength(part) {
  const { lo, hi } = boundsOf(part);
  if (!Number.isFinite(hi)) return Infinity;
  return hi - lo + 1 + repsOf(part).ranges.reduce((n, g) => n + ((g.times || 1) - 1) * (g.to - g.from + 1), 0);
}

// 처음부터 센 순번 (0부터). 반복해서 뜬 단도 모두 센다
export function knitIndex(part, p = part.progress) {
  const { lo } = boundsOf(part);
  let n = p.row - lo;
  for (const g of repsOf(part).ranges) {
    if (g.from > p.row) continue;
    // 지나온 구간은 끝까지 돈 것으로, 지금 있는 구간은 지금 회차까지
    const it = p.row > g.to ? Math.max(iterOf(p, g), g.times || 1) : iterOf(p, g);
    n += (it - 1) * (g.to - g.from + 1);
  }
  const len = passLength(part);
  if (repsOf(part).whole && Number.isFinite(len)) n += ((p.rep || 1) - 1) * len;
  return n;
}

// 전체 진행률 0~1 (횟수가 정해지지 않았으면 차트 한 번 기준)
export function progressFrac(part, p = part.progress) {
  if (!p) return 0;
  if (p.done) return 1;
  const len = passLength(part);
  if (!Number.isFinite(len)) return 0;
  const w = repsOf(part).whole;
  const total = len * ((w && w.times) || 1);
  const idx = w && !w.times ? knitIndex(part, { ...p, rep: 1 }) : knitIndex(part, p);
  return Math.max(0, Math.min(1, idx / total));
}

// 지금 단을 겉면에서 뜨는지. 원통뜨기는 항상 겉면. 반복으로 실제 뜬 순서를 따른다
export function isRightSide(part, p = part.progress) {
  const m = part.cal.mode;
  if (!m || m.type === 'round') return true;
  return (knitIndex(part, p) % 2 === 0) === (m.first !== 'WS');
}

// 다음 단. 결과: 'next' | 'range'(구간 반복으로 되돌아감) | 'repeat'(전체 반복 다음 번째) | 'finished'
export function nextRow(part) {
  const p = part.progress;
  if (p.done) return 'finished';
  p.mark = null;
  p.rr = p.rr || {};
  const g = rangeAt(part, p.row);
  if (g && p.row === g.to) {
    const it = iterOf(p, g);
    if (!g.times || it < g.times) {
      p.rr[g.id] = it + 1;
      p.row = g.from;
      return 'range';
    }
  }
  return stepForward(part);
}

// 지금 단 다음으로 한 단 나아간다 (구간 반복은 따지지 않음): 다음 단, 전체 반복의 다음 번째, 또는 완료
function stepForward(part) {
  const { lo, hi } = boundsOf(part);
  const p = part.progress;
  if (p.row < hi) {
    p.row += 1;
    return 'next';
  }
  const w = repsOf(part).whole;
  if (w && (!w.times || (p.rep || 1) < w.times)) {
    p.rep = (p.rep || 1) + 1;
    p.row = lo;
    p.rr = {};
    return 'repeat';
  }
  p.done = true;
  return 'finished';
}

export function prevRow(part) {
  const { lo, hi } = boundsOf(part);
  const p = part.progress;
  p.mark = null;
  p.rr = p.rr || {};
  if (p.done) {
    p.done = false;
    return true;
  }
  const g = rangeAt(part, p.row);
  if (g && p.row === g.from && iterOf(p, g) > 1) {
    p.rr[g.id] = iterOf(p, g) - 1;
    p.row = g.to;
    return true;
  }
  if (p.row > lo) {
    p.row -= 1;
    // 위쪽 구간으로 되돌아 들어가면 그 구간은 마지막 회차 상태다
    const up = rangeAt(part, p.row);
    if (up && p.row === up.to && up.times) p.rr[up.id] = Math.max(iterOf(p, up), up.times);
    return true;
  }
  if (repsOf(part).whole && (p.rep || 1) > 1 && Number.isFinite(hi)) {
    p.rep -= 1;
    p.row = hi;
    for (const x of repsOf(part).ranges) p.rr[x.id] = x.times || 1;
    return true;
  }
  return false;
}

// 그 단으로만 옮긴다 (회차는 그대로)
export function jumpTo(part, row) {
  const { lo, hi } = boundsOf(part);
  const p = part.progress;
  p.row = Math.max(lo, Math.min(hi, row));
  p.mark = null;
  p.done = false;
}

// 구간 반복을 지금 회차에서 끝내고 그다음 단으로 (횟수 미정 반복을 끝낼 때)
export function endRange(part, g) {
  const p = part.progress;
  p.mark = null;
  p.row = g.to;
  return stepForward(part);
}

// 구간이 서로 겹치는지, 범위를 벗어나는지 확인. 문제가 있으면 안내 문구, 없으면 ''
export function rangeProblem(part, g) {
  const { lo, hi } = boundsOf(part);
  if (!Number.isInteger(g.from) || !Number.isInteger(g.to)) return '시작 단과 끝 단을 적어주세요.';
  if (g.from > g.to) return '시작 단이 끝 단보다 클 수 없습니다.';
  if (g.from < lo || g.to > hi) return `${lo}단부터 ${Number.isFinite(hi) ? `${hi}단` : '끝'}까지의 단만 넣을 수 있습니다.`;
  if (g.from === lo && g.to === hi) return "차트 전체를 반복할 때는 '전체 반복'을 쓰세요.";
  const clash = repsOf(part).ranges.find((x) => x.id !== g.id && g.from <= x.to && g.to >= x.from);
  return clash ? `${clash.from}~${clash.to}단 반복과 겹칩니다.` : '';
}

export function partStatus(part) {
  if (!calibrated(part)) return 'setup';
  if (part.progress?.done) return 'done';
  if (part.progress?.touched) return 'active';
  return 'ready';
}
