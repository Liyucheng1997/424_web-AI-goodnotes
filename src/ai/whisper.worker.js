// 浏览器内语音识别：Whisper（transformers.js，WebGPU 优先，退回 WASM）。音频不离开本机。
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

let current = { key: null, pipe: null };
const SR = 16000;

const post = (msg) => self.postMessage(msg);

async function reachable(url, ms = 4000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { method: 'HEAD', signal: ac.signal, cache: 'no-store' });
    return r.ok || r.status === 302 || r.status === 307;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function pickHost(model, mirror) {
  if (mirror === 'hf') return 'https://huggingface.co/';
  if (mirror === 'mirror') return 'https://hf-mirror.com/';
  post({ type: 'status', message: '检测模型下载源…' });
  if (await reachable(`https://huggingface.co/${model}/resolve/main/config.json`)) return 'https://huggingface.co/';
  return 'https://hf-mirror.com/';
}

async function hasWebGPU() {
  try {
    if (!self.navigator?.gpu) return false;
    const a = await self.navigator.gpu.requestAdapter();
    return !!a;
  } catch {
    return false;
  }
}

async function getPipe(model, mirror) {
  const gpu = await hasWebGPU();
  const key = `${model}|${gpu}`;
  if (current.key === key) return current.pipe;
  env.remoteHost = await pickHost(model, mirror);
  post({ type: 'status', message: `加载模型 ${model.split('/').pop()}（${gpu ? 'WebGPU 加速' : 'WASM'}）…` });
  const files = {};
  const pipe = await pipeline('automatic-speech-recognition', model, {
    device: gpu ? 'webgpu' : 'wasm',
    dtype: gpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        files[p.file] = { loaded: p.loaded, total: p.total };
        const all = Object.values(files);
        const loaded = all.reduce((s, f) => s + f.loaded, 0);
        const total = all.reduce((s, f) => s + f.total, 0);
        post({ type: 'download', loaded, total });
      }
    },
  });
  current = { key, pipe };
  return pipe;
}

/** 在 24–30 秒之间找最安静的位置切段，避免把字切断 */
function splitPoints(audio) {
  const pts = [0];
  const win = Math.floor(SR * 0.1);
  let start = 0;
  while (audio.length - start > SR * 30) {
    let best = start + SR * 28, bestE = Infinity;
    for (let s = start + SR * 24; s < start + SR * 30 - win; s += win) {
      let e = 0;
      for (let i = s; i < s + win; i++) e += audio[i] * audio[i];
      if (e < bestE) {
        bestE = e;
        best = s + Math.floor(win / 2);
      }
    }
    pts.push(best);
    start = best;
  }
  pts.push(audio.length);
  return pts;
}

let t2s = null;
async function simplify(text) {
  if (!/[一-鿿]/.test(text)) return text;
  if (!t2s) {
    const OpenCC = await import('opencc-js/t2cn');
    t2s = OpenCC.Converter({ from: 't', to: 'cn' });
  }
  return t2s(text);
}

let cancelled = false;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type !== 'transcribe') return;
  cancelled = false;
  try {
    const pipe = await getPipe(msg.model, msg.mirror);
    const audio = msg.audio;
    const pts = splitPoints(audio);
    const segments = [];
    post({ type: 'status', message: '正在识别…' });
    for (let i = 0; i < pts.length - 1; i++) {
      if (cancelled) {
        post({ type: 'cancelled' });
        return;
      }
      const chunk = audio.subarray(pts[i], pts[i + 1]);
      if (chunk.length < SR * 0.3) continue;
      const out = await pipe(chunk, { language: msg.language || null, task: 'transcribe' });
      let text = (Array.isArray(out) ? out.map((o) => o.text).join('') : out.text || '').trim();
      if (msg.language !== 'english') text = await simplify(text);
      const seg = { start: pts[i] / SR, end: pts[i + 1] / SR, text };
      if (text) segments.push(seg);
      post({ type: 'segment', segment: seg, progress: pts[i + 1] / audio.length });
    }
    post({ type: 'done', segments });
  } catch (err) {
    post({ type: 'error', message: err?.message || String(err) });
  }
};
