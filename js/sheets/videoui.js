// 참고 영상 목록
import * as db from '../db.js';
import { esc, toast, ask, sheet } from '../ui.js';
import { scanVideos, isYoutube, hostOf } from '../model/videos.js';

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

// 바깥 링크 열기.
// 아이폰 홈 화면 앱에서는 window.open이 앱 안의 작은 브라우저를 띄우는데, 유튜브 앱으로 넘어가면
// 그 브라우저가 빈 화면으로 남는다. 그래서 유튜브는 유튜브 앱을, 그 밖의 링크는 Safari를 바로 연다.
export function openExternal(url) {
  const fallback = () => window.open(url, '_blank', 'noopener');
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = navigator.standalone || window.matchMedia?.('(display-mode: standalone)').matches;
  if (!ios || !standalone) return fallback();
  let target;
  try {
    const u = new URL(url);
    if (isYoutube(url)) {
      // youtu.be/ID → www.youtube.com/watch?v=ID (시작 시간 t는 그대로)
      if (/youtu\.be$/i.test(u.hostname)) {
        const id = u.pathname.slice(1);
        u.searchParams.set('v', id);
        u.pathname = '/watch';
      }
      target = `youtube://www.youtube.com${u.pathname}${u.search}`;
    } else {
      target = url.replace(/^http/i, 'x-safari-http');
    }
  } catch {
    return fallback();
  }
  // 앱이 열리면 이 화면은 가려진다. 1.5초 안에 안 가려지면(앱이 없거나 주소를 못 여는 경우) 원래 방식으로 연다
  let left = false;
  const onHide = () => { if (document.visibilityState === 'hidden') left = true; };
  document.addEventListener('visibilitychange', onHide);
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    if (!left) fallback();
  }, 1500);
  location.href = target;
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
  if (typeof v === 'number') { openExternal(list[v].url); return; }
  if (v === 'rescan') await runVideoScan(proj, doc);
  else if (v === 'add') { if (await addVideoLink(proj)) await db.put('projects', proj); }
  else if (v === 'edit') {
    const i = await sheet('어떤 영상을 고칠까요?', list.map((x, k) => ({ label: videoTitle(x), value: k })));
    if (i !== undefined && await editVideo(proj, i)) await db.put('projects', proj);
  }
  return videoMenu(proj, doc);
}
