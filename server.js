#!/usr/bin/env node
// AI 版 Obsidian · 本地服务（零依赖，Node 18+）
// 用法：node server.js [--vault <仓库路径>] [--port 5173] [--no-open]
// 仓库索引、Bases、AI 调用与纯前端模式共用 public/core/ 下的同一套代码，这里只负责 HTTP、配置和磁盘读写
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { exec } = require('child_process');
const { nodeFs } = require('./lib/node-fs');

const APP_DIR = __dirname;
const PUBLIC = path.join(APP_DIR, 'public');
const CONFIG_FILE = path.join(APP_DIR, 'config.json');
const SAMPLE_VAULT = path.join(APP_DIR, 'sample-vault');

const args = process.argv.slice(2);
const argVal = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

// ---------- 配置 ----------
function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { }
  c.ai = Object.assign({ provider: 'deepseek', baseUrl: '', apiKey: '', model: '', maxTokens: 8000, temperature: '' }, c.ai || {});
  c.recentVaults = Array.isArray(c.recentVaults) ? c.recentVaults : [];
  return c;
}
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8'); }
const config = loadConfig();
const PORT = Number(argVal('--port') || process.env.PORT || config.port || 5173);

function rememberVault(p) {
  config.vaultPath = p;
  config.recentVaults = [p, ...config.recentVaults.filter(x => x !== p)].slice(0, 8);
  saveConfig();
}

// ---------- HTTP 工具 ----------
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', woff2: 'font/woff2', base: 'text/plain; charset=utf-8', canvas: 'application/json; charset=utf-8' };
const extOfName = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };

function send(req, res, status, data, type) {
  let body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  // x-ai-obsidian：前端据此判断有本地服务（否则进入纯前端模式）
  const headers = { 'content-type': type || (typeof data === 'string' ? 'text/plain; charset=utf-8' : MIME.json), 'cache-control': 'no-store', 'x-ai-obsidian': '1' };
  if (body.length > 32 * 1024 && /gzip/.test(req.headers['accept-encoding'] || '')) { body = zlib.gzipSync(body); headers['content-encoding'] = 'gzip'; }
  res.writeHead(status, headers);
  res.end(body);
}
function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('请求过大'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJsonBody(req) { const b = await readBody(req); try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('JSON 格式错误'), { status: 400 }); } }

function maskKey(k) { return k ? (k.length > 10 ? k.slice(0, 4) + '••••' + k.slice(-4) : '••••') : ''; }

async function main() {
  // public/core 是 ES 模块（浏览器直接加载），这里用动态 import 引入
  const { deps } = await import('./public/core/deps.js');
  deps.yaml = require('./public/vendor/js-yaml.min.js');
  const { Vault } = await import('./public/core/vault.js');
  const { Service } = await import('./public/core/service.js');
  const { PRESETS, streamChat } = await import('./public/core/ai.js');

  let vaultPath = argVal('--vault') || process.env.VAULT || config.vaultPath || SAMPLE_VAULT;
  if (!fs.existsSync(vaultPath)) vaultPath = SAMPLE_VAULT;

  let vault, svc;
  function openVault(p) {
    vault?.close();
    vault = new Vault(nodeFs(p));
    svc = new Service(vault, { isSample: path.resolve(p) === path.resolve(SAMPLE_VAULT), extraInfo: () => ({ recentVaults: config.recentVaults }) });
    vault.build().catch(e => console.error('索引失败', e));
  }
  openVault(vaultPath);

  // ---------- 路由 ----------
  async function api(req, res, url) {
    const q = Object.fromEntries(url.searchParams);
    const route = req.method + ' ' + url.pathname;
    const ok = data => send(req, res, 200, data);
    switch (route) {
      case 'GET /api/info': return ok(await svc.info());
      case 'GET /api/tree': return ok(await svc.tree(q.dir, q.offset, q.limit));
      case 'GET /api/file': return ok(await svc.readFile(q.path));
      case 'PUT /api/file': return ok(await svc.writeFile(await readJsonBody(req)));
      case 'POST /api/upload': return ok(await svc.upload(await readBody(req), q.name, q.folder));
      case 'POST /api/folder': { const b = await readJsonBody(req); return ok(await svc.mkdir(b.path)); }
      case 'POST /api/rename': { const b = await readJsonBody(req); return ok(await svc.rename(b.from, b.to)); }
      case 'POST /api/trash': { const b = await readJsonBody(req); return ok(await svc.trash(b.path)); }
      case 'GET /api/raw': {
        const rel = vault.rel(q.path);
        const st = await vault.fs.stat(rel);
        res.writeHead(200, { 'content-type': MIME[extOfName(rel)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'max-age=300' });
        return vault.fs.stream(rel).pipe(res);
      }
      case 'GET /api/resolve': return ok(svc.resolve(q.link, q.from));
      case 'GET /api/names': return ok(svc.names());
      case 'GET /api/search': return ok(svc.search(q.q, q.limit));
      case 'GET /api/backlinks': return ok(svc.backlinks(q.path));
      case 'GET /api/tags': return ok(svc.tags());
      case 'GET /api/heatmap': return ok(svc.heatmap());
      case 'GET /api/recent': return ok(svc.recent(q.n));
      case 'GET /api/graph': return ok(svc.graph(q.path, q.depth));
      case 'GET /api/base': return ok(await svc.base(q.path, q.view));
      case 'POST /api/base/query': { const b = await readJsonBody(req); return ok(svc.baseQuery(b.yaml, b.view)); }
      case 'GET /api/bases': return ok(svc.bases());
      case 'GET /api/templates': return ok(await svc.templates());
      case 'GET /api/folders': return ok(svc.folders());
      case 'GET /api/retrieve': return ok(svc.retrieve(q.q, q.k, q.exclude));
      case 'GET /api/settings': return ok({ mode: 'server', ai: { ...config.ai, apiKey: maskKey(config.ai.apiKey), hasKey: !!config.ai.apiKey }, presets: PRESETS, vaultPath: vault.root, recentVaults: config.recentVaults, sampleVault: SAMPLE_VAULT });
      case 'POST /api/settings': {
        const b = await readJsonBody(req);
        if (b.ai) {
          const next = { ...config.ai, ...b.ai };
          // 前端回传的是掩码 → 保留原 Key；回传空串 → 清除
          if (b.ai.apiKey === maskKey(config.ai.apiKey) || b.ai.apiKey === undefined) next.apiKey = config.ai.apiKey;
          delete next.hasKey;
          config.ai = next;
        }
        saveConfig();
        return ok({ ok: true });
      }
      case 'POST /api/vault/open': {
        const b = await readJsonBody(req);
        const p = path.resolve(String(b.path || '').trim() || SAMPLE_VAULT);
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw Object.assign(new Error('文件夹不存在：' + p), { status: 400 });
        openVault(p);
        rememberVault(p);
        return ok({ ok: true, path: p });
      }
      case 'POST /api/vault/reindex': { vault.close(); vault.build().catch(e => console.error(e)); return ok({ ok: true }); }
      case 'POST /api/ai/chat': return aiChat(req, res);
      case 'POST /api/ai/test': {
        let out = '';
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30000);
        try {
          const b = await readJsonBody(req);
          const cfg = { ...config.ai, ...(b.ai || {}) };
          if (!b.ai?.apiKey || b.ai.apiKey === maskKey(config.ai.apiKey)) cfg.apiKey = config.ai.apiKey;
          await streamChat(cfg, { messages: [{ role: 'user', content: '用一句话回复：连接成功' }], maxTokens: 256 }, t => { out += t; }, ctrl.signal);
          return ok({ ok: true, reply: out.trim().slice(0, 200) });
        } catch (e) { return ok({ ok: false, error: e.name === 'AbortError' ? '请求超时' : e.message }); }
        finally { clearTimeout(t); }
      }
    }
    throw Object.assign(new Error('未知接口 ' + route), { status: 404 });
  }

  async function aiChat(req, res) {
    const b = await readJsonBody(req);
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
    const write = o => res.write('data: ' + JSON.stringify(o) + '\n\n');
    try {
      const messages = (b.messages || []).filter(m => m && m.content && (m.role === 'user' || m.role === 'assistant'));
      const r = await streamChat(config.ai, { system: b.system, messages, maxTokens: b.maxTokens }, t => write({ t }), ctrl.signal);
      write({ done: true, stop: r.stopReason });
    } catch (e) {
      if (e.name !== 'AbortError') write({ error: e.message });
    }
    res.end();
  }

  async function serveStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const full = path.resolve(PUBLIC, '.' + p);
    if (!full.startsWith(PUBLIC)) return send(req, res, 403, '禁止访问');
    try {
      const data = await fsp.readFile(full);
      send(req, res, 200, data, MIME[extOfName(full)] || 'application/octet-stream');
    } catch { send(req, res, 404, '未找到'); }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || (e.code === 'ENOENT' ? 404 : 500);
      if (!res.headersSent) send(req, res, status, e.body || { error: e.code === 'ENOENT' ? '文件不存在' : e.message });
      else res.end();
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    const link = `http://localhost:${PORT}`;
    console.log(`\n  AI 版 Obsidian 已启动 → ${link}\n  当前仓库：${vault.root}\n  （按 Ctrl+C 退出）\n`);
    if (!args.includes('--no-open') && !process.env.NO_OPEN) {
      const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
      exec(cmd, () => { });
    }
  });
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用，可用 --port 指定其他端口` : e); process.exit(1); });
}

main().catch(e => { console.error(e); process.exit(1); });
