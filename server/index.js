// 墨记 InkMind 后端：静态资源 + Claude Opus 5.5 康奈尔笔记生成（SSE 流式进度）
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { NOTES_SCHEMA, buildSystemPrompt, buildUserPrompt } from './prompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = Number(process.env.API_PORT || 8787);
const MODEL = 'claude-opus-5-5';

const app = express();
app.use(express.json({ limit: '20mb' }));

/** 服务端是否已经配置了凭据（.env 里的 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN） */
function serverHasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function makeClient(req) {
  const userKey = (req.get('x-anthropic-key') || '').trim();
  // 浏览器设置里填了 Key 就用它；否则用服务端环境变量
  return userKey ? new Anthropic({ apiKey: userKey }) : new Anthropic();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: MODEL, serverKey: serverHasKey() });
});

app.post('/api/ai/cornell', async (req, res) => {
  const { transcript, title, detail = 'standard', language = 'auto', instructions = '' } = req.body || {};
  if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: '转录文本为空' });
  }
  if (!req.get('x-anthropic-key') && !serverHasKey()) {
    return res.status(401).json({ error: '还没有配置 Claude API Key：在「设置」里填写，或在项目根目录 .env 中设置 ANTHROPIC_API_KEY' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  try {
    const client = makeClient(req);
    send('status', { stage: 'thinking', message: 'Claude 正在阅读转录并组织结构…' });

    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: NOTES_SCHEMA },
        },
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserPrompt({ transcript, title, detail, language, instructions }) }],
      },
      { signal: ac.signal },
    );

    let chars = 0;
    let lastSent = 0;
    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'text') {
        send('status', { stage: 'writing', message: '正在书写笔记…' });
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'thinking_delta') {
          send('thinking', { text: event.delta.thinking });
        } else if (event.delta.type === 'text_delta') {
          chars += event.delta.text.length;
          if (chars - lastSent > 120) {
            lastSent = chars;
            send('progress', { chars });
          }
        }
      }
    }

    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      send('error', { error: `Claude 拒绝了这个请求${msg.stop_details?.explanation ? '：' + msg.stop_details.explanation : ''}` });
      return res.end();
    }
    if (msg.stop_reason === 'max_tokens') {
      send('error', { error: '输出超出长度上限，请把音频拆成更短的片段再试' });
      return res.end();
    }
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let notes;
    try {
      notes = JSON.parse(text);
    } catch {
      send('error', { error: '模型返回的内容无法解析为笔记结构，请重试' });
      return res.end();
    }
    send('done', { notes, usage: msg.usage, model: msg.model });
    res.end();
  } catch (err) {
    if (ac.signal.aborted) return;
    let message = err?.message || String(err);
    if (err instanceof Anthropic.AuthenticationError) message = 'API Key 无效或已过期';
    else if (err instanceof Anthropic.PermissionDeniedError) message = '这个 API Key 没有权限使用 Claude Opus 5.5';
    else if (err instanceof Anthropic.RateLimitError) message = '请求过于频繁，稍后再试';
    else if (err instanceof Anthropic.BadRequestError) message = `请求被拒绝：${err.message}`;
    else if (err instanceof Anthropic.APIConnectionError) message = '连不上 Claude API，请检查网络或代理';
    console.error('[cornell]', err);
    send('error', { error: message });
    res.end();
  }
});

// 生产模式：托管打包后的前端
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`InkMind API 已启动 http://localhost:${PORT}  (服务端 Key：${serverHasKey() ? '已配置' : '未配置'})`);
});
