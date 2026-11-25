// PDF 글자에서 단·코 번호와 글줄 읽기
import { validPair } from './knitting.js';
import { clamp } from './core.js';

// PDF 글자 층에서 숫자만 모아 둔다 (영역 안쪽, 정규화 좌표)
export async function readNumberLabels(page, area, margin = 0) {
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
      const [, b, , d, e, f] = it.transform;
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
export function buildTable(labels, pair, key) {
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

export async function growToLabels(doc, pageNum, A) {
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
export function autoDetect(labels, key) {
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
        // 바로 다음 번호(±1)는 간격이 달라도 잇는다 (차트 사이 빈 공간 대비).
        // 띄엄띄엄 적힌 번호는 번호 간격과 위치 간격의 비율이 같아야 잇는다
        const first = i - start < 2;
        const step1 = Math.abs(dn) === 1 && (first || sg === dir);
        const sameUnit = !first && sg === dir && unit && Math.abs(u - unit) < unit * 0.2;
        ok = dn !== 0 && Math.abs(dn) <= 10 && u > 0 && (first || step1 || sameUnit);
        if (ok) {
          if (first) { unit = u; dir = sg; } else if (Math.abs(dn) > 1 || !unit) unit = unit ? (unit + u) / 2 : u;
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
export async function proposeArea(doc, pageNum) {
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

export function nearestLabel(labels, nx, ny) {
  let best = null;
  let bd = Infinity;
  for (const l of labels) {
    // 글자 상자 크기로 나눈 거리: 상자 안이면 1 이하
    const d = Math.hypot((nx - l.cx) / Math.max(l.hw, 0.004), (ny - l.cy) / Math.max(l.hh, 0.004));
    if (d < bd) { bd = d; best = l; }
  }
  return bd <= 4 ? best : null;
}

// PDF 글자 층에서 줄 단위 위치를 모은다 (영역 안, 정규화 좌표)
export async function readTextLines(page, area) {
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
