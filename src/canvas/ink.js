// 笔迹/形状/文字/图片元素：几何、命中测试、变换、Canvas 绘制
import { getStroke } from 'perfect-freehand';
import rough from 'roughjs';
import { wrapText, fontCss, fontScale } from './text.js';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const gen = rough.generator();
const cache = new WeakMap();
function memo(el, key, fn) {
  let c = cache.get(el);
  if (!c) cache.set(el, (c = {}));
  if (!(key in c)) c[key] = fn();
  return c[key];
}

/* ---------------- 笔迹 ---------------- */
export function strokeOptions(el) {
  if (el.tool === 'highlighter') {
    return { size: el.size, thinning: 0, smoothing: 0.6, streamline: 0.4, simulatePressure: false, last: true };
  }
  return { size: el.size, thinning: 0.62, smoothing: 0.55, streamline: 0.45, simulatePressure: !el.pressure, last: true };
}

function outlineToPath(pts) {
  if (pts.length < 4) {
    if (!pts.length) return '';
    const [x, y] = pts[0];
    return `M${x},${y} m-1,0 a1,1 0 1,0 2,0 a1,1 0 1,0 -2,0`;
  }
  const avg = (a, b) => (a + b) / 2;
  let a = pts[0], b = pts[1];
  const c = pts[2];
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${avg(b[0], c[0]).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;
  for (let i = 2, max = pts.length - 1; i < max; i++) {
    a = pts[i];
    b = pts[i + 1];
    d += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
  }
  return d + 'Z';
}

export function strokePathFromPoints(points, el) {
  return outlineToPath(getStroke(points, strokeOptions(el)));
}

export function strokePath(el) {
  return memo(el, 'd', () => strokePathFromPoints(el.points, el));
}

/* ---------------- 形状（rough.js 手绘风） ---------------- */
export function shapePaths(el) {
  return memo(el, 'paths', () => {
    const o = {
      seed: el.seed || 1,
      stroke: el.color,
      strokeWidth: el.size,
      roughness: el.rough ? 1.1 : 0,
      bowing: el.rough ? 1 : 0,
      disableMultiStroke: !el.rough,
      fill: el.fill || undefined,
      fillStyle: el.fillStyle || 'hachure',
      fillWeight: Math.max(0.6, el.size * 0.45),
      hachureGap: 6,
    };
    const { x1, y1, x2, y2 } = el;
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    const ds = [];
    if (el.kind === 'rect') ds.push(gen.rectangle(x, y, w, h, o));
    else if (el.kind === 'ellipse') ds.push(gen.ellipse(x + w / 2, y + h / 2, w, h, o));
    else {
      ds.push(gen.line(x1, y1, x2, y2, o));
      if (el.kind === 'arrow') {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const len = Math.min(16, Math.hypot(x2 - x1, y2 - y1) * 0.4) + el.size;
        for (const s of [-1, 1]) {
          const a = ang + Math.PI + s * 0.45;
          ds.push(gen.line(x2, y2, x2 + Math.cos(a) * len, y2 + Math.sin(a) * len, o));
        }
      }
    }
    return ds.flatMap((d) => gen.toPaths(d));
  });
}

/* ---------------- 文字 ---------------- */
export function textLines(el) {
  return memo(el, 'lines', () => wrapText(el.text, el.w, el.font, el.size));
}
export function textFont(el) {
  return { size: el.size * fontScale(el.font), css: fontCss(el.font) };
}

/* ---------------- 包围盒 / 命中 ---------------- */
export function bbox(el) {
  return memo(el, 'bbox', () => {
    if (el.type === 'stroke') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of el.points) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      const p = el.size / 2 + 1;
      return { x: x0 - p, y: y0 - p, w: x1 - x0 + 2 * p, h: y1 - y0 + 2 * p };
    }
    if (el.type === 'shape') {
      const p = el.size + 2;
      return { x: Math.min(el.x1, el.x2) - p, y: Math.min(el.y1, el.y2) - p, w: Math.abs(el.x2 - el.x1) + 2 * p, h: Math.abs(el.y2 - el.y1) + 2 * p };
    }
    if (el.type === 'text') {
      const n = Math.max(1, textLines(el).length);
      return { x: el.x, y: el.y, w: el.w, h: n * el.lh };
    }
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  });
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function hitTest(el, x, y, r = 6) {
  const b = bbox(el);
  if (x < b.x - r || x > b.x + b.w + r || y < b.y - r || y > b.y + b.h + r) return false;
  if (el.type === 'stroke') {
    const pts = el.points;
    const tol = el.size / 2 + r;
    if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) < tol;
    for (let i = 1; i < pts.length; i++) {
      if (distToSeg(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < tol) return true;
    }
    return false;
  }
  if (el.type === 'shape') {
    const { x1, y1, x2, y2 } = el;
    const tol = el.size / 2 + r;
    if (el.kind === 'line' || el.kind === 'arrow') return distToSeg(x, y, x1, y1, x2, y2) < tol;
    if (el.fill) return true;
    const xa = Math.min(x1, x2), xb = Math.max(x1, x2), ya = Math.min(y1, y2), yb = Math.max(y1, y2);
    if (el.kind === 'rect') {
      return distToSeg(x, y, xa, ya, xb, ya) < tol || distToSeg(x, y, xb, ya, xb, yb) < tol || distToSeg(x, y, xb, yb, xa, yb) < tol || distToSeg(x, y, xa, yb, xa, ya) < tol;
    }
    const cx = (xa + xb) / 2, cy = (ya + yb) / 2, rx = (xb - xa) / 2 || 1, ry = (yb - ya) / 2 || 1;
    const v = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return Math.abs(v - 1) * Math.min(rx, ry) < tol;
  }
  return true; // 文字、图片：命中包围盒即可
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inLasso(el, poly) {
  if (el.type === 'stroke') {
    const pts = el.points;
    const step = Math.max(1, Math.floor(pts.length / 24));
    let n = 0, hit = 0;
    for (let i = 0; i < pts.length; i += step) {
      n++;
      if (pointInPoly(pts[i][0], pts[i][1], poly)) hit++;
    }
    return hit / n >= 0.5;
  }
  const b = bbox(el);
  return pointInPoly(b.x + b.w / 2, b.y + b.h / 2, poly);
}

export function unionBox(els) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of els) {
    const b = bbox(el);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ---------------- 变换 ---------------- */
export function transformEl(el, { dx = 0, dy = 0, s = 1, ox = 0, oy = 0 }) {
  const fx = (x) => ox + (x - ox) * s + dx;
  const fy = (y) => oy + (y - oy) * s + dy;
  switch (el.type) {
    case 'stroke':
      return { ...el, size: el.size * (s === 1 ? 1 : Math.sqrt(s)), points: el.points.map(([x, y, p]) => [fx(x), fy(y), p]) };
    case 'shape':
      return { ...el, x1: fx(el.x1), y1: fy(el.y1), x2: fx(el.x2), y2: fy(el.y2) };
    case 'text':
      return { ...el, x: fx(el.x), y: fy(el.y), w: el.w * s, size: el.size * s, lh: el.lh * s };
    case 'image':
      return { ...el, x: fx(el.x), y: fy(el.y), w: el.w * s, h: el.h * s };
    default:
      return el;
  }
}

/* ---------------- Canvas 绘制（导出 / 缩略图） ---------------- */
const imgCache = new Map();
export function loadImage(src) {
  if (!imgCache.has(src)) {
    imgCache.set(
      src,
      new Promise((res) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = src;
      }),
    );
  }
  return imgCache.get(src);
}

export async function drawElement(ctx, el) {
  ctx.save();
  if (el.type === 'stroke') {
    ctx.fillStyle = el.color;
    if (el.tool === 'highlighter') {
      ctx.globalAlpha = 0.38;
      ctx.globalCompositeOperation = 'multiply';
    }
    ctx.fill(new Path2D(strokePath(el)));
  } else if (el.type === 'shape') {
    for (const p of shapePaths(el)) {
      const path = new Path2D(p.d);
      if (p.fill && p.fill !== 'none') {
        ctx.fillStyle = p.fill;
        ctx.fill(path);
      }
      if (p.stroke && p.stroke !== 'none') {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
    }
  } else if (el.type === 'text') {
    const f = textFont(el);
    ctx.fillStyle = el.color;
    ctx.font = `${el.bold ? 700 : 400} ${f.size}px ${f.css}`;
    ctx.textBaseline = 'alphabetic';
    if (el.rot) {
      ctx.translate(el.x, el.y);
      ctx.rotate((el.rot * Math.PI) / 180);
      ctx.translate(-el.x, -el.y);
    }
    textLines(el).forEach((ln, i) => ctx.fillText(ln.text, el.x, el.y + i * el.lh + el.lh * 0.74));
  } else if (el.type === 'image') {
    const im = await loadImage(el.src);
    if (im) ctx.drawImage(im, el.x, el.y, el.w, el.h);
  }
  ctx.restore();
}
