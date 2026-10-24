// 仓库接口：本地服务（server.js 的 /api 路由）和纯前端模式（js/backend/local.js）共用的同一套实现
import { extOf } from './vault.js';
import { loadBase, runView } from './bases.js';

const TEXT_FILE_EXT = ['md', 'base', 'canvas', 'txt', 'css', 'json', 'excalidraw'];
const err = (status, message, body) => Object.assign(new Error(message), { status, body });

export class Service {
  // opts.isSample：当前是内置示例仓库；opts.extraInfo()：宿主补充到 info() 里的字段（最近打开的仓库等）
  constructor(vault, opts = {}) {
    this.vault = vault;
    this.opts = opts;
  }

  // ---------- 仓库元数据（读取 .obsidian 配置，保持与桌面版一致） ----------
  async readJson(rel) { try { return JSON.parse(await this.vault.fs.readText('.obsidian/' + rel)); } catch { return null; } }
  async meta() {
    const [app, tpl, appearance, fc] = await Promise.all(['app.json', 'templates.json', 'appearance.json', 'plugins/obsidian-file-color/data.json'].map(f => this.readJson(f)));
    const folderColors = {};
    if (fc && Array.isArray(fc.fileColors)) {
      const pal = Object.fromEntries((fc.palette || []).map(p => [p.id, p.value]));
      for (const f of fc.fileColors) if (pal[f.color]) folderColors[f.path] = pal[f.color];
    }
    const v = this.vault, isSample = !!this.opts.isSample;
    return {
      name: isSample ? '读书笔记' : v.name, path: v.root, isSample,
      attachmentFolder: app?.attachmentFolderPath || '04_图片附件库',
      newFileFolder: app?.newFileFolderPath || '',
      templateFolder: tpl?.folder || '03_模板文件库',
      dateFormat: tpl?.dateFormat || 'YYYY/MM/DD',
      timeFormat: tpl?.timeFormat || 'HH:mm',
      cssTheme: appearance?.cssTheme || '', baseFontSize: appearance?.baseFontSize || null,
      folderColors,
      status: v.status, version: v.version,
      ...(this.opts.extraInfo?.() || {}),
    };
  }
  info() { return this.meta(); }

  // ---------- 文件 ----------
  tree(dir, offset = 0, limit = 400) { return this.vault.list(dir || '', Number(offset) || 0, Number(limit) || 400); }

  async readFile(path) {
    path = path || '';
    if (!TEXT_FILE_EXT.includes(extOf(path)) && !path.endsWith('.excalidraw.md')) throw err(400, '不是文本文件');
    const r = await this.vault.read(path);
    const e = this.vault.files.get(r.path);
    if (e) r.ctime = e.ctime;
    return r;
  }

  // b: { path, content, create?, expectMtime?, force? }
  async writeFile(b) {
    const v = this.vault;
    const exists = await v.exists(b.path);
    if (b.create && exists) throw err(409, '同名文件已存在');
    if (b.expectMtime && exists) {
      const st = await v.fs.stat(v.rel(b.path));
      if (Math.abs(st.mtime - b.expectMtime) > 2 && !b.force) throw err(409, '文件已在别处被修改', { error: '文件已在别处被修改', mtime: st.mtime });
    }
    return v.write(b.path, String(b.content ?? ''));
  }

  async upload(data, name, folder) {
    const v = this.vault;
    if (folder == null) folder = (await this.meta()).attachmentFolder;
    name = (name || 'Pasted image.png').replace(/[\\/:*?"<>|]/g, '_');
    let rel = folder ? folder + '/' + name : name;
    let n = 1;
    while (await v.exists(rel)) {
      const i = name.lastIndexOf('.'), e = i > 0 ? name.slice(i) : '';
      rel = (folder ? folder + '/' : '') + name.slice(0, name.length - e.length) + ' ' + n++ + e;
    }
    return v.writeBinary(rel, data);
  }

  async mkdir(path) { await this.vault.mkdir(path); return { ok: true }; }
  rename(from, to) { return this.vault.rename(from, to); }
  async trash(path) { await this.vault.trash(path); return { ok: true }; }

  // ---------- 查询 ----------
  resolve(link, from) { return { path: this.vault.resolve(link, from) }; }
  names() { return this.vault.names(); }
  search(q, limit) { return this.vault.search(q || '', Number(limit) || 80); }
  backlinks(path) { return this.vault.backlinksOf(path); }
  tags() { return this.vault.tags(); }
  heatmap() { return this.vault.heatmap(); }
  recent(n) { return this.vault.recent(Number(n) || 12); }
  graph(path, depth) { return this.vault.graph(path, Math.min(Number(depth) || 1, 3)); }
  retrieve(q, k, exclude) { return this.vault.retrieve(q, Math.min(Number(k) || 6, 12), exclude); }

  async base(path, view) {
    const { content } = await this.vault.read(path);
    return runView(loadBase(content), Number(view) || 0, this.vault);
  }
  baseQuery(yaml, view) { return runView(loadBase(yaml), Number(view) || 0, this.vault); }
  bases() {
    const list = [];
    for (const e of this.vault.files.values()) if (e.ext === 'base') list.push({ path: e.path, name: e.name.replace(/\.base$/, '') });
    return list.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
  }
  async templates() {
    const folder = (await this.meta()).templateFolder;
    const out = [];
    for (const e of this.vault.files.values()) if (e.ext === 'md' && e.path.startsWith(folder + '/')) out.push({ path: e.path, name: e.name, type: e.fm?.['类型'] || '', content: e.content });
    return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }
  folders() {
    const set = new Set();
    for (const e of this.vault.files.values()) { let d = e.path.slice(0, Math.max(0, e.path.lastIndexOf('/'))); while (d) { set.add(d); d = d.slice(0, Math.max(0, d.lastIndexOf('/'))); } }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }));
  }
}
