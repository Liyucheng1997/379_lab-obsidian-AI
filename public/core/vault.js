// 仓库索引：扫描 Markdown / 附件，解析 frontmatter、双链、标签，维护反向链接
// 读写磁盘全部经由 fs 适配器（Node：lib/node-fs.js；浏览器：js/backend/handle-fs.js），路径一律是仓库内的相对路径（/ 分隔）
import { deps } from './deps.js';

const IGNORE_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules', '.claude', '.claudian', '.vscode']);
const MD_EXT = new Set(['md']);
const TEXT_EXT = new Set(['md', 'base', 'canvas', 'txt', 'css', 'json']);

const LINK_RE = /!?\[\[([^\[\]\|#\^]*)(#[^\[\]\|]*)?(\|[^\[\]]*)?\]\]/g;
const TAG_RE = /(?:^|[\s(（，。,;；])#([\p{L}\p{N}_\-\/]*[\p{L}_\-\/][\p{L}\p{N}_\-\/]*)/gu;
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

function extOf(name) { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; }
function baseOf(name) { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; }
function dirOf(p) { const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(0, i) : ''; }
function fileOf(p) { return p.slice(p.lastIndexOf('/') + 1); }
// 规范化相对路径；拒绝跳出仓库的 ..
function normRel(p) {
  const out = [];
  for (const seg of String(p || '').replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join('/');
}

function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: null, body: text, fmText: '' };
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  if (!m) return { fm: null, body: text, fmText: '' };
  let fm = null;
  try { fm = deps.yaml.load(m[1]) || {}; } catch { fm = {}; }
  if (typeof fm !== 'object' || Array.isArray(fm)) fm = {};
  return { fm, body: text.slice(m[0].length), fmText: m[1] };
}

function stripCode(body) {
  return body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function parseNote(text) {
  const { fm, body } = splitFrontmatter(text);
  const links = [];
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text))) { const t = m[1].trim(); if (t) links.push(t); }
  const tags = new Set();
  const clean = stripCode(body);
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(clean))) tags.add(m[1]);
  if (fm) {
    let ft = fm.tags ?? fm.tag;
    if (typeof ft === 'string') ft = ft.split(/[,\s]+/);
    if (Array.isArray(ft)) ft.forEach(t => { if (t != null && String(t).trim()) tags.add(String(t).replace(/^#/, '').trim()); });
  }
  return { fm: fm || {}, links, tags: [...tags] };
}

class Vault {
  constructor(fsx) {
    this.fs = fsx;
    this.root = fsx.root;
    this.name = fsx.name;
    this.files = new Map();      // rel -> entry
    this.byName = new Map();     // lower name -> Set(rel)   md: 不含扩展名; 其他: 含扩展名
    this.backlinks = new Map();  // rel -> Set(sourceRel)
    this.unresolved = new Map(); // lower link -> Set(sourceRel)
    this.folderCounts = new Map();
    this.status = { state: 'idle', done: 0, total: 0, startedAt: 0, ms: 0 };
    this.version = 0;
    this.unwatch = null;
  }

  rel(p) {
    const r = normRel(p);
    if (r === null) throw Object.assign(new Error('路径越界'), { status: 400 });
    return r;
  }

  // ---------- 索引 ----------
  async build() {
    this.status = { state: 'scanning', done: 0, total: 0, startedAt: Date.now(), ms: 0 };
    this.files.clear(); this.byName.clear(); this.backlinks.clear(); this.unresolved.clear();
    const list = await this._walk();
    this.status.state = 'indexing';
    this.status.total = list.length;
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const rel = list[i++];
        try { await this._indexFile(rel); } catch { /* 跳过无法读取的文件 */ }
        this.status.done++;
      }
    };
    await Promise.all(Array.from({ length: 48 }, worker));
    this._rebuildLinks();
    this._rebuildCounts();
    this.status.state = 'ready';
    this.status.ms = Date.now() - this.status.startedAt;
    this.version++;
    this._watch();
  }

  // 列出仓库里所有文件（跳过隐藏文件夹和 IGNORE_DIRS）
  async _walk() {
    const list = [];
    const walk = async (dir) => {
      let ents;
      try { ents = await this.fs.readdir(dir); } catch { return; }
      const subs = [];
      for (const e of ents) {
        if (e.name.startsWith('.') && e.dir) continue;
        if (IGNORE_DIRS.has(e.name)) continue;
        const rel = dir ? dir + '/' + e.name : e.name;
        if (e.dir) subs.push(walk(rel));
        else list.push(rel);
      }
      await Promise.all(subs);
    };
    await walk('');
    return list;
  }

  async _readText(rel, st) { return st?.blob ? st.blob.text() : this.fs.readText(rel); }

  async _indexFile(rel, stat) {
    stat = stat || await this.fs.stat(rel);
    const fname = fileOf(rel);
    const ext = extOf(fname);
    const entry = { path: rel, ext, size: stat.size, mtime: stat.mtime, ctime: stat.ctime };
    if (MD_EXT.has(ext)) {
      entry.name = baseOf(fname);
      const text = await this._readText(rel, stat);
      const parsed = parseNote(text);
      entry.content = text;
      entry.fm = parsed.fm;
      entry.tags = parsed.tags;
      entry.links = parsed.links;
    } else {
      entry.name = fname;
      if (stat.blob) entry.blob = stat.blob;   // 浏览器：附件直接生成 blob: 地址
    }
    const old = this.files.get(rel);
    if (old) this._unname(old);
    this.files.set(rel, entry);
    this._name(entry);
    return entry;
  }

  _key(entry) { return (entry.ext === 'md' ? entry.name : entry.name).toLowerCase(); }
  _name(entry) {
    const k = this._key(entry);
    if (!this.byName.has(k)) this.byName.set(k, new Set());
    this.byName.get(k).add(entry.path);
    if (entry.ext === 'md' && Array.isArray(entry.fm?.aliases)) {
      for (const a of entry.fm.aliases) {
        if (!a) continue;
        const ak = String(a).toLowerCase();
        if (!this.byName.has(ak)) this.byName.set(ak, new Set());
        this.byName.get(ak).add(entry.path);
      }
    }
  }
  _unname(entry) {
    const k = this._key(entry);
    this.byName.get(k)?.delete(entry.path);
    if (entry.ext === 'md' && Array.isArray(entry.fm?.aliases)) {
      for (const a of entry.fm.aliases) if (a) this.byName.get(String(a).toLowerCase())?.delete(entry.path);
    }
  }

  resolve(link, from) {
    if (!link) return null;
    let t = String(link).trim().replace(/\\/g, '/');
    try { t = decodeURIComponent(t); } catch { }
    if (t.includes('/')) {
      const tries = [t, t + '.md'];
      for (const c of tries) if (this.files.has(c)) return c;
      if (from) {
        const rel = normRel(dirOf(from) + '/' + t);
        for (const c of [rel, rel + '.md']) if (this.files.has(c)) return c;
      }
      t = t.slice(t.lastIndexOf('/') + 1);
    }
    let set = this.byName.get(t.toLowerCase());
    if ((!set || !set.size) && t.toLowerCase().endsWith('.md')) set = this.byName.get(t.slice(0, -3).toLowerCase());
    if (!set || !set.size) return null;
    if (set.size === 1) return set.values().next().value;
    const arr = [...set];
    const fdir = from ? dirOf(from) : '';
    const same = arr.find(p => dirOf(p) === fdir);
    if (same) return same;
    return arr.sort((a, b) => a.length - b.length)[0];
  }

  _addLinks(entry) {
    entry.out = [];
    for (const l of entry.links || []) {
      const target = this.resolve(l, entry.path);
      if (target) {
        if (!this.backlinks.has(target)) this.backlinks.set(target, new Set());
        this.backlinks.get(target).add(entry.path);
        entry.out.push(target);
      } else {
        const k = l.toLowerCase().replace(/\.md$/, '').split('/').pop();
        if (!this.unresolved.has(k)) this.unresolved.set(k, new Set());
        this.unresolved.get(k).add(entry.path);
      }
    }
  }
  _removeLinks(entry) {
    for (const t of entry.out || []) this.backlinks.get(t)?.delete(entry.path);
    for (const l of entry.links || []) {
      const k = l.toLowerCase().replace(/\.md$/, '').split('/').pop();
      this.unresolved.get(k)?.delete(entry.path);
    }
  }
  _rebuildLinks() {
    this.backlinks.clear(); this.unresolved.clear();
    for (const e of this.files.values()) if (e.ext === 'md') this._addLinks(e);
  }
  _rebuildCounts() {
    const c = new Map();
    for (const e of this.files.values()) {
      if (e.ext !== 'md') continue;
      let d = dirOf(e.path);
      while (true) { c.set(d, (c.get(d) || 0) + 1); if (!d) break; d = dirOf(d); }
    }
    this.folderCounts = c;
  }

  // 文件变化后增量更新
  async refresh(rel, st) {
    const old = this.files.get(rel);
    if (!st) try { st = await this.fs.stat(rel); } catch { st = null; }
    if (old && old.ext === 'md') this._removeLinks(old);
    if (!st || !st.file) {
      if (old) { this._unname(old); this.files.delete(rel); }
    } else {
      const e = await this._indexFile(rel, st);
      if (e.ext === 'md') {
        this._addLinks(e);
        // 之前未解析、现在能解析的链接
        const keys = [e.name.toLowerCase(), ...((Array.isArray(e.fm?.aliases) ? e.fm.aliases : []).map(a => String(a).toLowerCase()))];
        for (const k of keys) {
          const srcs = this.unresolved.get(k);
          if (srcs && srcs.size) {
            for (const s of [...srcs]) { const se = this.files.get(s); if (se) { this._removeLinks(se); this._addLinks(se); } }
          }
        }
      }
    }
    if (!old || !st) this._rebuildCounts();
    this.version++;
  }

  // 监听外部修改（桌面版 Obsidian 同时在改）：适配器支持 watch 时实时更新，否则由宿主调用 rescan()
  _watch() {
    if (this.unwatch || !this.fs.watch) return;
    const pending = new Map();
    this.unwatch = this.fs.watch(rel => {
      if (rel.split('/').some(seg => seg.startsWith('.') || IGNORE_DIRS.has(seg))) return;
      clearTimeout(pending.get(rel));
      pending.set(rel, setTimeout(() => {
        pending.delete(rel);
        if (this.selfWrites.has(rel)) { this.selfWrites.delete(rel); return; }
        this.fs.stat(rel).then(st => {
          if (st.dir) return this._rebuildCounts();
          return this.refresh(rel, st);
        }, () => this.refresh(rel)).catch(() => { });
      }, 300));
    });
  }
  selfWrites = new Set();
  close() { try { this.unwatch?.(); } catch { } this.unwatch = null; }

  // 全量比对修改时间，增量更新变化的文件；返回变化的文件数
  async rescan() {
    if (this.status.state !== 'ready') return 0;
    const list = await this._walk();
    const seen = new Set(list);
    let changed = 0, i = 0;
    const worker = async () => {
      while (i < list.length) {
        const rel = list[i++];
        let st;
        try { st = await this.fs.stat(rel); } catch { continue; }
        const old = this.files.get(rel);
        if (old && old.mtime === st.mtime && old.size === st.size) continue;
        await this.refresh(rel, st); changed++;
      }
    };
    await Promise.all(Array.from({ length: 48 }, worker));
    for (const rel of [...this.files.keys()]) if (!seen.has(rel)) { await this.refresh(rel); changed++; }
    return changed;
  }

  // ---------- 读取 ----------
  async list(dir, offset = 0, limit = 400) {
    dir = this.rel(dir);
    const ents = await this.fs.readdir(dir);
    const folders = [], files = [];
    for (const e of ents) {
      if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
      const rel = dir ? dir + '/' + e.name : e.name;
      if (e.dir) folders.push({ name: e.name, path: rel, count: this.folderCounts.get(rel) ?? null });
      else files.push({ name: e.name, path: rel, ext: extOf(e.name) });
    }
    folders.sort((a, b) => collator.compare(a.name, b.name));
    files.sort((a, b) => collator.compare(a.name, b.name));
    return { folders, files: files.slice(offset, offset + limit), totalFiles: files.length, offset };
  }

  async read(rel) {
    rel = this.rel(rel);
    const st = await this.fs.stat(rel);
    const text = await this._readText(rel, st);
    return { path: rel, content: text, mtime: st.mtime };
  }

  async write(rel, content) {
    rel = this.rel(rel);
    this.selfWrites.add(rel);
    await this.fs.writeText(rel, content);
    const st = await this.fs.stat(rel);
    await this.refresh(rel, st);
    return { path: rel, mtime: st.mtime };
  }

  async writeBinary(rel, buf) {
    rel = this.rel(rel);
    this.selfWrites.add(rel);
    await this.fs.writeBinary(rel, buf);
    await this.refresh(rel);
    return { path: rel };
  }

  async exists(rel) { return this.fs.exists(this.rel(rel)); }

  async mkdir(rel) { await this.fs.mkdir(this.rel(rel)); this._rebuildCounts(); this.version++; }

  // 删除 = 移到仓库内 .trash（与 Obsidian "trashOption: local" 一致）
  async trash(rel) {
    rel = this.rel(rel);
    const st = await this.fs.stat(rel);
    const name = fileOf(rel), ext = st.dir || !extOf(name) ? '' : '.' + name.slice(name.lastIndexOf('.') + 1);
    let target = '.trash/' + name, n = 1;
    while (await this.fs.exists(target)) target = '.trash/' + name.slice(0, name.length - ext.length) + ` ${n++}` + ext;
    await this.fs.move(rel, target);
    if (st.dir) {
      for (const k of [...this.files.keys()]) if (k === rel || k.startsWith(rel + '/')) await this.refresh(k);
    } else await this.refresh(rel);
    this._rebuildCounts();
  }

  // 重命名 / 移动，并更新其他笔记里的双链
  async rename(from, to) {
    from = this.rel(from); to = this.rel(to);
    if (await this.fs.exists(to)) throw Object.assign(new Error('目标已存在'), { status: 409 });
    const st = await this.fs.stat(from);
    const entry = this.files.get(from);
    const sources = entry ? [...(this.backlinks.get(from) || [])] : [];
    await this.fs.move(from, to);
    if (st.dir) {
      for (const k of [...this.files.keys()]) {
        if (k.startsWith(from + '/')) { await this.refresh(k); await this.refresh(to + k.slice(from.length)); }
      }
      this._rebuildCounts();
      return { path: to, updated: 0 };
    }
    await this.refresh(from);
    await this.refresh(to);
    let updated = 0;
    if (entry && entry.ext === 'md') {
      const oldName = entry.name, newName = baseOf(to.split('/').pop());
      if (oldName !== newName) {
        const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(!?\\[\\[)(?:[^\\[\\]|#]*/)?${esc}(\\.md)?(#[^\\[\\]|]*)?(\\|[^\\[\\]]*)?\\]\\]`, 'g');
        for (const s of sources) {
          const sp = s === from ? to : s;
          try {
            const { content } = await this.read(sp);
            const next = content.replace(re, (all, open, md, hash, alias) => `${open}${newName}${hash || ''}${alias || ''}]]`);
            if (next !== content) { await this.write(sp, next); updated++; }
          } catch { }
        }
      }
    }
    return { path: to, updated };
  }

  // ---------- 查询 ----------
  notes() { const out = []; for (const e of this.files.values()) if (e.ext === 'md') out.push(e); return out; }

  names() {
    const notes = [], files = [];
    for (const e of this.files.values()) {
      if (e.ext === 'md') {
        const o = { p: e.path };
        if (e.fm && e.fm['类型']) o.t = String(e.fm['类型']);
        if (Array.isArray(e.fm?.aliases) && e.fm.aliases.length) o.a = e.fm.aliases.map(String);
        notes.push(o);
      } else files.push(e.path);
    }
    return { notes, files, version: this.version };
  }

  backlinksOf(rel) {
    const entry = this.files.get(rel);
    const linked = [];
    for (const s of this.backlinks.get(rel) || []) {
      const se = this.files.get(s);
      if (!se || !se.content) continue;
      const lines = se.content.split('\n');
      const ctx = [];
      for (const line of lines) {
        LINK_RE.lastIndex = 0;
        let m, hit = false;
        while ((m = LINK_RE.exec(line))) { if (this.resolve(m[1], s) === rel) { hit = true; break; } }
        if (hit) { ctx.push(line.trim().slice(0, 240)); if (ctx.length >= 3) break; }
      }
      linked.push({ path: s, name: se.name, context: ctx });
    }
    linked.sort((a, b) => collator.compare(a.name, b.name));
    // 未链接提及：正文里出现名字却没有加双链（只在名字 ≥2 字时检查，并限量）
    const unlinked = [];
    if (entry && entry.ext === 'md' && entry.name.length >= 2) {
      const n = entry.name;
      const linkedSet = new Set(linked.map(l => l.path));
      for (const e of this.files.values()) {
        if (e.ext !== 'md' || e.path === rel || linkedSet.has(e.path) || !e.content) continue;
        const idx = e.content.indexOf(n);
        if (idx < 0) continue;
        const ls = e.content.lastIndexOf('\n', idx) + 1;
        let le = e.content.indexOf('\n', idx); if (le < 0) le = e.content.length;
        const line = e.content.slice(ls, le);
        if (line.includes('[[')) { const before = e.content.slice(ls, idx); if (before.lastIndexOf('[[') > before.lastIndexOf(']]')) continue; }
        unlinked.push({ path: e.path, name: e.name, context: [line.trim().slice(0, 240)] });
        if (unlinked.length >= 50) break;
      }
    }
    return { linked, unlinked };
  }

  tags() {
    const c = new Map();
    for (const e of this.files.values()) if (e.ext === 'md') for (const t of e.tags) c.set(t, (c.get(t) || 0) + 1);
    return [...c.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag));
  }

  search(q, limit = 80) {
    const terms = [], filters = { tag: [], path: [], file: [], prop: [] };
    const re = /(\[([^\]:]+):([^\]]*)\])|(tag:#?(\S+))|(path:("[^"]+"|\S+))|(file:("[^"]+"|\S+))|("([^"]+)")|(\S+)/g;
    let m;
    while ((m = re.exec(q))) {
      if (m[1]) filters.prop.push([m[2].trim(), m[3].trim()]);
      else if (m[4]) filters.tag.push(m[5].toLowerCase());
      else if (m[6]) filters.path.push(m[7].replace(/"/g, '').toLowerCase());
      else if (m[8]) filters.file.push(m[9].replace(/"/g, '').toLowerCase());
      else if (m[10]) terms.push(m[11]);
      else if (m[12]) { if (m[12].startsWith('#') && m[12].length > 1) filters.tag.push(m[12].slice(1).toLowerCase()); else terms.push(m[12]); }
    }
    const lterms = terms.map(t => t.toLowerCase());
    const needLower = lterms.some(t => /[a-z]/.test(t));
    const results = [];
    let total = 0;
    for (const e of this.files.values()) {
      if (e.ext !== 'md') continue;
      const lp = e.path.toLowerCase();
      if (filters.path.some(p => !lp.includes(p))) continue;
      if (filters.file.some(f => !e.name.toLowerCase().includes(f))) continue;
      if (filters.tag.length) { const lt = e.tags.map(t => t.toLowerCase()); if (!filters.tag.every(t => lt.some(x => x === t || x.startsWith(t + '/')))) continue; }
      if (filters.prop.length && !filters.prop.every(([k, v]) => { const pv = e.fm?.[k]; if (pv == null) return false; if (!v) return true; return (Array.isArray(pv) ? pv : [pv]).some(x => String(x).toLowerCase().includes(v.toLowerCase())); })) continue;
      const hay = needLower ? e.content.toLowerCase() : e.content;
      const lname = e.name.toLowerCase();
      if (!lterms.every(t => hay.includes(t) || lname.includes(t))) continue;
      total++;
      if (results.length >= limit * 3) continue;
      let score = 0;
      for (const t of lterms) { if (lname === t) score += 100; else if (lname.includes(t)) score += 30; }
      const snippets = [];
      if (lterms.length) {
        const t = lterms[0];
        let from = 0;
        while (snippets.length < 3) {
          const i = hay.indexOf(t, from);
          if (i < 0) break;
          const s = Math.max(0, i - 40), en = Math.min(e.content.length, i + t.length + 60);
          snippets.push({ text: e.content.slice(s, en).replace(/\n/g, ' '), at: i - s, len: t.length });
          from = i + t.length;
          score += 1;
        }
      }
      results.push({ path: e.path, name: e.name, score, snippets });
    }
    results.sort((a, b) => b.score - a.score || collator.compare(a.name, b.name));
    return { total, results: results.slice(0, limit), terms };
  }

  // 给 AI 检索用：中文按双字切分打分
  retrieve(q, k = 6, exclude) {
    const text = String(q || '');
    const grams = new Set();
    for (const w of text.match(/[a-zA-Z0-9]{3,}/g) || []) grams.add(w.toLowerCase());
    const cjk = text.replace(/[^一-鿿]/g, ' ').split(/\s+/).filter(Boolean);
    for (const seg of cjk) for (let i = 0; i < seg.length - 1; i++) grams.add(seg.slice(i, i + 2));
    const gl = [...grams].slice(0, 24);
    const scored = [];
    for (const e of this.files.values()) {
      if (e.ext !== 'md' || e.path === exclude || !e.content) continue;
      let s = 0;
      if (e.name.length >= 2 && text.includes(e.name)) s += 40 + e.name.length * 2;
      if (!s && !gl.length) continue;
      const lname = e.name.toLowerCase();
      for (const g of gl) {
        if (lname.includes(g)) s += 6;
        const i = e.content.indexOf(g);
        if (i >= 0) { s += 1; if (e.content.indexOf(g, i + 1) >= 0) s += 0.5; }
      }
      if (s > 2) scored.push([s, e]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, k).map(([score, e]) => ({ path: e.path, name: e.name, score, excerpt: splitFrontmatter(e.content).body.trim().slice(0, 1500) }));
  }

  heatmap(days = 250) {
    const counts = {};
    const types = {};
    const norm = v => {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(String(v || ''));
      return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
    };
    for (const e of this.files.values()) {
      if (e.ext !== 'md') continue;
      const d = norm(e.fm?.date) || new Date(e.ctime).toISOString().slice(0, 10);
      counts[d] = (counts[d] || 0) + 1;
      const t = e.fm?.['类型'] ? String(e.fm['类型']) : '未分类';
      types[t] = (types[t] || 0) + 1;
    }
    return { counts, types, days };
  }

  recent(n = 12) {
    return this.notes().sort((a, b) => b.mtime - a.mtime).slice(0, n).map(e => ({ path: e.path, name: e.name, mtime: e.mtime, type: e.fm?.['类型'] || '' }));
  }

  graph(rel, depth = 1) {
    const nodes = new Map(), edges = [];
    const add = (p, lvl) => { if (!nodes.has(p)) { const e = this.files.get(p); nodes.set(p, { id: p, name: e ? e.name : p, lvl, type: e?.fm?.['类型'] || '' }); } };
    add(rel, 0);
    let frontier = [rel];
    for (let d = 1; d <= depth; d++) {
      const next = [];
      for (const p of frontier) {
        const e = this.files.get(p);
        const neigh = new Set([...(e?.out || []), ...(this.backlinks.get(p) || [])]);
        for (const n of neigh) {
          if (nodes.size > 220) break;
          if (!nodes.has(n)) { add(n, d); next.push(n); }
        }
      }
      frontier = next;
    }
    for (const p of nodes.keys()) {
      const e = this.files.get(p);
      for (const t of new Set(e?.out || [])) if (nodes.has(t) && t !== p) edges.push({ s: p, t });
    }
    return { nodes: [...nodes.values()], edges };
  }
}

export { Vault, splitFrontmatter, parseNote, extOf, baseOf, dirOf, normRel, TEXT_EXT, collator };
