// 形状识别：画完后按住不动 → 拉直线 / 规整成矩形、椭圆（类似 GoodNotes 的“按住成形”）

export function recognizeShape(points) {
  if (points.length < 4) return null;
  let len = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (i) len += Math.hypot(x - points[i - 1][0], y - points[i - 1][1]);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const [sx, sy] = points[0];
  const [ex, ey] = points[points.length - 1];
  const chord = Math.hypot(ex - sx, ey - sy);
  if (len < 12) return null;
  if (chord / len > 0.9) {
    // 近似水平/竖直时吸附
    let tx = ex, ty = ey;
    const ang = Math.abs(Math.atan2(ey - sy, ex - sx));
    if (ang < 0.07 || Math.abs(ang - Math.PI) < 0.07) ty = sy;
    if (Math.abs(ang - Math.PI / 2) < 0.07) tx = sx;
    return { kind: 'line', x1: sx, y1: sy, x2: tx, y2: ty };
  }
  const w = x1 - x0, h = y1 - y0;
  if (w < 16 || h < 16) return null;
  if (chord > 0.3 * Math.max(w, h)) return null; // 不是闭合图形
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = w / 2, ry = h / 2;
  let eErr = 0, rErr = 0;
  for (const [x, y] of points) {
    eErr += Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1);
    const dEdge = Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1));
    rErr += dEdge / Math.min(rx, ry);
  }
  eErr /= points.length;
  rErr /= points.length;
  if (Math.min(eErr, rErr) > 0.3) return null;
  return { kind: rErr < eErr ? 'rect' : 'ellipse', x1: x0, y1: y0, x2: x1, y2: y1 };
}
