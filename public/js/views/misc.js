// 其他视图：Canvas 白板（只读浏览）、纯文本、图片
import { h, esc, basename, debounce, toast, splitFM } from '../util.js';
import { icon, iconHTML } from '../icons.js';
import { api, index } from '../api.js';
import { app } from '../ctx.js';
import { renderMarkdown, enhance } from '../markdown.js';

const CANVAS_COLORS = { 1: '#e93147', 2: '#ec7500', 3: '#e0ac00', 4: '#08b94e', 5: '#00bfbc', 6: '#7852ee' };

export class CanvasView {
  constructor(path) { this.path = path; this.type = 'canvas'; this.el = h('div', { class: 'view view-canvas' }); }
  get title() { return basename(this.path).replace(/\.canvas$/, ''); }
  async load() {
    const { content } = await api.read(this.path);
    let data = { nodes: [], edges: [] };
    try { data = JSON.parse(content || '{}'); } catch { toast('Canvas 文件格式错误', 'error'); }
    const nodes = data.nodes || [], edges = data.edges || [];
    const stage = h('div', { class: 'cv-stage' });
    const world = h('div', { class: 'cv-world' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('cv-edges');
    world.append(svg);
    stage.append(world);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const byId = {};
    for (const n of [...nodes].sort((a, b) => (a.type === 'group' ? -1 : 0) - (b.type === 'group' ? -1 : 0))) {
      byId[n.id] = n;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
      const color = CANVAS_COLORS[n.color] || (n.color?.startsWith('#') ? n.color : null);
      const box = h('div', { class: 'cv-node cv-' + n.type, style: { left: n.x + 'px', top: n.y + 'px', width: n.width + 'px', height: n.height + 'px', ...(color ? { '--cv-color': color } : {}) } });
      if (n.type === 'group') box.append(h('div', { class: 'cv-group-label' }, n.label || ''));
      else if (n.type === 'text') { const b = h('div', { class: 'markdown-rendered', html: renderMarkdown(n.text || '', this.path) }); box.append(b); enhance(b, this.path, 1); }
      else if (n.type === 'link') box.append(h('a', { class: 'external-link', href: n.url, target: '_blank', rel: 'noopener' }, n.url));
      else if (n.type === 'file') {
        const p = index.resolve(n.file, this.path) || n.file;
        if (index.isImage(p)) box.append(h('img', { src: api.raw(p), alt: '' }));
        else {
          box.append(h('a', { class: 'internal-link cv-file-title', 'data-path': p }, basename(p)));
          const b = h('div', { class: 'markdown-rendered' });
          box.append(b);
          api.read(p).then(r => { b.innerHTML = renderMarkdown(splitFM(r.content).body.slice(0, 3000), p); enhance(b, p, 2); }).catch(() => { b.textContent = '未找到文件'; });
        }
      }
      world.append(box);
    }
    if (!nodes.length) { minX = minY = 0; maxX = maxY = 400; }
    const side = (n, s) => s === 'left' ? [n.x, n.y + n.height / 2] : s === 'right' ? [n.x + n.width, n.y + n.height / 2] : s === 'top' ? [n.x + n.width / 2, n.y] : [n.x + n.width / 2, n.y + n.height];
    const off = 400;
    svg.setAttribute('style', `left:${minX - off}px;top:${minY - off}px;width:${maxX - minX + off * 2}px;height:${maxY - minY + off * 2}px`);
    svg.innerHTML = '<defs><marker id="cv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>';
    for (const e of edges) {
      const a = byId[e.fromNode], b = byId[e.toNode];
      if (!a || !b) continue;
      const [x1, y1] = side(a, e.fromSide || 'right'), [x2, y2] = side(b, e.toSide || 'left');
      const dx = Math.max(40, Math.abs(x2 - x1) / 2);
      const c = (s, x, y) => s === 'left' ? [x - dx, y] : s === 'right' ? [x + dx, y] : s === 'top' ? [x, y - dx] : [x, y + dx];
      const [cx1, cy1] = c(e.fromSide || 'right', x1, y1), [cx2, cy2] = c(e.toSide || 'left', x2, y2);
      const tx = v => v - minX + off, ty = v => v - minY + off;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${tx(x1)},${ty(y1)} C${tx(cx1)},${ty(cy1)} ${tx(cx2)},${ty(cy2)} ${tx(x2)},${ty(y2)}`);
      path.setAttribute('marker-end', e.toEnd === 'none' ? '' : 'url(#cv-arrow)');
      if (CANVAS_COLORS[e.color]) path.style.color = CANVAS_COLORS[e.color];
      svg.append(path);
      if (e.label) { const t = h('div', { class: 'cv-edge-label', style: { left: (x1 + x2) / 2 + 'px', top: (y1 + y2) / 2 + 'px' } }, e.label); world.append(t); }
    }
    // 平移缩放
    let v = { x: 0, y: 0, k: 1 };
    const apply = () => { world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`; };
    const fit = () => {
      const r = stage.getBoundingClientRect();
      const w = maxX - minX + 80, hh = maxY - minY + 80;
      v.k = Math.min(1, Math.min(r.width / w, r.height / hh));
      v.x = (r.width - (maxX - minX) * v.k) / 2 - minX * v.k; v.y = (r.height - (maxY - minY) * v.k) / 2 - minY * v.k;
      apply();
    };
    let drag = null;
    stage.addEventListener('mousedown', e => { if (e.target.closest('a,.markdown-rendered')) return; drag = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y }; stage.classList.add('is-dragging'); });
    window.addEventListener('mousemove', e => { if (!drag) return; v.x = drag.vx + e.clientX - drag.x; v.y = drag.vy + e.clientY - drag.y; apply(); });
    window.addEventListener('mouseup', () => { drag = null; stage.classList.remove('is-dragging'); });
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const k = Math.min(3, Math.max(0.1, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; apply();
    }, { passive: false });
    stage.addEventListener('click', e => { const a = e.target.closest('a.internal-link[data-path]'); if (a) { e.preventDefault(); app.open(a.dataset.path, { newTab: e.ctrlKey || e.metaKey }); } });
    const fitBtn = h('button', { class: 'btn btn-sm' }, '适应窗口'); fitBtn.onclick = fit;
    this.el.innerHTML = '';
    this.el.append(h('div', { class: 'view-header' }, h('div', { class: 'crumbs' }, icon('grid', 16), h('span', { class: 'crumb is-last' }, this.title), h('span', { class: 'muted', style: { marginLeft: '8px' } }, `${nodes.length} 个节点 · 只读浏览`)), h('div', { class: 'view-actions' }, fitBtn)), stage);
    requestAnimationFrame(fit);
  }
}

// 纯文本（.base 源文件、css、json…）
export class TextView {
  constructor(path) { this.path = path; this.type = 'text'; this.el = h('div', { class: 'view view-text' }); this.saveSoon = debounce(() => this.save(), 700); }
  get title() { return basename(this.path); }
  async load() {
    const r = await api.read(this.path);
    this.mtime = r.mtime;
    const ta = h('textarea', { class: 'md-editor code-editor', spellcheck: false });
    ta.value = r.content;
    ta.addEventListener('input', () => { this.content = ta.value; this.saveSoon(); app.setSaveState('dirty'); });
    ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this.saveSoon.flush(); } if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); } });
    const actions = h('div', { class: 'view-actions' });
    if (this.path.endsWith('.base')) { const b = h('button', { class: 'btn btn-sm btn-primary' }, icon('database', 14), '打开视图'); b.onclick = () => app.open(this.path); actions.append(b); }
    this.el.innerHTML = '';
    this.el.append(h('div', { class: 'view-header' }, h('div', { class: 'crumbs' }, h('span', { class: 'crumb is-last' }, this.path)), actions), h('div', { class: 'view-scroll' }, h('div', { class: 'view-content wide' }, ta)));
  }
  async save() { if (this.content == null) return; app.setSaveState('saving'); try { const r = await api.write(this.path, this.content); this.mtime = r.mtime; app.setSaveState('saved'); } catch (e) { app.setSaveState('error'); toast(e.message, 'error'); } }
  destroy() { this.saveSoon.flush(); }
}

export class ImageView {
  constructor(path) { this.path = path; this.type = 'image'; this.el = h('div', { class: 'view view-image' }); }
  get title() { return basename(this.path); }
  async load() {
    this.el.innerHTML = '';
    this.el.append(h('div', { class: 'view-header' }, h('div', { class: 'crumbs' }, icon('image', 16), h('span', { class: 'crumb is-last' }, this.path))), h('div', { class: 'image-stage' }, h('img', { src: api.raw(this.path), alt: esc(this.title) })));
  }
}

export { iconHTML };
