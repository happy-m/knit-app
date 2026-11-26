// 여러 페이지의 영역(구간)을 위아래로 이어 붙여 한 장처럼 보여주는 뷰 (글 설명 파트용)
// 좌표: 구간 i 안에서 페이지 기준 0~1 정규화 좌표 (nx, ny)
import { dpr } from '../pdf.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const RENDER_ZOOM = 3; // 이 배율까지는 또렷하게 보이도록 미리 그려 둔다

export class StackView {
  constructor(host, opts) {
    this.host = host;
    this.doc = opts.doc;
    this.pieces = opts.pieces.map((p) => ({ pageNum: p.page, area: p.area }));
    this.decorate = opts.decorate;
    this.onTap = opts.onTap;
    this.onScale = opts.onScale;
    this.maxZoom = opts.maxZoom || 6;
    this.s = 1;
    host.classList.add('cv');
    host.innerHTML =
      '<div class="cv-scroll"><div class="cv-pad"><div class="sv-stack">' +
      this.pieces.map((p, i) =>
        (i > 0 ? `<div class="sv-div"><span>${p.pageNum}쪽</span></div>` : '') +
        `<div class="sv-piece" data-i="${i}"><canvas></canvas><div class="cv-ov"></div></div>`).join('') +
      '</div></div></div>' +
      '<div class="cv-zoom"><button type="button" class="cv-zbtn" data-z="-1" aria-label="축소">−</button>' +
      '<button type="button" class="cv-zbtn" data-z="1" aria-label="확대">+</button></div>';
    this.sc = host.querySelector('.cv-scroll');
    this.stack = host.querySelector('.sv-stack');
    host.querySelectorAll('.sv-piece').forEach((el, i) => {
      this.pieces[i].el = el;
      this.pieces[i].canvas = el.querySelector('canvas');
      this.pieces[i].ov = el.querySelector('.cv-ov');
    });
    host.querySelectorAll('.cv-zbtn').forEach((b) =>
      b.addEventListener('click', () => this.setScale(this.s * (b.dataset.z === '1' ? 1.4 : 1 / 1.4)))
    );
  }

  async init(initialScale) {
    for (const p of this.pieces) {
      p.page = await this.doc.getPage(p.pageNum);
      const vp = p.page.getViewport({ scale: 1 });
      p.W1 = vp.width;
      p.H1 = vp.height;
    }
    this.s = clamp(initialScale ?? this.fitS(), this.minS(), this.maxS());
    this._layout();
    this._bind();
    await this._render();
    this.ro = new ResizeObserver(() => {
      if (this.s < this.minS()) this.setScale(this.minS());
    });
    this.ro.observe(this.sc);
  }

  destroy() {
    this.ro?.disconnect();
    this.dead = true;
  }

  fitS() {
    const w = this.sc.clientWidth || 300;
    return w / Math.max(...this.pieces.map((p) => p.area.w * p.W1));
  }
  minS() {
    return this.fitS() * 0.999;
  }
  maxS() {
    return this.fitS() * this.maxZoom;
  }
  pieceSize(i) {
    const p = this.pieces[i];
    return [p.area.w * p.W1 * this.s, p.area.h * p.H1 * this.s];
  }
  // 구간 i 안의 좌표 → 그 구간 안의 css px
  n2p(i, nx, ny) {
    const p = this.pieces[i];
    return [(nx - p.area.x) * p.W1 * this.s, (ny - p.area.y) * p.H1 * this.s];
  }
  // 이어 붙인 전체 기준 css px
  pos(i, nx, ny) {
    const [x, y] = this.n2p(i, nx, ny);
    return [x, this.pieces[i].el.offsetTop + y];
  }
  // 전체 기준 css px → 가장 가까운 구간과 그 안의 좌표
  locate(px, py) {
    let i = 0;
    for (let k = 0; k < this.pieces.length; k++) {
      if (py >= this.pieces[k].el.offsetTop) i = k;
    }
    const p = this.pieces[i];
    const ly = clamp(py - p.el.offsetTop, 0, this.pieceSize(i)[1]);
    return { i, nx: p.area.x + px / (p.W1 * this.s), ny: p.area.y + ly / (p.H1 * this.s) };
  }

  setScale(s, focal) {
    s = clamp(s, this.minS(), this.maxS());
    const fx = focal ? focal.cx : this.sc.clientWidth / 2;
    const fy = focal ? focal.cy : this.sc.clientHeight / 2;
    const at = this.locate(this.sc.scrollLeft + fx, this.sc.scrollTop + fy);
    this.s = s;
    this._layout();
    const [px, py] = this.pos(at.i, at.nx, at.ny);
    this.sc.scrollLeft = px - fx;
    this.sc.scrollTop = py - fy;
    this.onScale?.(s);
  }

  redraw() {
    this.pieces.forEach((p, i) => {
      const view = { size: () => this.pieceSize(i), n2p: (nx, ny) => this.n2p(i, nx, ny) };
      p.ov.innerHTML = this.decorate ? this.decorate(i, view) : '';
    });
  }

  // 구간 i의 한 점이 보이도록 스크롤. x: 'start' | 'keep'
  scrollTo(i, nx, ny, { x = 'keep', yFrac = 0.4, smooth = false } = {}) {
    const [, py] = this.pos(i, nx, ny);
    const left = x === 'start' ? 0 : this.sc.scrollLeft;
    this.sc.scrollTo({ left, top: py - this.sc.clientHeight * yFrac, behavior: smooth ? 'smooth' : 'auto' });
  }

  _layout() {
    const maxW = Math.max(...this.pieces.map((_, i) => this.pieceSize(i)[0]));
    this.stack.style.width = maxW + 'px';
    this.pieces.forEach((p, i) => {
      const [w, h] = this.pieceSize(i);
      for (const el of [p.el, p.ov]) {
        el.style.width = w + 'px';
        el.style.height = h + 'px';
      }
    });
    this.redraw();
  }

  async _render() {
    const base = this.fitS() * RENDER_ZOOM * dpr();
    for (const p of this.pieces) {
      if (this.dead) return;
      let k = base;
      const W = p.area.w * p.W1;
      const H = p.area.h * p.H1;
      k = Math.min(k, 4096 / W, 4096 / H, Math.sqrt(16e6 / (W * H)));
      const vp = p.page.getViewport({ scale: k, offsetX: -p.area.x * p.W1 * k, offsetY: -p.area.y * p.H1 * k });
      p.canvas.width = Math.ceil(W * k);
      p.canvas.height = Math.ceil(H * k);
      try {
        await p.page.render({ canvasContext: p.canvas.getContext('2d'), viewport: vp }).promise;
      } catch {}
    }
  }

  _emitTap(cx, cy) {
    const r = this.stack.getBoundingClientRect();
    const at = this.locate(cx - r.left, cy - r.top);
    this.onTap?.(at.i, at.nx, at.ny);
  }

  _bind() {
    const sc = this.sc;
    let st = null;
    let multi = false;
    let pin = null;
    sc.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.cv-zoom')) return;
      if (!e.isPrimary) { multi = true; return; }
      multi = false;
      st = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, stp: sc.scrollTop };
    });
    sc.addEventListener('pointermove', (e) => {
      if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) st.moved = true;
    });
    sc.addEventListener('pointerup', (e) => {
      if (st && !st.moved && !multi && Math.abs(sc.scrollLeft - st.sl) < 4 && Math.abs(sc.scrollTop - st.stp) < 4) {
        this._emitTap(e.clientX, e.clientY);
      }
      st = null;
    });
    sc.addEventListener('pointercancel', () => { st = null; });
    sc.addEventListener('contextmenu', (e) => e.preventDefault());

    sc.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      multi = true;
      const [a, b] = e.touches;
      const r = sc.getBoundingClientRect();
      pin = {
        d: dist(a, b), s: this.s, k: 1,
        cx: (a.clientX + b.clientX) / 2 - r.left,
        cy: (a.clientY + b.clientY) / 2 - r.top,
        sl: sc.scrollLeft, st: sc.scrollTop,
      };
    }, { passive: true });
    sc.addEventListener('touchmove', (e) => {
      if (!pin || e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = e.touches;
      const s = clamp(pin.s * (dist(a, b) / pin.d), this.minS(), this.maxS());
      pin.k = s / pin.s;
      this.stack.style.transformOrigin = `${pin.sl + pin.cx}px ${pin.st + pin.cy}px`;
      this.stack.style.transform = `scale(${pin.k})`;
    }, { passive: false });
    const endPinch = (e) => {
      if (!pin || e.touches.length >= 2) return;
      const p = pin;
      pin = null;
      this.stack.style.transform = '';
      if (Math.abs(p.k - 1) > 0.01) {
        sc.scrollLeft = p.sl;
        sc.scrollTop = p.st;
        this.setScale(p.s * p.k, { cx: p.cx, cy: p.cy });
      }
    };
    sc.addEventListener('touchend', endPinch);
    sc.addEventListener('touchcancel', endPinch);
    sc.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      this.setScale(this.s * Math.exp(-e.deltaY / 300), { cx: e.clientX - r.left, cy: e.clientY - r.top });
    }, { passive: false });
  }
}
