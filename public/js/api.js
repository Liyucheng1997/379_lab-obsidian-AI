// 与本地服务通信 + 客户端链接解析索引
import { basename, dirname, extname, bus } from './util.js';

async function req(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(url, opt);
  let data = null;
  const ct = res.headers.get('content-type') || '';
  data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) { const e = new Error(data?.error || data || ('HTTP ' + res.status)); e.status = res.status; e.data = data; throw e; }
  return data;
}
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null)).toString();

export const api = {
  info: () => req('GET', '/api/info'),
  tree: (dir, offset = 0, limit = 400) => req('GET', '/api/tree?' + qs({ dir, offset, limit })),
  read: path => req('GET', '/api/file?' + qs({ path })),
  write: (path, content, extra = {}) => req('PUT', '/api/file', { path, content, ...extra }),
  rename: (from, to) => req('POST', '/api/rename', { from, to }),
  trash: path => req('POST', '/api/trash', { path }),
  mkdir: path => req('POST', '/api/folder', { path }),
  names: () => req('GET', '/api/names'),
  search: (q, limit) => req('GET', '/api/search?' + qs({ q, limit })),
  backlinks: path => req('GET', '/api/backlinks?' + qs({ path })),
  tags: () => req('GET', '/api/tags'),
  heatmap: () => req('GET', '/api/heatmap'),
  recent: n => req('GET', '/api/recent?' + qs({ n })),
  graph: (path, depth) => req('GET', '/api/graph?' + qs({ path, depth })),
  base: (path, view) => req('GET', '/api/base?' + qs({ path, view })),
  baseQuery: (yaml, view = 0) => req('POST', '/api/base/query', { yaml, view }),
  bases: () => req('GET', '/api/bases'),
  templates: () => req('GET', '/api/templates'),
  folders: () => req('GET', '/api/folders'),
  retrieve: (q, k, exclude) => req('GET', '/api/retrieve?' + qs({ q, k, exclude })),
  settings: () => req('GET', '/api/settings'),
  saveSettings: s => req('POST', '/api/settings', s),
  testAI: ai => req('POST', '/api/ai/test', { ai }),
  openVault: path => req('POST', '/api/vault/open', { path }),
  reindex: () => req('POST', '/api/vault/reindex'),
  async upload(file, name, folder) {
    const res = await fetch('/api/upload?' + qs({ name, folder }), { method: 'POST', body: file });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    return d;
  },
  raw: path => '/api/raw?' + qs({ path }),

  // 流式对话：onText(增量)；返回 { abort, done: Promise }
  chat({ system, messages, maxTokens }, onText) {
    const ctrl = new AbortController();
    const done = (async () => {
      const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system, messages, maxTokens }), signal: ctrl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', full = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith('data:')) continue;
          const ev = JSON.parse(chunk.slice(5).trim());
          if (ev.error) throw new Error(ev.error);
          if (ev.t) { full += ev.t; onText(ev.t, full); }
        }
      }
      return full;
    })();
    return { abort: () => ctrl.abort(), done };
  },
};

// ---------- 名称索引（双链补全、快速切换、链接解析） ----------
export const index = {
  notes: [],          // [{p, n, t, a}]
  files: [],          // 附件路径
  byName: new Map(),  // 小写名 -> [path]
  version: -1,
  async load() {
    const d = await api.names();
    this.version = d.version;
    this.notes = d.notes.map(o => ({ ...o, n: basename(o.p) }));
    this.files = d.files;
    const m = new Map();
    const add = (k, p) => { k = k.toLowerCase(); if (!m.has(k)) m.set(k, []); m.get(k).push(p); };
    for (const o of this.notes) { add(o.n, o.p); if (o.a) o.a.forEach(a => add(String(a), o.p)); }
    for (const p of this.files) add(p.split('/').pop(), p);
    this.byName = m;
    this.pathSet = new Set([...this.notes.map(o => o.p), ...this.files]);
    this.types = new Map(this.notes.filter(o => o.t).map(o => [o.p, o.t]));
    bus.emit('index');
  },
  pathSet: new Set(),
  types: new Map(),
  resolve(link, from) {
    if (!link) return null;
    let t = String(link).trim();
    if (t.includes('/')) {
      for (const c of [t, t + '.md']) if (this.pathSet.has(c)) return c;
      t = t.split('/').pop();
    }
    let arr = this.byName.get(t.toLowerCase());
    if (!arr && t.toLowerCase().endsWith('.md')) arr = this.byName.get(t.slice(0, -3).toLowerCase());
    if (!arr || !arr.length) return null;
    if (arr.length === 1) return arr[0];
    const fd = from ? dirname(from) : '';
    return arr.find(p => dirname(p) === fd) || [...arr].sort((a, b) => a.length - b.length)[0];
  },
  isImage(p) { return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(extname(p)); },
  typeOf(p) { return this.types.get(p) || ''; },
};
