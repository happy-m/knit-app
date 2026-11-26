// 도안 속 참고 영상 찾기: 페이지의 QR 코드와 링크를 읽어 주소 목록을 만든다
import { OPS } from '../../vendor/pdf.min.mjs';
const QR_WIDTH = 1700; // QR 코드를 읽을 때 페이지를 그리는 폭(px)

let jsQRP = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsQRP) {
    jsQRP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/jsQR.min.js';
      s.onload = () => resolve(window.jsQR);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return jsQRP;
}

const isUrl = (s) => /^https?:\/\//i.test(s || '');
export const isYoutube = (u) => /(^|\/\/)(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(u);
export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// QR 바로 아래(없으면 위)에 붙은 설명 글자를 제목으로 쓴다
function captionNear(items, vp, box) {
  const pick = (below) => {
    const got = [];
    for (const it of items) {
      const s = (it.str || '').trim();
      if (!s) continue;
      const [, b, , d, e, f] = it.transform;
      const h = Math.hypot(b, d) || 0;
      const [x1, y1] = vp.convertToViewportPoint(e, f);
      const [x2] = vp.convertToViewportPoint(e + (it.width || 0), f + h);
      const nx = (x1 + x2) / 2 / vp.width;
      const ny = y1 / vp.height;
      const inX = nx > box.x - box.w * 0.4 && nx < box.x + box.w * 1.4;
      const dy = below ? ny - (box.y + box.h) : box.y - ny;
      if (inX && dy > -0.004 && dy < 0.05) got.push({ s, ny, nx });
    }
    got.sort((a, b) => a.ny - b.ny || a.nx - b.nx);
    return got.map((g) => g.s).join(' ').trim();
  };
  return (pick(true) || pick(false)).slice(0, 40);
}

// 페이지에 그려진 그림 중 QR 코드일 법한 정사각형들의 위치(px, vp 기준)
async function squareImages(page, vp) {
  const ops = await page.getOperatorList();
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const out = [];
  const IMG = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter((x) => x !== undefined));
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    else if (fn === OPS.paintFormXObjectBegin && ops.argsArray[i]?.[0]) { stack.push(ctm); ctm = mul(ctm, ops.argsArray[i][0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (IMG.has(fn)) {
      // 그림은 (0,0)~(1,1) 단위 사각형을 ctm으로 옮긴 자리에 그려진다
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => vp.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const r = b.w / (b.h || 1);
      if (r > 0.8 && r < 1.25 && b.w > vp.width * 0.03 && b.w < vp.width * 0.5) out.push(b);
    }
  }
  return out;
}

// 도안 전체를 훑어 영상·링크 목록을 만든다. onProgress(지금 페이지, 전체)
export async function scanVideos(doc, onProgress) {
  const jsQR = await loadJsQR();
  const found = [];
  const seen = new Set();
  const add = (url, title, page, src) => {
    url = url.trim();
    if (!isUrl(url) || seen.has(url)) return;
    seen.add(url);
    found.push({ url, title: title || '', page, src });
  };
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  for (let pn = 1; pn <= doc.numPages; pn++) {
    onProgress?.(pn, doc.numPages);
    let page;
    try { page = await doc.getPage(pn); } catch { continue; }
    const vp1 = page.getViewport({ scale: 1 });
    let items = [];
    try { items = (await page.getTextContent()).items; } catch {}
    // 1) PDF 안의 링크
    try {
      for (const a of await page.getAnnotations()) {
        if (a.subtype !== 'Link' || !a.url) continue;
        const [x1, y1, x2, y2] = a.rect;
        const [px1, py1] = vp1.convertToViewportPoint(x1, y2);
        const [px2, py2] = vp1.convertToViewportPoint(x2, y1);
        const box = { x: px1 / vp1.width, y: py1 / vp1.height, w: (px2 - px1) / vp1.width, h: (py2 - py1) / vp1.height };
        add(a.url, captionNear(items, vp1, box), pn, 'link');
      }
    } catch {}
    // 2) QR 코드
    try {
      const scale = QR_WIDTH / vp1.width;
      const vp = page.getViewport({ scale });
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const hits = [];
      // 2-1) 페이지에 들어 있는 정사각형 그림마다 따로 잘라서 읽는다 (여러 개가 붙어 있어도 잘 읽힘)
      for (const b of await squareImages(page, vp)) {
        const pad = Math.round(b.w * 0.12) + 8;
        const w = Math.round(b.w + pad * 2);
        const h = Math.round(b.h + pad * 2);
        const c2 = document.createElement('canvas');
        c2.width = w;
        c2.height = h;
        const x2 = c2.getContext('2d', { willReadFrequently: true });
        x2.fillStyle = '#fff';
        x2.fillRect(0, 0, w, h);
        x2.drawImage(cv, b.x - pad, b.y - pad, w, h, 0, 0, w, h);
        const code = jsQR(x2.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
        if (code) hits.push({ data: code.data, box: { x: b.x / cv.width, y: b.y / cv.height, w: b.w / cv.width, h: b.h / cv.height } });
      }
      // 2-2) 그림으로 못 찾았으면 페이지 전체에서: 하나 읽으면 그 자리를 하얗게 지우고 다시 찾는다
      if (!hits.length) {
        const img = ctx.getImageData(0, 0, cv.width, cv.height);
        for (let k = 0; k < 12; k++) {
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (!code) break;
          const L = code.location;
          const xs = [L.topLeftCorner.x, L.topRightCorner.x, L.bottomLeftCorner.x, L.bottomRightCorner.x];
          const ys = [L.topLeftCorner.y, L.topRightCorner.y, L.bottomLeftCorner.y, L.bottomRightCorner.y];
          const pad = (Math.max(...xs) - Math.min(...xs)) * 0.15;
          const bx0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
          const by0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
          const bx1 = Math.min(img.width, Math.ceil(Math.max(...xs) + pad));
          const by1 = Math.min(img.height, Math.ceil(Math.max(...ys) + pad));
          for (let y = by0; y < by1; y++) img.data.fill(255, (y * img.width + bx0) * 4, (y * img.width + bx1) * 4);
          hits.push({ data: code.data, box: { x: bx0 / img.width, y: by0 / img.height, w: (bx1 - bx0) / img.width, h: (by1 - by0) / img.height } });
        }
      }
      for (const hcode of hits) add(hcode.data, captionNear(items, vp1, hcode.box), pn, 'qr');
    } catch {}
  }
  cv.width = cv.height = 0;
  return found;
}
