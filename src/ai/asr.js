// 语音识别工具：音频解码、Whisper Worker 封装、浏览器实时字幕（Web Speech API）

export async function decodeTo16k(blob) {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let decoded;
  try {
    decoded = await ac.decodeAudioData(buf.slice(0));
  } finally {
    ac.close();
  }
  const length = Math.ceil(decoded.duration * 16000);
  const off = new OfflineAudioContext(1, Math.max(1, length), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination); // 多声道会自动混成单声道
  src.start();
  const out = await off.startRendering();
  return { audio: out.getChannelData(0), duration: decoded.duration };
}

let worker = null;
function getWorker() {
  if (!worker) worker = new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
  return worker;
}

/** 识别。onEvent 收到 status / download / segment 消息；返回 segments */
export function transcribe(audio, { model, language, mirror }, onEvent) {
  const w = getWorker();
  return new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'done') resolve(m.segments);
      else if (m.type === 'error') reject(new Error(m.message));
      else if (m.type === 'cancelled') reject(new Error('已取消'));
      else onEvent?.(m);
    };
    w.onerror = (e) => reject(new Error(e.message || '识别线程出错'));
    // 复制一份再传，避免主线程的数组被转移后不可用
    const copy = new Float32Array(audio);
    w.postMessage({ type: 'transcribe', audio: copy, model, language, mirror }, [copy.buffer]);
  });
}

export function cancelTranscribe() {
  worker?.postMessage({ type: 'cancel' });
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function segmentsToText(segments, withTime = true) {
  return segments.map((s) => (withTime ? `[${fmtTime(s.start)}] ` : '') + s.text).join('\n');
}

/* ---------- 实时字幕 ---------- */
export function liveCaptionSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startLiveCaption(lang, onUpdate) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  let stopped = false;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + (lang.startsWith('zh') ? '。' : '. ');
      else interim += r[0].transcript;
    }
    onUpdate(finalText, interim);
  };
  rec.onerror = () => {};
  // 浏览器会在静音后自动结束，这里自动续上
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
      } catch {
        /* ignore */
      }
    }
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop() {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      return finalText;
    },
  };
}
