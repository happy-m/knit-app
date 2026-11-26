// 원형·타원 차트: 중심 줄(A–B, 원형이면 A=B)에서 바깥으로 단이 고리처럼 퍼진다
// ring = { a:{x,y}, b:{x,y}, c:{x,y}, n, off, gap }  좌표는 페이지 기준 0~1
// 단 k의 바깥 테두리 반지름 r(k) = (off + k·gap)·p0,  p0 = (C까지 거리)/n

export const validRing = (r) =>
  !!(r && r.a && r.b && r.c && Number.isInteger(r.n) && r.n >= 1 && typeof r.c.x === 'number');

// 페이지 크기(pt) W·H 기준 계산기
export function ringGeom(r, W, H) {
  const P = (q) => [q.x * W, q.y * H];
  const A = P(r.a);
  const B = P(r.b);
  const dist = (Q) => {
    const vx = B[0] - A[0], vy = B[1] - A[1];
    const L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, ((Q[0] - A[0]) * vx + (Q[1] - A[1]) * vy) / L2)) : 0;
    return Math.hypot(Q[0] - (A[0] + t * vx), Q[1] - (A[1] + t * vy));
  };
  const p0 = dist(P(r.c)) / r.n || 1;
  const off = r.off || 0;
  const gap = r.gap || 1;
  const radius = (k) => (off + k * gap) * p0;
  // 페이지 좌표(0~1) 한 점이 몇 단 안에 있는지
  const roundAt = (nx, ny) => {
    const d = dist([nx * W, ny * H]);
    return Math.max(1, Math.min(r.n, Math.ceil((d / p0 - off) / gap)));
  };
  // k단의 한가운데(안팎 테두리 사이)를 지나는 한 점, 페이지 좌표(0~1). B 쪽 끝에서 잡는다
  const midPoint = (k) => {
    let ux = B[0] - A[0], uy = B[1] - A[1];
    const L = Math.hypot(ux, uy);
    if (L < 1) { ux = 1; uy = 0; } else { ux /= L; uy /= L; }
    const rr = (off + (k - 0.5) * gap) * p0;
    return [(B[0] + ux * rr) / W, (B[1] + uy * rr) / H];
  };
  return { A, B, p0, radius, roundAt, midPoint };
}

// 트랙(스타디움) 모양 고리 경로. A·B·r은 화면 px
export function stadium(A, B, r) {
  if (!(r > 0.5)) return '';
  let ux = B[0] - A[0], uy = B[1] - A[1];
  const L = Math.hypot(ux, uy);
  if (L < 0.5) { ux = 1; uy = 0; } else { ux /= L; uy /= L; }
  const nx = -uy * r, ny = ux * r;
  const f = (v) => v.toFixed(1);
  return `M${f(A[0] - nx)} ${f(A[1] - ny)} L${f(B[0] - nx)} ${f(B[1] - ny)} ` +
    `A${f(r)} ${f(r)} 0 0 1 ${f(B[0] + nx)} ${f(B[1] + ny)} L${f(A[0] + nx)} ${f(A[1] + ny)} ` +
    `A${f(r)} ${f(r)} 0 0 1 ${f(A[0] - nx)} ${f(A[1] - ny)} Z`;
}

// ChartView 위에 그릴 때: 페이지 pt → 화면 px 변환을 붙여 준다
export function ringOnView(r, v, W, H) {
  const g = ringGeom(r, W, H);
  const o = v.n2p(0, 0);
  const k = (v.n2p(1, 0)[0] - o[0]) / W; // pt당 px
  const toPx = (Q) => [o[0] + Q[0] * k, o[1] + Q[1] * k];
  return { ...g, Apx: toPx(g.A), Bpx: toPx(g.B), rpx: (i) => g.radius(i) * k, toPx };
}
