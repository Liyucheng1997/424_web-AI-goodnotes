import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { ElementView, PaperView } from './ElementView.jsx';
import { PAGE_W, PAGE_H } from './templates.js';
import { uid, strokePathFromPoints, hitTest, inLasso, unionBox, transformEl } from './ink.js';
import { recognizeShape } from './recognize.js';
import { fontCss, fontScale } from './text.js';
import { Trash2, Copy, CopyPlus, Palette } from 'lucide-react';

const HOLD_MS = 550;

function Page({
  page,
  index,
  zoom,
  tool,
  penOnly,
  selection,
  editingId,
  onChange,
  onSelect,
  onEditText,
  onActivate,
  onSelectionAction,
  palette,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const liveRef = useRef(null);
  const cursorRef = useRef(null);
  const drag = useRef(null);
  const [visible, setVisible] = useState(index < 3);
  const [erased, setErased] = useState(null); // Set<id>
  const [lasso, setLasso] = useState(null); // [[x,y]]
  const [shapePreview, setShapePreview] = useState(null);
  const [xf, setXf] = useState(null); // 选择框实时变换
  const [showColors, setShowColors] = useState(false);

  // 只渲染视口附近的页面
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const selIds = selection?.pageId === page.id ? selection.ids : null;
  const selSet = useMemo(() => new Set(selIds || []), [selIds]);
  const selEls = useMemo(() => page.elements.filter((e) => selSet.has(e.id)), [page.elements, selSet]);
  const selBox = useMemo(() => (selEls.length ? unionBox(selEls) : null), [selEls]);

  useEffect(() => setShowColors(false), [selIds]);
  useEffect(() => {
    if (tool.tool !== 'eraser' && cursorRef.current) cursorRef.current.style.display = 'none';
  }, [tool.tool]);

  const toPage = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };

  const setLive = (d, color, opacity) => {
    const p = liveRef.current;
    if (!p) return;
    p.setAttribute('d', d || '');
    if (color) p.setAttribute('fill', color);
    p.style.opacity = opacity ?? 1;
    p.style.mixBlendMode = opacity && opacity < 1 ? 'multiply' : 'normal';
  };

  const moveCursor = (x, y, r) => {
    const c = cursorRef.current;
    if (!c) return;
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', r);
    c.style.display = 'block';
  };

  const capture = (e) => {
    try {
      svgRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件没有真实指针 */
    }
  };

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (penOnly && e.pointerType === 'touch') return; // 防误触：手指只用来滚动
    if (tool.tool === 'hand') return;
    onActivate(index);
    const [x, y] = toPage(e);
    const t = tool.tool;

    // 选择框：拖动/缩放
    if (t === 'lasso' && selBox) {
      const hx = selBox.x + selBox.w, hy = selBox.y + selBox.h;
      if (Math.hypot(x - hx, y - hy) < 14 / zoom + 6) {
        drag.current = { mode: 'scale', sx: x, sy: y, ox: selBox.x, oy: selBox.y, w0: Math.max(selBox.w, selBox.h) };
        capture(e);
        return;
      }
      if (x >= selBox.x - 6 && x <= hx + 6 && y >= selBox.y - 6 && y <= hy + 6) {
        drag.current = { mode: 'move', sx: x, sy: y };
        capture(e);
        return;
      }
      onSelect(null);
    }

    if (t === 'text') {
      e.preventDefault();
      if (editingId) {
        // 正在编辑：点别处 = 完成编辑
        document.activeElement?.blur?.();
        return;
      }
      const hit = [...page.elements].reverse().find((el) => el.type === 'text' && hitTest(el, x, y, 4));
      if (hit) {
        onEditText(page.id, hit.id);
      } else {
        const el = {
          id: uid(),
          type: 'text',
          x,
          y: y - 16,
          w: Math.max(120, Math.min(360, PAGE_W - x - 30)),
          text: '',
          size: tool.textSize,
          lh: Math.round(tool.textSize * 1.6),
          color: tool.color,
          font: tool.font,
          rot: 0,
        };
        onChange(page.id, [...page.elements, el], { silent: true });
        onEditText(page.id, el.id, true);
      }
      return;
    }

    capture(e);
    e.preventDefault();

    if (t === 'pen' || t === 'highlighter') {
      const pressure = e.pointerType === 'pen';
      const el = { tool: t, size: tool.size, pressure };
      drag.current = { mode: 'ink', el, pts: [[x, y, pressure ? e.pressure || 0.5 : 0.5]], last: [x, y], holdTimer: null, snapped: null };
      setLive(strokePathFromPoints(drag.current.pts, el), tool.color, t === 'highlighter' ? 0.38 : 1);
      armHold();
    } else if (t === 'eraser') {
      drag.current = { mode: 'erase', set: new Set() };
      eraseAt(x, y);
      moveCursor(x, y, tool.eraserSize);
    } else if (t === 'lasso') {
      drag.current = { mode: 'lasso', pts: [[x, y]] };
      setLasso([[x, y]]);
    } else if (t === 'shape') {
      drag.current = { mode: 'shape', x1: x, y1: y };
      setShapePreview(null);
    }
  }

  function armHold() {
    const d = drag.current;
    clearTimeout(d.holdTimer);
    d.holdTimer = setTimeout(() => {
      const cur = drag.current;
      if (!cur || cur.mode !== 'ink' || cur.pts.length < 4) return;
      const sh = recognizeShape(cur.pts);
      if (!sh) return;
      cur.snapped = sh;
      setLive('');
      setShapePreview({ id: 'preview', type: 'shape', ...sh, color: tool.color, size: Math.max(1.5, tool.size * 0.55), rough: false, seed: 3 });
    }, HOLD_MS);
  }

  function eraseAt(x, y) {
    const d = drag.current;
    const r = tool.eraserSize / 1;
    let changed = false;
    for (const el of page.elements) {
      if (d.set.has(el.id)) continue;
      if (hitTest(el, x, y, r)) {
        d.set.add(el.id);
        changed = true;
      }
    }
    if (changed) setErased(new Set(d.set));
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (tool.tool === 'eraser' && e.pointerType !== 'touch') {
      const [x, y] = toPage(e);
      moveCursor(x, y, tool.eraserSize);
    }
    if (!d) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (d.mode === 'ink') {
      if (d.snapped) {
        // 已成形：继续拖动可调整终点
        const [x, y] = toPage(e);
        const sh = { ...d.snapped };
        if (sh.kind === 'line') {
          sh.x2 = x;
          sh.y2 = y;
          d.snapped = sh;
          setShapePreview((p) => (p ? { ...p, x2: x, y2: y } : p));
        }
        return;
      }
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = toPage(ev);
        d.pts.push([x, y, d.el.pressure ? ev.pressure || 0.5 : 0.5]);
      }
      const [lx, ly] = d.pts[d.pts.length - 1];
      if (Math.hypot(lx - d.last[0], ly - d.last[1]) > 3) {
        d.last = [lx, ly];
        armHold();
      }
      setLive(strokePathFromPoints(d.pts, d.el));
    } else if (d.mode === 'erase') {
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = toPage(ev);
        eraseAt(x, y);
      }
    } else if (d.mode === 'lasso') {
      const [x, y] = toPage(e);
      d.pts.push([x, y]);
      setLasso([...d.pts]);
    } else if (d.mode === 'shape') {
      const [x, y] = toPage(e);
      let x2 = x, y2 = y;
      if (e.shiftKey && (tool.shapeKind === 'rect' || tool.shapeKind === 'ellipse')) {
        const s = Math.max(Math.abs(x - d.x1), Math.abs(y - d.y1));
        x2 = d.x1 + Math.sign(x - d.x1) * s;
        y2 = d.y1 + Math.sign(y - d.y1) * s;
      }
      d.preview = { id: 'preview', type: 'shape', kind: tool.shapeKind, x1: d.x1, y1: d.y1, x2, y2, color: tool.color, size: Math.max(1.5, tool.size * 0.55), rough: tool.rough, seed: 7 };
      setShapePreview(d.preview);
    } else if (d.mode === 'move') {
      const [x, y] = toPage(e);
      d.xf = { dx: x - d.sx, dy: y - d.sy, s: 1, ox: 0, oy: 0 };
      setXf(d.xf);
    } else if (d.mode === 'scale') {
      const [x, y] = toPage(e);
      const s = Math.max(0.15, (d.w0 + Math.max(x - d.sx, y - d.sy)) / d.w0);
      d.xf = { dx: 0, dy: 0, s, ox: d.ox, oy: d.oy };
      setXf(d.xf);
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'ink') {
      clearTimeout(d.holdTimer);
      setLive('');
      if (d.snapped) {
        const sh = d.snapped;
        const el = { id: uid(), type: 'shape', ...sh, color: tool.color, size: Math.max(1.5, tool.size * 0.55), rough: false, seed: Math.floor(Math.random() * 1e6) };
        if (tool.tool === 'highlighter' && sh.kind === 'line') {
          // 荧光笔拉直：保持荧光笔笔迹
          const stroke = { id: uid(), type: 'stroke', tool: 'highlighter', color: tool.color, size: tool.size, pressure: false, points: [[sh.x1, sh.y1, 0.5], [sh.x2, sh.y2, 0.5]] };
          onChange(page.id, [...page.elements, stroke]);
        } else onChange(page.id, [...page.elements, el]);
        setShapePreview(null);
        return;
      }
      const el = { id: uid(), type: 'stroke', tool: d.el.tool, color: tool.color, size: d.el.size, pressure: d.el.pressure, points: d.pts.map(([x, y, p]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100]) };
      onChange(page.id, [...page.elements, el]);
    } else if (d.mode === 'erase') {
      if (d.set.size) onChange(page.id, page.elements.filter((el) => !d.set.has(el.id)));
      setErased(null);
    } else if (d.mode === 'lasso') {
      setLasso(null);
      const pts = d.pts;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      let ids;
      if (len < 8) {
        const [x, y] = pts[0];
        const hit = [...page.elements].reverse().find((el) => hitTest(el, x, y, 6));
        ids = hit ? [hit.id] : [];
      } else {
        ids = page.elements.filter((el) => inLasso(el, pts)).map((el) => el.id);
      }
      onSelect(ids.length ? { pageId: page.id, ids } : null);
    } else if (d.mode === 'shape') {
      const p = d.preview;
      setShapePreview(null);
      if (p && Math.hypot(p.x2 - p.x1, p.y2 - p.y1) > 4) {
        onChange(page.id, [...page.elements, { ...p, id: uid(), seed: Math.floor(Math.random() * 1e6) }]);
      }
    } else if (d.mode === 'move' || d.mode === 'scale') {
      const cur = d.xf;
      setXf(null);
      if (cur && (cur.dx || cur.dy || cur.s !== 1)) {
        onChange(page.id, page.elements.map((el) => (selSet.has(el.id) ? transformEl(el, cur) : el)));
      }
    }
  }

  function onPointerLeave() {
    if (cursorRef.current) cursorRef.current.style.display = 'none';
  }

  // 文字编辑
  const editing = editingId?.pageId === page.id ? page.elements.find((e) => e.id === editingId.id) : null;
  const taRef = useRef(null);
  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      const v = taRef.current.value;
      taRef.current.setSelectionRange(v.length, v.length);
    }
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function commitText(value) {
    const el = editing;
    if (!el) return;
    const others = page.elements.filter((e) => e.id !== el.id);
    if (!value.trim()) onChange(page.id, others, { silent: true });
    else if (value !== el.text) onChange(page.id, page.elements.map((e) => (e.id === el.id ? { ...e, text: value } : e)));
    onEditText(null);
  }

  const touchAction = tool.tool === 'hand' || penOnly ? 'pan-x pan-y' : 'none';
  const cursor = { pen: 'crosshair', highlighter: 'crosshair', eraser: 'none', lasso: 'default', text: 'text', shape: 'crosshair', hand: 'grab' }[tool.tool];
  const xfTransform = xf ? `translate(${xf.dx} ${xf.dy}) translate(${xf.ox} ${xf.oy}) scale(${xf.s}) translate(${-xf.ox} ${-xf.oy})` : undefined;

  return (
    <div className="page-wrap" ref={wrapRef} data-page-index={index} style={{ width: PAGE_W * zoom, height: PAGE_H * zoom }}>
      <svg
        ref={svgRef}
        className="page-svg"
        width={PAGE_W * zoom}
        height={PAGE_H * zoom}
        viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
        style={{ touchAction, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        <PaperView template={page.template} paper={page.paper} pid={page.id} />
        {visible && (
          <g>
            {page.elements.map((el) =>
              selSet.has(el.id) && xf ? null : <ElementView key={el.id} el={el} hidden={erased?.has(el.id) || editing?.id === el.id} />,
            )}
            {xf && (
              <g transform={xfTransform}>
                {selEls.map((el) => (
                  <ElementView key={el.id} el={el} />
                ))}
              </g>
            )}
          </g>
        )}
        <path ref={liveRef} d="" />
        {shapePreview && <ElementView el={shapePreview} />}
        {lasso && <polyline points={lasso.map((p) => p.join(',')).join(' ')} fill="rgba(0,113,227,0.06)" stroke="#0071e3" strokeWidth={1.4 / zoom} strokeDasharray={`${5 / zoom} ${4 / zoom}`} />}
        {selBox && (
          <g transform={xfTransform}>
            <rect
              x={selBox.x - 6}
              y={selBox.y - 6}
              width={selBox.w + 12}
              height={selBox.h + 12}
              fill="rgba(0,113,227,0.04)"
              stroke="#0071e3"
              strokeWidth={1.5 / zoom}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
              rx={6}
            />
            <circle cx={selBox.x + selBox.w} cy={selBox.y + selBox.h} r={8 / zoom + 2} fill="#fff" stroke="#0071e3" strokeWidth={2 / zoom} />
          </g>
        )}
        <circle ref={cursorRef} r="10" fill="rgba(255,255,255,0.6)" stroke="rgba(0,0,0,0.45)" strokeWidth={1 / zoom} style={{ display: 'none', pointerEvents: 'none' }} />
      </svg>

      {editing && (
        <textarea
          key={editing.id}
          ref={taRef}
          className="text-editor"
          defaultValue={editing.text}
          spellCheck={false}
          style={{
            left: editing.x * zoom - 4,
            top: editing.y * zoom - 2,
            width: editing.w * zoom + 8,
            minHeight: editing.lh * zoom + 4,
            fontSize: editing.size * fontScale(editing.font) * zoom,
            lineHeight: `${editing.lh * zoom}px`,
            fontFamily: fontCss(editing.font),
            color: editing.color,
            fontWeight: editing.bold ? 700 : 400,
          }}
          onInput={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur();
            e.stopPropagation();
          }}
        />
      )}

      {selBox && !xf && (
        <div className="sel-menu" style={{ left: Math.max(0, (selBox.x + selBox.w / 2) * zoom), top: Math.max(0, (selBox.y - 6) * zoom) }} onPointerDown={(e) => e.stopPropagation()}>
          <button title="颜色" onClick={() => setShowColors((v) => !v)}>
            <Palette size={16} strokeWidth={1.75} />
          </button>
          <button title="复制" onClick={() => onSelectionAction('copy')}>
            <Copy size={16} strokeWidth={1.75} />
          </button>
          <button title="创建副本" onClick={() => onSelectionAction('duplicate')}>
            <CopyPlus size={16} strokeWidth={1.75} />
          </button>
          <button title="删除" className="danger" onClick={() => onSelectionAction('delete')}>
            <Trash2 size={16} strokeWidth={1.75} />
          </button>
          {showColors && (
            <div className="sel-colors">
              {palette.map((c) => (
                <button key={c} className="dot" style={{ background: c }} onClick={() => onSelectionAction('color', c)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(Page);
