// 笔记视图：阅读 / 编辑 / 分屏，属性面板，行内标题重命名，自动保存
import { h, esc, debounce, splitFM, toast, bus, basename, dirname, store } from '../util.js';
import { icon, iconHTML, TYPE_ICON } from '../icons.js';
import { api, index } from '../api.js';
import { renderMarkdown, enhance, headingsOf, wordCount } from '../markdown.js';
import { createEditor } from '../editor.js';
import { app } from '../ctx.js';
import { menuAt, confirmBox, openModal } from '../modals.js';
import { PROP_VALUES } from '../schema.js';

const PROP_ICON = { date: 'calendar', tags: 'tag', aliases: 'link', cover: 'image', 类型: 'layers', states: 'clock', 状态: 'clock' };

function yamlScalar(v) {
  if (v === '' || v == null) return '';
  if (/^[\[\]{}>|*&!%@`#,]|: | #|^\s|\s$|^(true|false|null|\d+(\.\d+)?)$/i.test(v) || v.includes('"')) return JSON.stringify(v);
  return v;
}

// 行级修改 frontmatter，尽量不改动用户原有格式
export function setProperty(text, key, value) {
  const { hasFM, fmText, fmEnd } = splitFM(text);
  const line = `${key}: ${Array.isArray(value) ? '' : yamlScalar(value)}`.replace(/\s+$/, '') + (Array.isArray(value) ? '\n' + value.map(v => `  - ${yamlScalar(String(v))}`).join('\n') : '');
  if (!hasFM) return `---\n${line}\n---\n` + text;
  const lines = fmText.split('\n');
  const kre = new RegExp(`^["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`);
  const i = lines.findIndex(l => kre.test(l));
  if (i >= 0) {
    let j = i + 1;
    while (j < lines.length && /^\s+(-|\S)/.test(lines[j]) && !/^\S/.test(lines[j])) j++;
    lines.splice(i, j - i, line);
  } else lines.push(line);
  return `---\n${lines.join('\n')}\n---\n` + text.slice(fmEnd);
}
export function removeProperty(text, key) {
  const { hasFM, fmText, fmEnd } = splitFM(text);
  if (!hasFM) return text;
  const lines = fmText.split('\n');
  const kre = new RegExp(`^["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`);
  const i = lines.findIndex(l => kre.test(l));
  if (i < 0) return text;
  let j = i + 1;
  while (j < lines.length && /^\s+/.test(lines[j])) j++;
  lines.splice(i, j - i);
  return `---\n${lines.join('\n')}\n---\n` + text.slice(fmEnd);
}

function valueChips(v, from) {
  const wrap = h('div', { class: 'prop-values' });
  const arr = Array.isArray(v) ? v : [v];
  for (const x of arr) {
    if (x == null || x === '') continue;
    const s = x instanceof Date ? x.toISOString().slice(0, 10) : String(x);
    const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(s.trim());
    if (m) {
      const p = index.resolve(m[1], from);
      wrap.append(h('a', { class: 'prop-chip internal-link' + (p ? '' : ' is-unresolved'), 'data-href': m[1], 'data-path': p || null }, m[2] || m[1]));
    } else if (/^https?:\/\//.test(s)) wrap.append(h('a', { class: 'prop-chip external-link', href: s, target: '_blank', rel: 'noopener' }, s.replace(/^https?:\/\//, '').slice(0, 40)));
    else wrap.append(h('span', { class: Array.isArray(v) ? 'prop-chip' : 'prop-text' }, s));
  }
  return wrap;
}

let previewEl, previewTimer;
export function attachHoverPreview(root) {
  root.addEventListener('mouseover', e => {
    const a = e.target.closest('a.internal-link[data-path], .cm-lp-wikilink[data-path]');
    if (!a || a.closest('.hover-preview')) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => showPreview(a), 550);
    a.addEventListener('mouseleave', () => { clearTimeout(previewTimer); setTimeout(() => { if (previewEl && !previewEl.matches(':hover')) hidePreview(); }, 250); }, { once: true });
  });
}
document.addEventListener('mousedown', e => { clearTimeout(previewTimer); if (!previewEl?.contains(e.target)) hidePreview(); }, true);
async function showPreview(a) {
  const p = a.dataset.path;
  if (!p || !p.endsWith('.md') || !a.isConnected || !a.offsetParent || !a.matches(':hover')) return;
  hidePreview();
  previewEl = h('div', { class: 'popover hover-preview' });
  previewEl.addEventListener('mouseleave', hidePreview);
  document.body.append(previewEl);
  const r = a.getBoundingClientRect();
  const left = Math.min(r.left, innerWidth - 460);
  const below = r.bottom + 360 < innerHeight;
  Object.assign(previewEl.style, { left: Math.max(8, left) + 'px', top: (below ? r.bottom + 6 : Math.max(8, r.top - 366)) + 'px' });
  try {
    const { content } = await api.read(p);
    if (!previewEl) return;
    const body = h('div', { class: 'markdown-rendered', html: renderMarkdown(splitFM(content).body.slice(0, 4000), p) });
    previewEl.append(h('div', { class: 'hp-title' }, basename(p)), body);
    enhance(body, p, 2);
  } catch { hidePreview(); }
}
function hidePreview() { previewEl?.remove(); previewEl = null; }

const MODES = [['read', 'book-open', '阅读', '阅读视图'], ['edit', 'pencil', '编辑', '实时预览编辑（Ctrl+E 切换）'], ['source', 'file-text', '源码', 'Markdown 源码']];

export class NoteView {
  constructor(path, opts = {}) {
    this.path = path;
    this.type = 'note';
    let m = opts.mode || store.get('defaultMode', 'read');
    if (!MODES.some(x => x[0] === m)) m = 'edit';
    this.mode = m;
    this.content = '';
    this.mtime = 0;
    this.dirty = false;
    this.el = h('div', { class: 'view view-note' });
    this.saveSoon = debounce(() => this.save(), 700);
    this.build();
  }

  get title() { return basename(this.path); }

  build() {
    const crumbs = h('div', { class: 'crumbs' });
    this.crumbs = crumbs;
    this.modeSeg = h('div', { class: 'seg' },
      ...MODES.map(([m, ic, t, tip]) => {
        const b = h('button', { class: 'seg-btn', 'data-mode': m, title: tip }, icon(ic, 15), h('span', null, t));
        b.onclick = () => this.setMode(m);
        return b;
      }));
    const aiBtn = h('button', { class: 'btn btn-sm btn-ai', title: 'AI 助手' }, icon('sparkles', 15), h('span', null, 'AI'));
    aiBtn.onclick = () => menuAt(aiBtn, app.ai.noteMenu(this));
    const more = h('button', { class: 'icon-btn', title: '更多' }, icon('more', 18));
    more.onclick = () => menuAt(more, this.moreMenu());
    this.header = h('div', { class: 'view-header' }, crumbs, h('div', { class: 'view-actions' }, aiBtn, this.modeSeg, more));

    this.titleInput = h('input', { class: 'inline-title', spellcheck: false });
    this.titleInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.titleInput.blur(); if (this.editor) setTimeout(() => this.editor.focus(), 0); }
      if (e.key === 'Escape') { this.titleInput.value = this.title; this.titleInput.blur(); }
    });
    this.titleInput.addEventListener('blur', () => this.commitTitle());
    this.cover = h('div', { class: 'note-cover' });
    this.props = h('div', { class: 'properties' });
    this.reading = h('div', { class: 'markdown-rendered' });
    this.editorHost = h('div', { class: 'editor-host' });
    this.body = h('div', { class: 'note-body' }, this.editorHost, this.reading);
    this.content_ = h('div', { class: 'view-content' }, this.cover, this.titleInput, this.props, this.body);
    this.scroll = h('div', { class: 'view-scroll' }, this.content_);
    this.el.append(this.header, this.scroll);

    for (const root of [this.reading, this.props, this.editorHost]) attachHoverPreview(root);
    for (const root of [this.reading, this.props]) root.addEventListener('click', e => this.onClick(e));
    this.editorHost.addEventListener('click', e => { if (e.target.closest('.cm-lp-props, .cm-lp-block')) this.onClick(e); });
    this.reading.addEventListener('change', e => { if (e.target.classList.contains('task-checkbox')) this.toggleTask(e.target); });
    // 点击正文下方的空白处：光标跳到文末
    this.scroll.addEventListener('mousedown', e => {
      if (this.mode === 'read' || !this.editor || (e.target !== this.scroll && e.target !== this.content_)) return;
      e.preventDefault();
      this.editor.setSelection(this.editor.view.state.doc.length);
      this.editor.focus();
    });
  }

  async load() {
    try {
      const r = await api.read(this.path);
      this.content = r.content; this.mtime = r.mtime; this.dirty = false;
    } catch (e) {
      this.content = ''; this.missing = true;
      this.reading.innerHTML = `<div class="empty-state">${iconHTML('file', 32)}<p>文件不存在或无法读取：${esc(this.path)}</p></div>`;
    }
    this.renderAll();
  }

  renderAll() {
    this.renderCrumbs();
    this.titleInput.value = this.title;
    this.editor?.setPath(this.path);
    this.modeSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === this.mode));
    this.el.dataset.mode = this.mode;
    this.renderCover();
    if (this.mode === 'read') {
      this.props.replaceChildren(this.propsElement(this.content, true));
      this.renderReading();
      this.editor?.destroy(); this.editorHost.innerHTML = ''; this.editor = null;
    } else {
      this.props.innerHTML = '';
      this.ensureEditor();
    }
    bus.emit('note-updated', this);
  }

  renderCrumbs() {
    this.crumbs.innerHTML = '';
    const parts = this.path.split('/');
    parts.forEach((seg, i) => {
      const last = i === parts.length - 1;
      const el = h('span', { class: 'crumb' + (last ? ' is-last' : '') }, last ? basename(seg) : seg);
      if (!last) el.onclick = () => app.reveal(parts.slice(0, i + 1).join('/'));
      this.crumbs.append(el);
      if (!last) this.crumbs.append(h('span', { class: 'crumb-sep' }, '/'));
    });
  }

  renderCover() {
    const { fm } = splitFM(this.content);
    this.cover.innerHTML = '';
    const coverV = fm.cover;
    if (!coverV || this.mode === 'source') return;
    const m = /\[\[([^\]|]+)/.exec(String(coverV));
    const target = m ? m[1] : String(coverV);
    const p = /^https?:/.test(target) ? null : index.resolve(target, this.path);
    const src = p ? api.raw(p) : /^https?:/.test(target) ? target : null;
    if (src) this.cover.append(h('img', { src, alt: '封面', loading: 'lazy' }));
  }

  // 属性表：阅读模式放在正文上方；实时预览中由编辑器把 frontmatter 渲染成同样的表
  propsElement(text, showWhenEmpty) {
    const { fm, hasFM } = splitFM(text);
    const box = h('div', { class: 'props-box' });
    if (!hasFM) { if (showWhenEmpty) box.append(this.addPropButton()); return box; }
    box.append(h('div', { class: 'props-head' }, h('span', null, 'Properties · 属性')));
    for (const [k, v] of Object.entries(fm)) {
      const valEl = valueChips(v, this.path);
      const row = h('div', { class: 'prop-row' },
        h('div', { class: 'prop-key' }, icon(PROP_ICON[k] || (Array.isArray(v) ? 'list' : 'file-text'), 15), h('span', null, k)),
        valEl);
      if (!Array.isArray(v) && (v == null || typeof v !== 'object' || v instanceof Date)) {
        valEl.classList.add('is-editable');
        valEl.title = '点击编辑';
        valEl.addEventListener('mousedown', e => { if (!e.target.closest('a')) e.preventDefault(); });
        valEl.addEventListener('click', e => { if (e.target.closest('a')) return; this.editProp(k, v, valEl); });
      }
      row.querySelector('.prop-key').addEventListener('contextmenu', e => {
        e.preventDefault();
        import('../modals.js').then(({ showMenu }) => showMenu(e.clientX, e.clientY, [{ label: '删除属性', icon: 'trash', danger: true, onClick: () => this.setContent(removeProperty(this.content, k)) }]));
      });
      box.append(row);
    }
    box.append(this.addPropButton());
    return box;
  }

  addPropButton() {
    const b = h('button', { class: 'prop-add' }, icon('plus', 14), '添加属性');
    b.addEventListener('mousedown', e => e.preventDefault());
    b.onclick = async () => {
      const key = await import('../modals.js').then(m => m.promptText({ title: '添加属性', placeholder: '属性名，例如 states / 书籍 / 研究领域' }));
      if (key) this.setContent(setProperty(this.content, key, ''));
    };
    return b;
  }

  editProp(k, v, valEl) {
    const cur = v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? '');
    const listId = 'dl-' + Math.random().toString(36).slice(2);
    const input = h('input', { class: 'input prop-input', value: String(cur), list: PROP_VALUES[k] ? listId : null });
    const dl = PROP_VALUES[k] ? h('datalist', { id: listId }, ...PROP_VALUES[k].map(o => h('option', { value: o }))) : null;
    valEl.replaceWith(input); if (dl) input.after(dl);
    input.focus(); input.select();
    let done = false;
    const commit = save => {
      if (done) return; done = true;
      if (save && input.value !== String(cur)) this.setContent(setProperty(this.content, k, input.value));
      else if (this.mode === 'read') this.props.replaceChildren(this.propsElement(this.content, true));
      else this.editor?.refresh();
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) commit(true); if (e.key === 'Escape') commit(false); });
    input.addEventListener('blur', () => commit(true));
  }

  renderReading() {
    const { body } = splitFM(this.content);
    this.reading.innerHTML = body.trim() ? renderMarkdown(body, this.path) : '<p class="muted empty-hint">空白笔记 · 按 Ctrl+E 开始编辑，或使用右上角 AI 按模板补全</p>';
    enhance(this.reading, this.path);
    if (this.pendingHeading) { const hd = this.pendingHeading; this.pendingHeading = null; requestAnimationFrame(() => this.scrollToHeading(hd)); }
  }

  ensureEditor() {
    const mode = this.mode === 'source' ? 'source' : 'live';
    if (this.editor) {
      if (this.editor.value !== this.content) this.editor.setValue(this.content);
      if (this.editorMode !== mode) { this.editor.setMode(mode); this.editorMode = mode; }
      return;
    }
    this.editorMode = mode;
    this.editor = createEditor({
      value: this.content, path: this.path, mode,
      attachmentFolder: app.meta?.attachmentFolder,
      renderProps: text => this.propsElement(text, false),
      onChange: v => { this.content = v; this.dirty = true; this.saveSoon(); bus.emit('note-updated', this); app.setSaveState('dirty'); },
      onSave: () => this.saveSoon.flush(),
      onAction: a => { if (a === 'ai') app.ai.inline(this); if (a === 'toggle') this.setMode('read'); },
      onOpen: (t, e) => this.openTarget(t, e),
    });
    this.editorHost.innerHTML = '';
    this.editorHost.append(this.editor.el);
    if (this.pendingHeading) { const hd = this.pendingHeading; this.pendingHeading = null; requestAnimationFrame(() => this.scrollToHeading(hd)); }
  }

  openTarget(t, e = {}) {
    if (t.tag) return app.searchFor('tag:#' + t.tag);
    if (t.url) {
      if (/^(https?:|mailto:)/i.test(t.url)) window.open(t.url, '_blank', 'noopener');
      else { let u = t.url; try { u = decodeURIComponent(u); } catch { } const p = index.resolve(u, this.path); if (p) app.open(p, { newTab: e.ctrlKey || e.metaKey }); }
      return;
    }
    if (t.path) { if (t.path === this.path && t.heading) return this.scrollToHeading(t.heading); return app.open(t.path, { newTab: e.ctrlKey || e.metaKey, heading: t.heading || undefined, mode: t.path.endsWith('.md') ? this.mode : undefined }); }
    if (t.href) app.createAndOpen(t.href, { from: this.path });
  }

  setMode(m) {
    if (m === this.mode) return;
    if (this.dirty) this.saveSoon.flush();
    this.mode = m;
    store.set('defaultMode', m);
    this.renderAll();
    if (m !== 'read') setTimeout(() => this.editor?.focus(), 20);
  }
  toggleMode() { this.setMode(this.mode === 'read' ? 'edit' : 'read'); }

  // 统一修改入口：编辑模式下走编辑器（保留撤销），否则直接保存并重绘
  setContent(text, { save = true } = {}) {
    this.content = text;
    this.dirty = true;
    if (this.editor && this.mode !== 'read') { this.editor.replaceAll(text); this.renderCover(); }
    else this.renderAll();
    if (save) this.saveSoon.flush();
  }

  async save() {
    if (!this.dirty || this.missing) return;
    const content = this.content;
    app.setSaveState('saving');
    try {
      const r = await api.write(this.path, content, { expectMtime: this.mtime });
      this.mtime = r.mtime;
      if (this.content === content) this.dirty = false;
      app.setSaveState('saved');
      bus.emit('file-saved', this.path);
    } catch (e) {
      if (e.status === 409) {
        app.setSaveState('dirty');
        const ok = await confirmBox({ title: '文件已在别处修改', message: '这篇笔记在其他地方（比如桌面版 Obsidian）被修改过。\n要用当前内容覆盖吗？选择“取消”将重新载入磁盘上的版本。', okText: '覆盖' });
        if (ok) { const r = await api.write(this.path, this.content, { force: true }); this.mtime = r.mtime; this.dirty = false; app.setSaveState('saved'); }
        else { await this.load(); }
      } else { app.setSaveState('error'); toast('保存失败：' + e.message, 'error'); }
    }
  }

  // 窗口重新获得焦点时检查磁盘变化
  async checkExternal() {
    if (this.dirty || this.missing) return;
    try {
      const r = await api.read(this.path);
      if (r.mtime !== this.mtime && r.content !== this.content) { this.content = r.content; this.mtime = r.mtime; if (this.editor) this.editor.setValue(r.content); this.renderAll(); }
      else this.mtime = r.mtime;
    } catch { }
  }

  async commitTitle() {
    const name = this.titleInput.value.trim().replace(/[\\/:*?"<>|]/g, '');
    if (!name || name === this.title) { this.titleInput.value = this.title; return; }
    const dir = dirname(this.path);
    const to = (dir ? dir + '/' : '') + name + '.md';
    await app.renamePath(this.path, to);
  }

  onClick(e) {
    const a = e.target.closest('a');
    if (!a) return;
    if (a.classList.contains('tag')) { e.preventDefault(); app.searchFor('tag:#' + a.dataset.tag); return; }
    if (a.classList.contains('internal-link')) {
      e.preventDefault();
      const heading = a.dataset.heading;
      if (a.dataset.path) {
        if (a.dataset.path === this.path && heading) return this.scrollToHeading(heading);
        app.open(a.dataset.path, { newTab: e.ctrlKey || e.metaKey, heading });
      } else if (a.dataset.href) app.createAndOpen(a.dataset.href, { from: this.path });
    }
  }

  scrollToHeading(text) {
    if (this.mode !== 'read') {
      const hs = headingsOf(this.content);
      const t = hs.find(x => x.text.trim() === text.trim());
      if (t) this.editor?.gotoLine(t.line + (splitFM(this.content).hasFM ? splitFM(this.content).fmText.split('\n').length + 2 : 0));
      return;
    }
    const target = [...this.reading.querySelectorAll('.md-heading')].find(x => x.textContent.trim() === text.trim());
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1200); }
  }
  scrollToHeadingIndex(i, line) {
    if (this.mode === 'read') {
      const t = this.reading.querySelectorAll('.md-heading')[i];
      t?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      const { hasFM, fmText } = splitFM(this.content);
      this.editor?.gotoLine(line + (hasFM ? fmText.split('\n').length + 2 : 0));
    }
  }

  toggleTask(cb) {
    const boxes = [...this.reading.querySelectorAll('.task-checkbox')];
    const n = boxes.indexOf(cb);
    if (n < 0) return;
    const lines = this.content.split('\n');
    let k = -1, inCode = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) inCode = !inCode;
      if (inCode) continue;
      if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(lines[i]) && ++k === n) {
        lines[i] = lines[i].replace(/\[[ xX]\]/, cb.checked ? '[x]' : '[ ]');
        this.content = lines.join('\n'); this.dirty = true; this.saveSoon.flush();
        break;
      }
    }
  }

  // ---------- 给 AI 用的读写接口 ----------
  getSelection() { return this.editor && this.mode !== 'read' ? this.editor.selection() : (window.getSelection()?.toString() || ''); }
  insertAtCursor(text) {
    if (this.editor && this.mode !== 'read') { this.editor.insert(text); return; }
    this.appendText(text);
  }
  replaceSelection(text) {
    if (this.editor && this.mode !== 'read' && this.editor.selection()) { this.editor.insert(text); return true; }
    return false;
  }
  appendText(text) { this.setContent(this.content.replace(/\s*$/, '') + '\n\n' + text.trim() + '\n'); }
  replaceBody(text) {
    const { hasFM, fmEnd } = splitFM(this.content);
    this.setContent((hasFM ? this.content.slice(0, fmEnd) : '') + text.trim() + '\n');
  }
  stats() { return { ...wordCount(this.content), headings: headingsOf(this.content) }; }

  moreMenu() {
    const p = this.path;
    return [
      { label: '重命名…', icon: 'pencil', onClick: () => { this.titleInput.focus(); this.titleInput.select(); } },
      { label: '移动到…', icon: 'folder', onClick: () => app.movePath(p) },
      { label: '插入模板', icon: 'template', hint: 'Ctrl+T', onClick: () => app.insertTemplate(this) },
      { sep: true },
      { label: '打开关系图谱', icon: 'graph', onClick: () => app.openView('graph', { path: p }) },
      { label: '在文件列表中显示', icon: 'folder-open', onClick: () => app.reveal(p) },
      { label: '复制双链', icon: 'link', onClick: () => { navigator.clipboard?.writeText(`[[${this.title}]]`); toast('已复制 [[' + this.title + ']]'); } },
      { label: '查看源码信息', icon: 'info', onClick: () => this.showInfo() },
      { sep: true },
      { label: '删除笔记', icon: 'trash', danger: true, onClick: () => app.trashPath(p) },
    ];
  }

  showInfo() {
    const s = this.stats();
    openModal({ title: '笔记信息', width: 420, body: h('div', { class: 'info-grid' },
      ...[['路径', this.path], ['字数', s.words], ['字符', s.chars], ['标题数', s.headings.length], ['类型', splitFM(this.content).fm['类型'] || '—']].flatMap(([k, v]) => [h('div', { class: 'muted' }, k), h('div', { class: 'tabular' }, String(v))])) });
  }

  onShow() { this.checkExternal(); }
  destroy() { if (this.dirty) this.saveSoon.flush(); }
}

export function typeIcon(path) { return TYPE_ICON[index.typeOf(path)] || 'file-text'; }
