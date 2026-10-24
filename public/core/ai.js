// AI 接口：OpenAI 兼容接口（DeepSeek / Kimi / 通义 / 智谱 / 硅基流动 / Ollama …）与 Anthropic Claude
// 本地服务模式下由 Node 转发（Key 存在 config.json）；纯前端模式下浏览器直接请求（Key 存在 localStorage）。

const PRESETS = {
  deepseek: { label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  anthropic: { label: 'Claude (Anthropic)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' },
  openai: { label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: '' },
  moonshot: { label: 'Kimi (Moonshot)', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: '' },
  qwen: { label: '通义千问 (DashScope)', kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '' },
  zhipu: { label: '智谱 GLM', kind: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '' },
  siliconflow: { label: '硅基流动', kind: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: '' },
  ollama: { label: 'Ollama（本地）', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', noKey: true },
  custom: { label: '自定义 OpenAI 兼容', kind: 'openai', baseUrl: '', model: '' },
};

// 支持服务端拒答回退（fallbacks: "default"）的 Claude 模型
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

async function* sseLines(body) {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      yield line;
    }
  }
  if (buf) yield buf;
}

async function errorText(res) {
  let t = '';
  try { t = await res.text(); } catch { }
  try { const j = JSON.parse(t); t = j.error?.message || j.message || t; } catch { }
  return `HTTP ${res.status}：${String(t).slice(0, 400)}`;
}

// 统一的流式接口：onText(文本增量)，返回 { stopReason }
async function streamChat(cfg, { system, messages, maxTokens }, onText, signal) {
  const preset = PRESETS[cfg.provider] || PRESETS.custom;
  const kind = cfg.kind || preset.kind;
  const baseUrl = trimSlash(cfg.baseUrl || preset.baseUrl);
  const model = cfg.model || preset.model;
  if (!baseUrl) throw new Error('请先在设置里填写 API 地址');
  if (!model) throw new Error('请先在设置里填写模型名称');
  if (!cfg.apiKey && !preset.noKey) throw new Error('请先在设置里填写 API Key');
  const max = Math.min(Math.max(Number(maxTokens || cfg.maxTokens) || 8000, 256), 64000);

  if (kind === 'anthropic') {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2026-10-21',
      // 纯前端模式由浏览器直接调用；Node 转发时这个头不起作用
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = { model, max_tokens: max, stream: true, messages };
    if (system) body.system = system;
    if (FALLBACK_MODELS.has(model)) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    const res = await fetch(baseUrl + '/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw new Error(await errorText(res));
    let stopReason = null;
    for await (const line of sseLines(res.body)) {
      if (!line.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') onText(ev.delta.text);
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
      else if (ev.type === 'error') throw new Error(ev.error?.message || 'Claude 返回错误');
    }
    if (stopReason === 'refusal') onText('\n\n> [!warning] 模型拒绝回答了这个请求。');
    return { stopReason };
  }

  // OpenAI 兼容
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const body = { model, messages: msgs, stream: true, max_tokens: max };
  if (cfg.temperature !== '' && cfg.temperature != null && !isNaN(Number(cfg.temperature))) body.temperature = Number(cfg.temperature);
  const url = /\/chat\/completions$/.test(baseUrl) ? baseUrl : baseUrl + '/chat/completions';
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await errorText(res));
  let stopReason = null;
  for await (const line of sseLines(res.body)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    let ev;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.error) throw new Error(ev.error.message || 'AI 返回错误');
    const ch = ev.choices?.[0];
    if (ch?.delta?.content) onText(ch.delta.content);
    if (ch?.finish_reason) stopReason = ch.finish_reason;
  }
  return { stopReason };
}

export { PRESETS, streamChat };
