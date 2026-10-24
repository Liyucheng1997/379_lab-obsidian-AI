#!/usr/bin/env node
// AI 版 Obsidian · 本地服务（零依赖，Node 18+）
// 用法：node server.js [--vault <仓库路径>] [--port 5173] [--no-open]
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { exec } = require('child_process');
const { Vault, extOf } = require('./lib/vault');
const { loadBase, runView } = require('./lib/bases');
const { PRESETS, streamChat } = require('./lib/ai');

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
let vaultPath = argVal('--vault') || process.env.VAULT || config.vaultPath || SAMPLE_VAULT;
if (!fs.existsSync(vaultPath)) vaultPath = SAMPLE_VAULT;

let vault = new Vault(vaultPath);
vault.build().catch(e => console.error('索引失败', e));

function rememberVault(p) {
  config.vaultPath = p;
  config.recentVaults = [p, ...config.recentVaults.filter(x => x !== p)].slice(0, 8);
  saveConfig();
}

// ---------- 仓库元数据（读取 .obsidian 配置，保持与桌面版一致） ----------
function readJson(rel) { try { return JSON.parse(fs.readFileSync(path.join(vault.root, '.obsidian', rel), 'utf8')); } catch { return null; } }
function vaultMeta() {
  const app = readJson('app.json') || {};
  const tpl = readJson('templates.json') || {};
  const appearance = readJson('appearance.json') || {};
  const fc = readJson('plugins/obsidian-file-color/data.json');
  const folderColors = {};
  if (fc && Array.isArray(fc.fileColors)) {
    const pal = Object.fromEntries((fc.palette || []).map(p => [p.id, p.value]));
    for (const f of fc.fileColors) if (pal[f.color]) folderColors[f.path] = pal[f.color];
  }
  const isSample = path.resolve(vault.root) === path.resolve(SAMPLE_VAULT);
  return {
    name: isSample ? '读书笔记' : vault.name, path: vault.root, isSample,
    attachmentFolder: app.attachmentFolderPath || '04_图片附件库',
    newFileFolder: app.newFileFolderPath || '',
    templateFolder: tpl.folder || '03_模板文件库',
    dateFormat: tpl.dateFormat || 'YYYY/MM/DD',
    timeFormat: tpl.timeFormat || 'HH:mm',
    cssTheme: appearance.cssTheme || '', baseFontSize: appearance.baseFontSize || null,
    folderColors,
    status: vault.status, version: vault.version,
    recentVaults: config.recentVaults,
  };
}

// ---------- HTTP 工具 ----------
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', woff2: 'font/woff2', base: 'text/plain; charset=utf-8', canvas: 'application/json; charset=utf-8' };

function send(req, res, status, data, type) {
  let body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  const headers = { 'content-type': type || (typeof data === 'string' ? 'text/plain; charset=utf-8' : MIME.json), 'cache-control': 'no-store' };
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

// ---------- 路由 ----------
async function api(req, res, url) {
  const q = Object.fromEntries(url.searchParams);
  const route = req.method + ' ' + url.pathname;
  switch (route) {
    case 'GET /api/info': return send(req, res, 200, vaultMeta());
    case 'GET /api/tree': return send(req, res, 200, await vault.list(q.dir || '', Number(q.offset) || 0, Number(q.limit) || 400));
    case 'GET /api/file': {
      const ext = extOf(q.path || '');
      if (!['md', 'base', 'canvas', 'txt', 'css', 'json', 'excalidraw'].includes(ext) && !q.path.endsWith('.excalidraw.md')) throw Object.assign(new Error('不是文本文件'), { status: 400 });
      const r = await vault.read(q.path);
      const e = vault.files.get(q.path);
      if (e) { r.ctime = e.ctime; }
      return send(req, res, 200, r);
    }
    case 'PUT /api/file': {
      const b = await readJsonBody(req);
      if (b.create && fs.existsSync(vault.abs(b.path))) throw Object.assign(new Error('同名文件已存在'), { status: 409 });
      if (b.expectMtime && fs.existsSync(vault.abs(b.path))) {
        const st = await fsp.stat(vault.abs(b.path));
        if (Math.abs(st.mtimeMs - b.expectMtime) > 2 && !b.force) return send(req, res, 409, { error: '文件已在别处被修改', mtime: st.mtimeMs });
      }
      return send(req, res, 200, await vault.write(b.path, String(b.content ?? '')));
    }
    case 'POST /api/upload': {
      const buf = await readBody(req);
      const folder = q.folder ?? vaultMeta().attachmentFolder;
      let name = (q.name || 'Pasted image.png').replace(/[\\/:*?"<>|]/g, '_');
      let rel = folder ? folder + '/' + name : name;
      let n = 1;
      while (fs.existsSync(vault.abs(rel))) { const e = path.extname(name); rel = (folder ? folder + '/' : '') + name.slice(0, name.length - e.length) + ' ' + n++ + e; }
      return send(req, res, 200, await vault.writeBinary(rel, buf));
    }
    case 'POST /api/folder': { const b = await readJsonBody(req); await vault.mkdir(b.path); return send(req, res, 200, { ok: true }); }
    case 'POST /api/rename': { const b = await readJsonBody(req); return send(req, res, 200, await vault.rename(b.from, b.to)); }
    case 'POST /api/trash': { const b = await readJsonBody(req); await vault.trash(b.path); return send(req, res, 200, { ok: true }); }
    case 'GET /api/raw': {
      const full = vault.abs(q.path);
      const st = await fsp.stat(full);
      res.writeHead(200, { 'content-type': MIME[extOf(full)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'max-age=300' });
      return fs.createReadStream(full).pipe(res);
    }
    case 'GET /api/resolve': return send(req, res, 200, { path: vault.resolve(q.link, q.from) });
    case 'GET /api/names': return send(req, res, 200, vault.names());
    case 'GET /api/search': return send(req, res, 200, vault.search(q.q || '', Number(q.limit) || 80));
    case 'GET /api/backlinks': return send(req, res, 200, vault.backlinksOf(q.path));
    case 'GET /api/tags': return send(req, res, 200, vault.tags());
    case 'GET /api/heatmap': return send(req, res, 200, vault.heatmap());
    case 'GET /api/recent': return send(req, res, 200, vault.recent(Number(q.n) || 12));
    case 'GET /api/graph': return send(req, res, 200, vault.graph(q.path, Math.min(Number(q.depth) || 1, 3)));
    case 'GET /api/base': {
      const { content } = await vault.read(q.path);
      return send(req, res, 200, runView(loadBase(content), Number(q.view) || 0, vault));
    }
    case 'POST /api/base/query': {
      const b = await readJsonBody(req);
      return send(req, res, 200, runView(loadBase(b.yaml), Number(b.view) || 0, vault));
    }
    case 'GET /api/bases': {
      const list = [];
      for (const e of vault.files.values()) if (e.ext === 'base') list.push({ path: e.path, name: e.name.replace(/\.base$/, '') });
      list.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
      return send(req, res, 200, list);
    }
    case 'GET /api/templates': {
      const folder = vaultMeta().templateFolder;
      const out = [];
      for (const e of vault.files.values()) if (e.ext === 'md' && e.path.startsWith(folder + '/')) out.push({ path: e.path, name: e.name, type: e.fm?.['类型'] || '', content: e.content });
      out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      return send(req, res, 200, out);
    }
    case 'GET /api/folders': {
      const set = new Set();
      for (const e of vault.files.values()) { let d = e.path.slice(0, Math.max(0, e.path.lastIndexOf('/'))); while (d) { set.add(d); d = d.slice(0, Math.max(0, d.lastIndexOf('/'))); } }
      return send(req, res, 200, [...set].sort((a, b) => a.localeCompare(b, 'zh', { numeric: true })));
    }
    case 'GET /api/retrieve': return send(req, res, 200, vault.retrieve(q.q, Math.min(Number(q.k) || 6, 12), q.exclude));
    case 'GET /api/settings': return send(req, res, 200, { ai: { ...config.ai, apiKey: maskKey(config.ai.apiKey), hasKey: !!config.ai.apiKey }, presets: PRESETS, vaultPath: vault.root, recentVaults: config.recentVaults, sampleVault: SAMPLE_VAULT });
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
      return send(req, res, 200, { ok: true });
    }
    case 'POST /api/vault/open': {
      const b = await readJsonBody(req);
      const p = path.resolve(String(b.path || '').trim() || SAMPLE_VAULT);
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw Object.assign(new Error('文件夹不存在：' + p), { status: 400 });
      vault.close();
      vault = new Vault(p);
      vault.build().catch(e => console.error('索引失败', e));
      rememberVault(p);
      return send(req, res, 200, { ok: true, path: p });
    }
    case 'POST /api/vault/reindex': { vault.close(); vault.build().catch(e => console.error(e)); return send(req, res, 200, { ok: true }); }
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
        return send(req, res, 200, { ok: true, reply: out.trim().slice(0, 200) });
      } catch (e) { return send(req, res, 200, { ok: false, error: e.name === 'AbortError' ? '请求超时' : e.message }); }
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
    send(req, res, 200, data, MIME[extOf(full)] || 'application/octet-stream');
  } catch { send(req, res, 404, '未找到'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || (e.code === 'ENOENT' ? 404 : 500);
    if (!res.headersSent) send(req, res, status, { error: e.code === 'ENOENT' ? '文件不存在' : e.message });
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
