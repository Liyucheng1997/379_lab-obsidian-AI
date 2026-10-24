// 通用工具
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

const pad = n => String(n).padStart(2, '0');
// 与 Obsidian 模板一致的日期格式：YYYY/MM/DD、HH:mm 等
export function formatDate(fmt, d = new Date()) {
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, t => ({ YYYY: d.getFullYear(), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) }[t]));
}

export function relTime(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  return new Date(ms).toLocaleDateString('zh-CN');
}

export const store = {
  get(k, def) { try { const v = localStorage.getItem('aiobs:' + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem('aiobs:' + k, JSON.stringify(v)); } catch { } },
};

export const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

export const basename = p => { const n = p.split('/').pop(); return n.endsWith('.md') ? n.slice(0, -3) : n; };
export const dirname = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
export const extname = p => { const n = p.split('/').pop(); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

// 模糊匹配：返回分数（越大越好），不匹配返回 -1
export function fuzzy(q, s) {
  if (!q) return 0;
  q = q.toLowerCase(); const t = s.toLowerCase();
  const i = t.indexOf(q);
  if (i >= 0) return 1000 - i * 2 - (t.length - q.length) * 0.5 + (i === 0 ? 300 : 0);
  let qi = 0, score = 0, last = -1;
  for (let k = 0; k < t.length && qi < q.length; k++) {
    if (t[k] === q[qi]) { score += last === k - 1 ? 8 : 2; last = k; qi++; }
  }
  return qi === q.length ? score - t.length * 0.2 : -1;
}

// 提示
let toastHost;
export function toast(msg, type = '', ms = 2400) {
  if (!toastHost) { toastHost = h('div', { class: 'toast-host' }); document.body.append(toastHost); }
  const t = h('div', { class: 'toast' + (type ? ' toast-' + type : '') }, msg);
  toastHost.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// 事件总线
const listeners = new Map();
export const bus = {
  on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); },
  emit(ev, ...a) { for (const fn of listeners.get(ev) || []) { try { fn(...a); } catch (e) { console.error(e); } } },
};

// 拆分 frontmatter（前端轻量版）
export function splitFM(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text || '');
  if (!m) return { fmText: '', fm: {}, body: text || '', hasFM: false, fmEnd: 0 };
  let fm = {};
  try { fm = window.jsyaml.load(m[1]) || {}; if (typeof fm !== 'object' || Array.isArray(fm)) fm = {}; } catch { fm = {}; }
  return { fmText: m[1], fm, body: text.slice(m[0].length), hasFM: true, fmEnd: m[0].length };
}

export function slug(s) { return String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, ''); }

export function hashHue(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; }
