// 页面尺寸与纸张模板。模板输出与渲染方式无关的“图元”，SVG 和 Canvas（导出 PDF）共用。

export const PAGE_W = 794; // A4 @96dpi
export const PAGE_H = 1123;

const RULE = 'rgba(70, 120, 200, 0.22)';
const RULE_STRONG = 'rgba(70, 120, 200, 0.45)';
const LABEL = 'rgba(60, 80, 120, 0.45)';
const MARGIN_RED = 'rgba(215, 0, 21, 0.28)';

/** 康奈尔笔记版式（AI 排版也用这些坐标） */
export const CORNELL = {
  left: 40,
  right: PAGE_W - 40,
  headerBaseline: 92, // 标题所在线
  bodyTop: 120, // 线索栏/笔记栏起始
  cueRight: 236, // 线索栏右边界（竖线）
  notesLeft: 252,
  lineGap: 32,
  firstLine: 152, // 第一条横线
  bodyBottom: 888, // 笔记区最后一条横线不低于此
  summaryTop: 908,
  summaryFirstLine: 968,
  summaryBottom: 1083,
};

export function cornellLines() {
  const ys = [];
  for (let y = CORNELL.firstLine; y <= CORNELL.bodyBottom; y += CORNELL.lineGap) ys.push(y);
  return ys;
}
export function summaryLines() {
  const ys = [];
  for (let y = CORNELL.summaryFirstLine; y <= CORNELL.summaryBottom; y += CORNELL.lineGap) ys.push(y);
  return ys;
}

export const TEMPLATES = [
  { id: 'cornell', name: '康奈尔' },
  { id: 'lined', name: '横线' },
  { id: 'grid', name: '方格' },
  { id: 'dotted', name: '点阵' },
  { id: 'blank', name: '空白' },
];

export const PAPERS = [
  { id: 'white', name: '白色', color: '#ffffff' },
  { id: 'cream', name: '米黄', color: '#fbf6e9' },
  { id: 'mist', name: '浅灰', color: '#f4f5f7' },
];

export function paperColor(id) {
  return (PAPERS.find((p) => p.id === id) || PAPERS[0]).color;
}

/** 返回模板图元列表 */
export function templatePrims(template) {
  const P = [];
  switch (template) {
    case 'lined': {
      P.push({ t: 'hlines', x1: 0, x2: PAGE_W, y0: 128, y1: PAGE_H - 40, gap: 32, stroke: RULE, w: 1 });
      P.push({ t: 'line', x1: 92, y1: 0, x2: 92, y2: PAGE_H, stroke: MARGIN_RED, w: 1.2 });
      break;
    }
    case 'grid': {
      P.push({ t: 'grid', x0: 0, y0: 0, x1: PAGE_W, y1: PAGE_H, gap: 24, stroke: 'rgba(70,120,200,0.16)', w: 1 });
      break;
    }
    case 'dotted': {
      P.push({ t: 'dots', x0: 12, y0: 12, x1: PAGE_W, y1: PAGE_H, gap: 24, r: 1.3, fill: 'rgba(60,70,90,0.32)' });
      break;
    }
    case 'cornell': {
      const C = CORNELL;
      // 标题线
      P.push({ t: 'line', x1: C.left, y1: C.headerBaseline + 8, x2: C.right, y2: C.headerBaseline + 8, stroke: RULE_STRONG, w: 1.4 });
      P.push({ t: 'text', x: C.left, y: 40, text: '主题 TOPIC', size: 10, fill: LABEL, weight: 600, spacing: 1.5 });
      P.push({ t: 'text', x: C.right, y: 40, text: '日期 DATE', size: 10, fill: LABEL, weight: 600, anchor: 'end', spacing: 1.5 });
      // 线索栏 / 笔记栏横线
      P.push({ t: 'hlines', x1: C.left, x2: C.right, y0: C.firstLine, y1: C.bodyBottom, gap: C.lineGap, stroke: RULE, w: 1 });
      // 竖分隔线
      P.push({ t: 'line', x1: C.cueRight, y1: C.bodyTop, x2: C.cueRight, y2: C.summaryTop, stroke: RULE_STRONG, w: 1.6 });
      P.push({ t: 'text', x: C.left, y: C.bodyTop + 14, text: '线索 CUES', size: 10, fill: LABEL, weight: 600, spacing: 1.5 });
      P.push({ t: 'text', x: C.notesLeft, y: C.bodyTop + 14, text: '笔记 NOTES', size: 10, fill: LABEL, weight: 600, spacing: 1.5 });
      // 总结区
      P.push({ t: 'line', x1: C.left, y1: C.summaryTop, x2: C.right, y2: C.summaryTop, stroke: RULE_STRONG, w: 1.6 });
      P.push({ t: 'text', x: C.left, y: C.summaryTop + 26, text: '总结 SUMMARY', size: 10, fill: LABEL, weight: 600, spacing: 1.5 });
      P.push({ t: 'hlines', x1: C.left, x2: C.right, y0: C.summaryFirstLine, y1: C.summaryBottom, gap: C.lineGap, stroke: RULE, w: 1 });
      break;
    }
    default:
      break;
  }
  return P;
}

/** 在 Canvas 上画模板（导出 PDF / 缩略图用） */
export function drawTemplate(ctx, template, paper) {
  ctx.fillStyle = paperColor(paper);
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  for (const p of templatePrims(template)) {
    ctx.save();
    if (p.t === 'line') {
      ctx.strokeStyle = p.stroke; ctx.lineWidth = p.w;
      ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    } else if (p.t === 'hlines') {
      ctx.strokeStyle = p.stroke; ctx.lineWidth = p.w; ctx.beginPath();
      for (let y = p.y0; y <= p.y1; y += p.gap) { ctx.moveTo(p.x1, y); ctx.lineTo(p.x2, y); }
      ctx.stroke();
    } else if (p.t === 'grid') {
      ctx.strokeStyle = p.stroke; ctx.lineWidth = p.w; ctx.beginPath();
      for (let x = p.x0; x <= p.x1; x += p.gap) { ctx.moveTo(x, p.y0); ctx.lineTo(x, p.y1); }
      for (let y = p.y0; y <= p.y1; y += p.gap) { ctx.moveTo(p.x0, y); ctx.lineTo(p.x1, y); }
      ctx.stroke();
    } else if (p.t === 'dots') {
      ctx.fillStyle = p.fill;
      for (let y = p.y0; y <= p.y1; y += p.gap)
        for (let x = p.x0; x <= p.x1; x += p.gap) { ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill(); }
    } else if (p.t === 'text') {
      ctx.fillStyle = p.fill;
      ctx.font = `${p.weight || 400} ${p.size}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = p.anchor === 'end' ? 'right' : 'left';
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${p.spacing || 0}px`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }
}
