// 페이지 그림 위에서 사각형 영역을 끌어 잡는 도구 (차트 영역, 글 설명 영역, 기호 설명 영역이 함께 쓴다)
// 영역 좌표는 페이지 기준 0~1 ({x, y, w, h})
import { renderPage, pageSize } from './pdf.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MIN_PX = 16; // 이보다 작게 끌면 실수로 보고 되돌린다
const GRAB_PX = 28; // 모서리를 잡았다고 보는 거리

// box: 그림이 들어갈 자리(.pv-box). onChange(A): 새 영역을 잡았을 때. 고친 영역을 돌려주면 그걸로 바꾼다
export function rectPicker(box, doc, { page, area = null, onChange } = {}) {
  let pg = page;
  let A = area ? { ...area } : null;
  let W = 0, H = 0;
  box.innerHTML = '<div class="pv-stage"><canvas></canvas><div class="pv-rect" hidden><i class="h tl"></i><i class="h tr"></i><i class="h bl"></i><i class="h br"></i></div></div>';
  const stage = box.querySelector('.pv-stage');
  const rect = box.querySelector('.pv-rect');
  const draw = (R = A) => {
    rect.hidden = !R;
    if (R) Object.assign(rect.style, { left: R.x * W + 'px', top: R.y * H + 'px', width: R.w * W + 'px', height: R.h * H + 'px' });
  };
  const layout = async () => {
    const sz = await pageSize(doc, pg);
    const cssW = Math.min(box.clientWidth - 2, ((box.clientHeight - 2) * sz.w) / sz.h);
    W = cssW;
    H = (cssW * sz.h) / sz.w;
    stage.style.width = W + 'px';
    stage.style.height = H + 'px';
    draw();
    await renderPage(doc, pg, stage.querySelector('canvas'), cssW);
  };

  let anchor = null;
  let draft = null;
  const pt = (e) => {
    const r = stage.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / W, 0, 1), clamp((e.clientY - r.top) / H, 0, 1)];
  };
  stage.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    anchor = [x, y];
    draft = null;
    if (!A) return;
    // 모서리 근처를 잡으면 맞은편 모서리를 고정하고 크기를 바꾼다
    const corners = [[A.x, A.y], [A.x + A.w, A.y], [A.x, A.y + A.h], [A.x + A.w, A.y + A.h]];
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = corners[i];
      if (Math.hypot((cx - x) * W, (cy - y) * H) < GRAB_PX) { anchor = corners[3 - i]; break; }
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!anchor) return;
    const [x, y] = pt(e);
    draft = { x: Math.min(x, anchor[0]), y: Math.min(y, anchor[1]), w: Math.abs(x - anchor[0]), h: Math.abs(y - anchor[1]) };
    draw(draft);
  });
  const up = async () => {
    if (!anchor) return;
    anchor = null;
    const d = draft;
    draft = null;
    if (!d || d.w * W < MIN_PX || d.h * H < MIN_PX) { draw(); return; }
    A = d;
    A = (await onChange?.(A)) || A;
    draw();
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  const ro = new ResizeObserver(() => { clearTimeout(ro.t); ro.t = setTimeout(layout, 200); });
  ro.observe(box);

  return {
    layout,
    area: () => A,
    page: () => pg,
    setArea(a) { A = a ? { ...a } : null; draw(); },
    setPage(n) { pg = n; return layout(); },
    destroy() { ro.disconnect(); clearTimeout(ro.t); },
  };
}
