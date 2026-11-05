import { useEffect, useRef, useState } from 'react';
import { Upload, Mic, Square, FileText, Sparkles, X, Play, Pause, Trash2, Wand2, ChevronDown, AudioLines } from 'lucide-react';
import { decodeTo16k, transcribe, cancelTranscribe, segmentsToText, fmtTime, liveCaptionSupported, startLiveCaption } from './asr.js';
import { generateCornell, serverHealth } from './claude.js';
import { layoutCornell, SAMPLE_NOTES, SAMPLE_TRANSCRIPT } from './layout.js';
import { FONTS } from '../canvas/text.js';
import { saveAudio, loadAudio, deleteAudio } from '../store.js';
import { uid } from '../canvas/ink.js';
import { toast } from '../ui/toast.js';

const SOURCES = [
  { id: 'upload', label: '音频文件', icon: Upload },
  { id: 'record', label: '现场录音', icon: Mic },
  { id: 'text', label: '粘贴文字', icon: FileText },
];

const ASR_LANG = [
  { id: 'chinese', label: '中文', live: 'zh-CN' },
  { id: 'english', label: 'English', live: 'en-US' },
  { id: '', label: '自动', live: 'zh-CN' },
];

export default function AiPanel({ prefs, setPrefs, notebookTitle, recordings, onAddRecording, onRemoveRecording, onUpdateRecording, onInsertPages, onClose }) {
  const [source, setSource] = useState('upload');
  const [transcript, setTranscript] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [asr, setAsr] = useState(null); // {stage, message, progress, download}
  const [gen, setGen] = useState(null); // {message, chars, thinking}
  const [health, setHealth] = useState(null);
  const [showMore, setShowMore] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    serverHealth().then(setHealth);
  }, []);

  const busy = !!asr || !!gen;
  const hasKey = !!prefs.apiKey || !!health?.serverKey;

  /* ---------------- 识别 ---------------- */
  async function runAsr(blob, recId) {
    setAsr({ message: '解码音频…', progress: 0 });
    try {
      const { audio, duration } = await decodeTo16k(blob);
      let acc = [];
      const segs = await transcribe(audio, { model: prefs.whisperModel, language: prefs.asrLanguage, mirror: prefs.hfMirror }, (m) => {
        if (m.type === 'status') setAsr((s) => ({ ...s, message: m.message }));
        else if (m.type === 'download') setAsr((s) => ({ ...s, message: '下载识别模型（只需一次）', download: m.loaded / m.total }));
        else if (m.type === 'segment') {
          if (m.segment.text) acc = [...acc, m.segment];
          setTranscript(segmentsToText(acc));
          setAsr((s) => ({ ...s, message: `正在识别 ${fmtTime(m.segment.end)} / ${fmtTime(duration)}`, progress: m.progress, download: null }));
        }
      });
      const text = segmentsToText(segs);
      setTranscript(text);
      if (recId) onUpdateRecording(recId, { transcript: text });
      toast(`识别完成，共 ${segs.length} 段`, 'success');
    } catch (e) {
      if (e.message !== '已取消') toast('识别失败：' + e.message, 'error');
    } finally {
      setAsr(null);
    }
  }

  async function onFile(file) {
    if (!file) return;
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
    const id = uid();
    await saveAudio(id, file);
    let duration = 0;
    try {
      duration = await new Promise((res) => {
        const a = new Audio(URL.createObjectURL(file));
        a.onloadedmetadata = () => res(a.duration);
        a.onerror = () => res(0);
      });
    } catch {
      /* ignore */
    }
    onAddRecording({ id, name: file.name, createdAt: Date.now(), duration, transcript: '' });
    runAsr(file, id);
  }

  /* ---------------- 录音 ---------------- */
  const [rec, setRec] = useState(null); // {start, recorder, live, finalText, interim}
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState({ final: '', interim: '' });
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setElapsed((Date.now() - rec.start) / 1000), 250);
    return () => clearInterval(t);
  }, [rec]);

  async function startRec() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast('无法使用麦克风，请在浏览器地址栏允许麦克风权限', 'error');
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(1000);
    const langLive = (ASR_LANG.find((l) => l.id === prefs.asrLanguage) || ASR_LANG[0]).live;
    setLive({ final: '', interim: '' });
    const liveCap = startLiveCaption(langLive, (final, interim) => setLive({ final, interim }));
    setElapsed(0);
    setRec({ start: Date.now(), recorder, stream, chunks, liveCap, mime });
  }

  async function stopRec() {
    const r = rec;
    if (!r) return;
    const stopped = new Promise((res) => (r.recorder.onstop = res));
    r.recorder.stop();
    await stopped;
    r.stream.getTracks().forEach((t) => t.stop());
    const liveText = r.liveCap?.stop() || '';
    setRec(null);
    const blob = new Blob(r.chunks, { type: r.mime || 'audio/webm' });
    const id = uid();
    await saveAudio(id, blob);
    const d = new Date();
    const name = `录音 ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    onAddRecording({ id, name, createdAt: Date.now(), duration: (Date.now() - r.start) / 1000, transcript: liveText });
    if (liveText.trim()) {
      setTranscript(liveText);
      toast('录音已保存，实时字幕已填入转录', 'success');
    } else {
      toast('录音已保存，开始离线识别…');
      runAsr(blob, id);
    }
  }

  /* ---------------- 生成笔记 ---------------- */
  async function generate() {
    if (!transcript.trim()) {
      toast('先上传音频、录音或粘贴文字', 'error');
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setGen({ message: '连接 Claude Opus 5.5…', chars: 0, thinking: '' });
    try {
      const data = await generateCornell(
        { transcript, title: title || '', detail: prefs.aiDetail, language: prefs.aiLanguage, instructions },
        {
          apiKey: prefs.apiKey,
          signal: ac.signal,
          onStatus: (s) => setGen((g) => ({ ...g, message: s.message })),
          onThinking: (t) => setGen((g) => ({ ...g, thinking: (g.thinking + t).slice(-600) })),
          onProgress: (chars) => setGen((g) => ({ ...g, chars })),
        },
      );
      setGen((g) => ({ ...g, message: '排版成手写笔记…' }));
      const pages = await layoutCornell(data.notes, { font: prefs.aiFont });
      onInsertPages(pages, data.notes.title);
      toast(`已生成 ${pages.length} 页康奈尔笔记，可以直接在上面修改`, 'success');
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'error');
    } finally {
      setGen(null);
      abortRef.current = null;
    }
  }

  async function previewSample() {
    const pages = await layoutCornell(SAMPLE_NOTES, { font: prefs.aiFont });
    onInsertPages(pages, SAMPLE_NOTES.title);
    toast('已插入示例笔记（离线排版，未调用 API）', 'success');
  }

  return (
    <aside className="side-pane ai-pane">
      <div className="pane-head">
        <div className="pane-title">
          <span className="ai-badge">
            <Sparkles size={15} strokeWidth={2} />
          </span>
          AI 记笔记
        </div>
        <button className="modal-x" onClick={onClose} title="关闭">
          <X size={15} />
        </button>
      </div>

      <div className="pane-body">
        <div className="seg seg-full">
          {SOURCES.map((s) => (
            <button key={s.id} className={source === s.id ? 'active' : ''} onClick={() => setSource(s.id)} disabled={busy && source !== s.id}>
              <s.icon size={14} strokeWidth={1.9} />
              {s.label}
            </button>
          ))}
        </div>

        <div className="field-row">
          <label className="field-label">识别语言</label>
          <div className="seg seg-sm">
            {ASR_LANG.map((l) => (
              <button key={l.id} className={prefs.asrLanguage === l.id ? 'active' : ''} onClick={() => setPrefs({ asrLanguage: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {source === 'upload' && (
          <label
            className={'drop' + (busy ? ' disabled' : '')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) onFile(e.dataTransfer.files[0]);
            }}
          >
            <input type="file" accept="audio/*,video/*" hidden disabled={busy} onChange={(e) => onFile(e.target.files[0])} />
            <AudioLines size={28} strokeWidth={1.4} />
            <div className="drop-title">拖入或点击选择音频</div>
            <div className="drop-sub">mp3 / m4a / wav / webm / mp4，在浏览器本地用 Whisper 识别</div>
          </label>
        )}

        {source === 'record' && (
          <div className="rec-box">
            <button className={'rec-btn' + (rec ? ' on' : '')} onClick={rec ? stopRec : startRec} disabled={!!asr}>
              {rec ? <Square size={20} fill="currentColor" /> : <Mic size={24} />}
            </button>
            <div className="rec-time tabular">{rec ? fmtTime(elapsed) : '点击开始录音'}</div>
            <div className="rec-hint">
              {rec ? (
                <span className="status-dot live">录音中，可以同时在页面上手写</span>
              ) : liveCaptionSupported() ? (
                '录音时显示实时字幕；停止后可再用 Whisper 精确识别'
              ) : (
                '当前浏览器不支持实时字幕，停止后用 Whisper 识别'
              )}
            </div>
            {rec && (live.final || live.interim) && (
              <div className="live-caption">
                {live.final}
                <span className="muted">{live.interim}</span>
              </div>
            )}
          </div>
        )}

        {asr && (
          <div className="progress-card">
            <div className="progress-row">
              <span className="spinner sm" />
              <span>{asr.message}</span>
              <button className="btn btn-sm btn-ghost-danger" onClick={cancelTranscribe}>
                取消
              </button>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.round(((asr.download ?? asr.progress) || 0) * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="field">
          <div className="field-label-row">
            <label className="field-label">转录文本</label>
            <span className="muted tabular">{transcript.length} 字</span>
          </div>
          <textarea
            className="input transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={source === 'text' ? '把课堂记录、会议纪要或字幕文本粘贴到这里…' : '识别结果会出现在这里，可以先修改再生成笔记'}
          />
          {!transcript && (
            <button className="link-btn" onClick={() => { setTranscript(SAMPLE_TRANSCRIPT); setTitle('光合作用'); }}>
              用一段示例课堂转录试试
            </button>
          )}
        </div>

        <div className="field">
          <label className="field-label">笔记标题（可选）</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={notebookTitle || '留空让 AI 起名'} />
        </div>

        <div className="field-row">
          <label className="field-label">详细程度</label>
          <div className="seg seg-sm">
            {[
              ['concise', '简洁'],
              ['standard', '标准'],
              ['detailed', '详细'],
            ].map(([id, l]) => (
              <button key={id} className={prefs.aiDetail === id ? 'active' : ''} onClick={() => setPrefs({ aiDetail: id })}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <button className="more-btn" onClick={() => setShowMore((v) => !v)}>
          更多选项 <ChevronDown size={14} style={{ transform: showMore ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </button>
        {showMore && (
          <div className="more">
            <div className="field-row">
              <label className="field-label">笔记语言</label>
              <div className="seg seg-sm">
                {[
                  ['auto', '跟随原文'],
                  ['zh', '中文'],
                  ['en', 'English'],
                ].map(([id, l]) => (
                  <button key={id} className={prefs.aiLanguage === id ? 'active' : ''} onClick={() => setPrefs({ aiLanguage: id })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-row">
              <label className="field-label">手写字体</label>
              <select className="input" value={prefs.aiFont} onChange={(e) => setPrefs({ aiFont: e.target.value })}>
                {Object.entries(FONTS).map(([k, f]) => (
                  <option key={k} value={k}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">额外要求</label>
              <textarea className="input" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="例如：多记公式推导；线索栏写成考试问题" />
            </div>
          </div>
        )}

        {gen ? (
          <div className="progress-card">
            <div className="progress-row">
              <span className="spinner sm" />
              <span>{gen.message}</span>
              <button className="btn btn-sm btn-ghost-danger" onClick={() => abortRef.current?.abort()}>
                停止
              </button>
            </div>
            {gen.chars > 0 && <div className="muted small">已写 {gen.chars} 字符</div>}
            {gen.thinking && <div className="thinking">{gen.thinking}</div>}
          </div>
        ) : (
          <button className="btn btn-primary btn-block" onClick={generate} disabled={busy || !transcript.trim()}>
            <Wand2 size={16} />
            生成手写康奈尔笔记
          </button>
        )}
        <div className="key-hint">
          {health === null ? (
            <span className="status-dot warn">本地服务未连接</span>
          ) : hasKey ? (
            <span className="status-dot ok">Claude Opus 5.5 已就绪</span>
          ) : (
            <span className="status-dot warn">未配置 API Key，请在设置中填写</span>
          )}
          <button className="link-btn" onClick={previewSample} disabled={busy}>
            离线预览示例笔记
          </button>
        </div>

        <Recordings recordings={recordings} onRemove={onRemoveRecording} onUse={(r) => r.transcript && setTranscript(r.transcript)} onTranscribe={async (r) => {
          const blob = await loadAudio(r.id);
          if (blob) runAsr(blob, r.id);
        }} busy={busy} />
      </div>
    </aside>
  );
}

function Recordings({ recordings, onRemove, onUse, onTranscribe, busy }) {
  const [playing, setPlaying] = useState(null);
  const audioRef = useRef(null);
  useEffect(() => () => audioRef.current?.pause(), []);
  if (!recordings?.length) return null;

  async function toggle(r) {
    if (playing === r.id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const blob = await loadAudio(r.id);
    if (!blob) return toast('找不到这段录音的音频', 'error');
    const a = new Audio(URL.createObjectURL(blob));
    a.onended = () => setPlaying(null);
    audioRef.current = a;
    a.play();
    setPlaying(r.id);
  }

  return (
    <div className="recs">
      <div className="section-label">本笔记本的录音</div>
      {recordings.map((r) => (
        <div className="rec-row" key={r.id}>
          <button className="icon-btn play" onClick={() => toggle(r)}>
            {playing === r.id ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <div className="rec-meta">
            <div className="rec-name">{r.name}</div>
            <div className="muted small tabular">
              {fmtTime(r.duration || 0)} · {r.transcript ? `${r.transcript.length} 字转录` : '未识别'}
            </div>
          </div>
          <div className="actions">
            {r.transcript ? (
              <button className="btn btn-sm" onClick={() => onUse(r)}>
                使用
              </button>
            ) : (
              <button className="btn btn-sm" disabled={busy} onClick={() => onTranscribe(r)}>
                识别
              </button>
            )}
            <button
              className="icon-btn"
              title="删除录音"
              onClick={async () => {
                if (playing === r.id) audioRef.current?.pause();
                await deleteAudio(r.id);
                onRemove(r.id);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
