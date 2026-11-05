// 本地存储：IndexedDB（idb-keyval）。笔记本索引 + 每本笔记的页面数据 + 录音音频。
import { get, set, del } from 'idb-keyval';
import { uid } from './canvas/ink.js';

const INDEX = 'nb:index';

export const COVERS = ['#1d1d1f', '#3a4a63', '#4f6b5a', '#7a5c45', '#8c3b3b', '#5b4f7a', '#2f6f8f', '#b08d57'];

export function newPage(template = 'cornell', paper = 'white') {
  return { id: uid(), template, paper, elements: [] };
}

export async function listNotebooks() {
  return (await get(INDEX)) || [];
}

async function saveIndex(list) {
  await set(INDEX, list);
}

export async function createNotebook({ title = '未命名笔记', template = 'cornell', paper = 'white', cover } = {}) {
  const now = Date.now();
  const meta = {
    id: uid(),
    title,
    cover: cover || COVERS[Math.floor(Math.random() * COVERS.length)],
    template,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    pageCount: 1,
    preview: '',
  };
  const doc = { id: meta.id, pages: [newPage(template, paper)], recordings: [] };
  await set('nb:' + meta.id, doc);
  await saveIndex([meta, ...(await listNotebooks())]);
  return { meta, doc };
}

export async function loadNotebook(id) {
  const doc = await get('nb:' + id);
  if (!doc) return null;
  doc.recordings ||= [];
  return doc;
}

/** 从页面里抽出文字，供书库搜索 */
function textOf(doc) {
  const parts = [];
  for (const p of doc.pages) for (const el of p.elements) if (el.type === 'text') parts.push(el.text);
  for (const r of doc.recordings || []) if (r.transcript) parts.push(r.transcript.slice(0, 400));
  return parts.join(' ').slice(0, 2000);
}

export async function saveNotebook(doc, patch = {}) {
  await set('nb:' + doc.id, doc);
  const list = await listNotebooks();
  const i = list.findIndex((m) => m.id === doc.id);
  if (i >= 0) {
    list[i] = { ...list[i], ...patch, updatedAt: Date.now(), pageCount: doc.pages.length, preview: textOf(doc) };
    await saveIndex(list);
  }
}

export async function updateMeta(id, patch) {
  const list = await listNotebooks();
  const i = list.findIndex((m) => m.id === id);
  if (i >= 0) {
    list[i] = { ...list[i], ...patch };
    await saveIndex(list);
  }
  return list;
}

export async function deleteNotebook(id) {
  const doc = await get('nb:' + id);
  for (const r of doc?.recordings || []) await del('audio:' + r.id);
  await del('nb:' + id);
  const list = (await listNotebooks()).filter((m) => m.id !== id);
  await saveIndex(list);
  return list;
}

export async function duplicateNotebook(id) {
  const list = await listNotebooks();
  const meta = list.find((m) => m.id === id);
  const doc = await get('nb:' + id);
  if (!meta || !doc) return list;
  const nid = uid();
  const copy = { ...structuredClone(doc), id: nid, recordings: [] };
  await set('nb:' + nid, copy);
  const now = Date.now();
  const next = [{ ...meta, id: nid, title: meta.title + ' 副本', createdAt: now, updatedAt: now }, ...list];
  await saveIndex(next);
  return next;
}

export async function saveAudio(id, blob) {
  await set('audio:' + id, blob);
}
export async function loadAudio(id) {
  return get('audio:' + id);
}
export async function deleteAudio(id) {
  return del('audio:' + id);
}

/* ---------- 偏好设置（localStorage） ---------- */
const PREF_KEY = 'inkmind.prefs';
export const DEFAULT_PREFS = {
  theme: 'light',
  apiKey: '',
  whisperModel: 'onnx-community/whisper-small',
  hfMirror: 'auto', // auto | hf | mirror
  penOnly: false,
  aiFont: 'wenkai',
  aiDetail: 'standard',
  aiLanguage: 'auto',
  asrLanguage: 'chinese',
};
export function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
export function savePrefs(p) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式下忽略 */
  }
}
