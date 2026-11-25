// 도안 핀: S(오늘 시작한 곳), E(여기까지 뜸). 파트마다 하나씩, part.pins = { S: {seg, x, y, label, at}, E: … }
import { toast } from './ui.js';

const KINDS = { S: '오늘 시작한 곳', E: '여기까지 뜸' };
const stamp = (at) => { const d = new Date(at); return `${d.getMonth() + 1}.${d.getDate()}`; };

// 단 카드 메뉴에 넣는 항목
export function pinMenuItems(part) {
  const pins = part.pins || {};
  return Object.entries(KINDS).flatMap(([k, what]) => {
    const pin = pins[k];
    if (!pin) return [{ label: `${k} 핀 꽂기 (${what})`, value: `pin${k}` }];
    return [
      { label: `${k} 핀 옮기기 (${what})`, sub: `${pin.label ? `${pin.label} · ` : ''}${stamp(pin.at)}에 꽂음`, value: `pin${k}` },
      { label: `${k} 핀 빼기`, value: `unpin${k}`, danger: true },
    ];
  });
}

// 뜨기 화면 하나에서 쓰는 핀 조작기. save(): 파트 저장, redraw(): 차트 다시 그리기
export function pinControl(part, save, redraw) {
  let arming = null; // 다음 탭에 꽂을 핀 종류
  return {
    armed: () => arming,
    // 메뉴에서 고른 동작 처리. 핀 동작이었으면 true
    async handle(act) {
      const m = /^(un)?pin([SE])$/.exec(act || '');
      if (!m) return false;
      if (m[1]) {
        delete part.pins?.[m[2]];
        await save();
        redraw();
        toast(`${m[2]} 핀을 뺐습니다`);
      } else {
        arming = m[2];
        toast(`<b>${m[2]} 핀</b>을 꽂을 자리를 도안에서 탭하세요`, { ms: 5000 });
      }
      return true;
    },
    // 탭한 자리에 꽂는다. pos = { seg, x, y, label }
    async place(pos) {
      const k = arming;
      arming = null;
      (part.pins ||= {})[k] = { ...pos, at: Date.now() };
      await save();
      redraw();
      toast(`<b>${k} 핀</b>을 꽂았습니다${pos.label ? ` · ${pos.label}` : ''}`);
    },
    // 구간 seg에 있는 핀을 그린다. n2p: 페이지 좌표 → 화면 px
    html(seg, n2p) {
      let h = '';
      for (const [k, pin] of Object.entries(part.pins || {})) {
        if ((pin.seg ?? 0) !== seg) continue;
        const [x, y] = n2p(pin.x, pin.y);
        h += `<span class="kpin kpin-${k}" style="left:${x}px;top:${y}px"><b><i>${k}</i></b></span>`;
      }
      return h;
    },
  };
}
