// 文件列表：彩色一级文件夹（读取 obsidian-file-color 配置）、笔记计数、懒加载、拖拽移动
import { h, store, basename, dirname, extname, toast } from '../util.js';
import { icon, iconHTML } from '../icons.js';
import { api } from '../api.js';
import { app } from '../ctx.js';
import { showMenu } from '../modals.js';

export class Explorer {
  constructor() {
    this.expanded = new Set(store.get('expanded', []));
    this.el = h('div', { class: 'panel explorer' });
    const bar = h('div', { class: 'panel-bar' },
      this.btn('file-plus', '新建笔记', () => app.createNote({ folder: this.targetFolder() })),
      this.btn('template', '从模板新建', () => app.newFromTemplate({ folder: this.targetFolder() })),
      this.btn('folder-plus', '新建文件夹', () => app.createFolder(this.targetFolder())),
      this.btn('target', '定位当前笔记', () => { const p = app.activePath(); if (p) this.reveal(p); }),
      this.btn('collapse', '全部折叠', () => { this.expanded.clear(); this.persist(); this.refresh(); }));
    this.tree = h('div', { class: 'tree' });
    this.el.append(bar, h('div', { class: 'panel-scroll' }, this.tree));
    this.tree.addEventListener('contextmenu', e => { if (e.target === this.tree) { e.preventDefault(); this.folderMenu(e, ''); } });
    this.tree.addEventListener('dragover', e => { if (e.target === this.tree) e.preventDefault(); });
    this.tree.addEventListener('drop', e => { if (e.target === this.tree) this.onDrop(e, ''); });
  }
  btn(ic, title, fn) { const b = h('button', { class: 'icon-btn', title }, icon(ic, 17)); b.onclick = fn; return b; }
  persist() { store.set('expanded', [...this.expanded]); }
  targetFolder() { const p = app.activePath(); return p ? dirname(p) : (app.meta?.newFileFolder || ''); }

  colorOf(path) { return app.meta?.folderColors?.[path] || null; }

  async refresh() {
    const scroll = this.tree.parentElement?.scrollTop || 0;
    const frag = h('div');
    await this.renderDir('', frag, 0, null);
    this.tree.replaceChildren(...frag.childNodes);
    if (this.tree.parentElement) this.tree.parentElement.scrollTop = scroll;
    this.markActive(app.activePath());
  }

  async renderDir(dir, host, depth, inherited, offset = 0) {
    let data;
    try { data = await api.tree(dir, offset); } catch { return; }
    if (offset === 0) for (const f of data.folders) host.append(await this.folderNode(f, depth, inherited));
    for (const f of data.files) host.append(this.fileNode(f, depth));
    const shown = offset + data.files.length;
    if (shown < data.totalFiles) {
      const more = h('div', { class: 'tree-more', style: { paddingLeft: 10 + depth * 16 + 'px' } }, `显示更多（${shown}/${data.totalFiles}）`);
      more.onclick = async () => { const tmp = h('div'); await this.renderDir(dir, tmp, depth, inherited, shown); more.replaceWith(...tmp.childNodes); };
      host.append(more);
    }
  }

  async folderNode(f, depth, inherited) {
    const color = this.colorOf(f.path) || null;
    const open = this.expanded.has(f.path);
    const title = h('div', { class: 'tree-item folder' + (open ? ' is-open' : '') + (color ? ' has-color' : ''), draggable: true, 'data-path': f.path, style: { paddingLeft: 6 + depth * 16 + 'px', ...(color ? { '--folder-color': color } : {}) } },
      h('span', { class: 'tree-caret', html: iconHTML('chevron-right', 14) }),
      h('span', { class: 'tree-ico', html: iconHTML(open ? 'folder-open' : 'folder', 16) }),
      h('span', { class: 'tree-name' }, f.name),
      f.count != null ? h('span', { class: 'tree-count tabular' }, f.count) : null);
    const children = h('div', { class: 'tree-children', style: inherited || color ? { '--guide-color': color || inherited } : null });
    const wrap = h('div', { class: 'tree-folder' }, title, children);
    if (open) await this.renderDir(f.path, children, depth + 1, color || inherited);
    title.addEventListener('click', async () => {
      if (this.expanded.has(f.path)) { this.expanded.delete(f.path); children.replaceChildren(); title.classList.remove('is-open'); title.querySelector('.tree-ico').innerHTML = iconHTML('folder', 16); }
      else { this.expanded.add(f.path); title.classList.add('is-open'); title.querySelector('.tree-ico').innerHTML = iconHTML('folder-open', 16); await this.renderDir(f.path, children, depth + 1, color || inherited); this.markActive(app.activePath()); }
      this.persist();
    });
    title.addEventListener('contextmenu', e => { e.preventDefault(); this.folderMenu(e, f.path); });
    this.dnd(title, f.path, true);
    return wrap;
  }

  fileNode(f, depth) {
    const ext = f.ext;
    const isMd = ext === 'md';
    const name = isMd ? f.name.slice(0, -3) : f.name;
    const ic = isMd ? 'file-text' : ext === 'base' ? 'database' : ext === 'canvas' ? 'grid' : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext) ? 'image' : 'file';
    const el = h('div', { class: 'tree-item file', draggable: true, 'data-path': f.path, title: f.path, style: { paddingLeft: 22 + depth * 16 + 'px' } },
      h('span', { class: 'tree-ico', html: iconHTML(ic, 15) }),
      h('span', { class: 'tree-name' }, name),
      !isMd ? h('span', { class: 'tree-ext' }, ext.toUpperCase()) : null);
    el.addEventListener('click', e => app.open(f.path, { newTab: e.ctrlKey || e.metaKey }));
    el.addEventListener('auxclick', e => { if (e.button === 1) app.open(f.path, { newTab: true }); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); this.fileMenu(e, f.path); });
    this.dnd(el, f.path, false);
    return el;
  }

  dnd(el, path, isFolder) {
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-vault-path', path); e.dataTransfer.setData('text/plain', `[[${basename(path)}]]`); e.dataTransfer.effectAllowed = 'move'; });
    if (!isFolder) return;
    el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-vault-path')) { e.preventDefault(); el.classList.add('is-drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('is-drop'));
    el.addEventListener('drop', e => { el.classList.remove('is-drop'); this.onDrop(e, path); });
  }
  async onDrop(e, folder) {
    const src = e.dataTransfer.getData('text/x-vault-path');
    if (!src) return;
    e.preventDefault(); e.stopPropagation();
    if (src === folder || folder.startsWith(src + '/') || dirname(src) === folder) return;
    await app.renamePath(src, (folder ? folder + '/' : '') + src.split('/').pop());
  }

  folderMenu(e, path) {
    showMenu(e.clientX, e.clientY, [
      { label: '新建笔记', icon: 'file-plus', onClick: () => app.createNote({ folder: path }) },
      { label: '从模板新建…', icon: 'template', onClick: () => app.newFromTemplate({ folder: path }) },
      { label: '新建文件夹', icon: 'folder-plus', onClick: () => app.createFolder(path) },
      path ? { sep: true } : null,
      path ? { label: '重命名…', icon: 'pencil', onClick: () => app.renameDialog(path) } : null,
      path ? { label: '在此文件夹中搜索', icon: 'search', onClick: () => app.searchFor(`path:"${path}" `) } : null,
      path ? { sep: true } : null,
      path ? { label: '删除文件夹', icon: 'trash', danger: true, onClick: () => app.trashPath(path) } : null,
    ]);
  }
  fileMenu(e, path) {
    showMenu(e.clientX, e.clientY, [
      { label: '在新标签页打开', icon: 'plus', onClick: () => app.open(path, { newTab: true }) },
      { label: '重命名…', icon: 'pencil', onClick: () => app.renameDialog(path) },
      { label: '移动到…', icon: 'folder', onClick: () => app.movePath(path) },
      { label: '复制双链', icon: 'link', onClick: () => { navigator.clipboard?.writeText(`[[${basename(path)}]]`); toast('已复制'); } },
      extname(path) === 'md' ? { label: '打开关系图谱', icon: 'graph', onClick: () => app.openView('graph', { path }) } : null,
      { sep: true },
      { label: '删除', icon: 'trash', danger: true, onClick: () => app.trashPath(path) },
    ]);
  }

  markActive(path) {
    this.tree.querySelectorAll('.tree-item.is-active').forEach(x => x.classList.remove('is-active'));
    if (!path) return;
    const el = this.tree.querySelector(`.tree-item.file[data-path="${CSS.escape(path)}"]`);
    el?.classList.add('is-active');
    return el;
  }

  async reveal(path) {
    const parts = path.split('/');
    let changed = false;
    for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (!this.expanded.has(d)) { this.expanded.add(d); changed = true; } }
    if (!parts[parts.length - 1].includes('.')) { if (!this.expanded.has(path)) { this.expanded.add(path); changed = true; } }
    if (changed) { this.persist(); await this.refresh(); }
    const el = this.markActive(path) || this.tree.querySelector(`.tree-item[data-path="${CSS.escape(path)}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 1200);
  }
}
