// 工作区：标签页、侧栏、命令、快捷键、启动流程
import { h, $, store, toast, bus, basename, dirname, extname, fuzzy, debounce, IMAGE_EXT, relTime } from './util.js';
import { icon, iconHTML, TYPE_ICON } from './icons.js';
import { api, index } from './api.js';
import { app } from './ctx.js';
import { NoteView } from './views/note.js';
import { BaseView } from './views/base.js';
import { HomeView } from './views/home.js';
import { GraphView } from './views/graph.js';
import { CanvasView, TextView, ImageView } from './views/misc.js';
import { Explorer } from './panels/explorer.js';
import { SearchPanel, TagsPanel, OutlinePanel, LinksPanel, LocalGraphPanel } from './panels/side.js';
import { AIPanel, noteMenu, inline, fillNote } from './panels/ai.js';
import { pickList, promptText, confirmBox } from './modals.js';
import { newFromTemplate, insertTemplate, openSettings } from './dialogs.js';
import { invalidateHeat } from './heatmap.js';

const PREFS_VERSION = 2;
const DEFAULT_PREFS = { v: PREFS_VERSION, scheme: 'glass', theme: 'auto', fontSize: 18, readable: true, folderColors: true, rainbowTags: true, linkUnderline: true, leftOpen: true, rightOpen: true, leftWidth: 290, rightWidth: 360, leftTab: 'files', rightTab: 'ai' };
const storedPrefs = store.get('prefs', {});
// 旧版本偏好：切换到新的默认外观（个人网站玻璃风格、更大的字号）
if ((storedPrefs.v || 1) < PREFS_VERSION) { delete storedPrefs.scheme; delete storedPrefs.fontSize; delete storedPrefs.leftWidth; delete storedPrefs.rightWidth; }
app.prefs = { ...DEFAULT_PREFS, ...storedPrefs, v: PREFS_VERSION };

const els = {
  app: $('#app'), ribbon: $('#ribbon'), left: $('#left'), right: $('#right'),
  leftTabs: $('#leftTabs'), leftBody: $('#leftBody'), rightTabs: $('#rightTabs'), rightBody: $('#rightBody'),
  tabbar: $('#tabbar'), host: $('#viewHost'), status: $('#status'), vaultBtn: $('#vaultBtn'),
};

// ---------- 外观 ----------
const mql = matchMedia('(prefers-color-scheme: dark)');
const narrow = matchMedia('(max-width: 760px)');
app.applyPrefs = () => {
  const p = app.prefs, root = document.documentElement;
  const dark = p.theme === 'dark' || (p.theme === 'auto' && mql.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.scheme = p.scheme;
  root.style.setProperty('--note-size', p.fontSize + 'px');
  root.classList.toggle('readable', p.readable);
  root.classList.toggle('no-folder-colors', !p.folderColors);
  root.classList.toggle('rainbow-tags', p.rainbowTags);
  root.classList.toggle('link-underline', p.linkUnderline);
  els.left.classList.toggle('is-collapsed', !p.leftOpen);
  els.right.classList.toggle('is-collapsed', !p.rightOpen);
  els.left.style.width = p.leftWidth + 'px';
  els.right.style.width = p.rightWidth + 'px';
  const tb = $('#themeBtn'); if (tb) tb.replaceChildren(icon(dark ? 'sun' : 'moon', 19));
};
mql.addEventListener('change', () => app.applyPrefs());

// 窄屏下侧栏是临时浮层，不把它的开合状态写回偏好
const savePrefs = () => {
  const p = { ...app.prefs };
  if (narrow.matches) { const old = store.get('prefs', {}); p.leftOpen = old.leftOpen ?? true; p.rightOpen = old.rightOpen ?? true; }
  store.set('prefs', p);
};
app.savePrefs = savePrefs;

// ---------- 面板 ----------
const explorer = new Explorer();
const search = new SearchPanel();
const tags = new TagsPanel();
const outline = new OutlinePanel();
const links = new LinksPanel();
const localGraph = new LocalGraphPanel();
const aiPanel = new AIPanel();
app.aiPanel = aiPanel;
app.ai = { noteMenu, inline, fillNote, run: (k, v) => aiPanel.runAction(k, v) };

const LEFT = { files: ['folder', '文件', explorer], search: ['search', '搜索', search], tags: ['tag', '标签', tags] };
const RIGHT = { ai: ['sparkles', 'AI', aiPanel], outline: ['list', '大纲', outline], links: ['link', '链接', links], graph: ['graph', '图谱', localGraph] };

function buildSideTabs(host, body, defs, key) {
  host.innerHTML = '';
  for (const [k, [ic, label, panel]] of Object.entries(defs)) {
    const b = h('button', { class: 'side-tab', 'data-k': k, title: label }, icon(ic, 16), h('span', null, label));
    b.onclick = () => showSide(host, body, defs, key, k);
    host.append(b);
    panel.el.dataset.k = k;
    body.append(panel.el);
  }
}
function showSide(host, body, defs, key, k) {
  app.prefs[key] = k; savePrefs();
  host.querySelectorAll('.side-tab').forEach(b => b.classList.toggle('active', b.dataset.k === k));
  for (const [kk, [, , panel]] of Object.entries(defs)) panel.el.hidden = kk !== k;
  if (k === 'tags') tags.refresh();
  if (k === 'graph') localGraph.update(app.activeView()); else localGraph.hide?.();
  if (k === 'outline') outline.update(app.activeView());
  if (k === 'links') links.update(app.activeView());
}
app.showLeft = k => { if (!app.prefs.leftOpen) toggleLeft(true); showSide(els.leftTabs, els.leftBody, LEFT, 'leftTab', k); };
app.showRight = k => { if (!app.prefs.rightOpen) toggleRight(true); showSide(els.rightTabs, els.rightBody, RIGHT, 'rightTab', k); };
function toggleLeft(v) { app.prefs.leftOpen = v ?? !app.prefs.leftOpen; savePrefs(); app.applyPrefs(); }
function toggleRight(v) { app.prefs.rightOpen = v ?? !app.prefs.rightOpen; savePrefs(); app.applyPrefs(); if (app.prefs.rightOpen) showSide(els.rightTabs, els.rightBody, RIGHT, 'rightTab', app.prefs.rightTab); }

// ---------- 标签页 ----------
let tabs = [], activeId = null, seq = 0;
const recent = store.get('recent', []);

function viewFor(path, opts = {}) {
  if (!path) return new HomeView();
  const ext = extname(path);
  if (ext === 'md') return new NoteView(path, opts);
  if (ext === 'base' && !opts.asText) return new BaseView(path, opts);
  if (ext === 'canvas') return new CanvasView(path);
  if (IMAGE_EXT.has(ext)) return new ImageView(path);
  if (['base', 'txt', 'css', 'json', 'js', 'excalidraw'].includes(ext)) return new TextView(path);
  return null;
}

app.activeView = () => tabs.find(t => t.id === activeId)?.view || null;
app.activePath = () => { const v = app.activeView(); return v?.path || null; };

app.open = async (path, opts = {}) => {
  const ext = extname(path);
  const existing = tabs.find(t => t.view.path === path && (!!opts.asText) === (t.view.type === 'text' && ext === 'base'));
  if (existing && !opts.newTab) {
    activate(existing.id);
    if (opts.heading && existing.view.scrollToHeading) existing.view.scrollToHeading(opts.heading);
    return existing.view;
  }
  const view = viewFor(path, opts);
  if (!view) { window.open(api.raw(path), '_blank'); return; }
  if (opts.heading) view.pendingHeading = opts.heading;
  const cur = tabs.find(t => t.id === activeId);
  if (cur && !opts.newTab && !cur.pinned) {
    cur.view.destroy?.();
    cur.view.el.remove();
    cur.view = view;
    els.host.append(view.el);
    activate(cur.id, true);
  } else {
    const t = { id: ++seq, view };
    const i = cur ? tabs.indexOf(cur) + 1 : tabs.length;
    tabs.splice(i, 0, t);
    els.host.append(view.el);
    activate(t.id, true);
  }
  await view.load();
  if (view.type !== 'home') pushRecent(path);
  renderTabs(); updateSide();
  return view;
};

app.openView = async (type, opts = {}) => {
  if (type === 'home') {
    const ex = tabs.find(t => t.view.type === 'home');
    if (ex) { activate(ex.id); ex.view.load(); return; }
    const view = new HomeView();
    const t = { id: ++seq, view }; tabs.push(t); els.host.append(view.el); activate(t.id, true); await view.load(); renderTabs();
  }
  if (type === 'graph') {
    const path = opts.path || app.activePath();
    if (!path) { toast('请先打开一篇笔记'); return; }
    const view = new GraphView(path, opts);
    const t = { id: ++seq, view }; tabs.push(t); els.host.append(view.el); activate(t.id, true); await view.load(); renderTabs();
  }
};

function activate(id, silent) {
  activeId = id;
  for (const t of tabs) t.view.el.hidden = t.id !== id;
  const v = app.activeView();
  if (!silent) { v?.onShow?.(); updateSide(); }
  renderTabs();
  explorer.markActive(v?.path);
  updateStatus();
  persistTabs();
  document.title = (v ? v.title + ' - ' : '') + (app.meta?.name || 'AI 版 Obsidian');
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  t.view.destroy?.(); t.view.el.remove();
  if (!tabs.length) { app.openView('home'); return; }
  if (activeId === id) activate(tabs[Math.min(i, tabs.length - 1)].id);
  else renderTabs();
  persistTabs();
}
app.closeActive = () => activeId && closeTab(activeId);

const renderedTabs = new Set();
function renderTabs() {
  els.tabbar.querySelectorAll('.tab').forEach(x => x.remove());
  const add = els.tabbar.querySelector('.tab-add');
  for (const t of tabs) {
    const v = t.view;
    const ic = v.type === 'home' ? 'home' : v.type === 'base' ? 'database' : v.type === 'graph' ? 'graph' : v.type === 'canvas' ? 'grid' : v.type === 'image' ? 'image' : TYPE_ICON[index.typeOf(v.path)] || 'file-text';
    const x = h('button', { class: 'tab-x', title: '关闭' }, icon('x', 13));
    const isNew = !renderedTabs.has(t.id); renderedTabs.add(t.id);
    const el = h('div', { class: 'tab' + (t.id === activeId ? ' active' : '') + (isNew ? ' is-new' : ''), title: v.path || v.title }, h('span', { class: 'tab-ico', html: iconHTML(ic, 14) }), h('span', { class: 'tab-title' }, v.title), x);
    el.onclick = () => activate(t.id);
    el.onauxclick = e => { if (e.button === 1) closeTab(t.id); };
    x.onclick = e => { e.stopPropagation(); closeTab(t.id); };
    els.tabbar.insertBefore(el, add);
  }
  els.tabbar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function persistTabs() {
  store.set('tabs', { list: tabs.map(t => ({ type: t.view.type, path: t.view.path })), active: tabs.findIndex(t => t.id === activeId) });
}
function pushRecent(p) { const i = recent.indexOf(p); if (i >= 0) recent.splice(i, 1); recent.unshift(p); recent.length = Math.min(recent.length, 30); store.set('recent', recent); }

// ---------- 侧栏联动 & 状态栏 ----------
const updateSide = debounce(() => {
  const v = app.activeView();
  const k = app.prefs.rightTab;
  if (!app.prefs.rightOpen) return;
  if (k === 'outline') outline.update(v);
  if (k === 'links') links.update(v);
  if (k === 'graph') localGraph.update(v);
}, 120);
bus.on('note-updated', v => { if (v === app.activeView()) { updateStatus(); if (app.prefs.rightTab === 'outline') outlineSoon(v); } });
const outlineSoon = debounce(v => outline.update(v), 300);
bus.on('file-saved', () => { if (app.prefs.rightTab === 'links') linksSoon(); });
const linksSoon = debounce(() => links.update(app.activeView()), 800);

let backCount = null;
app.setBacklinkCount = n => { backCount = n; updateStatus(); };
let saveState = 'saved', saveText = '';
app.setSaveState = (s, text = '') => { saveState = s; saveText = text; updateStatus(); };
const updateStatus = debounce(() => {
  const v = app.activeView();
  els.status.innerHTML = '';
  if (v?.type === 'note') {
    const s = v.stats();
    if (backCount != null) els.status.append(h('span', { class: 'st-item' }, icon('incoming', 13), ` ${backCount} 个反链`));
    els.status.append(h('span', { class: 'st-item tabular' }, `${s.words.toLocaleString()} 字`), h('span', { class: 'st-item tabular' }, `${s.chars.toLocaleString()} 字符`));
  }
  const label = saveText || { saved: '已保存', saving: '保存中…', dirty: '未保存', error: '保存失败' }[saveState];
  els.status.append(h('span', { class: 'st-item st-save is-' + saveState }, h('i', { class: 'dot' }), label));
}, 80);

// ---------- 文件操作 ----------
async function uniquePath(folder, name, ext = '.md') {
  const base = (folder ? folder + '/' : '') + name;
  let p = base + ext, n = 1;
  while (index.pathSet.has(p)) p = `${base} ${n++}${ext}`;
  return p;
}

app.createNote = async ({ folder = app.meta.newFileFolder || '', name = '未命名', content = '', mode = 'edit', open = true } = {}) => {
  const path = await uniquePath(folder, name);
  try { await api.write(path, content, { create: true }); }
  catch (e) { toast('创建失败：' + e.message, 'error'); return null; }
  await afterFsChange();
  if (!open) return path;
  const v = await app.open(path, { mode });
  if (name === '未命名' && v?.titleInput) { v.titleInput.focus(); v.titleInput.select(); }
  return v;
};
app.createAndOpen = async (linkName, { from } = {}) => {
  const name = linkName.split('/').pop().replace(/\.md$/, '');
  const folder = linkName.includes('/') ? dirname(linkName) : (app.meta.newFileFolder || (from ? dirname(from) : ''));
  const ok = await confirmBox({ title: '创建新笔记', message: `「${name}」还不存在，要在「${folder || '根目录'}」创建它吗？`, okText: '创建' });
  if (ok) await app.createNote({ folder, name });
};
app.createFolder = async parent => {
  const name = await promptText({ title: '新建文件夹', placeholder: '文件夹名称' });
  if (!name) return;
  const p = (parent ? parent + '/' : '') + name;
  await api.mkdir(p);
  explorer.expanded.add(parent); explorer.expanded.add(p); explorer.persist();
  await explorer.refresh();
};
app.renamePath = async (from, to) => {
  try {
    const r = await api.rename(from, to);
    for (const t of tabs) {
      const v = t.view;
      if (v.path === from) { v.path = to; if (v.type === 'note') v.renderAll(); }
      else if (v.path?.startsWith(from + '/')) v.path = to + v.path.slice(from.length);
    }
    await afterFsChange();
    renderTabs();
    for (const t of tabs) if (t.view.type === 'note' && t.view.path !== to && !t.view.dirty) t.view.checkExternal();
    toast(r.updated ? `已重命名，并更新了 ${r.updated} 篇笔记中的双链` : '已重命名', 'success');
    return true;
  } catch (e) { toast('重命名失败：' + e.message, 'error'); const v = tabs.find(t => t.view.path === from)?.view; if (v?.titleInput) v.titleInput.value = v.title; return false; }
};
app.renameDialog = async path => {
  const name = path.split('/').pop();
  const isMd = name.endsWith('.md');
  const next = await promptText({ title: '重命名', value: isMd ? name.slice(0, -3) : name });
  if (!next || next === (isMd ? name.slice(0, -3) : name)) return;
  const dir = dirname(path);
  await app.renamePath(path, (dir ? dir + '/' : '') + next + (isMd ? '.md' : ''));
};
app.movePath = async path => {
  const folders = await api.folders();
  pickList({
    placeholder: `把「${basename(path)}」移动到…`,
    getItems: q => [{ title: '（仓库根目录）', value: '', icon: 'vault' }, ...folders.map(f => ({ title: f, value: f, icon: 'folder' }))].filter(x => !q || fuzzy(q, x.title) >= 0).slice(0, 60),
    onPick: it => { if (it.value == null) return; app.renamePath(path, (it.value ? it.value + '/' : '') + path.split('/').pop()); },
  });
};
app.trashPath = async path => {
  if (!(await confirmBox({ title: '删除', message: `把「${path}」移到仓库的 .trash 文件夹？\n（可以在文件管理器中找回）`, okText: '删除', danger: true }))) return;
  try {
    await api.trash(path);
    for (const t of [...tabs]) if (t.view.path === path || t.view.path?.startsWith(path + '/')) closeTab(t.id);
    await afterFsChange();
    toast('已移到 .trash', 'success');
  } catch (e) { toast('删除失败：' + e.message, 'error'); }
};
async function afterFsChange() { invalidateHeat(); await Promise.all([index.load(), explorer.refresh()]); }
app.afterFsChange = afterFsChange;

app.reveal = path => { app.showLeft('files'); explorer.reveal(path); };
app.searchFor = q => { app.showLeft('search'); search.focus(q); };
app.newFromTemplate = (opts = {}) => newFromTemplate({ folder: opts.folder ?? explorer.targetFolder(), ...opts });
app.insertTemplate = v => { v = v || app.activeView(); if (v?.type === 'note') insertTemplate(v); else toast('请先打开一篇笔记'); };
app.openSettings = s => openSettings(s);
app.randomNote = () => { const n = index.notes; if (!n.length) return; const pool = n.filter(o => !o.p.startsWith(app.meta.templateFolder + '/')); app.open(pool[Math.floor(Math.random() * pool.length)].p); };

app.quickSwitcher = () => pickList({
  placeholder: '输入笔记名称… 回车打开，Ctrl+回车在新标签页打开',
  hints: [['↑↓', '选择'], ['↵', '打开'], ['Ctrl ↵', '新标签页'], ['Esc', '关闭']],
  getItems: q => {
    if (!q) return recent.filter(p => index.pathSet.has(p)).slice(0, 12).map(p => ({ title: basename(p), note: dirname(p), icon: TYPE_ICON[index.typeOf(p)] || 'file-text', path: p, hint: '最近' }));
    const out = [];
    for (const o of index.notes) {
      let s = fuzzy(q, o.n);
      if (o.a) for (const a of o.a) s = Math.max(s, fuzzy(q, a) - 1);
      if (s >= 0) out.push([s, o]);
    }
    for (const p of index.files) { const s = fuzzy(q, p.split('/').pop()); if (s >= 0) out.push([s - 5, { p, n: p.split('/').pop() }]); }
    out.sort((a, b) => b[0] - a[0]);
    const items = out.slice(0, 40).map(([, o]) => ({ title: o.n, note: dirname(o.p), icon: o.p.endsWith('.md') ? TYPE_ICON[o.t] || 'file-text' : o.p.endsWith('.base') ? 'database' : 'image', path: o.p }));
    if (!out.some(([, o]) => o.n === q)) items.push({ title: `新建笔记「${q}」`, icon: 'file-plus', create: q });
    return items;
  },
  onPick: (it, e) => { if (it.path) app.open(it.path, { newTab: e.ctrlKey || e.metaKey }); else if (it.create) app.createNote({ name: it.create.replace(/[\\/:*?"<>|]/g, '') }); },
});

const COMMANDS = () => [
  ['新建笔记', 'file-plus', 'Ctrl+N', () => app.createNote({ folder: explorer.targetFolder() })],
  ['从模板新建', 'template', 'Ctrl+Shift+N', () => app.newFromTemplate()],
  ['AI 写卡片', 'sparkles', '', () => app.newFromTemplate({ ai: true })],
  ['插入模板', 'template', 'Ctrl+T', () => app.insertTemplate()],
  ['快速打开', 'search', 'Ctrl+O', () => app.quickSwitcher()],
  ['全局搜索', 'search', 'Ctrl+Shift+F', () => app.showLeft('search')],
  ['切换阅读 / 编辑', 'book-open', 'Ctrl+E', () => app.activeView()?.toggleMode?.()],
  ['AI：按模板补全当前卡片', 'wand', '', () => aiPanel.runAction('fill')],
  ['AI：直接写入当前卡片', 'sparkles', '', () => { const v = app.activeView(); if (v?.type === 'note') fillNote(v); }],
  ['AI：生成相关概念双链', 'link', '', () => aiPanel.runAction('links')],
  ['AI：总结当前笔记', 'list', '', () => aiPanel.runAction('summary')],
  ['AI：费曼式解释', 'bulb', '', () => aiPanel.runAction('feynman')],
  ['AI：出题自测', 'target', '', () => aiPanel.runAction('quiz')],
  ['AI：改写选中内容', 'feather', 'Ctrl+J', () => { const v = app.activeView(); if (v?.type === 'note') inline(v); }],
  ['打开 AI 助手', 'sparkles', 'Ctrl+Shift+A', () => app.showRight('ai')],
  ['打开首页', 'home', '', () => app.openView('home')],
  ['打开关系图谱', 'graph', '', () => app.openView('graph')],
  ['随机打开一张卡片', 'dice', '', () => app.randomNote()],
  ['在文件列表中显示当前笔记', 'folder-open', '', () => { const p = app.activePath(); if (p) app.reveal(p); }],
  ['显示大纲', 'list', '', () => app.showRight('outline')],
  ['显示反向链接', 'link', '', () => app.showRight('links')],
  ['切换左侧栏', 'panel-left', 'Ctrl+\\', () => toggleLeft()],
  ['切换右侧栏', 'panel-right', '', () => toggleRight()],
  ['切换深色 / 浅色', 'moon', '', () => toggleTheme()],
  ['重命名当前文件', 'pencil', '', () => { const p = app.activePath(); if (p) app.renameDialog(p); }],
  ['移动当前文件', 'folder', '', () => { const p = app.activePath(); if (p) app.movePath(p); }],
  ['删除当前文件', 'trash', '', () => { const p = app.activePath(); if (p) app.trashPath(p); }],
  ['关闭当前标签页', 'x', 'Ctrl+W', () => app.closeActive()],
  ['设置', 'settings', 'Ctrl+,', () => openSettings()],
  ['AI 模型设置', 'bot', '', () => openSettings('ai')],
  ['打开其他仓库', 'vault', '', () => openSettings('vault')],
];
app.commandPalette = () => pickList({
  placeholder: '输入命令…',
  getItems: q => COMMANDS().map(([t, ic, k, fn]) => ({ title: t, icon: ic, hint: k, fn, s: fuzzy(q, t) })).filter(x => !q || x.s >= 0).sort((a, b) => q ? b.s - a.s : 0),
  onPick: it => it.fn?.(),
});

function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  app.prefs.theme = dark ? 'light' : 'dark'; savePrefs(); app.applyPrefs();
}

// ---------- 仓库 ----------
app.refreshMeta = async () => { app.meta = await api.info(); renderVaultBtn(); return app.meta; };
app.refreshAIStatus = async () => { try { aiPanel.setStatus(await api.settings()); } catch { } };
app.switchVault = async target => {
  try {
    if (api.mode === 'browser') {
      // 纯前端模式：先弹出选择文件夹（必须紧跟用户点击），取消则保持原样
      const r = await api.openVault(target);
      if (r?.cancelled) return;
      for (const t of tabs) t.view.destroy?.();
    } else {
      for (const t of tabs) t.view.destroy?.();
      await api.openVault(target);
    }
    store.set('tabs', null); store.set('expanded', []);
    location.reload();
  } catch (e) { toast(e.message, 'error'); }
};
app.reloadAll = async () => { await app.refreshMeta(); await afterFsChange(); };

function renderVaultBtn() {
  els.vaultBtn.replaceChildren(...[icon('vault', 16), h('span', { class: 'vault-name' }, app.meta.name), app.meta.isSample ? h('span', { class: 'pill' }, '示例') : null, icon('chevron-down', 14)].filter(Boolean));
}

async function waitIndex() {
  while (true) {
    const m = await app.refreshMeta();
    if (m.status.state === 'ready') return;
    els.status.textContent = `正在建立索引… ${m.status.done}/${m.status.total || '?'}`;
    await new Promise(r => setTimeout(r, 700));
  }
}

// ---------- 快捷键 ----------
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  const inModal = document.querySelector('.modal-overlay');
  if (inModal && k !== 'p' && k !== 'o') return;
  const map = {
    o: () => app.quickSwitcher(), p: () => app.commandPalette(),
    n: () => e.shiftKey ? app.newFromTemplate() : app.createNote({ folder: explorer.targetFolder() }),
    t: () => app.insertTemplate(), w: () => app.closeActive(), ',': () => openSettings(),
    '\\': () => toggleLeft(),
    e: () => app.activeView()?.toggleMode?.(),
    f: () => { if (e.shiftKey) app.showLeft('search'); else return false; },
    a: () => { if (e.shiftKey) app.showRight('ai'); else return false; },
    j: () => { const v = app.activeView(); if (v?.type === 'note') inline(v); },
    s: () => { const v = app.activeView(); v?.saveSoon?.flush(); },
  };
  if (map[k]) { const r = map[k](); if (r !== false) e.preventDefault(); }
});
window.addEventListener('focus', () => app.activeView()?.onShow?.());
window.addEventListener('beforeunload', () => { for (const t of tabs) if (t.view.dirty) t.view.saveSoon.flush(); });

// ---------- 侧栏拖拽调宽 ----------
for (const r of document.querySelectorAll('.resizer')) {
  r.addEventListener('mousedown', e => {
    e.preventDefault();
    const side = r.dataset.side, startX = e.clientX, startW = app.prefs[side + 'Width'];
    document.body.classList.add('is-resizing');
    const move = ev => { const d = side === 'left' ? ev.clientX - startX : startX - ev.clientX; app.prefs[side + 'Width'] = Math.max(200, Math.min(620, startW + d)); app.applyPrefs(); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('is-resizing'); savePrefs(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
}

// ---------- 启动 ----------
function buildRibbon() {
  const b = (ic, title, fn, id) => { const x = h('button', { class: 'ribbon-btn', title, id }, icon(ic, 19)); x.onclick = fn; return x; };
  els.ribbon.append(
    b('panel-left', '切换左侧栏 (Ctrl+\\)', () => toggleLeft()),
    b('home', '首页', () => app.openView('home')),
    b('search', '快速打开 (Ctrl+O)', () => app.quickSwitcher()),
    b('file-plus', '从模板新建 (Ctrl+Shift+N)', () => app.newFromTemplate()),
    b('sparkles', 'AI 写卡片', () => app.newFromTemplate({ ai: true })),
    b('database', '笔记数据库', async () => { const list = await api.bases(); pickList({ placeholder: '打开数据库视图…', getItems: q => list.filter(x => !q || fuzzy(q, x.name) >= 0).map(x => ({ title: x.name, note: dirname(x.path), icon: 'database', path: x.path })), onPick: it => app.open(it.path) }); }),
    b('graph', '关系图谱', () => app.openView('graph')),
    b('dice', '随机漫步', () => app.randomNote()),
    b('command', '命令面板 (Ctrl+P)', () => app.commandPalette()),
    h('div', { class: 'ribbon-spacer' }),
    b('moon', '切换深色 / 浅色', toggleTheme, 'themeBtn'),
    b('settings', '设置 (Ctrl+,)', () => openSettings()),
  );
  const addTab = h('button', { class: 'tab-add', title: '新标签页' }, icon('plus', 16));
  addTab.onclick = () => { const v = new HomeView(); const t = { id: ++seq, view: v }; tabs.push(t); els.host.append(v.el); activate(t.id, true); v.load(); renderTabs(); };
  const rightToggle = h('button', { class: 'icon-btn tabbar-right', title: '切换右侧栏' }, icon('panel-right', 17));
  rightToggle.onclick = () => toggleRight();
  const leftToggle = h('button', { class: 'icon-btn mobile-nav', title: '文件' }, icon('menu', 17));
  leftToggle.onclick = () => toggleLeft();
  els.tabbar.append(leftToggle, addTab, h('div', { class: 'tabbar-spacer' }), rightToggle);
  // 窄屏：侧栏作为浮层，点击工作区收起
  if (narrow.matches) { app.prefs.leftOpen = false; app.prefs.rightOpen = false; }
  document.querySelector('.workspace').addEventListener('mousedown', () => { if (narrow.matches && (app.prefs.leftOpen || app.prefs.rightOpen)) { app.prefs.leftOpen = false; app.prefs.rightOpen = false; app.applyPrefs(); } });
  els.vaultBtn.onclick = () => openSettings('vault');
}

async function boot() {
  buildRibbon();
  app.applyPrefs();
  buildSideTabs(els.leftTabs, els.leftBody, LEFT, 'leftTab');
  buildSideTabs(els.rightTabs, els.rightBody, RIGHT, 'rightTab');
  showSide(els.leftTabs, els.leftBody, LEFT, 'leftTab', app.prefs.leftTab);
  await app.refreshMeta();
  app.refreshAIStatus();
  explorer.refresh();
  await waitIndex();
  await index.load();
  explorer.refresh();
  showSide(els.rightTabs, els.rightBody, RIGHT, 'rightTab', app.prefs.rightTab);
  // 深链接：#path=<笔记路径>&mode=read|edit|source
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('path') && index.pathSet.has(hash.get('path'))) {
    await app.open(hash.get('path'), { newTab: true, mode: hash.get('mode') || undefined });
    app.setSaveState('saved');
    return;
  }
  const saved = store.get('tabs', null);
  const list = (saved?.list || []).filter(t => t.type === 'home' || t.type === 'graph' ? true : index.pathSet.has(t.path));
  if (!list.length) await app.openView('home');
  else {
    for (const t of list) {
      if (t.type === 'home') await app.openView('home');
      else if (t.type === 'graph') await app.openView('graph', { path: t.path });
      else await app.open(t.path, { newTab: true, asText: t.type === 'text' });
    }
    const a = tabs[Math.max(0, Math.min(saved.active, tabs.length - 1))];
    if (a) activate(a.id);
  }
  app.setSaveState('saved');
  if (!aiPanel.configured) setTimeout(() => toast('提示：在 设置 → AI 模型 中填写 API Key 即可启用 AI 功能'), 1200);
}
boot().catch(e => { console.error(e); toast('启动失败：' + e.message, 'error', 6000); });

export { relTime };
