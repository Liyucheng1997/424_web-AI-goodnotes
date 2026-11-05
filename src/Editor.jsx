import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  ChevronLeft, Undo2, Redo2, PenLine, Highlighter, Eraser, Lasso, Shapes, Type, ImagePlus, Hand, Sparkles, Download,
  Settings as SettingsIcon, Moon, Sun, Minus, Plus, PanelLeft, Copy, Trash2, ArrowUp, ArrowDown, FilePlus2, Square, Circle, Slash, MoveUpRight, Maximize2,
} from 'lucide-react';
import Page from './canvas/Page.jsx';
import { ElementView, PaperView } from './canvas/ElementView.jsx';
import { PAGE_W, PAGE_H, TEMPLATES, PAPERS, paperColor } from './canvas/templates.js';
import { uid, transformEl, unionBox } from './canvas/ink.js';
import { FONTS } from './canvas/text.js';
import { newPage, saveNotebook, updateMeta } from './store.js';
import AiPanel from './ai/AiPanel.jsx';
import Settings from './ui/Settings.jsx';
import { toast } from './ui/toast.js';
import { exportPDF, exportPNG, thumbnail } from './export.js';

const INKS = ['#1d1d1f', '#1f4e9c', '#c0262d', '#2f6f4f', '#b35c00', '#6b4fa3'];
const HIGHLIGHTS = ['#ffd84d', '#8be3a6', '#8ccbff', '#ffa8cb', '#ffbe6b'];
const SIZES = { pen: [1.6, 2.6, 4], highlighter: [12, 18, 26], eraser: [6, 12, 24], shape: [1.6, 2.6, 4], text: [16, 20, 28] };

const TOOL_KEY = 'inkmind.tool';
const DEFAULT_TOOL = {
  tool: 'pen',
  penColor: '#1d1d1f',
  hlColor: '#ffd84d',
  penSize: 2.6,
  hlSize: 18,
  eraserSize: 12,
  shapeKind: 'rect',
  rough: true,
  textSize: 20,
  font: 'wenkai',
};
function loadTool() {
  try {
    return { ...DEFAULT_TOOL, ...JSON.parse(localStorage.getItem(TOOL_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_TOOL };
  }
}

export default function Editor({ meta, initialDoc, prefs, setPrefs, onBack, onRename }) {
  const [doc, setDoc] = useState(initialDoc);
  const [title, setTitle] = useState(meta.title);
  const hist = useRef({ undo: [], redo: [], silentBase: null });
  const [, force] = useState(0);
  const [ts, setTs] = useState(loadTool);
  const [selection, setSelection] = useState(null);
  const [editing, setEditing] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [cur, setCur] = useState(0);
  const [showThumbs, setShowThumbs] = useState(() => window.innerWidth > 900);
  const [showAi, setShowAi] = useState(() => !initialDoc.pages.some((p) => p.elements.length));
  const [showSettings, setShowSettings] = useState(false);
  const [menu, setMenu] = useState(null); // 'shape' | 'page' | 'export'
  const [saved, setSaved] = useState(true);
  const scrollRef = useRef(null);
  const clip = useRef(null);
  const fileRef = useRef(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    try {
      localStorage.setItem(TOOL_KEY, JSON.stringify(ts));
    } catch {
      /* ignore */
    }
  }, [ts]);

  /* ---------- 初始缩放：适应宽度 ---------- */
  const fitWidth = useCallback(() => {
    const w = scrollRef.current?.clientWidth || 900;
    setZoom(Math.max(0.35, Math.min(1.4, (w - 48) / PAGE_W)));
  }, []);
  useEffect(() => {
    fitWidth();
  }, [fitWidth]);

  /* ---------- 自动保存 ---------- */
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(async () => {
      await saveNotebook(doc, { title });
      setSaved(true);
    }, 500);
    return () => clearTimeout(t);
  }, [doc, title]);
  const titleRef = useRef(title);
  titleRef.current = title;
  useEffect(
    () => () => {
      // 离开编辑器时立即保存（防止防抖期间的修改丢失）
      const d = docRef.current;
      saveNotebook(d, { title: titleRef.current });
      if (d.pages[0]) thumbnail(d.pages[0]).then((thumb) => updateMeta(d.id, { thumb }));
    },
    [],
  );
  useEffect(() => {
    const t = setTimeout(async () => {
      const first = doc.pages[0];
      if (first) updateMeta(doc.id, { thumb: await thumbnail(first) });
    }, 2500);
    return () => clearTimeout(t);
  }, [doc.pages[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 历史记录 ---------- */
  const setPages = useCallback((fn, { silent = false } = {}) => {
    setDoc((d) => {
      const pages = typeof fn === 'function' ? fn(d.pages) : fn;
      if (pages === d.pages) return d;
      const h = hist.current;
      if (silent) {
        if (!h.silentBase) h.silentBase = d.pages;
      } else {
        h.undo.push(h.silentBase || d.pages);
        h.silentBase = null;
        if (h.undo.length > 120) h.undo.shift();
        h.redo = [];
      }
      return { ...d, pages };
    });
    force((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const h = hist.current;
    if (!h.undo.length) return;
    setDoc((d) => {
      h.redo.push(h.silentBase || d.pages);
      h.silentBase = null;
      return { ...d, pages: h.undo.pop() };
    });
    setSelection(null);
    setEditing(null);
    force((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const h = hist.current;
    if (!h.redo.length) return;
    setDoc((d) => {
      h.undo.push(d.pages);
      return { ...d, pages: h.redo.pop() };
    });
    setSelection(null);
    force((n) => n + 1);
  }, []);

  const onPageChange = useCallback(
    (pageId, elements, opts) => setPages((pages) => pages.map((p) => (p.id === pageId ? { ...p, elements } : p)), opts),
    [setPages],
  );

  /* ---------- 选择操作 ---------- */
  const selectionAction = useCallback(
    (action, arg) => {
      const sel = selection;
      if (!sel) return;
      const ids = new Set(sel.ids);
      if (action === 'copy') {
        const page = docRef.current.pages.find((p) => p.id === sel.pageId);
        clip.current = page.elements.filter((e) => ids.has(e.id));
        toast(`已复制 ${clip.current.length} 个对象`);
        return;
      }
      if (action === 'delete') {
        setPages((pages) => pages.map((p) => (p.id === sel.pageId ? { ...p, elements: p.elements.filter((e) => !ids.has(e.id)) } : p)));
        setSelection(null);
      } else if (action === 'duplicate') {
        const newIds = [];
        setPages((pages) =>
          pages.map((p) => {
            if (p.id !== sel.pageId) return p;
            const copies = p.elements.filter((e) => ids.has(e.id)).map((e) => {
              const c = { ...transformEl(e, { dx: 24, dy: 24 }), id: uid() };
              newIds.push(c.id);
              return c;
            });
            return { ...p, elements: [...p.elements, ...copies] };
          }),
        );
        setSelection({ pageId: sel.pageId, ids: newIds });
      } else if (action === 'color') {
        setPages((pages) =>
          pages.map((p) => (p.id !== sel.pageId ? p : { ...p, elements: p.elements.map((e) => (ids.has(e.id) && e.type !== 'image' && !(e.type === 'stroke' && e.tool === 'highlighter') ? { ...e, color: arg } : e)) })),
        );
      }
    },
    [selection, setPages],
  );

  const paste = useCallback(() => {
    const items = clip.current;
    if (!items?.length) return;
    const page = docRef.current.pages[cur];
    if (!page) return;
    const box = unionBox(items);
    const dx = Math.min(30, PAGE_W - box.x - box.w), dy = 30;
    const copies = items.map((e) => ({ ...transformEl(e, { dx, dy }), id: uid() }));
    onPageChange(page.id, [...page.elements, ...copies]);
    setSelection({ pageId: page.id, ids: copies.map((c) => c.id) });
    setTs((t) => ({ ...t, tool: 'lasso' }));
  }, [cur, onPageChange]);

  /* ---------- 图片 ---------- */
  const insertImage = useCallback(
    (file) => {
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const im = new Image();
        im.onload = () => {
          // 压缩大图
          const max = 1400;
          const s = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.round(im.width * s);
          c.height = Math.round(im.height * s);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          const src = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
          const w = Math.min(PAGE_W * 0.6, im.width);
          const h = (w * im.height) / im.width;
          const page = docRef.current.pages[cur];
          const el = { id: uid(), type: 'image', x: (PAGE_W - w) / 2, y: Math.max(60, (PAGE_H - h) / 3), w, h, src };
          onPageChange(page.id, [...page.elements, el]);
          setSelection({ pageId: page.id, ids: [el.id] });
          setTs((t) => ({ ...t, tool: 'lasso' }));
        };
        im.src = reader.result;
      };
      reader.readAsDataURL(file);
    },
    [cur, onPageChange],
  );

  /* ---------- 快捷键 / 粘贴 ---------- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && k === 'c' && selection) {
        selectionAction('copy');
      } else if (mod && k === 'v' && clip.current) {
        e.preventDefault();
        paste();
      } else if (mod && k === 'd' && selection) {
        e.preventDefault();
        selectionAction('duplicate');
      } else if ((k === 'delete' || k === 'backspace') && selection) {
        selectionAction('delete');
      } else if (k === 'escape') {
        setSelection(null);
        setMenu(null);
      } else if (!mod && !e.altKey) {
        const map = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso', t: 'text', s: 'shape', ' ': null };
        if (map[k]) setTs((t) => ({ ...t, tool: map[k] }));
      }
    };
    const onPaste = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        insertImage(f);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, [undo, redo, selection, selectionAction, paste, insertImage]);

  useEffect(() => {
    if (ts.tool !== 'lasso') setSelection(null);
    setMenu(null);
  }, [ts.tool]);

  /* ---------- 缩放 / 滚动 ---------- */
  useEffect(() => {
    const el = scrollRef.current;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.max(0.3, Math.min(3, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    const mid = el.scrollTop + el.clientHeight / 2;
    const pageH = PAGE_H * zoom + 28;
    setCur(Math.max(0, Math.min(docRef.current.pages.length - 1, Math.floor((mid - 24) / pageH))));
  }, [zoom]);

  const scrollToPage = useCallback(
    (i, smooth = true) => {
      const el = scrollRef.current;
      el.scrollTo({ top: 24 + i * (PAGE_H * zoom + 28) - 12, behavior: smooth ? 'smooth' : 'auto' });
      setCur(i);
    },
    [zoom],
  );

  // 抓手工具：鼠标拖动滚动
  const panRef = useRef(null);
  const onScrollerDown = (e) => {
    if (ts.tool !== 'hand' || e.pointerType === 'touch') return;
    panRef.current = { x: e.clientX, y: e.clientY, sl: scrollRef.current.scrollLeft, st: scrollRef.current.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onScrollerMove = (e) => {
    const p = panRef.current;
    if (!p) return;
    scrollRef.current.scrollLeft = p.sl - (e.clientX - p.x);
    scrollRef.current.scrollTop = p.st - (e.clientY - p.y);
  };

  /* ---------- 页面操作 ---------- */
  const addPage = (template, at = cur + 1) => {
    const base = doc.pages[cur];
    const p = newPage(template || base?.template || 'cornell', base?.paper || 'white');
    setPages((pages) => [...pages.slice(0, at), p, ...pages.slice(at)]);
    setMenu(null);
    setTimeout(() => scrollToPage(at), 30);
  };
  const dupPage = (i) => {
    const src = doc.pages[i];
    const p = { ...src, id: uid(), elements: src.elements.map((e) => ({ ...e, id: uid() })) };
    setPages((pages) => [...pages.slice(0, i + 1), p, ...pages.slice(i + 1)]);
  };
  const delPage = (i) => {
    if (doc.pages.length === 1) {
      setPages([newPage(doc.pages[0].template, doc.pages[0].paper)]);
      return;
    }
    setPages((pages) => pages.filter((_, j) => j !== i));
    toast('已删除页面，可撤销');
  };
  const movePage = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= doc.pages.length) return;
    setPages((pages) => {
      const a = [...pages];
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
  };
  const setPageStyle = (patch) => {
    const id = doc.pages[cur]?.id;
    setPages((pages) => pages.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  /* ---------- AI 插入 ---------- */
  const insertAiPages = (pages, aiTitle) => {
    const d = docRef.current;
    const blank = d.pages.length === 1 && !d.pages[0].elements.length;
    const at = blank ? 0 : d.pages.length;
    setPages((old) => (blank ? pages : [...old, ...pages]));
    if (aiTitle && (/^未命名/.test(title) || !title.trim())) {
      setTitle(aiTitle);
      onRename(aiTitle);
    }
    setTs((t) => ({ ...t, tool: 'pen' }));
    setTimeout(() => scrollToPage(at), 80);
  };

  const recordings = doc.recordings || [];
  const recActions = {
    onAddRecording: (r) => setDoc((d) => ({ ...d, recordings: [r, ...(d.recordings || [])] })),
    onRemoveRecording: (id) => setDoc((d) => ({ ...d, recordings: d.recordings.filter((r) => r.id !== id) })),
    onUpdateRecording: (id, patch) => setDoc((d) => ({ ...d, recordings: d.recordings.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  };

  /* ---------- 工具状态 ---------- */
  const t = ts.tool;
  const color = t === 'highlighter' ? ts.hlColor : ts.penColor;
  const pageTool = useMemo(
    () => ({
      tool: t,
      color,
      size: t === 'highlighter' ? ts.hlSize : ts.penSize,
      eraserSize: ts.eraserSize,
      shapeKind: ts.shapeKind,
      rough: ts.rough,
      textSize: ts.textSize,
      font: ts.font,
    }),
    [t, color, ts.hlSize, ts.penSize, ts.eraserSize, ts.shapeKind, ts.rough, ts.textSize, ts.font],
  );

  const setColor = (c) => setTs((s) => (s.tool === 'highlighter' ? { ...s, hlColor: c } : { ...s, penColor: c }));
  const sizeKey = { pen: 'penSize', highlighter: 'hlSize', eraser: 'eraserSize', shape: 'penSize', text: 'textSize' }[t];
  const sizes = SIZES[t];
  const onActivate = useCallback((i) => setCur(i), []);
  const onEditText = useCallback((pageId, id, fresh) => setEditing(pageId ? { pageId, id, fresh } : null), []);

  const doExport = async (kind) => {
    setMenu(null);
    try {
      if (kind === 'pdf') {
        toast('正在生成 PDF…');
        await exportPDF(doc.pages, title);
      } else await exportPNG(doc.pages[cur], `${title}-第${cur + 1}页`);
    } catch (e) {
      toast('导出失败：' + e.message, 'error');
    }
  };

  const ShapeIcon = { rect: Square, ellipse: Circle, line: Slash, arrow: MoveUpRight }[ts.shapeKind];
  const tools = [
    ['pen', PenLine, '钢笔 (P)'],
    ['highlighter', Highlighter, '荧光笔 (H)'],
    ['eraser', Eraser, '橡皮擦 (E)'],
    ['lasso', Lasso, '套索选择 (L)'],
    ['shape', ShapeIcon, '形状 (S)'],
    ['text', Type, '文字 (T)'],
    ['hand', Hand, '抓手'],
  ];
  const curPage = doc.pages[cur];

  return (
    <div className="editor">
      <header className="titlebar">
        <button className="tb-round" onClick={onBack} title="返回书库">
          <ChevronLeft size={18} />
        </button>
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onRename(title.trim() || '未命名笔记')}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <div className="tb-spacer" />
        <button className="icon-btn" onClick={undo} disabled={!hist.current.undo.length} title="撤销 (Ctrl+Z)">
          <Undo2 size={18} strokeWidth={1.75} />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!hist.current.redo.length} title="重做 (Ctrl+Shift+Z)">
          <Redo2 size={18} strokeWidth={1.75} />
        </button>
        <div className="popover-anchor">
          <button className="icon-btn" onClick={() => setMenu(menu === 'export' ? null : 'export')} title="导出">
            <Download size={18} strokeWidth={1.75} />
          </button>
          {menu === 'export' && (
            <div className="popover menu" style={{ right: 0, top: 38 }}>
              <div className="menu-item" onClick={() => doExport('pdf')}>
                <span className="menu-label">导出整本为 PDF</span>
              </div>
              <div className="menu-item" onClick={() => doExport('png')}>
                <span className="menu-label">导出当前页为 PNG</span>
              </div>
            </div>
          )}
        </div>
        <button className="icon-btn hide-sm" onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })} title="深色模式">
          {prefs.theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="设置">
          <SettingsIcon size={18} strokeWidth={1.75} />
        </button>
        <button className={'btn ' + (showAi ? 'btn-soft' : 'btn-primary')} onClick={() => setShowAi((v) => !v)}>
          <Sparkles size={15} />
          <span className="ai-btn-label">AI 记笔记</span>
        </button>
      </header>

      <div className="toolbar">
        <button className={'icon-btn tool' + (showThumbs ? ' on' : '')} onClick={() => setShowThumbs((v) => !v)} title="页面缩略图">
          <PanelLeft size={18} strokeWidth={1.75} />
        </button>
        <span className="tb-sep" />
        {tools.map(([id, Icon, label]) => (
          <div className="popover-anchor" key={id}>
            <button
              className={'icon-btn tool' + (t === id ? ' on' : '')}
              title={label}
              onClick={() => {
                if (id === 'shape' && t === 'shape') setMenu(menu === 'shape' ? null : 'shape');
                else setTs((s) => ({ ...s, tool: id }));
              }}
            >
              <Icon size={18} strokeWidth={1.75} />
            </button>
            {id === 'shape' && menu === 'shape' && (
              <div className="popover menu" style={{ left: 0, top: 38 }}>
                {[
                  ['rect', Square, '矩形'],
                  ['ellipse', Circle, '椭圆'],
                  ['line', Slash, '直线'],
                  ['arrow', MoveUpRight, '箭头'],
                ].map(([k, I, l]) => (
                  <div key={k} className="menu-item" onClick={() => { setTs((s) => ({ ...s, shapeKind: k })); setMenu(null); }}>
                    <span className="menu-icon"><I size={15} /></span>
                    <span className="menu-label">{l}</span>
                    {ts.shapeKind === k && <span className="menu-shortcut">✓</span>}
                  </div>
                ))}
                <div className="menu-sep" />
                <div className="menu-item" onClick={() => setTs((s) => ({ ...s, rough: !s.rough }))}>
                  <span className="menu-label">手绘风格</span>
                  {ts.rough && <span className="menu-shortcut">✓</span>}
                </div>
              </div>
            )}
          </div>
        ))}
        <button className="icon-btn tool" title="插入图片" onClick={() => fileRef.current.click()}>
          <ImagePlus size={18} strokeWidth={1.75} />
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { insertImage(e.target.files[0]); e.target.value = ''; }} />

        {['pen', 'highlighter', 'shape', 'text'].includes(t) && (
          <>
            <span className="tb-sep" />
            <div className="swatches">
              {(t === 'highlighter' ? HIGHLIGHTS : INKS).map((c) => (
                <button key={c} className={'swatch-dot' + (color === c ? ' on' : '')} style={{ '--c': c }} onClick={() => setColor(c)} />
              ))}
              <label className="swatch-dot custom" title="自定义颜色" style={{ '--c': color }}>
                <input type="color" value={color.length === 7 ? color : '#000000'} onChange={(e) => setColor(e.target.value)} />
              </label>
            </div>
          </>
        )}
        {sizes && (
          <>
            <span className="tb-sep" />
            <div className="sizes">
              {sizes.map((s, i) => (
                <button key={s} className={'size-btn' + (ts[sizeKey] === s ? ' on' : '')} onClick={() => setTs((x) => ({ ...x, [sizeKey]: s }))} title={`粗细 ${i + 1}`}>
                  <i style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
                </button>
              ))}
            </div>
          </>
        )}
        {t === 'text' && (
          <select className="input input-sm" value={ts.font} onChange={(e) => setTs((s) => ({ ...s, font: e.target.value }))}>
            {Object.entries(FONTS).map(([k, f]) => (
              <option key={k} value={k}>
                {f.label}
              </option>
            ))}
          </select>
        )}
        <div className="tb-spacer" />
        <div className="popover-anchor">
          <button className="btn btn-sm" onClick={() => setMenu(menu === 'page' ? null : 'page')}>
            {TEMPLATES.find((x) => x.id === curPage?.template)?.name || '模板'}
          </button>
          {menu === 'page' && (
            <div className="popover page-pop" style={{ right: 0, top: 36 }}>
              <div className="menu-header">当前页模板</div>
              <div className="tpl-grid">
                {TEMPLATES.map((tp) => (
                  <button key={tp.id} className={'tpl' + (curPage?.template === tp.id ? ' on' : '')} onClick={() => setPageStyle({ template: tp.id })}>
                    <svg viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}>
                      <PaperView template={tp.id} paper={curPage?.paper || 'white'} pid={'tpl-' + tp.id} />
                    </svg>
                    <span>{tp.name}</span>
                  </button>
                ))}
              </div>
              <div className="menu-header">纸张颜色</div>
              <div className="paper-row">
                {PAPERS.map((p) => (
                  <button key={p.id} className={'paper-dot' + (curPage?.paper === p.id ? ' on' : '')} style={{ background: p.color }} title={p.name} onClick={() => setPageStyle({ paper: p.id })} />
                ))}
              </div>
              <div className="menu-sep" />
              <div className="menu-item" onClick={() => addPage(curPage?.template)}>
                <span className="menu-icon"><FilePlus2 size={15} /></span>
                <span className="menu-label">在后面添加一页</span>
              </div>
            </div>
          )}
        </div>
        <span className="tb-sep" />
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.3, z / 1.15))} title="缩小">
          <Minus size={16} />
        </button>
        <button className="zoom-label tabular" onClick={fitWidth} title="适应宽度">
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(3, z * 1.15))} title="放大">
          <Plus size={16} />
        </button>
        <button className="icon-btn" onClick={fitWidth} title="适应宽度">
          <Maximize2 size={15} />
        </button>
      </div>

      <div className="workspace">
        {showThumbs && (
          <aside className="thumbs">
            {doc.pages.map((p, i) => (
              <div key={p.id} className={'thumb' + (i === cur ? ' on' : '')} onClick={() => scrollToPage(i)}>
                <Thumb page={p} />
                <div className="thumb-foot">
                  <span className="tabular">{i + 1}</span>
                  <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
                    <button title="上移" onClick={() => movePage(i, -1)}><ArrowUp size={12} /></button>
                    <button title="下移" onClick={() => movePage(i, 1)}><ArrowDown size={12} /></button>
                    <button title="复制页面" onClick={() => dupPage(i)}><Copy size={12} /></button>
                    <button title="删除页面" className="danger" onClick={() => delPage(i)}><Trash2 size={12} /></button>
                  </div>
                </div>
              </div>
            ))}
            <button className="add-page" onClick={() => addPage(curPage?.template, doc.pages.length)}>
              <Plus size={16} /> 添加页面
            </button>
          </aside>
        )}

        <main
          className={'scroller' + (t === 'hand' ? ' grab' : '')}
          ref={scrollRef}
          onScroll={onScroll}
          onPointerDown={onScrollerDown}
          onPointerMove={onScrollerMove}
          onPointerUp={() => (panRef.current = null)}
        >
          <div className="pages">
            {doc.pages.map((p, i) => (
              <Page
                key={p.id}
                page={p}
                index={i}
                zoom={zoom}
                tool={pageTool}
                penOnly={prefs.penOnly}
                selection={selection}
                editingId={editing}
                onChange={onPageChange}
                onSelect={setSelection}
                onEditText={onEditText}
                onActivate={onActivate}
                onSelectionAction={selectionAction}
                palette={INKS}
              />
            ))}
            <button className="add-page-bottom" onClick={() => addPage(doc.pages[doc.pages.length - 1]?.template, doc.pages.length)}>
              <Plus size={16} /> 添加页面
            </button>
          </div>
        </main>

        {showAi && (
          <AiPanel
            prefs={prefs}
            setPrefs={setPrefs}
            notebookTitle={title}
            recordings={recordings}
            {...recActions}
            onInsertPages={insertAiPages}
            onClose={() => setShowAi(false)}
          />
        )}
      </div>

      <footer className="statusbar">
        <span className="tabular">
          第 {cur + 1} / {doc.pages.length} 页
        </span>
        <span className={'status-dot ' + (saved ? 'ok' : 'warn')}>{saved ? '已保存' : '保存中…'}</span>
        <span className="muted hide-sm">按住笔尖不动可拉直线条、规整成形状 · Ctrl+滚轮缩放</span>
      </footer>

      {showSettings && <Settings prefs={prefs} setPrefs={setPrefs} onClose={() => setShowSettings(false)} />}
      {menu && <div className="menu-catcher" onPointerDown={() => setMenu(null)} />}
    </div>
  );
}

const Thumb = memo(function Thumb({ page }) {
  return (
    <svg className="thumb-svg" viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} style={{ background: paperColor(page.paper) }}>
      <PaperView template={page.template} paper={page.paper} pid={'th-' + page.id} />
      {page.elements.map((el) => (
        <ElementView key={el.id} el={el} />
      ))}
    </svg>
  );
});
