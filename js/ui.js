// 공통 화면 요소: 아이콘, 안내 띠(토스트), 대화상자, 아래에서 올라오는 목록
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (d, w = 20, sw = 2) =>
  `<svg aria-hidden="true" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const icon = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 18, 2.2),
  undo: svg('<path d="M9 7L4 12l5 5"/><path d="M4 12h9a6 6 0 010 12h-1" transform="translate(0,-4)"/>', 18),
  left: svg('<path d="M20 12H4M10 6l-6 6 6 6"/>', 18, 2.4),
  right: svg('<path d="M4 12h16M14 6l6 6-6 6"/>', 18, 2.4),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16, 2.6),
  chev: svg('<path d="M6 9l6 6 6-6"/>', 16, 2.4),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/>', 14, 2.2),
  more: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>', 20, 2),
  file: svg('<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>', 22),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 20),
};

// '으로' / '로' 고르기
const lastChar = (w) => String(w).replace(/[^0-9A-Za-z\uAC00-\uD7A3]+$/, '').slice(-1);
export function ro(word) {
  const c = lastChar(word).charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) {
    const j = (c - 0xac00) % 28;
    return j === 0 || j === 8 ? '로' : '으로';
  }
  return '(으)로';
}

// '을' / '를' 고르기
export function eul(word) {
  const c = lastChar(word).charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 === 0 ? '를' : '을';
  return '을(를)';
}

const layer = () => document.getElementById('layer');

let toastTimer = null;
export function toast(msg, { action, onAction, ms = 3500 } = {}) {
  const old = layer().querySelector('.toast');
  old?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${msg}</span>` + (action ? `<button type="button">${esc(action)}</button>` : '');
  if (action) {
    el.querySelector('button').addEventListener('click', () => {
      el.remove();
      onAction?.();
    });
  }
  layer().appendChild(el);
  toastTimer = setTimeout(() => el.remove(), ms);
}

// 버튼을 고르면 그 value로 끝나는 대화상자
export function dialog({ title, body = '', buttons }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'scrim';
    el.innerHTML =
      `<div class="dialog" role="dialog" aria-modal="true">` +
      (title ? `<div class="dialog-title">${title}</div>` : '') +
      (body ? `<div class="dialog-body">${body}</div>` : '') +
      `<div class="dialog-btns">${buttons
        .map((b, i) => `<button type="button" class="btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}" data-i="${i}">${esc(b.label)}</button>`)
        .join('')}</div></div>`;
    const done = (v) => {
      el.remove();
      resolve(v);
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) done(buttons[+b.dataset.i].value);
      else if (e.target === el) done(undefined);
    });
    layer().appendChild(el);
    el.querySelector('.btn.primary')?.focus();
  });
}

export function ask(title, value = '', { label = '', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'scrim';
    el.innerHTML = `<form class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-title">${esc(title)}</div>
      <div class="field">${label ? `<label for="ask-in">${esc(label)}</label>` : ''}
      <input id="ask-in" class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></div>
      <div class="dialog-btns"><button type="button" class="btn" data-x>취소</button><button class="btn primary">확인</button></div></form>`;
    const input = el.querySelector('input');
    const done = (v) => {
      el.remove();
      resolve(v);
    };
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) done(v);
    });
    el.querySelector('[data-x]').addEventListener('click', () => done(null));
    layer().appendChild(el);
    setTimeout(() => input.focus(), 50);
  });
}

// 아래에서 올라오는 목록. items: [{label, sub, value, danger}]
export function sheet(title, items) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'scrim sheet-scrim';
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-title">${esc(title)}</div>
      ${items
        .map(
          (it, i) => `<button type="button" class="sheet-item${it.danger ? ' danger' : ''}${it.current ? ' current' : ''}" data-i="${i}">
        <span>${esc(it.label)}</span>${it.sub ? `<span class="sheet-sub">${it.sub}</span>` : ''}</button>`
        )
        .join('')}
      <button type="button" class="sheet-item sheet-cancel" data-x>닫기</button></div>`;
    const done = (v) => {
      el.remove();
      resolve(v);
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) done(items[+b.dataset.i].value);
      else if (e.target.closest('[data-x]') || e.target === el) done(undefined);
    });
    layer().appendChild(el);
  });
}

export function clearLayer() {
  layer().innerHTML = '';
}
