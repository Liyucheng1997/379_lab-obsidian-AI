// 笔记热力图（对应仓库里的 contribution-graph 插件，配色沿用 00_热力视图.md 的规则）
import { api } from './api.js';
import { h } from './util.js';

// 首页热力图跟随配色（玻璃配色下是个人网站的橙色阶）；笔记里的 contributionGraph 代码块仍用它自己的配色
const DEFAULT_RULES = [
  { color: 'var(--heat-1)', min: 1, max: 10 },
  { color: 'var(--heat-2)', min: 10, max: 100 },
  { color: 'var(--heat-3)', min: 100, max: 200 },
  { color: 'var(--heat-4)', min: 200, max: 1e9 },
];
let cache = null, cacheAt = 0;
export async function heatData() {
  if (!cache || Date.now() - cacheAt > 20000) { cache = await api.heatmap(); cacheAt = Date.now(); }
  return cache;
}
export function invalidateHeat() { cache = null; }

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function renderHeatmap(el, opt = {}) {
  const days = opt.days || 250;
  const rules = (opt.rules && opt.rules.length ? opt.rules : DEFAULT_RULES).slice().sort((a, b) => a.min - b.min);
  el.classList.add('heatmap');
  el.innerHTML = '<div class="muted" style="padding:12px">正在统计…</div>';
  const { counts } = await heatData();
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - days + 1);
  // 以周一为一周的开始
  const lead = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - lead);
  const cols = [];
  let total = 0, active = 0;
  const d = new Date(start);
  while (d <= end) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const key = iso(d);
      const n = d <= end ? counts[key] || 0 : -1;
      if (n > 0) { total += n; active++; }
      col.push({ key, n, month: d.getMonth(), date: d.getDate() });
      d.setDate(d.getDate() + 1);
    }
    cols.push(col);
  }
  const colorOf = n => { if (n <= 0) return null; let c = rules[0].color; for (const r of rules) if (n >= r.min) c = r.color; return c; };
  const grid = h('div', { class: 'hm-grid' });
  const months = h('div', { class: 'hm-months' });
  let lastMonth = -1;
  cols.forEach((col, ci) => {
    const c = h('div', { class: 'hm-col' });
    const first = col.find(x => x.date <= 7 && x.n >= 0);
    const m = first ? first.month : -1;
    months.append(h('span', { class: 'hm-month' }, m >= 0 && m !== lastMonth && first.date <= 7 ? `${m + 1}月` : ''));
    if (m >= 0 && first.date <= 7) lastMonth = m;
    for (const cell of col) {
      const color = colorOf(cell.n);
      c.append(h('i', { class: 'hm-cell' + (cell.n < 0 ? ' is-future' : ''), style: color ? { background: color } : null, title: cell.n >= 0 ? `${cell.key} · ${cell.n} 条笔记` : '' }));
    }
    grid.append(c);
    void ci;
  });
  const legend = h('div', { class: 'hm-legend' }, h('span', null, '少'), h('i', { class: 'hm-cell' }), ...rules.map(r => h('i', { class: 'hm-cell', style: { background: r.color }, title: `${r.min}–${r.max >= 1e9 ? '∞' : r.max}` })), h('span', null, '多'));
  el.innerHTML = '';
  el.append(
    h('div', { class: 'hm-head' }, h('div', { class: 'hm-title' }, opt.title && opt.title !== 'Contributions' ? opt.title : `过去 ${days} 天的笔记热力图`), h('div', { class: 'hm-sum tabular' }, `${total} 条笔记 · ${active} 个活跃日`)),
    h('div', { class: 'hm-scroll' }, h('div', { class: 'hm-inner' }, months, grid)),
    legend,
  );
  const sc = el.querySelector('.hm-scroll'); sc.scrollLeft = sc.scrollWidth;
}
