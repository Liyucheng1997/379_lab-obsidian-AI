// 侧栏面板：搜索、标签、大纲、反向链接 / 出链、局部图谱
import { h, esc, debounce, basename, splitFM, store, collator } from '../util.js';
import { icon, iconHTML, TYPE_ICON } from '../icons.js';
import { api, index } from '../api.js';
import { app } from '../ctx.js';
import { headingsOf, tagHue } from '../markdown.js';
import { drawGraph } from '../views/graph.js';

export class SearchPanel {
  constructor() {
    this.el = h('div', { class: 'panel search-panel' });
    this.input = h('input', { class: 'input search-input', placeholder: '搜索全部笔记…', spellcheck: false });
    this.info = h('div', { class: 'search-info muted' });
    this.list = h('div', { class: 'search-results' });
    const help = h('div', { class: 'search-help muted' },
      h('div', null, '支持：', h('code', null, 'tag:#标签'), ' ', h('code', null, 'path:文件夹'), ' ', h('code', null, 'file:名称'), ' ', h('code', null, '[类型:书籍]'), ' ', h('code', null, '"精确短语"')));
    this.el.append(h('div', { class: 'panel-pad' }, this.input, help, this.info), h('div', { class: 'panel-scroll' }, this.list));
    this.input.addEventListener('input', debounce(() => this.run(), 280));
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter') this.run(); });
  }
  focus(q) { if (q != null) this.input.value = q; this.input.focus(); this.run(); }
  async run() {
    const q = this.input.value.trim();
    if (!q) { this.list.innerHTML = ''; this.info.textContent = ''; return; }
    this.info.textContent = '搜索中…';
    const t = Date.now();
    const r = await api.search(q, 100);
    this.info.textContent = `${r.total} 个结果 · ${Date.now() - t} ms`;
    this.list.innerHTML = '';
    const terms = r.terms.map(x => x.toLowerCase());
    for (const it of r.results) {
      const row = h('div', { class: 'sr-item' },
        h('div', { class: 'sr-title' }, h('span', { class: 'sr-ico', html: iconHTML(TYPE_ICON[index.typeOf(it.path)] || 'file-text', 14) }), h('span', null, it.name)),
        h('div', { class: 'sr-path muted' }, it.path.slice(0, it.path.lastIndexOf('/'))));
      for (const s of it.snippets) {
        const html = esc(s.text.slice(0, s.at)) + '<mark>' + esc(s.text.slice(s.at, s.at + s.len)) + '</mark>' + esc(s.text.slice(s.at + s.len));
        row.append(h('div', { class: 'sr-snippet', html }));
      }
      row.onclick = e => app.open(it.path, { newTab: e.ctrlKey || e.metaKey });
      this.list.append(row);
    }
    void terms;
  }
}

export class TagsPanel {
  constructor() { this.el = h('div', { class: 'panel tags-panel' }); }
  async refresh() {
    const tags = await api.tags();
    this.el.innerHTML = '';
    if (!tags.length) { this.el.append(h('div', { class: 'empty-state small' }, icon('tag', 24), h('p', null, '还没有标签'))); return; }
    // 嵌套标签树
    const root = { children: new Map(), count: 0 };
    for (const { tag, count } of tags) {
      let n = root;
      tag.split('/').forEach((seg, i, arr) => {
        if (!n.children.has(seg)) n.children.set(seg, { name: seg, full: arr.slice(0, i + 1).join('/'), children: new Map(), count: 0 });
        n = n.children.get(seg); n.count += count;
      });
    }
    const list = h('div', { class: 'tag-tree' });
    const render = (n, depth, host) => {
      for (const c of [...n.children.values()].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name))) {
        const row = h('div', { class: 'tag-row', style: { paddingLeft: 8 + depth * 14 + 'px' } }, h('span', { class: 'tag tag-pill', 'data-tag': c.full, style: { '--tag-hue': tagHue(c.full) } }, '#' + c.name), h('span', { class: 'tree-count tabular' }, c.count));
        row.onclick = () => app.searchFor('tag:#' + c.full);
        host.append(row);
        render(c, depth + 1, host);
      }
    };
    render(root, 0, list);
    this.el.append(h('div', { class: 'panel-scroll' }, list));
  }
}

export class OutlinePanel {
  constructor() { this.el = h('div', { class: 'panel outline-panel' }); }
  update(view) {
    this.el.innerHTML = '';
    if (!view || view.type !== 'note') { this.el.append(h('div', { class: 'empty-state small' }, icon('list', 22), h('p', null, '打开一篇笔记查看大纲'))); return; }
    const hs = headingsOf(view.content);
    if (!hs.length) { this.el.append(h('div', { class: 'empty-state small' }, h('p', null, '这篇笔记没有标题'))); return; }
    const min = Math.min(...hs.map(x => x.level));
    const list = h('div', { class: 'outline' });
    hs.forEach((x, i) => {
      const row = h('div', { class: 'outline-item', style: { paddingLeft: 10 + (x.level - min) * 14 + 'px' } }, x.text);
      row.onclick = () => view.scrollToHeadingIndex(i, x.line);
      list.append(row);
    });
    this.el.append(h('div', { class: 'panel-scroll' }, list));
  }
}

export class LinksPanel {
  constructor() { this.el = h('div', { class: 'panel links-panel' }); this.token = 0; }
  async update(view) {
    const t = ++this.token;
    if (!view || view.type !== 'note') { this.el.innerHTML = ''; this.el.append(h('div', { class: 'empty-state small' }, icon('link', 22), h('p', null, '打开一篇笔记查看链接'))); return; }
    const path = view.path;
    const r = await api.backlinks(path).catch(() => ({ linked: [], unlinked: [] }));
    if (t !== this.token) return;
    app.setBacklinkCount(r.linked.length);
    // 出链：从当前内容实时解析
    const outs = [];
    const seen = new Set();
    const re = /!?\[\[([^\[\]\|#\^]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let m;
    while ((m = re.exec(view.content))) {
      const name = m[1].trim(); if (seen.has(name)) continue; seen.add(name);
      outs.push({ name, path: index.resolve(name, path) });
    }
    const sec = (title, ic, n, body, collapsedKey) => {
      const collapsed = store.get(collapsedKey, false);
      const head = h('div', { class: 'links-head' + (collapsed ? ' is-collapsed' : '') }, h('span', { class: 'tree-caret', html: iconHTML('chevron-right', 13) }), icon(ic, 14), h('span', null, title), h('span', { class: 'tree-count tabular' }, n));
      head.onclick = () => { const c = !head.classList.contains('is-collapsed'); head.classList.toggle('is-collapsed', c); store.set(collapsedKey, c); };
      return h('div', { class: 'links-sec' }, head, body);
    };
    const item = (it, withCtx) => {
      const row = h('div', { class: 'link-item' + (it.path ? '' : ' is-unresolved') },
        h('div', { class: 'link-title' }, h('span', { class: 'sr-ico', html: iconHTML(it.path ? TYPE_ICON[index.typeOf(it.path)] || 'file-text' : 'file-plus', 13) }), h('span', null, it.name)));
      if (withCtx) for (const c of it.context || []) row.append(h('div', { class: 'link-ctx', html: esc(c).replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (a, x, y, z) => `<b>${z || x}</b>`) }));
      row.onclick = e => it.path ? app.open(it.path, { newTab: e.ctrlKey || e.metaKey }) : app.createAndOpen(it.name, { from: path });
      return row;
    };
    const back = h('div', { class: 'links-body' }, ...(r.linked.length ? r.linked.map(x => item(x, true)) : [h('div', { class: 'muted links-empty' }, '没有其他笔记链接到这里')]));
    const un = h('div', { class: 'links-body' }, ...(r.unlinked.length ? r.unlinked.map(x => item(x, true)) : [h('div', { class: 'muted links-empty' }, '没有未链接的提及')]));
    const out = h('div', { class: 'links-body' }, ...(outs.length ? outs.map(x => item(x, false)) : [h('div', { class: 'muted links-empty' }, '这篇笔记还没有双链')]));
    this.el.innerHTML = '';
    this.el.append(h('div', { class: 'panel-scroll' },
      sec('反向链接', 'incoming', r.linked.length, back, 'col:back'),
      sec('出链', 'outgoing', outs.length, out, 'col:out'),
      sec('未链接的提及', 'search', r.unlinked.length, un, 'col:unlinked')));
  }
}

export class LocalGraphPanel {
  constructor() { this.el = h('div', { class: 'panel graph-panel' }); }
  async update(view) {
    this.g?.destroy(); this.g = null;
    this.el.innerHTML = '';
    if (!view || view.type !== 'note') { this.el.append(h('div', { class: 'empty-state small' }, icon('graph', 22), h('p', null, '打开一篇笔记查看局部图谱'))); return; }
    const canvas = h('canvas', { class: 'graph-canvas' });
    const open = h('button', { class: 'btn btn-sm' }, icon('graph', 14), '全屏图谱');
    open.onclick = () => app.openView('graph', { path: view.path });
    this.el.append(h('div', { class: 'graph-mini' }, canvas), h('div', { class: 'panel-pad' }, open));
    const data = await api.graph(view.path, 1);
    this.g = drawGraph(canvas, data, { center: view.path, compact: true, onOpen: (p, e) => app.open(p, { newTab: e.ctrlKey || e.metaKey }) });
  }
  hide() { this.g?.destroy(); this.g = null; }
}

export { splitFM, basename };
