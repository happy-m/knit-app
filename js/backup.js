// 백업 파일: 작품·파트·진행 기록과 도안 PDF를 파일 하나로 묶는다.
// 형식: "KNITBAK1"(8바이트) + JSON 길이(uint32 LE) + JSON(UTF-8) + PDF 데이터들을 이어 붙임
import * as db from './db.js';

const MAGIC = 'KNITBAK1';

export async function buildBackup() {
  const projects = await db.all('projects');
  const parts = await db.all('parts');
  const files = [];
  const bufs = [];
  for (const p of projects) {
    if (!p.fileId || files.some((f) => f.id === p.fileId)) continue;
    const buf = await db.get('files', p.fileId);
    if (!buf) continue;
    files.push({ id: p.fileId, size: buf.byteLength });
    bufs.push(buf);
  }
  // 작품 정보에 붙인 사진(게이지·메모)
  for (const p of projects) {
    const i = p.info || {};
    for (const id of [...(i.gauge?.photos || []), ...(i.gauge?.after?.photos || []), ...(i.memos || []).flatMap((m) => m.photos || [])]) {
      if (files.some((f) => f.id === id)) continue;
      const buf = await db.get('files', id);
      if (!buf) continue;
      files.push({ id, size: buf.byteLength });
      bufs.push(buf);
    }
  }
  const meta = { app: 'knit', v: 1, created: Date.now(), projects, parts, files };
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const head = new Uint8Array(12);
  head.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(head.buffer).setUint32(8, json.byteLength, true);
  const blob = new Blob([head, json, ...bufs], { type: 'application/octet-stream' });
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return { blob, name: `뜨개도안-백업-${ymd}.knitbak`, count: projects.length };
}

export async function readBackup(file) {
  const buf = await file.arrayBuffer();
  if (buf.byteLength < 12 || new TextDecoder().decode(buf.slice(0, 8)) !== MAGIC) throw new Error('not a backup');
  const len = new DataView(buf).getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(buf.slice(12, 12 + len)));
  if (meta.app !== 'knit' || !Array.isArray(meta.projects)) throw new Error('not a backup');
  let off = 12 + len;
  const datas = [];
  for (const f of meta.files || []) {
    datas.push({ id: f.id, data: buf.slice(off, off + f.size) });
    off += f.size;
  }
  if (off > buf.byteLength) throw new Error('broken');
  return { meta, datas };
}

// 같은 id는 백업 내용으로 덮어쓰고, 나머지 기존 작품은 그대로 둔다.
export async function restoreBackup({ meta, datas }) {
  for (const f of datas) await db.put('files', f.data, f.id);
  for (const p of meta.projects) await db.put('projects', p);
  for (const p of meta.parts || []) await db.put('parts', p);
  return datas.map((f) => f.id);
}
