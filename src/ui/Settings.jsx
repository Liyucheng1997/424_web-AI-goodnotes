import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { serverHealth } from '../ai/claude.js';

const MODELS = [
  { id: 'onnx-community/whisper-tiny', label: 'Whisper Tiny · 最快（约 40MB）' },
  { id: 'onnx-community/whisper-base', label: 'Whisper Base · 较快（约 80MB）' },
  { id: 'onnx-community/whisper-small', label: 'Whisper Small · 推荐，中文更准（约 250MB）' },
  { id: 'onnx-community/whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo · 最准，需 WebGPU（约 600MB）' },
];

export default function Settings({ prefs, setPrefs, onClose }) {
  const [key, setKey] = useState(prefs.apiKey);
  const [health, setHealth] = useState(undefined);
  useEffect(() => {
    serverHealth().then(setHealth);
  }, []);

  return (
    <Modal
      title="设置"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setPrefs({ apiKey: key.trim() });
              onClose();
            }}
          >
            完成
          </button>
        </>
      }
    >
      <div className="form">
        <div className="section-label">Claude（AI 记笔记）</div>
        <div className="form-row">
          <span className="form-label">API Key</span>
          <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={health?.serverKey ? '服务端已配置，可留空' : 'sk-ant-…'} autoComplete="off" />
        </div>
        <p className="hint">
          模型固定为 <b>Claude Opus 5.5</b>。Key 只保存在这台电脑的浏览器里，通过本地服务转发给 Anthropic；也可以在项目根目录的 <code>.env</code> 写 <code>ANTHROPIC_API_KEY</code>。
          {health === null && <span className="status-dot warn"> 本地服务未连接</span>}
          {health?.serverKey && <span className="status-dot ok"> 服务端已配置 Key</span>}
        </p>

        <div className="section-label">语音识别（本地 Whisper）</div>
        <div className="form-row">
          <span className="form-label">识别模型</span>
          <select className="input" value={prefs.whisperModel} onChange={(e) => setPrefs({ whisperModel: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <span className="form-label">下载源</span>
          <div className="seg seg-sm">
            {[
              ['auto', '自动'],
              ['hf', 'HuggingFace'],
              ['mirror', 'hf-mirror 镜像'],
            ].map(([id, l]) => (
              <button key={id} className={prefs.hfMirror === id ? 'active' : ''} onClick={() => setPrefs({ hfMirror: id })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <p className="hint">模型第一次使用时下载并缓存在浏览器里，之后离线可用。音频不会上传到任何服务器。</p>

        <div className="section-label">书写</div>
        <label className="form-check">
          <input type="checkbox" checked={prefs.penOnly} onChange={(e) => setPrefs({ penOnly: e.target.checked })} />
          只用触控笔书写（手指只滚动页面，防止手掌误触）
        </label>
        <div className="form-row">
          <span className="form-label">外观</span>
          <div className="seg seg-sm">
            {[
              ['light', '浅色'],
              ['dark', '深色'],
            ].map(([id, l]) => (
              <button key={id} className={prefs.theme === id ? 'active' : ''} onClick={() => setPrefs({ theme: id })}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
