// 작품 정보(실·바늘·게이지·메모·영상·기간)와 사진
import * as db from '../db.js';
import { loadPdf } from '../pdf.js';
import { esc, icon, toast, dialog, ask, sheet } from '../ui.js';
import { isYoutube, hostOf } from '../videos.js';
import { app, go, onCleanup, header } from '../core.js';
import { runVideoScan, videoTitle } from '../videoui.js';

export const NEEDLE_KINDS = ['줄바늘', '막대바늘', '장갑바늘', '코바늘', '기타'];

export function fmtDate(d) {
  return d ? d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, dd) => `${y}.${+m}.${+dd}`) : '';
}

export function infoLines(info) {
  if (!info) return [];
  info = normInfo(info);
  const out = [];
  const yarns = (info.yarns || []).filter((y) => y.name || y.color || y.amount);
  if (yarns.length) out.push(['실', yarns.map((y) => [y.name, y.color, y.amount].filter(Boolean).map(esc).join(' · ')).join('<br>')]);
  const needles = (info.needles || []).filter((n) => n.mm || n.note);
  if (needles.length) out.push(['바늘', needles.map((n) => [n.kind, n.mm ? `${n.mm}mm` : '', n.note].filter(Boolean).map(esc).join(' · ')).join('<br>')]);
  const g = info.gauge || {};
  const gl = [];
  const gOne = (x, tag) => {
    const ph = x.photos?.length ? ` · 사진 ${x.photos.length}` : '';
    if (x.sts || x.rows) gl.push(`${tag}${esc(x.sts || '?')}코 × ${esc(x.rows || '?')}단${ph}`);
    else if (ph) gl.push(`${tag}사진 ${x.photos.length}장`);
  };
  const both = g.after.sts || g.after.rows || g.after.photos.length;
  gOne(g, both ? '<span class="muted">세탁 전</span> ' : '');
  gOne(g.after, '<span class="muted">세탁 후</span> ');
  if (gl.length) out.push(['게이지', gl.join('<br>') + (g.note ? `<br><span class="muted">${esc(g.note)}</span>` : '')]);
  if (info.start || info.end) out.push(['기간', `${fmtDate(info.start) || '?'} ~ ${fmtDate(info.end) || '뜨는 중'}`]);
  const memos = info.memos.filter((m) => m.text || m.photos?.length);
  if (memos.length) {
    const first = memos[0].text ? esc(memos[0].text.split('\n')[0].slice(0, 40)) : '사진 메모';
    out.push(['메모', `${first}${memos.length > 1 ? ` <span class="muted">외 ${memos.length - 1}개</span>` : ''}`]);
  }
  return out;
}

export function infoCard(proj) {
  const lines = infoLines(proj.info);
  if (!lines.length) {
    return `<a class="btn dashed" href="#/info/${proj.id}">${icon.plus}작품 정보 적기 (실·바늘·게이지·날짜·메모)</a>`;
  }
  return `<a class="card info-card" href="#/info/${proj.id}">
    <div class="info-head"><span class="label">작품 정보</span><span class="small muted">고치기</span></div>
    <dl class="info-dl">${lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></a>`;
}

// 예전 형식(메모 한 덩어리)을 새 형식(메모 여러 개)으로 읽는다
export function normInfo(info = {}) {
  info.yarns = info.yarns || [];
  info.needles = info.needles || [];
  info.gauge = info.gauge || {};
  info.gauge.photos = info.gauge.photos || [];
  info.gauge.after = info.gauge.after || {}; // 세탁 후
  info.gauge.after.photos = info.gauge.after.photos || [];
  if (!Array.isArray(info.memos)) info.memos = info.memo ? [{ id: db.uid(), text: info.memo, at: null, photos: [] }] : [];
  delete info.memo;
  return info;
}

// 작품에 붙은 사진 id 전부
export function photoIdsOf(proj) {
  const i = proj.info || {};
  return [...(i.gauge?.photos || []), ...(i.gauge?.after?.photos || []), ...(i.memos || []).flatMap((m) => m.photos || [])];
}

// 사진을 긴 변 1600px 이하 JPEG로 줄여 저장하고 id를 돌려준다
export async function savePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    const id = `img_${db.uid()}`;
    await db.put('files', await blob.arrayBuffer(), id);
    return id;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function photoUrl(id) {
  const buf = await db.get('files', id);
  return buf ? URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' })) : null;
}

// 사진 크게 보기. 지우기를 고르면 'del'
export function photoViewer(url) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'docv photo-view';
    el.innerHTML = `<div class="docv-top"><span class="k-spacer"></span>
        <button type="button" class="btn danger" data-del>사진 지우기</button>
        <button type="button" class="icon-btn" data-x aria-label="닫기">${icon.close}</button></div>
      <div class="pz"><img src="${url}" alt=""></div>`;
    const done = (v) => { el.remove(); resolve(v); };
    el.querySelector('[data-x]').addEventListener('click', () => done(null));
    el.querySelector('[data-del]').addEventListener('click', () => done('del'));
    document.getElementById('layer').appendChild(el);
  });
}

export const INFO_TABS = [['yarn', '실'], ['needle', '바늘'], ['gauge', '게이지'], ['memo', '메모'], ['video', '영상'], ['date', '기간']];

export let infoTab = 'yarn';

export async function viewInfo(pid) {
  const proj = await db.get('projects', pid);
  if (!proj) return go('#/');
  const info = normInfo(proj.info);
  const urls = new Map(); // 사진 id → object URL
  onCleanup(() => urls.forEach((u) => URL.revokeObjectURL(u)));
  const urlOf = async (id) => {
    if (!urls.has(id)) urls.set(id, await photoUrl(id));
    return urls.get(id);
  };
  const stamp = (at) => {
    if (!at) return '';
    const d = new Date(at);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  };
  const photosHtml = (ids, where) => `<div class="photos" data-where="${where}">
      ${ids.map((id) => `<button type="button" class="photo" data-photo="${id}"><img alt="첨부 사진" data-src="${id}"></button>`).join('')}
      <label class="photo add">${icon.plus}<span>사진</span><input type="file" accept="image/*" multiple hidden data-addphoto="${where}"></label>
    </div>`;
  const yarnRow = (y, i) => `<div class="rep-row" data-i="${i}">
      <input class="input" data-k="name" placeholder="실 이름 (예: 울 100%)" value="${esc(y.name || '')}" autocomplete="off">
      <div class="rep-two"><input class="input" data-k="color" placeholder="색·로트" value="${esc(y.color || '')}" autocomplete="off">
      <input class="input" data-k="amount" placeholder="양 (예: 3볼)" value="${esc(y.amount || '')}" autocomplete="off"></div>
      <input class="input" data-k="note" placeholder="성분·굵기·구입처 (선택)" value="${esc(y.note || '')}" autocomplete="off">
      <button type="button" class="link-btn rm" data-rm="yarns">이 실 지우기</button></div>`;
  const needleRow = (n, i) => `<div class="rep-row" data-i="${i}"><div class="rep-two">
      <select class="input" data-k="kind">${NEEDLE_KINDS.map((k) => `<option${k === n.kind ? ' selected' : ''}>${k}</option>`).join('')}</select>
      <input class="input" data-k="mm" inputmode="decimal" placeholder="굵기 mm" value="${esc(n.mm || '')}" autocomplete="off"></div>
      <input class="input" data-k="note" placeholder="용도 (예: 고무단, 몸판)" value="${esc(n.note || '')}" autocomplete="off">
      <button type="button" class="link-btn rm" data-rm="needles">이 바늘 지우기</button></div>`;
  const memoRow = (m, i) => `<div class="rep-row" data-i="${i}">
      ${m.at ? `<span class="small muted">${stamp(m.at)}</span>` : ''}
      <textarea class="input area" data-k="text" rows="3" placeholder="수정한 점, 실 남은 양, 다음에 참고할 것…">${esc(m.text || '')}</textarea>
      ${photosHtml(m.photos || [], `memo:${i}`)}
      <button type="button" class="link-btn rm" data-rm="memos">이 메모 지우기</button></div>`;
  const body = () => {
    if (infoTab === 'yarn') return `<div id="yarns">${info.yarns.map(yarnRow).join('') || '<p class="hint center">아직 적은 실이 없습니다.</p>'}</div>
      <button type="button" class="btn dashed" data-add="yarns">${icon.plus}실 추가</button>`;
    if (infoTab === 'needle') return `<div id="needles">${info.needles.map(needleRow).join('') || '<p class="hint center">아직 적은 바늘이 없습니다.</p>'}</div>
      <button type="button" class="btn dashed" data-add="needles">${icon.plus}바늘 추가</button>`;
    if (infoTab === 'gauge') {
      const A = info.gauge.after;
      const diff = (b, a) => {
        const x = parseFloat(b), y = parseFloat(a);
        if (!(x > 0) || !(y > 0) || x === y) return '';
        return `${y > x ? '+' : ''}${+(y - x).toFixed(1)}`;
      };
      const ds = diff(info.gauge.sts, A.sts), dr = diff(info.gauge.rows, A.rows);
      return `<p class="hint">10cm × 10cm 안의 코 수와 단 수</p>
      <input id="g-note" class="input" placeholder="무늬·바늘 (예: 메리야스, 4mm)" value="${esc(info.gauge.note || '')}" autocomplete="off">
      <div class="rep-row"><b>세탁 전</b>
        <div class="rep-two">
          <div class="field"><label for="g-sts">코</label><input id="g-sts" class="input" inputmode="decimal" value="${esc(info.gauge.sts || '')}"></div>
          <div class="field"><label for="g-rows">단</label><input id="g-rows" class="input" inputmode="decimal" value="${esc(info.gauge.rows || '')}"></div>
        </div>
        ${photosHtml(info.gauge.photos, 'gauge')}</div>
      <div class="rep-row"><b>세탁 후</b>
        <div class="rep-two">
          <div class="field"><label for="g2-sts">코</label><input id="g2-sts" class="input" inputmode="decimal" value="${esc(A.sts || '')}"></div>
          <div class="field"><label for="g2-rows">단</label><input id="g2-rows" class="input" inputmode="decimal" value="${esc(A.rows || '')}"></div>
        </div>
        ${ds || dr ? `<span class="small muted">세탁 전보다 ${[ds && `코 ${ds}`, dr && `단 ${dr}`].filter(Boolean).join(' · ')}</span>` : ''}
        ${photosHtml(A.photos, 'gauge2')}</div>`;
    }
    if (infoTab === 'video') {
      const vs = proj.videos || [];
      return `<p class="hint">뜨기 화면의 '영상' 버튼과 같은 목록입니다. 누르면 유튜브(또는 그 링크)로 열립니다.</p>
      ${vs.map((x, i) => `<div class="vid-row"><button type="button" class="vid-open" data-vopen="${i}">
          <b>${esc(videoTitle(x))}</b><span class="small muted">${esc(`${isYoutube(x.url) ? '▶ 유튜브' : /영상|동영상|video/i.test(x.title || '') ? '▶ 영상' : '🔗 링크'}${x.page ? ` · ${x.page}쪽 ${x.src === 'qr' ? 'QR' : '링크'}` : ' · 직접 추가'} · ${hostOf(x.url)}`)}</span></button>
          <button type="button" class="icon-btn" data-vmore="${i}" aria-label="이름 바꾸기·빼기">${icon.more || '⋯'}</button></div>`).join('')
        || `<p class="hint center">${proj.videosScanned ? '도안에서 찾은 영상이 없습니다.' : '아직 영상이 없습니다.'}</p>`}
      <button type="button" class="btn dashed" data-vadd>${icon.plus}링크 직접 추가</button>
      <button type="button" class="btn" data-vscan>${proj.videosScanned ? '도안에서 다시 찾기' : '도안의 QR 코드·링크에서 찾기'}</button>`;
    }
    if (infoTab === 'memo') return `<button type="button" class="btn dashed" data-add="memos">${icon.plus}새 메모</button>
      <div id="memos">${info.memos.map(memoRow).join('') || '<p class="hint center">아직 메모가 없습니다.</p>'}</div>`;
    return `<div class="rep-two">
        <div class="field"><label for="d-start">시작한 날</label><input id="d-start" class="input" type="date" value="${esc(info.start || '')}"></div>
        <div class="field"><label for="d-end">완성한 날</label><input id="d-end" class="input" type="date" value="${esc(info.end || '')}"></div>
      </div>
      <p class="hint">완성한 날을 비워 두면 '뜨는 중'으로 보입니다.</p>`;
  };
  const count = (k) => ({ video: (proj.videos || []).length, yarn: info.yarns.length, needle: info.needles.length, memo: info.memos.length,
    gauge: info.gauge.sts || info.gauge.rows || info.gauge.photos.length || info.gauge.after.sts || info.gauge.after.rows || info.gauge.after.photos.length ? '✓' : 0, date: info.start ? '✓' : 0 }[k]);
  const render = () => {
    app.innerHTML = `${header(`#/p/${pid}`, '작품 정보', esc(proj.name))}
    <div class="tabs" role="tablist">${INFO_TABS.map(([k, l]) =>
      `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === infoTab}">${l}${count(k) ? `<i>${count(k)}</i>` : ''}</button>`).join('')}</div>
    <div class="page"><form class="wrap" id="f">${body()}
      <p class="hint center">적는 대로 바로 저장됩니다.</p>
    </form></div>`;
    bind();
    app.querySelectorAll('img[data-src]').forEach(async (im) => { const u = await urlOf(im.dataset.src); if (u) im.src = u; });
  };
  const listOf = (where) => (where === 'gauge' ? info.gauge.photos : where === 'gauge2' ? info.gauge.after.photos : (info.memos[+where.split(':')[1]].photos ||= []));
  const collect = () => {
    for (const key of ['yarns', 'needles', 'memos']) {
      app.querySelectorAll(`#${key} .rep-row`).forEach((row) => {
        const o = info[key][+row.dataset.i];
        row.querySelectorAll('[data-k]').forEach((el) => { o[el.dataset.k] = el.value.trim(); });
      });
    }
    const v = (id) => app.querySelector(id)?.value.trim();
    if (app.querySelector('#g-sts')) {
      Object.assign(info.gauge, { sts: v('#g-sts'), rows: v('#g-rows'), note: v('#g-note') });
      Object.assign(info.gauge.after, { sts: v('#g2-sts'), rows: v('#g2-rows') });
    }
    if (app.querySelector('#d-start')) { info.start = v('#d-start'); info.end = v('#d-end'); }
  };
  let t;
  const save = async () => {
    collect();
    const fresh = await db.get('projects', pid);
    if (!fresh) return;
    fresh.videos = proj.videos;
    fresh.videosScanned = proj.videosScanned;
    fresh.info = info;
    fresh.updated = Date.now();
    await db.put('projects', fresh);
  };
  const bind = () => {
    const f = app.querySelector('#f');
    f.addEventListener('submit', (e) => e.preventDefault());
    f.addEventListener('input', (e) => { if (e.target.type === 'file') return; clearTimeout(t); t = setTimeout(save, 400); });
    f.addEventListener('change', (e) => { if (e.target.type !== 'file') save(); });
    app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
      await save();
      infoTab = b.dataset.tab;
      render();
    }));
    f.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      collect();
      const key = b.dataset.add;
      if (key === 'memos') info.memos.unshift({ id: db.uid(), text: '', at: Date.now(), photos: [] });
      else info[key].push(key === 'needles' ? { kind: info.needles.at(-1)?.kind || '줄바늘' } : {});
      await save();
      render();
      const rows = app.querySelectorAll(`#${key} .rep-row`);
      (key === 'memos' ? rows[0] : rows[rows.length - 1])?.querySelector('input, textarea')?.focus();
    }));
    f.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      collect();
      const key = b.dataset.rm;
      const i = +b.closest('.rep-row').dataset.i;
      const item = info[key][i];
      if (key === 'memos' && (item.text || item.photos?.length)) {
        const ok = await dialog({ title: '메모 지우기', body: '이 메모와 첨부한 사진을 지웁니다.',
          buttons: [{ label: '취소', value: false }, { label: '지우기', value: true, danger: true }] });
        if (!ok) return;
      }
      for (const id of item.photos || []) await db.del('files', id);
      info[key].splice(i, 1);
      await save();
      render();
    }));
    f.querySelectorAll('[data-vopen]').forEach((b) => b.addEventListener('click', () => window.open(proj.videos[+b.dataset.vopen].url, '_blank', 'noopener')));
    f.querySelectorAll('[data-vmore]').forEach((b) => b.addEventListener('click', async () => {
      const x = proj.videos[+b.dataset.vmore];
      const a = await sheet(videoTitle(x), [{ label: '이름 바꾸기', value: 'rename' }, { label: '목록에서 빼기', value: 'rm', danger: true }]);
      if (a === 'rename') {
        const n = await ask('영상 이름', x.title || '');
        if (!n) return;
        x.title = n;
        x.renamed = true;
      } else if (a === 'rm') proj.videos.splice(+b.dataset.vmore, 1);
      else return;
      await save();
      render();
    }));
    f.querySelector('[data-vadd]')?.addEventListener('click', async () => {
      const url = await ask('영상 링크', '', { placeholder: 'https://youtu.be/…', label: '유튜브 공유 버튼에서 복사한 주소를 붙여넣으세요' });
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) { toast('http로 시작하는 주소를 넣어주세요'); return; }
      const title = await ask('영상 이름', '', { placeholder: '예: 코잡기 영상' });
      (proj.videos = proj.videos || []).push({ url, title: title || '', page: null, src: 'manual', renamed: !!title });
      await save();
      render();
    });
    f.querySelector('[data-vscan]')?.addEventListener('click', async () => {
      await save();
      const fresh = await db.get('projects', pid);
      await runVideoScan(fresh, await loadPdf(fresh.fileId));
      proj.videos = fresh.videos;
      proj.videosScanned = fresh.videosScanned;
      render();
    });
    f.querySelectorAll('[data-addphoto]').forEach((inp) => inp.addEventListener('change', async () => {
      const files = [...inp.files];
      inp.value = '';
      if (!files.length) return;
      collect();
      const list = listOf(inp.dataset.addphoto);
      const wait = toast('사진을 저장하는 중…', { ms: 60000 });
      let fail = 0;
      for (const file of files) {
        try { list.push(await savePhoto(file)); } catch { fail++; }
      }
      wait.remove();
      if (fail) toast(`사진 ${fail}장은 열 수 없어 넣지 못했습니다`);
      await save();
      render();
    }));
    f.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.photo;
      const u = await urlOf(id);
      if (!u) return;
      if ((await photoViewer(u)) !== 'del') return;
      collect();
      const list = listOf(b.closest('.photos').dataset.where);
      list.splice(list.indexOf(id), 1);
      await db.del('files', id);
      await save();
      render();
    }));
  };
  onCleanup(() => { if (app.querySelector('#f')) { clearTimeout(t); save(); } });
  render();
}
