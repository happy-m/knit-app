// 참고 영상 목록
import * as db from './db.js';
import { esc, toast, ask, sheet } from './ui.js';
import { scanVideos, isYoutube, hostOf } from './videos.js';

export async function runVideoScan(proj, doc) {
  const t = toast('도안에서 QR 코드와 링크를 찾는 중…', { ms: 120000 });
  let found = [];
  try {
    found = await scanVideos(doc, (n, total) => { const sp = t.querySelector('span'); if (sp) sp.textContent = `도안에서 QR 코드와 링크를 찾는 중… ${n}/${total}쪽`; });
  } catch {
    t.remove();
    toast('QR 코드를 읽지 못했습니다');
    return;
  }
  t.remove();
  // 직접 넣은 링크는 남기고, 이름을 바꿔 둔 영상은 그 이름을 유지한다
  const old = proj.videos || [];
  const merged = found.map((f) => ({ ...f, title: old.find((o) => o.url === f.url && o.renamed)?.title || f.title, renamed: !!old.find((o) => o.url === f.url && o.renamed) }));
  for (const o of old) if (o.src === 'manual' && !merged.some((m) => m.url === o.url)) merged.push(o);
  proj.videos = merged;
  proj.videosScanned = true;
  proj.updated = Date.now();
  await db.put('projects', proj);
  toast(found.length ? `영상·링크 ${found.length}개를 찾았습니다` : '도안에서 QR 코드나 링크를 찾지 못했습니다');
}

export const videoTitle = (v) => v.title || `${v.page ? `${v.page}쪽 ` : ''}${isYoutube(v.url) ? '영상' : '링크'}`;

// 영상 한 줄 아래에 붙는 설명: 종류 · 어디서 왔는지 · 사이트
export const videoSub = (x) => `${isYoutube(x.url) ? '▶ 유튜브' : /영상|동영상|video/i.test(x.title || '') ? '▶ 영상' : '🔗 링크'}${x.page ? ` · ${x.page}쪽 ${x.src === 'qr' ? 'QR' : '링크'}` : ' · 직접 추가'} · ${hostOf(x.url)}`;

// 링크를 물어서 목록에 더한다 (저장은 부른 쪽에서). 더했으면 true
export async function addVideoLink(proj) {
  const url = await ask('영상 링크', '', { placeholder: 'https://youtu.be/…', label: '유튜브 공유 버튼에서 복사한 주소를 붙여넣으세요' });
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) { toast('http로 시작하는 주소를 넣어주세요'); return false; }
  const title = await ask('영상 이름', '', { placeholder: '예: 코잡기 영상' });
  (proj.videos = proj.videos || []).push({ url, title: title || '', page: null, src: 'manual', renamed: !!title });
  return true;
}

// 영상 하나의 이름 바꾸기·빼기 (저장은 부른 쪽에서). 바뀌었으면 true
export async function editVideo(proj, i) {
  const x = proj.videos[i];
  const a = await sheet(videoTitle(x), [{ label: '이름 바꾸기', value: 'rename' }, { label: '목록에서 빼기', value: 'rm', danger: true }]);
  if (a === 'rename') {
    const n = await ask('영상 이름', x.title || '');
    if (!n) return false;
    x.title = n;
    x.renamed = true;
    return true;
  }
  if (a === 'rm') { proj.videos.splice(i, 1); return true; }
  return false;
}

// 영상 버튼: 목록을 보여 주고 고르면 유튜브(또는 그 링크)로 연다
export async function videoMenu(proj, doc) {
  if (!proj.videosScanned) await runVideoScan(proj, doc);
  const list = proj.videos || [];
  const v = await sheet(list.length ? `참고 영상 ${list.length}개` : '참고 영상 (아직 없음)', [
    ...list.map((x, i) => ({ label: videoTitle(x), sub: esc(videoSub(x)), value: i })),
    { label: '+ 링크 직접 추가', value: 'add' },
    ...(list.length ? [{ label: '목록 고치기 (이름 바꾸기·빼기)', value: 'edit' }] : []),
    { label: '도안에서 다시 찾기', value: 'rescan' },
  ]);
  if (v === undefined) return;
  if (typeof v === 'number') { window.open(list[v].url, '_blank', 'noopener'); return; }
  if (v === 'rescan') await runVideoScan(proj, doc);
  else if (v === 'add') { if (await addVideoLink(proj)) await db.put('projects', proj); }
  else if (v === 'edit') {
    const i = await sheet('어떤 영상을 고칠까요?', list.map((x, k) => ({ label: videoTitle(x), value: k })));
    if (i !== undefined && await editVideo(proj, i)) await db.put('projects', proj);
  }
  return videoMenu(proj, doc);
}
