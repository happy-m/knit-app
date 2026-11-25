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

// 영상 버튼: 목록을 보여 주고 고르면 유튜브(또는 그 링크)로 연다
export async function videoMenu(proj, doc) {
  if (!proj.videosScanned) await runVideoScan(proj, doc);
  const list = proj.videos || [];
  const v = await sheet(list.length ? `참고 영상 ${list.length}개` : '참고 영상 (아직 없음)', [
    ...list.map((x, i) => ({
      label: videoTitle(x),
      sub: esc(`${isYoutube(x.url) ? '▶ 유튜브' : /영상|동영상|video/i.test(x.title || '') ? '▶ 영상' : '🔗 링크'}${x.page ? ` · ${x.page}쪽 ${x.src === 'qr' ? 'QR' : '링크'}` : ' · 직접 추가'} · ${hostOf(x.url)}`),
      value: i,
    })),
    { label: '+ 링크 직접 추가', value: 'add' },
    ...(list.length ? [{ label: '목록 고치기 (이름 바꾸기·빼기)', value: 'edit' }] : []),
    { label: '도안에서 다시 찾기', value: 'rescan' },
  ]);
  if (v === undefined) return;
  if (typeof v === 'number') { window.open(list[v].url, '_blank', 'noopener'); return; }
  if (v === 'rescan') { await runVideoScan(proj, doc); return videoMenu(proj, doc); }
  if (v === 'add') {
    const url = await ask('영상 링크', '', { placeholder: 'https://youtu.be/…', label: '유튜브 공유 버튼에서 복사한 주소를 붙여넣으세요' });
    if (!url) return videoMenu(proj, doc);
    if (!/^https?:\/\//i.test(url)) { toast('http로 시작하는 주소를 넣어주세요'); return videoMenu(proj, doc); }
    const title = await ask('영상 이름', '', { placeholder: '예: 감아코 영상' });
    (proj.videos = proj.videos || []).push({ url, title: title || '', page: null, src: 'manual', renamed: !!title });
    await db.put('projects', proj);
    return videoMenu(proj, doc);
  }
  if (v === 'edit') {
    const i = await sheet('어떤 영상을 고칠까요?', list.map((x, k) => ({ label: videoTitle(x), value: k })));
    if (i === undefined) return videoMenu(proj, doc);
    const a = await sheet(videoTitle(list[i]), [{ label: '이름 바꾸기', value: 'rename' }, { label: '목록에서 빼기', value: 'rm', danger: true }]);
    if (a === 'rename') {
      const n = await ask('영상 이름', list[i].title || '');
      if (n) { list[i].title = n; list[i].renamed = true; }
    } else if (a === 'rm') list.splice(i, 1);
    await db.put('projects', proj);
    return videoMenu(proj, doc);
  }
}
