// 사이즈별 숫자 읽기: "36 (39) 43", "10 (10) 10", "S (M) L" 같은 표기를 PDF 글자에서 찾는다
// 좌표는 페이지 기준 0~1 정규화 ({x, y, w, h})

const NUM = '\\d+(?:\\.\\d+)?';
const LIST = `${NUM}(?:\\s*[,/]\\s*${NUM})*`;
const SIZE_RE = new RegExp(`(${NUM})\\s*\\(\\s*(${LIST})\\s*\\)\\s*(${LIST})`, 'g');
const NUM_RE = new RegExp(NUM, 'g');

let measureCtx = null;
function measurer() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

// 페이지 글자를 한 줄 문자열로 이어 붙이고, 글자마다 위치를 계산할 수 있게 해 둔다
const pageCache = new WeakMap();
async function pageText(page, fresh = false) {
  if (!fresh && pageCache.has(page)) return pageCache.get(page);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  let text = '';
  const map = []; // 글자 → [item 번호, 글자 번호]
  const items = [];
  tc.items.forEach((it) => {
    if (it.str === undefined) return;
    const idx = items.length;
    items.push(it);
    for (let k = 0; k < it.str.length; k++) map.push([idx, k]);
    text += it.str;
    if (it.hasEOL) { text += '\n'; map.push(null); }
  });
  const ctx = measurer();
  // item 안에서 k번째 글자가 시작하는 위치(0~1).
  // 페이지를 그린 뒤라면 PDF에 들어 있는 글꼴(fontName)로 재서 더 정확하다
  const cums = items.map((it) => {
    const fam = tc.styles?.[it.fontName]?.fontFamily || 'sans-serif';
    ctx.font = `100px "${it.fontName}", ${fam}`;
    const ws = [0];
    for (let k = 0; k < it.str.length; k++) ws.push(ws[k] + ctx.measureText(it.str[k]).width);
    const tot = ws[ws.length - 1] || 1;
    return ws.map((w) => w / tot);
  });
  const charBox = (ci) => {
    const m = map[ci];
    if (!m) return null;
    const [ii, k] = m;
    const it = items[ii];
    const [, b, , d, e, f] = it.transform;
    const h = Math.hypot(b, d) || it.height || 0;
    const w = it.width || 0;
    const xa = e + w * cums[ii][k];
    const xb = e + w * cums[ii][k + 1];
    const [x1, y1] = vp.convertToViewportPoint(xa, f - h * 0.18);
    const [x2, y2] = vp.convertToViewportPoint(xb, f + h * 0.88);
    return { x0: Math.min(x1, x2) / vp.width, x1: Math.max(x1, x2) / vp.width, y0: Math.min(y1, y2) / vp.height, y1: Math.max(y1, y2) / vp.height };
  };
  const spanBox = (a, b) => {
    let r = null;
    for (let i = a; i < b; i++) {
      const c = charBox(i);
      if (!c || c.x1 - c.x0 <= 0) continue;
      r = r ? { x0: Math.min(r.x0, c.x0), x1: Math.max(r.x1, c.x1), y0: Math.min(r.y0, c.y0), y1: Math.max(r.y1, c.y1) } : c;
    }
    return r && { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
  };
  const out = { text, spanBox };
  pageCache.set(page, out);
  return out;
}

// 한 페이지의 사이즈 숫자 묶음들: [{nums: [box…], parens: [box…], values: ['36','39','43']}]
export async function readSizeGroups(page, area) {
  try {
    const { text, spanBox } = await pageText(page, true);
    const groups = [];
    for (const m of text.matchAll(SIZE_RE)) {
      const nums = [];
      const values = [];
      const parens = [];
      for (let i = 0; i < m[0].length; i++) {
        const ch = m[0][i];
        if (ch === '(' || ch === ')') {
          const bx = spanBox(m.index + i, m.index + i + 1);
          if (bx) parens.push(bx);
        }
      }
      for (const n of m[0].matchAll(NUM_RE)) {
        const bx = spanBox(m.index + n.index, m.index + n.index + n[0].length);
        if (!bx) break;
        nums.push(bx);
        values.push(n[0]);
      }
      if (nums.length < 3 || nums.length !== values.length) continue;
      const c = nums[0];
      if (area && (c.x + c.w / 2 < area.x || c.x > area.x + area.w || c.y + c.h / 2 < area.y || c.y + c.h / 2 > area.y + area.h)) continue;
      groups.push({ nums, parens, values });
    }
    return groups;
  } catch {
    return [];
  }
}

// 도안에서 "사이즈 1 (2) 3" 같은 사이즈 이름 표기와 예시 숫자를 찾는다
export async function findSizeInfo(doc) {
  const LABEL_RE = /(?:사이즈|size)\s*[:：]?\s*([^\s()]{1,8})\s*\(\s*([^)]{1,40})\)\s*([^\s,()]{1,8}(?:\s*[,/]\s*[^\s,()]{1,8})*)/i;
  let labels = null;
  let labelPage = null;
  let labelLines = [];
  const examples = [];
  const counts = {};
  for (let pn = 1; pn <= doc.numPages; pn++) {
    let page;
    try { page = await doc.getPage(pn); } catch { continue; }
    const { text } = await pageText(page);
    if (!labels) {
      const m = text.match(LABEL_RE);
      if (m) {
        labels = [m[1], ...m[2].split(/[,/]/), ...m[3].split(/[,/]/)].map((x) => x.trim()).filter(Boolean);
        labelPage = pn;
        // 표기가 있는 줄과 그 다음 줄 (예: 가슴둘레 88 (96) 108 cm)
        const start = text.lastIndexOf('\n', m.index) + 1;
        labelLines = text.slice(start).split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 2);
      }
    }
    for (const m of text.matchAll(SIZE_RE)) {
      const vals = m[0].match(NUM_RE);
      counts[vals.length] = (counts[vals.length] || 0) + 1;
      // 숫자가 서로 다른 예시가 더 알아보기 쉽다
      if (examples.length < 3 && new Set(vals).size === vals.length) {
        const s = text.lastIndexOf('\n', m.index) + 1;
        let e = text.indexOf('\n', m.index + m[0].length);
        if (e < 0) e = text.length;
        const before = text.slice(Math.max(s, m.index - 12), m.index);
        const after = text.slice(m.index + m[0].length, Math.min(e, m.index + m[0].length + 10));
        examples.push({ before, values: vals, after });
      }
    }
  }
  const n = labels?.length || +Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  if (labels && labels.length !== n) labels = null;
  return { n, labels, labelPage, labelLines, examples };
}
