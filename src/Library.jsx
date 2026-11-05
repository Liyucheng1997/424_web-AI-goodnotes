import { useMemo, useState } from 'react';
import { Search, Plus, Sparkles, NotebookPen, Star, MoreHorizontal, Moon, Sun, Settings as SettingsIcon, Trash2, Copy, Pencil, BookOpen } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Settings from './ui/Settings.jsx';

function greet() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function fmtDate(t) {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function Library({ notebooks, prefs, setPrefs, onOpen, onCreate, onDelete, onDuplicate, onRename, onToggleFav }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [menuFor, setMenuFor] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return notebooks
      .filter((n) => (filter === 'fav' ? n.favorite : true))
      .filter((n) => !kw || n.title.toLowerCase().includes(kw) || (n.preview || '').toLowerCase().includes(kw))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notebooks, q, filter]);

  return (
    <div className="library">
      <header className="titlebar">
        <div className="logo-mark">墨</div>
        <div className="logo-text">
          <div className="logo-name">墨记 InkMind</div>
          <div className="logo-sub">手写笔记 · AI 康奈尔笔记</div>
        </div>
        <div className="tb-spacer" />
        <button className="tb-round" onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })} title="深色模式">
          {prefs.theme === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
        </button>
        <button className="tb-round" onClick={() => setShowSettings(true)} title="设置">
          <SettingsIcon size={17} strokeWidth={1.75} />
        </button>
      </header>

      <div className="lib-scroll" onPointerDown={() => setMenuFor(null)}>
        <section className="hero">
          <div className="greet">{greet()} 👋</div>
          <h1 className="hero-title">
            把听到的，变成<span className="accent">手写笔记</span>
          </h1>
          <p className="hero-sub">像纸一样书写，像学霸一样记录。上传一段音频，Claude 会帮你整理成康奈尔笔记，再由你亲手修改。</p>
          <label className="search-pill">
            <Search size={17} strokeWidth={1.9} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索笔记标题或内容" />
          </label>
        </section>

        <section className="new-grid">
          <button className="new-card" onClick={() => onCreate({ template: 'cornell', ai: true })}>
            <span className="new-ico" style={{ background: 'var(--primary)' }}>
              <Sparkles size={24} strokeWidth={1.8} />
            </span>
            <span className="new-text">
              <span className="new-name">AI 音频转笔记</span>
              <span className="new-desc">上传或现场录音，自动生成手写康奈尔笔记</span>
            </span>
            <span className="new-plus">
              <Plus size={16} />
            </span>
          </button>
          <button className="new-card" onClick={() => onCreate({ template: 'cornell' })}>
            <span className="new-ico" style={{ background: '#248a3d' }}>
              <NotebookPen size={24} strokeWidth={1.8} />
            </span>
            <span className="new-text">
              <span className="new-name">康奈尔笔记本</span>
              <span className="new-desc">线索栏 · 笔记栏 · 总结栏，适合上课复习</span>
            </span>
            <span className="new-plus">
              <Plus size={16} />
            </span>
          </button>
          <button className="new-card" onClick={() => onCreate({ template: 'dotted' })}>
            <span className="new-ico" style={{ background: '#c93400' }}>
              <BookOpen size={24} strokeWidth={1.8} />
            </span>
            <span className="new-text">
              <span className="new-name">自由笔记本</span>
              <span className="new-desc">点阵纸，随手画图写字，可切换横线、方格</span>
            </span>
            <span className="new-plus">
              <Plus size={16} />
            </span>
          </button>
        </section>

        <section className="shelf">
          <div className="shelf-head">
            <div>
              <div className="eyebrow">MY NOTEBOOKS</div>
              <h2 className="shelf-title">我的笔记本</h2>
            </div>
            <div className="seg">
              <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
                全部
              </button>
              <button className={filter === 'fav' ? 'active' : ''} onClick={() => setFilter('fav')}>
                收藏
              </button>
            </div>
          </div>

          {list.length === 0 ? (
            <div className="empty">
              <NotebookPen size={34} strokeWidth={1.4} />
              <div>{q ? '没有找到匹配的笔记' : filter === 'fav' ? '还没有收藏的笔记本' : '还没有笔记本，从上面新建一本吧'}</div>
            </div>
          ) : (
            <div className="nb-grid">
              {list.map((n) => (
                <div key={n.id} className="nb-card" onClick={() => onOpen(n.id)}>
                  <div className="nb-cover">
                    <span className="nb-spine" style={{ background: n.cover }} />
                    {n.thumb ? <img src={n.thumb} alt="" draggable={false} /> : <div className="nb-blank" />}
                    <button
                      className={'nb-star' + (n.favorite ? ' on' : '')}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFav(n.id, !n.favorite);
                      }}
                      title="收藏"
                    >
                      <Star size={15} fill={n.favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="nb-info">
                    <div className="nb-text">
                      <div className="nb-title">{n.title}</div>
                      <div className="nb-meta tabular">
                        {fmtDate(n.updatedAt)} · {n.pageCount || 1} 页
                      </div>
                    </div>
                    <div className="popover-anchor" onPointerDown={(e) => e.stopPropagation()}>
                      <button
                        className="icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(menuFor === n.id ? null : n.id);
                        }}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                      {menuFor === n.id && (
                        <div className="popover menu" style={{ right: 0, bottom: 34 }} onClick={(e) => e.stopPropagation()}>
                          <div className="menu-item" onClick={() => { setRenaming({ id: n.id, title: n.title }); setMenuFor(null); }}>
                            <span className="menu-icon"><Pencil size={15} /></span>
                            <span className="menu-label">重命名</span>
                          </div>
                          <div className="menu-item" onClick={() => { onDuplicate(n.id); setMenuFor(null); }}>
                            <span className="menu-icon"><Copy size={15} /></span>
                            <span className="menu-label">创建副本</span>
                          </div>
                          <div className="menu-sep" />
                          <div className="menu-item danger" onClick={() => { setConfirmDel(n); setMenuFor(null); }}>
                            <span className="menu-icon"><Trash2 size={15} /></span>
                            <span className="menu-label">删除</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="watermark">INKMIND</div>
      </div>

      {confirmDel && (
        <Modal
          title="删除笔记本"
          width={380}
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDel(null)}>
                取消
              </button>
              <button
                className="btn btn-danger-solid"
                onClick={() => {
                  onDelete(confirmDel.id);
                  setConfirmDel(null);
                }}
              >
                删除
              </button>
            </>
          }
        >
          <p className="modal-msg">「{confirmDel.title}」及其中的录音会被永久删除，无法恢复。</p>
        </Modal>
      )}
      {renaming && (
        <Modal
          title="重命名"
          width={400}
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRenaming(null)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  onRename(renaming.id, renaming.title.trim() || '未命名笔记');
                  setRenaming(null);
                }}
              >
                确定
              </button>
            </>
          }
        >
          <input
            className="input"
            style={{ width: '100%' }}
            autoFocus
            value={renaming.title}
            onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRename(renaming.id, renaming.title.trim() || '未命名笔记');
                setRenaming(null);
              }
            }}
          />
        </Modal>
      )}
      {showSettings && <Settings prefs={prefs} setPrefs={setPrefs} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
