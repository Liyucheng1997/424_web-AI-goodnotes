// 把 Claude 返回的结构化笔记排版成“手写”康奈尔笔记页：手写字体文字 + 荧光笔 + 波浪线 + rough.js 手绘图示。
// 所有产物都是普通元素（文字、笔迹、形状），之后可以随意修改、擦除、移动。
import { CORNELL as C, PAGE_W } from '../canvas/templates.js';
import { uid } from '../canvas/ink.js';
import { wrapText, measure, parseMarks, ensureFont } from '../canvas/text.js';

export const INK = {
  text: '#23262d',
  title: '#15171c',
  cue: '#1f4e9c',
  key: '#c0262d',
  example: '#2f6f4f',
  warning: '#b35c00',
  question: '#6b4fa3',
  highlight: '#ffd84d',
  underline: '#d0343c',
  visual: '#2b3a55',
  boxFill: 'rgba(255, 207, 64, 0.55)',
  centerFill: 'rgba(90, 160, 255, 0.45)',
};

const ROWS = Math.round((C.bodyBottom - C.firstLine) / C.lineGap); // 每页笔记行数
const rowY = (k) => C.firstLine + (k - 1) * C.lineGap; // 第 k 行（1 起）的顶部
const NOTE_X = C.notesLeft + 6;
const NOTE_R = C.right - 4;
const BODY = { size: 19, lh: C.lineGap };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function layoutCornell(notes, { font = 'wenkai', date = new Date() } = {}) {
  const all = [notes.title, notes.summary, ...(notes.keywords || []), ...notes.sections.flatMap((s) => [s.cue, ...s.points.map((p) => p.text), s.visual?.title, s.visual?.label_a, s.visual?.label_b, ...(s.visual?.items || []), ...(s.visual?.items_b || [])])].join('');
  await ensureFont(font, all.slice(0, 6000) + '0123456789（续）：例注意关键词·');

  const R = rng(Math.floor(Math.random() * 1e9));
  const jit = (a) => (R() * 2 - 1) * a;
  const pages = [];
  let els;
  let row;
  const dateStr = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;

  const text = (x, y, w, str, opt = {}) => {
    const el = {
      id: uid(),
      type: 'text',
      x: x + jit(1.2),
      y,
      w,
      text: str,
      size: opt.size || BODY.size,
      lh: opt.lh || BODY.lh,
      color: opt.color || INK.text,
      font,
      rot: opt.noRot ? 0 : +jit(0.45).toFixed(2),
    };
    els.push(el);
    return el;
  };
  const stroke = (points, color, size, tool = 'pen') => els.push({ id: uid(), type: 'stroke', tool, color, size, pressure: false, points });
  const shape = (kind, x1, y1, x2, y2, opt = {}) =>
    els.push({ id: uid(), type: 'shape', kind, x1, y1, x2, y2, color: opt.color || INK.visual, size: opt.size || 1.6, rough: true, seed: Math.floor(R() * 1e6), fill: opt.fill, fillStyle: opt.fillStyle });

  function newPage(cont) {
    els = [];
    const title = cont ? `${notes.title}（续）` : notes.title;
    const tsize = cont ? 22 : 28;
    text(C.left, C.headerBaseline + 4 - tsize * 1.45 * 0.74, C.right - C.left - 160, title, { size: tsize, lh: tsize * 1.45, color: INK.title });
    const dw = measure(dateStr, font, 18);
    text(C.right - dw - 4, C.headerBaseline + 4 - 26 * 0.74, dw + 10, dateStr, { size: 18, lh: 26, color: INK.cue, noRot: true });
    pages.push({ id: uid(), template: 'cornell', paper: 'white', elements: els });
    row = 1;
  }

  /** 写一条带 ==荧光== / **划线** 标记的文字，返回占用的行数 */
  function markedText(x, y, w, src, opt) {
    const { plain, marks } = parseMarks(src);
    const size = opt.size || BODY.size;
    const lh = opt.lh || BODY.lh;
    const lines = wrapText(plain, w, font, size);
    // 先画荧光笔（在文字下面）
    for (const m of marks) {
      lines.forEach((ln, i) => {
        const a = Math.max(m.start, ln.start), b = Math.min(m.end, ln.start + ln.text.length);
        if (b <= a) return;
        const xa = x + measure(ln.text.slice(0, a - ln.start), font, size);
        const xb = x + measure(ln.text.slice(0, b - ln.start), font, size);
        const base = y + i * lh + lh * 0.74;
        if (m.kind === 'highlight') {
          const yc = base - size * 0.32;
          const pts = [];
          const y0 = yc + jit(1.2), y1 = yc + jit(1.2);
          for (let px = xa - 2; px <= xb + 2; px += 4) pts.push([px, y0 + ((px - xa) / Math.max(1, xb - xa)) * (y1 - y0), 0.5]);
          pts.push([xb + 2, y1, 0.5]);
          stroke(pts, INK.highlight, size * 1.05, 'highlighter');
        } else {
          const pts = [];
          for (let px = xa; px <= xb; px += 5) pts.push([px, base + 4.5 + Math.sin((px - xa) / 3.2) * 1.6, 0.5]);
          stroke(pts, INK.underline, 1.6);
        }
      });
    }
    text(x, y, w, plain, opt);
    return Math.max(1, lines.length);
  }

  function rowsFor(src, w, size = BODY.size) {
    return Math.max(1, wrapText(parseMarks(src).plain, w, font, size).length);
  }

  function ensureRows(n, cueLabel) {
    if (row + n - 1 > ROWS) {
      newPage(true);
      if (cueLabel) text(C.left + 2, rowY(row), C.cueRight - C.left - 14, `${cueLabel}（续）`, { color: 'rgba(31,78,156,0.55)', size: 16 });
      return true;
    }
    return false;
  }

  function point(p, cue) {
    const lvl = p.level >= 2 ? 2 : 1;
    const tx = NOTE_X + (lvl === 1 ? 18 : 42);
    const w = NOTE_R - tx;
    let src = p.text.trim();
    let color = INK.text;
    if (p.kind === 'key') color = INK.key;
    if (p.kind === 'example') {
      color = INK.example;
      if (!/^(例|e\.?g)/i.test(src)) src = '例：' + src;
    }
    if (p.kind === 'warning') {
      color = INK.warning;
      if (!/^注意/.test(src)) src = '注意：' + src;
    }
    if (p.kind === 'question') color = INK.question;
    const n = rowsFor(src, w);
    ensureRows(Math.min(n, ROWS), cue);
    const y = rowY(row);
    const by = y + BODY.lh * 0.74 - BODY.size * 0.32;
    if (lvl === 1) {
      const bx = NOTE_X + 6 + jit(0.8);
      stroke([[bx, by, 0.5], [bx + 0.6, by + 0.4, 0.5]], color, 5.5);
    } else {
      const bx = NOTE_X + 28;
      stroke([[bx, by, 0.5], [bx + 8, by + jit(0.8), 0.5]], color, 1.8);
    }
    const used = markedText(tx, y, w, src, { color });
    row += used;
  }

  /* ---------- 手绘图示 ---------- */
  function visualRows(v) {
    if (!v || v.type === 'none') return 0;
    const t = v.title ? 1 : 0;
    if (v.type === 'flow') return t + 3;
    if (v.type === 'compare') return t + 1 + Math.max(v.items.length, v.items_b.length, 1) + 1;
    if (v.type === 'mindmap') return 5;
    return 0;
  }

  function centeredText(cx, y, maxW, str, opt) {
    const size = opt.size;
    const lines = wrapText(str, maxW, font, size);
    const w = Math.min(maxW, Math.max(...lines.map((l) => measure(l.text, font, size))) + 4);
    text(cx - w / 2, y, w + 6, str, { ...opt, noRot: true });
    return lines.length;
  }

  function visual(v) {
    const W = NOTE_R - NOTE_X;
    if (v.title && v.type !== 'mindmap') {
      text(NOTE_X + 4, rowY(row), W, `▸ ${v.title}`, { color: INK.visual, size: 17 });
      row += 1;
    }
    const top = rowY(row);
    if (v.type === 'flow') {
      const items = v.items.slice(0, 5);
      const n = Math.max(1, items.length);
      const gap = 30;
      const bw = Math.min(140, (W - 8 - (n - 1) * gap) / n);
      const bh = 62;
      const size = bw < 90 ? 14 : 16;
      let x = NOTE_X + 4 + (W - 8 - (n * bw + (n - 1) * gap)) / 2;
      items.forEach((it, i) => {
        const y = top + 12;
        shape('rect', x, y, x + bw, y + bh, { fill: INK.boxFill, fillStyle: 'hachure' });
        const ln = wrapText(it, bw - 14, font, size).length;
        const lh = size * 1.35;
        centeredText(x + bw / 2, y + bh / 2 - (Math.min(ln, 2) * lh) / 2, bw - 14, it, { size, lh, color: INK.visual });
        if (i < n - 1) shape('arrow', x + bw + 4, y + bh / 2 + jit(2), x + bw + gap - 4, y + bh / 2 + jit(2), { size: 1.8 });
        x += bw + gap;
      });
      row += 3;
    } else if (v.type === 'compare') {
      const rowsN = Math.max(v.items.length, v.items_b.length, 1);
      const x0 = NOTE_X + 4, x1 = NOTE_R - 4, xm = (x0 + x1) / 2;
      const y0 = top + 4, y1 = top + (rowsN + 1) * C.lineGap + 10;
      shape('rect', x0, y0, x1, y1, { size: 1.5 });
      shape('line', xm, y0, xm, y1, { size: 1.4 });
      shape('line', x0, y0 + C.lineGap + 2, x1, y0 + C.lineGap + 2, { size: 1.4 });
      text(x0 + 10, rowY(row) + 2, xm - x0 - 16, v.label_a || 'A', { color: INK.key, size: 18 });
      text(xm + 10, rowY(row) + 2, x1 - xm - 16, v.label_b || 'B', { color: INK.cue, size: 18 });
      for (let i = 0; i < rowsN; i++) {
        const y = rowY(row + 1 + i) + 6;
        if (v.items[i]) text(x0 + 10, y, xm - x0 - 16, v.items[i], { size: 16, lh: C.lineGap });
        if (v.items_b[i]) text(xm + 10, y, x1 - xm - 16, v.items_b[i], { size: 16, lh: C.lineGap });
      }
      row += rowsN + 2;
    } else if (v.type === 'mindmap') {
      const cx = NOTE_X + W / 2, cy = top + 80;
      const ew = 150, eh = 58;
      shape('ellipse', cx - ew / 2, cy - eh / 2, cx + ew / 2, cy + eh / 2, { fill: INK.centerFill, fillStyle: 'hachure', size: 1.8 });
      centeredText(cx, cy - 14, ew - 24, v.title || '核心', { size: 18, lh: 26, color: INK.title });
      const items = v.items.slice(0, 6);
      const left = items.filter((_, i) => i % 2 === 1);
      const right = items.filter((_, i) => i % 2 === 0);
      const side = (arr, dir) => {
        arr.forEach((it, i) => {
          const y = top + 14 + ((i + 0.5) * 132) / arr.length;
          const tw = Math.min(150, measure(it, font, 16) + 8);
          const tx = dir > 0 ? cx + ew / 2 + 56 : cx - ew / 2 - 56 - tw;
          const ex = cx + (dir * ew) / 2 - dir * 4;
          shape('line', ex, cy + (y - cy) * 0.3, dir > 0 ? tx - 6 : tx + tw + 6, y, { size: 1.5 });
          text(tx, y - 14, tw + 6, it, { size: 16, lh: 22, color: INK.visual });
        });
      };
      side(right, 1);
      side(left, -1);
      row += 5;
    }
  }

  /* ---------- 正文 ---------- */
  newPage(false);
  const cueW = C.cueRight - C.left - 14;
  notes.sections.forEach((sec, si) => {
    const firstPointRows = sec.points[0] ? rowsFor(sec.points[0].text, NOTE_R - NOTE_X - 18) : 1;
    if (si > 0 && row > 1) row += 1; // 段落间空一行
    if (row + firstPointRows - 1 > ROWS) newPage(true);
    const startRow = row;
    const cueRows = Math.max(1, wrapText(sec.cue, cueW, font, 18).length);
    text(C.left + 2, rowY(row), cueW, sec.cue, { color: INK.cue, size: 18 });
    for (const p of sec.points) point(p, sec.cue);
    const vr = visualRows(sec.visual);
    if (vr) {
      ensureRows(vr, sec.cue);
      visual(sec.visual);
    }
    // 保证线索栏文字不和下一段重叠
    if (pages[pages.length - 1].elements === els && row < startRow + cueRows) row = startRow + cueRows;
    // 段落结束：线索栏下方画一道短的手绘分隔
    const sepY = rowY(row) - 4;
    if (row <= ROWS) stroke([[C.left + 4, sepY, 0.5], [C.left + 50, sepY + jit(1), 0.5], [C.left + 90, sepY + jit(1.2), 0.5]], 'rgba(31,78,156,0.35)', 1.4);
  });

  /* ---------- 总结 ---------- */
  const sx = C.left + 4, sw = C.right - C.left - 8;
  const top = C.summaryFirstLine - C.lineGap;
  const avail = C.summaryBottom - top - 6;
  const kw = (notes.keywords || []).filter(Boolean);
  let fit = null;
  for (const [size, lh] of [[18, 32], [16, 28], [15, 24], [13, 20]]) {
    const n = wrapText(parseMarks(notes.summary).plain, sw - 120, font, size).length;
    const need = n * lh + (kw.length ? lh : 0);
    if (need <= avail || size === 13) {
      fit = { size, lh, n };
      break;
    }
  }
  markedText(sx + 112, top, sw - 120, notes.summary, { size: fit.size, lh: fit.lh, color: INK.text });
  if (kw.length && (fit.n + 1) * fit.lh <= avail) {
    text(sx + 112, top + fit.n * fit.lh, sw - 120, `关键词：${kw.join(' · ')}`, { size: Math.min(fit.size, 16), lh: fit.lh, color: INK.cue });
  }
  return pages;
}

/** 离线示例：不调用 API 也能看到 AI 笔记效果 */
export const SAMPLE_NOTES = {
  title: '光合作用：植物如何“吃”阳光',
  keywords: ['光反应', '暗反应', '叶绿体', 'ATP', '卡尔文循环'],
  sections: [
    {
      cue: '光合作用是什么？',
      points: [
        { text: '植物利用==光能==，把 CO₂ 和 H₂O 合成有机物，并释放 O₂', level: 1, kind: 'key' },
        { text: '总反应：6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂', level: 1, kind: 'normal' },
        { text: '场所：**叶绿体**（类囊体膜 + 基质）', level: 2, kind: 'normal' },
      ],
      visual: { type: 'flow', title: '能量的转化', label_a: '', label_b: '', items: ['光能', '活跃化学能', '稳定化学能'], items_b: [] },
    },
    {
      cue: '光反应 vs 暗反应',
      points: [
        { text: '光反应必须有光；暗反应有没有光都能进行', level: 1, kind: 'normal' },
        { text: '暗反应 ≠ 只在黑暗中进行，常见误区', level: 1, kind: 'warning' },
      ],
      visual: { type: 'compare', title: '', label_a: '光反应', label_b: '暗反应', items: ['类囊体膜', '水的光解 → O₂', '产生 ATP、NADPH'], items_b: ['叶绿体基质', 'CO₂ 的固定', '消耗 ATP、NADPH'] },
    },
    {
      cue: '卡尔文循环怎么转？',
      points: [
        { text: 'CO₂ + C₅ → 2C₃（固定）', level: 1, kind: 'normal' },
        { text: 'C₃ 在 ATP、NADPH 作用下 → ==糖类== + C₅（还原）', level: 1, kind: 'normal' },
        { text: '例：夏天中午气孔关闭 → CO₂ ↓ → C₃ ↓、C₅ ↑', level: 2, kind: 'example' },
      ],
      visual: { type: 'none', title: '', label_a: '', label_b: '', items: [], items_b: [] },
    },
    {
      cue: '影响因素',
      points: [
        { text: '光照强度、CO₂ 浓度、温度（影响**酶的活性**）', level: 1, kind: 'normal' },
        { text: '大棚增产：补光、增施 CO₂、昼夜温差', level: 2, kind: 'example' },
        { text: '为什么阴天也能进行暗反应一段时间？', level: 1, kind: 'question' },
      ],
      visual: { type: 'mindmap', title: '光合速率', label_a: '', label_b: '', items: ['光照强度', 'CO₂ 浓度', '温度', '水分', '矿质元素'], items_b: [] },
    },
  ],
  summary: '光合作用分为==光反应==和暗反应两个阶段：光反应把光能转成 ATP 和 NADPH 中的化学能并释放氧气，暗反应利用它们把 CO₂ 固定、还原成糖类。生产上通过调节光照、CO₂ 和温度来提高产量。',
};

export const SAMPLE_TRANSCRIPT = `好，同学们，我们今天来讲光合作用。嗯，光合作用其实就是植物利用光能，把二氧化碳和水合成有机物，同时放出氧气的过程。总的反应式大家记一下：六个二氧化碳加六个水，在光照和叶绿体的条件下，生成一分子葡萄糖和六个氧气。
光合作用的场所是叶绿体，具体来说，光反应在类囊体的薄膜上，暗反应在叶绿体基质里。那光反应干了什么呢？第一，水的光解，产生氧气；第二，产生 ATP 和 NADPH。暗反应呢，就是二氧化碳的固定和三碳化合物的还原，这个过程叫卡尔文循环。
注意啊，很多同学以为暗反应只能在黑暗中进行，这是错的，暗反应有光没光都可以进行，只是它需要光反应提供的 ATP 和 NADPH。
最后说一下影响因素：光照强度、二氧化碳浓度、温度，温度主要是影响酶的活性。所以大棚种菜的时候，我们会补光，增施二氧化碳，还会拉大昼夜温差，来提高产量。好，下课前大家思考一个问题：为什么阴天的时候暗反应还能继续进行一段时间？`;
