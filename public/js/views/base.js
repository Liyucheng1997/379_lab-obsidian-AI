// Bases 数据库视图：卡片 / 看板 / 表格 / 列表（读取仓库里的 .base 文件）
import { h, esc, store, basename } from '../util.js';
import { icon, iconHTML, TYPE_ICON } from '../icons.js';
import { api, index } from '../api.js';
import { app } from '../ctx.js';
import { attachHoverPreview } from './note.js';

const TYPE_ICONS = { cards: 'grid', kanban: 'kanban', table: 'table', list: 'list', map: 'grid' };

function placeholder(name) {
  const clean = name.replace(/^【[^】]+】/, '');
  return h('div', { class: 'card-ph' }, h('span', null, clean.slice(0, 1) || '·'));
}

function card(item, view) {
  const t = index.typeOf(item.path);
  const props = Object.entries(item.props).filter(([k, v]) => k !== 'file.name' && v);
  const img = view.hasImage ? h('div', { class: 'card-img', style: { aspectRatio: String(view.imageAspectRatio || 0.75) } },
    item.image ? h('img', { src: item.image.url || api.raw(item.image.path), loading: 'lazy', alt: '', style: { objectFit: view.imageFit === 'contain' ? 'contain' : 'cover' } }) : placeholder(item.name)) : null;
  return h('a', { class: 'base-card internal-link', 'data-path': item.path, title: item.path },
    img,
    h('div', { class: 'card-body' },
      h('div', { class: 'card-title' }, !view.hasImage ? h('span', { class: 'card-ico', html: iconHTML(TYPE_ICON[t] || 'file-text', 14) }) : null, item.name),
      ...props.slice(0, 3).map(([k, v]) => h('div', { class: 'card-prop' }, h('span', { class: 'muted' }, k.replace(/^(note|file)\./, '')), ' ', v))));
}

function renderBody(data, filter) {
  const v = data.view;
  const wrap = h('div', { class: 'base-body base-' + v.type });
  const match = it => !filter || it.name.toLowerCase().includes(filter) || Object.values(it.props).some(x => String(x).toLowerCase().includes(filter));
  const groups = data.groups.map(g => ({ key: g.key, items: g.items.filter(match) })).filter(g => g.items.length);
  if (!groups.length) { wrap.append(h('div', { class: 'empty-state' }, icon('database', 28), h('p', null, data.total ? '没有匹配的条目' : '这个视图暂时没有笔记'))); return wrap; }
  if (v.type === 'table' || v.type === 'map') {
    const table = h('table', { class: 'base-table' }, h('thead', null, h('tr', null, ...data.columns.map(c => h('th', null, c.label)))));
    const tb = h('tbody');
    for (const g of groups) {
      if (v.groupBy) tb.append(h('tr', { class: 'group-row' }, h('td', { colspan: data.columns.length }, g.key, h('span', { class: 'count' }, g.items.length))));
      for (const it of g.items) tb.append(h('tr', null, ...data.columns.map((c, i) => h('td', null, i === 0 ? h('a', { class: 'internal-link', 'data-path': it.path }, it.name) : (it.props[c.id] || '')))));
    }
    table.append(tb);
    wrap.append(h('div', { class: 'table-scroll' }, table));
    if (v.type === 'map') wrap.prepend(h('div', { class: 'base-note' }, icon('info', 14), ' 地图视图在网页版以表格展示'));
    return wrap;
  }
  if (v.type === 'kanban') {
    const board = h('div', { class: 'kanban' });
    for (const g of groups) {
      const col = h('div', { class: 'kanban-col', style: { width: (v.columnWidth || 220) + 'px' } },
        h('div', { class: 'kanban-head' }, h('span', null, g.key || '（未设置）'), h('span', { class: 'count' }, g.items.length)));
      const list = h('div', { class: 'kanban-list' });
      for (const it of g.items) list.append(card(it, v));
      col.append(list);
      board.append(col);
    }
    wrap.append(board);
    return wrap;
  }
  if (v.type === 'list') {
    for (const g of groups) {
      if (v.groupBy) wrap.append(h('div', { class: 'group-head' }, g.key, h('span', { class: 'count' }, g.items.length)));
      const ul = h('ul', { class: 'base-list' });
      for (const it of g.items) ul.append(h('li', null, h('a', { class: 'internal-link', 'data-path': it.path }, it.name)));
      wrap.append(ul);
    }
    return wrap;
  }
  const size = v.cardSize || 160;
  for (const g of groups) {
    if (v.groupBy) wrap.append(h('div', { class: 'group-head' }, g.key, h('span', { class: 'count' }, g.items.length)));
    const grid = h('div', { class: 'card-grid', style: { gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(110, size)}px, 1fr))` } });
    const items = g.items;
    // 大量卡片分批渲染
    const step = 240;
    let i = 0;
    const more = () => { const end = Math.min(items.length, i + step); for (; i < end; i++) grid.append(card(items[i], v)); };
    more();
    wrap.append(grid);
    if (i < items.length) {
      const btn = h('button', { class: 'btn btn-sm load-more' }, `再显示 ${Math.min(step, items.length - i)} 张（共 ${items.length}）`);
      btn.onclick = () => { more(); if (i >= items.length) btn.remove(); else btn.textContent = `再显示 ${Math.min(step, items.length - i)} 张（共 ${items.length}）`; };
      wrap.append(btn);
    }
  }
  return wrap;
}

export class BaseView {
  constructor(path, opts = {}) {
    this.path = path; this.type = 'base';
    this.viewIdx = opts.view ?? store.get('baseView:' + path, 0);
    this.filter = '';
    this.el = h('div', { class: 'view view-base' });
    this.el.addEventListener('click', e => {
      const a = e.target.closest('a.internal-link[data-path]');
      if (a) { e.preventDefault(); app.open(a.dataset.path, { newTab: e.ctrlKey || e.metaKey }); }
    });
    attachHoverPreview(this.el);
  }
  get title() { return basename(this.path).replace(/\.base$/, ''); }

  async load() {
    this.el.innerHTML = '<div class="view-loading"><div class="spinner"></div></div>';
    try { this.data = await api.base(this.path, this.viewIdx); }
    catch (e) { this.el.innerHTML = `<div class="empty-state">${iconHTML('database', 30)}<p>${esc(e.message)}</p></div>`; return; }
    this.render();
  }

  render() {
    const d = this.data;
    const tabs = h('div', { class: 'base-tabs' }, ...d.views.map((v, i) => {
      const b = h('button', { class: 'chip' + (i === d.index ? ' active' : '') }, icon(TYPE_ICONS[v.type] || 'grid', 13), ' ', v.name);
      b.onclick = () => { this.viewIdx = i; store.set('baseView:' + this.path, i); this.load(); };
      return b;
    }));
    const search = h('input', { class: 'input base-search', placeholder: '筛选…', value: this.filter });
    const srcBtn = h('button', { class: 'icon-btn', title: '查看 .base 源文件' }, icon('file-text', 16));
    srcBtn.onclick = () => app.open(this.path, { asText: true });
    const head = h('div', { class: 'view-header' },
      h('div', { class: 'crumbs' }, h('span', { class: 'crumb-ico', html: iconHTML('database', 16) }), h('span', { class: 'crumb is-last' }, this.title)),
      h('div', { class: 'view-actions' }, h('span', { class: 'muted tabular base-count' }, `${d.total} 条${d.truncated ? '（已截断）' : ''}`), search, srcBtn));
    this.body = renderBody(d, this.filter);
    this.el.innerHTML = '';
    const host = h('div', { class: 'base-body-host' }, this.body);
    this.el.append(head, h('div', { class: 'view-scroll' }, h('div', { class: 'base-wrap' }, tabs, host)));
    search.oninput = () => { this.filter = search.value.trim().toLowerCase(); host.replaceChildren(this.body = renderBody(d, this.filter)); };
  }
}

// 笔记中嵌入 ![[x.base]] 或 ```base 代码块
export async function embedBase(el, { path, yaml }) {
  el.classList.add('base-embed');
  el.innerHTML = '<div class="muted" style="padding:10px">载入数据库视图…</div>';
  let idx = 0;
  const load = async () => {
    try {
      const d = path ? await api.base(path, idx) : await api.baseQuery(yaml, idx);
      el.innerHTML = '';
      const tabs = h('div', { class: 'base-tabs' }, ...d.views.map((v, i) => {
        const b = h('button', { class: 'chip' + (i === d.index ? ' active' : '') }, v.name);
        b.onclick = () => { idx = i; load(); };
        return b;
      }));
      if (path) tabs.prepend(h('a', { class: 'internal-link base-embed-open', 'data-path': path }, h('span', { html: iconHTML('database', 14) }), basename(path).replace(/\.base$/, '')));
      el.append(tabs, renderBody(d, ''));
      el.onclick = e => { const a = e.target.closest('a.internal-link[data-path]'); if (a) { e.preventDefault(); e.stopPropagation(); app.open(a.dataset.path, { newTab: e.ctrlKey || e.metaKey }); } };
    } catch (e) { el.innerHTML = `<div class="embed-missing">数据库视图出错：${esc(e.message)}</div>`; }
  };
  load();
}
