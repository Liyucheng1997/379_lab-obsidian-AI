// 关系图谱：以当前笔记为中心的局部图（力导向，Canvas 绘制）
import { h, basename, store } from '../util.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { app } from '../ctx.js';

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export function drawGraph(canvas, data, { center, onOpen, compact } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  let W = 0, H = 0;
  const nodes = data.nodes.map((n, i) => ({ ...n, x: Math.cos(i * 2.4) * (40 + i * 3), y: Math.sin(i * 2.4) * (40 + i * 3), vx: 0, vy: 0, deg: 0 }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = data.edges.map(e => ({ s: byId.get(e.s), t: byId.get(e.t) })).filter(e => e.s && e.t);
  edges.forEach(e => { e.s.deg++; e.t.deg++; });
  const c0 = byId.get(center); if (c0) { c0.x = 0; c0.y = 0; }
  let view = { x: 0, y: 0, k: compact ? 0.8 : 1 }, hover = null, drag = null, alpha = 1, raf = 0, dead = false;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    draw();
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  function tick() {
    const rep = compact ? 1500 : 1800;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 90000) continue;
        const f = rep / d2;
        const d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const e of edges) {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - (compact ? 80 : 100)) * 0.02;
      e.s.vx += dx / d * f; e.s.vy += dy / d * f; e.t.vx -= dx / d * f; e.t.vy -= dy / d * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.004; n.vy -= n.y * 0.004;
      if (n === drag?.node || (n.id === center && !drag)) { n.vx = 0; n.vy = 0; if (n.id === center && !drag) continue; }
      n.x += n.vx * alpha; n.y += n.vy * alpha;
      n.vx *= 0.6; n.vy *= 0.6;
    }
    alpha = Math.max(0.02, alpha * 0.985);
  }

  function draw() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    ctx.scale(view.k, view.k);
    const line = css('--graph-line') || 'rgba(0,0,0,.15)';
    const prim = css('--primary');
    const node = css('--graph-node') || '#8e8e93';
    const text = css('--text-2');
    const near = hover ? new Set([hover.id, ...edges.filter(e => e.s === hover || e.t === hover).flatMap(e => [e.s.id, e.t.id])]) : null;
    ctx.lineWidth = 1 / view.k;
    for (const e of edges) {
      const hl = near && (e.s === hover || e.t === hover);
      ctx.strokeStyle = hl ? prim : line;
      ctx.globalAlpha = near && !hl ? 0.25 : 1;
      ctx.beginPath(); ctx.moveTo(e.s.x, e.s.y); ctx.lineTo(e.t.x, e.t.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const n of nodes) {
      const r = (n.id === center ? 7 : 3.5 + Math.min(5, Math.sqrt(n.deg) * 1.2));
      ctx.globalAlpha = near && !near.has(n.id) ? 0.25 : 1;
      ctx.fillStyle = n.id === center || n === hover ? prim : node;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      if (view.k > 0.55 || n === hover || n.id === center) {
        ctx.fillStyle = text;
        ctx.font = `${(n.id === center ? 13 : 11.5) / Math.max(view.k, 0.8)}px ${css('--font')}`;
        ctx.textAlign = 'center';
        ctx.fillText(n.name.length > 18 ? n.name.slice(0, 17) + '…' : n.name, n.x, n.y + r + 13 / Math.max(view.k, 0.8));
      }
    }
    ctx.globalAlpha = 1;
  }

  function loop() {
    if (dead) return;
    if (alpha > 0.03 || drag) { tick(); draw(); }
    raf = requestAnimationFrame(loop);
  }
  loop();

  const toWorld = (cx, cy) => { const r = canvas.getBoundingClientRect(); return { x: (cx - r.left - W / 2 - view.x) / view.k, y: (cy - r.top - H / 2 - view.y) / view.k }; };
  const pick = (cx, cy) => { const p = toWorld(cx, cy); let best = null, bd = 144 / view.k; for (const n of nodes) { const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2; if (d < bd) { bd = d; best = n; } } return best; };

  canvas.addEventListener('mousemove', e => {
    if (drag) {
      if (drag.node) { const p = toWorld(e.clientX, e.clientY); drag.node.x = p.x; drag.node.y = p.y; alpha = Math.max(alpha, 0.3); drag.moved = true; }
      else { view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; drag.moved = true; draw(); }
      return;
    }
    const n = pick(e.clientX, e.clientY);
    if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; draw(); }
  });
  canvas.addEventListener('mousedown', e => { const n = pick(e.clientX, e.clientY); drag = { node: n, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; });
  window.addEventListener('mouseup', function up(e) {
    if (dead) { window.removeEventListener('mouseup', up); return; }
    if (drag && !drag.moved && drag.node && e.target === canvas) onOpen?.(drag.node.id, e);
    drag = null;
  });
  canvas.addEventListener('mouseleave', () => { hover = null; draw(); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const k = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left - W / 2, my = e.clientY - r.top - H / 2;
    view.x = mx - (mx - view.x) * (k / view.k); view.y = my - (my - view.y) * (k / view.k); view.k = k;
    draw();
  }, { passive: false });

  return { destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); }, reheat() { alpha = 1; } };
}

export class GraphView {
  constructor(path, opts = {}) {
    this.path = path; this.type = 'graph';
    this.depth = opts.depth || store.get('graphDepth', 2);
    this.el = h('div', { class: 'view view-graph' });
  }
  get title() { return '图谱 · ' + basename(this.path || ''); }
  async load() {
    const seg = h('div', { class: 'seg' }, ...[1, 2, 3].map(d => {
      const b = h('button', { class: 'seg-btn' + (d === this.depth ? ' active' : '') }, `${d} 层`);
      b.onclick = () => { this.depth = d; store.set('graphDepth', d); this.load(); };
      return b;
    }));
    const canvas = h('canvas', { class: 'graph-canvas' });
    this.el.innerHTML = '';
    this.el.append(h('div', { class: 'view-header' }, h('div', { class: 'crumbs' }, icon('graph', 16), h('span', { class: 'crumb is-last' }, basename(this.path))), h('div', { class: 'view-actions' }, h('span', { class: 'muted' }, '链接深度'), seg)), h('div', { class: 'graph-host' }, canvas));
    const data = await api.graph(this.path, this.depth);
    this.g?.destroy();
    this.g = drawGraph(canvas, data, { center: this.path, onOpen: (p, e) => app.open(p, { newTab: e.ctrlKey || e.metaKey }) });
    this.el.querySelector('.crumbs').append(h('span', { class: 'muted', style: { marginLeft: '10px' } }, `${data.nodes.length} 个节点 · ${data.edges.length} 条链接`));
  }
  destroy() { this.g?.destroy(); }
}
