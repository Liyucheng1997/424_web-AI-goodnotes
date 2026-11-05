// 调用本地后端 /api/ai/cornell（后端再调用 Claude Opus 5.5），解析 SSE 进度

export async function serverHealth() {
  try {
    const r = await fetch('/api/health');
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function generateCornell(body, { apiKey, signal, onStatus, onThinking, onProgress } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-anthropic-key'] = apiKey;
  let res;
  try {
    res = await fetch('/api/ai/cornell', { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('连不上本地服务，请确认已用 npm run dev 或 npm start 启动');
  }
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = /^event: (.*)$/m.exec(raw)?.[1];
      const dataLine = /^data: (.*)$/m.exec(raw)?.[1];
      if (!ev || !dataLine) continue;
      const data = JSON.parse(dataLine);
      if (ev === 'status') onStatus?.(data);
      else if (ev === 'thinking') onThinking?.(data.text);
      else if (ev === 'progress') onProgress?.(data.chars);
      else if (ev === 'error') throw new Error(data.error);
      else if (ev === 'done') return data;
    }
  }
  throw new Error('连接意外中断');
}
