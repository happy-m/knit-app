// 도안 PDF의 한 영역을 확대·이동하며 보여주고, 그 위에 띠·표시를 얹는 뷰
// 좌표: n = 페이지 기준 0~1 정규화 좌표, p = 콘텐츠 css px
import { dpr } from '../pdf.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

export class ChartView {
  constructor(host, opts) {
    this.host = host;
    this.doc = opts.doc;
    this.pageNum = opts.pageNum;
    this.area = opts.area;
    this.onTap = opts.onTap;
    this.onLong = opts.onLong;
    this.decorate = opts.decorate;
    this.onScale = opts.onScale;
    this.maxZoom = opts.maxZoom || 14;
    this.s = 1;
    host.classList.add('cv');
    host.innerHTML =
      '<div class="cv-scroll"><div class="cv-pad"><div class="cv-inner">' +
      '<canvas class="cv-low"></canvas><canvas class="cv-hi"></canvas><div class="cv-ov"></div>' +
      '</div></div></div>' +
      '<div class="cv-zoom"><button type="button" class="cv-zbtn" data-z="-1" aria-label="축소">−</button>' +
      '<button type="button" class="cv-zbtn" data-z="1" aria-label="확대">+</button></div>';
    this.sc = host.querySelector('.cv-scroll');
    this.inner = host.querySelector('.cv-inner');
    this.low = host.querySelector('.cv-low');
    this.hi = host.querySelector('.cv-hi');
    this.ov = host.querySelector('.cv-ov');
    host.querySelectorAll('.cv-zbtn').forEach((b) =>
      b.addEventListener('click', () => this.setScale(this.s * (b.dataset.z === '1' ? 1.4 : 1 / 1.4)))
    );
  }

  async init(initialScale) {
    this.page = await this.doc.getPage(this.pageNum);
    const vp = this.page.getViewport({ scale: 1 });
    this.W1 = vp.width;
    this.H1 = vp.height;
    this.s = clamp(initialScale ?? this.fitS(), this.minS(), this.maxS());
    this._layout();
    await this._renderLow();
    this._bind();
    this._renderHi();
    this.ro = new ResizeObserver(() => this._onResize());
    this.ro.observe(this.sc);
  }

  destroy() {
    this.ro?.disconnect();
    this.hiTask?.cancel();
    clearTimeout(this._hiT);
  }

  fitS() {
    const w = this.sc.clientWidth || 300;
    return w / (this.area.w * this.W1);
  }
  minS() {
    return this.fitS() * 0.999;
  }
  maxS() {
    return this.fitS() * this.maxZoom;
  }
  size() {
    return [this.area.w * this.W1 * this.s, this.area.h * this.H1 * this.s];
  }
  n2p(nx, ny) {
    return [(nx - this.area.x) * this.W1 * this.s, (ny - this.area.y) * this.H1 * this.s];
  }
  p2n(px, py) {
    return [this.area.x + px / (this.W1 * this.s), this.area.y + py / (this.H1 * this.s)];
  }

  setScale(s, focal) {
    s = clamp(s, this.minS(), this.maxS());
    const fx = focal ? focal.cx : this.sc.clientWidth / 2;
    const fy = focal ? focal.cy : this.sc.clientHeight / 2;
    const [nx, ny] = this.p2n(this.sc.scrollLeft + fx, this.sc.scrollTop + fy);
    this.s = s;
    this.hi.style.display = 'none';
    this._layout();
    const [px, py] = this.n2p(nx, ny);
    this.sc.scrollLeft = px - fx;
    this.sc.scrollTop = py - fy;
    this.onScale?.(s);
    this._scheduleHi(60);
  }

  redraw() {
    this.ov.innerHTML = this.decorate ? this.decorate(this) : '';
  }

  // 정규화 좌표 한 점이 보이도록 스크롤. x: 'center' | 'start' | 'end' | 'keep'
  scrollTo(nx, ny, { x = 'keep', yFrac = 0.45, smooth = false } = {}) {
    const [px, py] = this.n2p(nx, ny);
    const vw = this.sc.clientWidth;
    const vh = this.sc.clientHeight;
    const [w] = this.size();
    let left = this.sc.scrollLeft;
    if (x === 'center') left = px - vw / 2;
    else if (x === 'start') left = 0;
    else if (x === 'end') left = w - vw + 8;
    const top = py - vh * yFrac;
    this.sc.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'auto' });
  }

  // 테스트와 디버깅용: 정규화 좌표를 화면 가운데로 옮기고 화면 좌표를 돌려준다
  reveal(nx, ny) {
    this.scrollTo(nx, ny, { x: 'center', yFrac: 0.5 });
    const r = this.inner.getBoundingClientRect();
    const [px, py] = this.n2p(nx, ny);
    return { x: r.left + px, y: r.top + py };
  }

  _layout() {
    const [w, h] = this.size();
    for (const el of [this.inner, this.low, this.ov]) {
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    }
    this.redraw();
  }

  async _renderLow() {
    // 영역 전체를 한 번 낮은 해상도로 그려 두고, 확대하면 늘려서 쓴다 (스크롤 중 빈 곳 방지)
    const k = Math.min(2048 / (this.area.w * this.W1), 2048 / (this.area.h * this.H1));
    const vp = this.page.getViewport({
      scale: k,
      offsetX: -this.area.x * this.W1 * k,
      offsetY: -this.area.y * this.H1 * k,
    });
    this.low.width = Math.ceil(this.area.w * this.W1 * k);
    this.low.height = Math.ceil(this.area.h * this.H1 * k);
    await this.page.render({ canvasContext: this.low.getContext('2d'), viewport: vp }).promise;
  }

  _scheduleHi(ms = 140) {
    clearTimeout(this._hiT);
    this._hiT = setTimeout(() => this._renderHi(), ms);
  }

  async _renderHi() {
    const [w, h] = this.size();
    const vw = this.sc.clientWidth;
    const vh = this.sc.clientHeight;
    const x0 = Math.max(0, this.sc.scrollLeft - vw * 0.5);
    const y0 = Math.max(0, this.sc.scrollTop - vh * 0.5);
    const x1 = Math.min(w, this.sc.scrollLeft + vw * 1.5);
    const y1 = Math.min(h, this.sc.scrollTop + vh * 1.5);
    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw <= 0 || rh <= 0) return;
    let W = rw * dpr();
    let H = rh * dpr();
    const f = Math.min(1, 4096 / W, 4096 / H, Math.sqrt(16e6 / (W * H)));
    W *= f;
    H *= f;
    const k = this.s * dpr() * f;
    const [nx0, ny0] = this.p2n(x0, y0);
    const vp = this.page.getViewport({ scale: k, offsetX: -nx0 * this.W1 * k, offsetY: -ny0 * this.H1 * k });
    const c = document.createElement('canvas');
    c.className = 'cv-hi';
    c.width = Math.ceil(W);
    c.height = Math.ceil(H);
    Object.assign(c.style, { left: x0 + 'px', top: y0 + 'px', width: rw + 'px', height: rh + 'px' });
    this.hiTask?.cancel();
    const task = this.page.render({ canvasContext: c.getContext('2d'), viewport: vp });
    this.hiTask = task;
    const s = this.s;
    try {
      await task.promise;
    } catch {
      return;
    }
    if (this.hiTask !== task || this.s !== s) return;
    this.hi.replaceWith(c);
    this.hi = c;
  }

  _onResize() {
    if (!this.W1) return;
    if (this.s < this.minS()) this.setScale(this.minS());
    else {
      this._layout();
      this._scheduleHi();
    }
  }

  _emit(name, cx, cy) {
    const r = this.inner.getBoundingClientRect();
    const [nx, ny] = this.p2n(cx - r.left, cy - r.top);
    this[name]?.(nx, ny);
  }

  _bind() {
    const sc = this.sc;
    let st = null;
    let multi = false;
    let pin = null;
    const cancelLong = () => clearTimeout(this._longT);

    sc.addEventListener('scroll', () => this._scheduleHi(), { passive: true });

    sc.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.cv-zoom')) return;
      if (!e.isPrimary) {
        multi = true;
        cancelLong();
        return;
      }
      multi = false;
      st = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, stp: sc.scrollTop };
      this._longT = setTimeout(() => {
        if (st && !st.moved && !multi && this.onLong) {
          st.long = true;
          this._emit('onLong', st.x, st.y);
        }
      }, 550);
    });
    sc.addEventListener('pointermove', (e) => {
      if (!st) return;
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) {
        st.moved = true;
        cancelLong();
      }
    });
    sc.addEventListener('pointerup', (e) => {
      cancelLong();
      if (
        st && !st.moved && !st.long && !multi &&
        Math.abs(sc.scrollLeft - st.sl) < 4 && Math.abs(sc.scrollTop - st.stp) < 4
      ) {
        this._emit('onTap', e.clientX, e.clientY);
      }
      st = null;
    });
    sc.addEventListener('pointercancel', () => {
      cancelLong();
      st = null;
    });
    sc.addEventListener('contextmenu', (e) => e.preventDefault());

    // 두 손가락으로 확대·축소
    sc.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        multi = true;
        cancelLong();
        const [a, b] = e.touches;
        const r = sc.getBoundingClientRect();
        pin = {
          d: dist(a, b), s: this.s, k: 1,
          cx: (a.clientX + b.clientX) / 2 - r.left,
          cy: (a.clientY + b.clientY) / 2 - r.top,
          sl: sc.scrollLeft, st: sc.scrollTop,
        };
      }
    }, { passive: true });
    sc.addEventListener('touchmove', (e) => {
      if (!pin || e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = e.touches;
      const s = clamp(pin.s * (dist(a, b) / pin.d), this.minS(), this.maxS());
      pin.k = s / pin.s;
      this.inner.style.transformOrigin = `${pin.sl + pin.cx}px ${pin.st + pin.cy}px`;
      this.inner.style.transform = `scale(${pin.k})`;
    }, { passive: false });
    const endPinch = (e) => {
      if (!pin || e.touches.length >= 2) return;
      const p = pin;
      pin = null;
      this.inner.style.transform = '';
      if (Math.abs(p.k - 1) > 0.01) {
        sc.scrollLeft = p.sl;
        sc.scrollTop = p.st;
        this.setScale(p.s * p.k, { cx: p.cx, cy: p.cy });
      }
    };
    sc.addEventListener('touchend', endPinch);
    sc.addEventListener('touchcancel', endPinch);

    // PC: Ctrl + 휠로 확대
    sc.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      this.setScale(this.s * Math.exp(-e.deltaY / 300), { cx: e.clientX - r.left, cy: e.clientY - r.top });
    }, { passive: false });
  }
}
