import { useCallback, useEffect, useState } from 'react';
import Library from './Library.jsx';
import Editor from './Editor.jsx';
import {
  listNotebooks, createNotebook, loadNotebook, deleteNotebook, duplicateNotebook, updateMeta, loadPrefs, savePrefs,
} from './store.js';
import { toast } from './ui/toast.js';

export default function App() {
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [notebooks, setNotebooks] = useState([]);
  const [open, setOpen] = useState(null); // { meta, doc }

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', prefs.theme === 'dark' ? '#000000' : '#f5f5f7');
  }, [prefs.theme]);

  const refresh = useCallback(async () => setNotebooks(await listNotebooks()), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 用 hash 记住打开的笔记本，刷新后还在原处
  useEffect(() => {
    const id = location.hash.match(/^#nb=(.+)$/)?.[1];
    if (id) openNotebook(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openNotebook(id) {
    const list = await listNotebooks();
    const meta = list.find((m) => m.id === id);
    const doc = await loadNotebook(id);
    if (!meta || !doc) {
      history.replaceState(null, '', location.pathname);
      return;
    }
    history.replaceState(null, '', '#nb=' + id);
    setOpen({ meta, doc });
  }

  async function create({ template, ai }) {
    const { meta, doc } = await createNotebook({ title: ai ? '未命名 AI 笔记' : '未命名笔记', template });
    await refresh();
    history.replaceState(null, '', '#nb=' + meta.id);
    setOpen({ meta, doc });
  }

  if (open) {
    return (
      <Editor
        key={open.meta.id}
        meta={open.meta}
        initialDoc={open.doc}
        prefs={prefs}
        setPrefs={setPrefs}
        onRename={(title) => updateMeta(open.meta.id, { title })}
        onBack={async () => {
          history.replaceState(null, '', location.pathname);
          setOpen(null);
          setTimeout(refresh, 700); // 等待最后一次自动保存
        }}
      />
    );
  }

  return (
    <Library
      notebooks={notebooks}
      prefs={prefs}
      setPrefs={setPrefs}
      onOpen={openNotebook}
      onCreate={create}
      onDelete={async (id) => {
        setNotebooks(await deleteNotebook(id));
        toast('已删除');
      }}
      onDuplicate={async (id) => setNotebooks(await duplicateNotebook(id))}
      onRename={async (id, title) => setNotebooks(await updateMeta(id, { title }))}
      onToggleFav={async (id, favorite) => setNotebooks(await updateMeta(id, { favorite }))}
    />
  );
}
