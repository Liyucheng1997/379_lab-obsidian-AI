// 首页：仓库概览、热力图、主题索引、数据库入口、最近编辑
import { h, relTime, formatDate } from '../util.js';
import { icon, iconHTML, TYPE_ICON } from '../icons.js';
import { api } from '../api.js';
import { app } from '../ctx.js';
import { renderHeatmap, heatData } from '../heatmap.js';
import { attachHoverPreview } from './note.js';

const STAT_TYPES = ['书籍', '人物', '概念', '电影', '主题'];

export class HomeView {
  constructor() {
    this.type = 'home'; this.path = '';
    this.el = h('div', { class: 'view view-home' });
    attachHoverPreview(this.el);
    this.el.addEventListener('click', e => { const a = e.target.closest('a.internal-link[data-path]'); if (a) { e.preventDefault(); app.open(a.dataset.path, { newTab: e.ctrlKey || e.metaKey }); } });
  }
  get title() { return '首页'; }
  async load() {
    const meta = app.meta;
    const hour = new Date().getHours();
    const hello = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const stats = h('div', { class: 'stat-row' });
    const heat = h('div', { class: 'card heat-card' });
    const themes = h('div', { class: 'theme-grid' });
    const bases = h('div', { class: 'base-tiles' });
    const recent = h('div', { class: 'recent-list' });
    const quick = h('div', { class: 'quick-row' },
      this.quick('file-plus', '新建卡片', '按模板创建', () => app.newFromTemplate()),
      this.quick('sparkles', 'AI 写卡片', '输入概念，AI 按模板填写', () => app.newFromTemplate({ ai: true })),
      this.quick('search', '快速打开', 'Ctrl+O', () => app.quickSwitcher()),
      this.quick('dice', '随机漫步', '随机打开一张卡片', () => app.randomNote()));

    this.el.innerHTML = '';
    this.el.append(h('div', { class: 'view-scroll' }, h('div', { class: 'home-wrap' },
      h('div', { class: 'home-watermark', 'aria-hidden': 'true' }, 'NOTES'),
      h('div', { class: 'home-hero' },
        h('div', null, h('div', { class: 'home-eyebrow' }, `Reading Notes · ${formatDate('YYYY/MM/DD')} · ${hello}`),
          h('h1', { class: 'home-title' }, meta.name, h('span', { class: 'em' }, '，第二大脑')),
          h('p', { class: 'home-sub' }, h('b', null, '卡片笔记'), ' · ', h('b', null, '主题阅读'), ' · ', h('b', null, '费曼学习法'), meta.isSample ? h('span', { class: 'pill' }, '示例仓库') : null))),
      quick, stats, heat,
      h('div', { class: 'home-cols' },
        h('section', { class: 'card home-sec' }, h('div', { class: 'sec-head' }, icon('target', 16), h('span', null, '主题索引')), themes),
        h('section', { class: 'card home-sec' }, h('div', { class: 'sec-head' }, icon('clock', 16), h('span', null, '最近编辑')), recent)),
      h('section', { class: 'card home-sec' }, h('div', { class: 'sec-head' }, icon('database', 16), h('span', null, '笔记数据库'), h('span', { class: 'muted sec-note' }, '06_笔记数据库检索 · Bases 视图')), bases),
    )));

    if (meta.status?.state !== 'ready') {
      stats.append(h('div', { class: 'muted', style: { padding: '8px 4px' } }, `正在建立索引… ${meta.status?.done || 0}/${meta.status?.total || '?'}`));
      setTimeout(() => app.refreshMeta().then(() => this.load()), 1500);
      return;
    }
    const hd = await heatData();
    const total = Object.values(hd.types).reduce((a, b) => a + b, 0);
    const today = hd.counts[formatDate('YYYY-MM-DD')] || 0;
    stats.append(this.stat('笔记', total, 'file-text'), ...STAT_TYPES.map(t => this.stat(t, hd.types[t] || 0, TYPE_ICON[t])), this.stat('今日新增', today, 'calendar'));
    renderHeatmap(heat, { days: 250 });

    api.baseQuery('views:\n  - type: cards\n    filters:\n      and:\n        - 类型 == "主题"\n    image: note.cover\n').then(d => {
      const items = d.groups.flatMap(g => g.items);
      if (!items.length) themes.append(h('p', { class: 'muted' }, '还没有「类型: 主题」的笔记'));
      for (const it of items.slice(0, 24)) {
        themes.append(h('a', { class: 'theme-item internal-link', 'data-path': it.path },
          it.image ? h('img', { src: it.image.url || api.raw(it.image.path), loading: 'lazy', alt: '' }) : h('span', { class: 'theme-ph', html: iconHTML('target', 18) }),
          h('span', null, it.name.replace(/^【主题】/, ''))));
      }
    });
    api.recent(10).then(list => {
      for (const r of list) recent.append(h('a', { class: 'recent-item internal-link', 'data-path': r.path },
        h('span', { class: 'recent-ico', html: iconHTML(TYPE_ICON[r.type] || 'file-text', 15) }), h('span', { class: 'recent-name' }, r.name), h('span', { class: 'muted recent-time' }, relTime(r.mtime))));
    });
    api.bases().then(list => {
      if (!list.length) bases.append(h('p', { class: 'muted' }, '仓库里还没有 .base 文件'));
      for (const b of list) {
        const t = h('button', { class: 'base-tile' }, h('span', { class: 'tile-ico', html: iconHTML('database', 16) }), h('span', null, b.name.replace(/^\d+_/, '')));
        t.onclick = e => app.open(b.path, { newTab: e.ctrlKey || e.metaKey });
        bases.append(t);
      }
    });
  }
  stat(label, n, ic) { return h('div', { class: 'stat card' }, h('div', { class: 'stat-top' }, icon(ic, 15), h('span', null, label)), h('div', { class: 'stat-num tabular' }, n.toLocaleString('zh-CN'))); }
  quick(ic, title, sub, fn) { const b = h('button', { class: 'quick card' }, h('span', { class: 'quick-ico', html: iconHTML(ic, 18) }), h('span', { class: 'quick-text' }, h('b', null, title), h('small', null, sub))); b.onclick = fn; return b; }
}
