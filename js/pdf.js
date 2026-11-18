// PDF 불러오기와 렌더링 (pdf.js, 앱에 포함된 파일 사용)
import * as pdfjs from '../vendor/pdf.min.mjs';
import { get } from './db.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const docs = new Map();

export function openPdfData(buffer) {
  // getDocument는 넘긴 버퍼를 가져가므로 사본을 넘긴다
  return pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false }).promise;
}

export function loadPdf(fileId) {
  if (!docs.has(fileId)) {
    docs.set(fileId, (async () => {
      const buf = await get('files', fileId);
      if (!buf) throw new Error('도안 파일을 찾을 수 없습니다');
      return openPdfData(buf);
    })());
  }
  return docs.get(fileId);
}

export function forgetPdf(fileId) {
  const p = docs.get(fileId);
  docs.delete(fileId);
  p?.then((d) => d.destroy()).catch(() => {});
}

export function dpr() {
  return Math.min(window.devicePixelRatio || 1, 3);
}

// 페이지 전체를 cssW 너비로 그린다
export async function renderPage(doc, pageNum, canvas, cssW) {
  const page = await doc.getPage(pageNum);
  const vp1 = page.getViewport({ scale: 1 });
  let k = (cssW / vp1.width) * dpr();
  const f = Math.min(1, 4096 / (vp1.width * k), 4096 / (vp1.height * k));
  k *= f;
  const vp = page.getViewport({ scale: k });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  canvas.style.width = cssW + 'px';
  canvas.style.height = (cssW * vp1.height) / vp1.width + 'px';
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return { w: vp1.width, h: vp1.height };
}

export async function pageSize(doc, pageNum) {
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  return { w: vp.width, h: vp.height };
}
