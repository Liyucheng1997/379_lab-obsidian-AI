// Obsidian 风格 Markdown 渲染：双链、嵌入、标签、高亮、注释、Callout、任务、热力图代码块
import { esc, splitFM, slug, extname, IMAGE_EXT, h, hashHue } from './util.js';
import { index, api } from './api.js';
import { iconHTML } from './icons.js';

let CURRENT = { from: '' };
export const tagHue = t => hashHue(String(t).split('/')[0]) % 360;

function parseInner(inner) {
  let [target, alias] = splitOnce(inner, '|');
  let [file, heading] = splitOnce(target, '#');
  return { file: file.trim(), heading: heading?.replace(/^\^/, '').trim() || '', alias: alias?.trim() || '' };
}
function splitOnce(s, ch) { const i = s.indexOf(ch); return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)]; }

function renderWikilink(tok) {
  const { file, heading, alias } = parseInner(tok.inner);
  const from = CURRENT.from;
  const resolved = file ? index.resolve(file, from) : from;
  if (tok.embed) {
    const ext = extname(file);
    if (resolved && IMAGE_EXT.has(extname(resolved))) {
      let w = '', hgt = '';
      const m = /^(\d+)(?:x(\d+))?$/.exec(alias);
      if (m) { w = m[1]; hgt = m[2] || ''; }
      return `<img class="embed-img" src="${esc(api.raw(resolved))}" alt="${esc(m ? file : alias || file)}" loading="lazy"${w ? ` width="${w}"` : ''}${hgt ? ` height="${hgt}"` : ''}>`;
    }
    if (resolved && /\.(mp3|wav|ogg|m4a|flac)$/i.test(resolved)) return `<audio controls src="${esc(api.raw(resolved))}"></audio>`;
    if (resolved && /\.(mp4|webm|mov)$/i.test(resolved)) return `<video controls src="${esc(api.raw(resolved))}"></video>`;
    if (resolved && /\.pdf$/i.test(resolved)) return `<iframe class="embed-pdf" src="${esc(api.raw(resolved))}"></iframe>`;
    if (resolved && /\.base$/i.test(resolved)) return `<span class="embed-base" data-path="${esc(resolved)}"></span>`;
    if (resolved && resolved.endsWith('.md')) return `<span class="embed-note" data-path="${esc(resolved)}" data-heading="${esc(heading)}"></span>`;
    if (IMAGE_EXT.has(ext) || !resolved) return `<span class="embed-missing">${iconHTML('image', 14)} 未找到「${esc(file)}」</span>`;
    return `<a class="internal-link" data-path="${esc(resolved)}">${esc(file)}</a>`;
  }
  const text = alias || (heading ? (file ? `${file} › ${heading}` : heading) : file);
  const cls = 'internal-link' + (resolved ? '' : ' is-unresolved');
  return `<a class="${cls}" data-href="${esc(file)}" data-heading="${esc(heading)}"${resolved ? ` data-path="${esc(resolved)}"` : ''}>${esc(text)}</a>`;
}

const extensions = [
  {
    name: 'wikilink', level: 'inline',
    start(src) { const i = src.indexOf('[['); if (i < 0) return; return i > 0 && src[i - 1] === '!' ? i - 1 : i; },
    tokenizer(src) { const m = /^(!?)\[\[([^\[\]\n]+?)\]\]/.exec(src); if (m) return { type: 'wikilink', raw: m[0], embed: !!m[1], inner: m[2] }; },
    renderer: renderWikilink,
  },
  {
    name: 'tag', level: 'inline',
    start(src) { const m = /(^|[\s(（，。,;；])#[\p{L}_\-\/]/u.exec(src); return m ? m.index + m[1].length : undefined; },
    tokenizer(src) { const m = /^#([\p{L}\p{N}_\-\/]*[\p{L}_\-\/][\p{L}\p{N}_\-\/]*)/u.exec(src); if (m) return { type: 'tag', raw: m[0], tag: m[1] }; },
    renderer(tok) { return `<a class="tag" data-tag="${esc(tok.tag)}" style="--tag-hue:${tagHue(tok.tag)}">#${esc(tok.tag)}</a>`; },
  },
  {
    name: 'mark', level: 'inline',
    start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^==(?=\S)([^\n]*?\S)==/.exec(src);
      if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
    },
    renderer(tok) { return `<mark>${this.parser.parseInline(tok.tokens)}</mark>`; },
  },
  {
    name: 'comment', level: 'inline',
    start(src) { const i = src.indexOf('%%'); return i < 0 ? undefined : i; },
    tokenizer(src) { const m = /^%%[\s\S]*?%%/.exec(src); if (m) return { type: 'comment', raw: m[0] }; },
    renderer() { return ''; },
  },
  {
    name: 'blockComment', level: 'block',
    start(src) { const m = /^%%/m.exec(src); return m ? m.index : undefined; },
    tokenizer(src) { const m = /^%%[\s\S]*?%%[ \t]*(?:\n|$)/.exec(src); if (m) return { type: 'blockComment', raw: m[0] }; },
    renderer() { return ''; },
  },
];

const renderer = {
  heading({ tokens, depth, text }) {
    const inner = this.parser.parseInline(tokens);
    return `<h${depth} id="h-${esc(slug(text))}" class="md-heading">${inner}</h${depth}>\n`;
  },
  code({ text, lang }) {
    const l = (lang || '').trim().split(/\s+/)[0];
    if (l === 'contributionGraph') return `<div class="x-heatmap" data-config="${esc(text)}"></div>`;
    if (l === 'base') return `<div class="embed-base" data-yaml="${esc(text)}"></div>`;
    if (l === 'dataview' || l === 'dataviewjs') return `<div class="x-plugin-block"><div class="x-plugin-label">${iconHTML('database', 14)} Dataview 查询 · 网页版仅展示源码，可改用 Bases 视图</div><pre><code>${esc(text)}</code></pre></div>`;
    return `<pre class="code-block" data-lang="${esc(l)}"><code class="language-${esc(l)}">${esc(text)}</code></pre>\n`;
  },
  checkbox({ checked }) { return `<input type="checkbox" class="task-checkbox"${checked ? ' checked' : ''}> `; },
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    if (/^(https?:|mailto:|obsidian:|zotero:)/i.test(href)) return `<a class="external-link" href="${esc(href)}" target="_blank" rel="noopener"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
    if (href.startsWith('#')) return `<a class="internal-link" data-heading="${esc(decodeURIComponent(href.slice(1)))}" data-path="${esc(CURRENT.from)}">${text}</a>`;
    let target = href; try { target = decodeURIComponent(href); } catch { }
    const [file, heading] = splitOnce(target, '#');
    const resolved = index.resolve(file, CURRENT.from);
    return `<a class="internal-link${resolved ? '' : ' is-unresolved'}" data-href="${esc(file)}" data-heading="${esc(heading || '')}"${resolved ? ` data-path="${esc(resolved)}"` : ''}>${text}</a>`;
  },
  image({ href, title, text }) {
    let src = href;
    if (!/^(https?:|data:)/i.test(href)) { let t = href; try { t = decodeURIComponent(href); } catch { } const r = index.resolve(t, CURRENT.from); src = r ? api.raw(r) : href; }
    let alt = text || '', w = '';
    const m = /^(.*?)\|(\d+)(?:x\d+)?$/.exec(alt); if (m) { alt = m[1]; w = m[2]; }
    return `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"${w ? ` width="${w}"` : ''}${title ? ` title="${esc(title)}"` : ''}>`;
  },
};

const md = new window.marked.Marked({ gfm: true, breaks: true });
md.use({ extensions, renderer });

export function renderMarkdown(text, from = '') {
  CURRENT = { from };
  try { return md.parse(text || ''); } catch (e) { console.error(e); return `<pre>${esc(text)}</pre>`; }
}

// 只渲染正文（去掉 frontmatter）
export function renderNote(text, from) { return renderMarkdown(splitFM(text).body, from); }

const CALLOUT_ICON = { note: 'pencil', info: 'info', tip: 'bulb', hint: 'bulb', important: 'star', success: 'check', check: 'check', done: 'check', question: 'info', help: 'info', faq: 'info', warning: 'info', caution: 'info', attention: 'info', failure: 'x', fail: 'x', missing: 'x', danger: 'x', error: 'x', bug: 'x', example: 'list', quote: 'quote', cite: 'quote', abstract: 'list', summary: 'list', tldr: 'list', todo: 'check' };
const CALLOUT_KIND = { tip: 'success', hint: 'success', success: 'success', check: 'success', done: 'success', warning: 'warning', caution: 'warning', attention: 'warning', question: 'warning', help: 'warning', faq: 'warning', failure: 'danger', fail: 'danger', missing: 'danger', danger: 'danger', error: 'danger', bug: 'danger', quote: 'neutral', cite: 'neutral', example: 'neutral' };

function callouts(root) {
  for (const bq of root.querySelectorAll('blockquote')) {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') continue;
    const m = /^\[!([\w-]+)\]([+-]?)[ \t]*/.exec(p.textContent);
    if (!m) continue;
    const type = m[1].toLowerCase(), fold = m[2];
    const html = p.innerHTML;
    const brIdx = html.search(/<br\s*\/?>|\n/);
    let titleHtml = brIdx >= 0 ? html.slice(0, brIdx) : html;
    const restHtml = brIdx >= 0 ? html.slice(brIdx).replace(/^(<br\s*\/?>|\n)\s*/, '') : '';
    titleHtml = titleHtml.replace(/^\s*\[![\w-]+\][+-]?\s*/, '') || type.charAt(0).toUpperCase() + type.slice(1);
    const box = h('div', { class: 'callout', 'data-callout': type, 'data-kind': CALLOUT_KIND[type] || 'primary' });
    const title = h('div', { class: 'callout-title', html: iconHTML(CALLOUT_ICON[type] || 'pencil', 16) + `<span>${titleHtml}</span>` + (fold ? iconHTML('chevron-down', 16) : '') });
    const content = h('div', { class: 'callout-content' });
    if (restHtml.trim()) content.append(h('p', { html: restHtml }));
    [...bq.children].slice(1).forEach(c => content.append(c));
    box.append(title, content);
    if (fold) {
      box.classList.add('is-foldable');
      if (fold === '-') box.classList.add('is-collapsed');
      title.addEventListener('click', () => box.classList.toggle('is-collapsed'));
    }
    bq.replaceWith(box);
  }
}

function sanitize(root) {
  root.querySelectorAll('script,style,object').forEach(n => n.remove());
  root.querySelectorAll('*').forEach(n => {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
    }
  });
}

function sectionOf(text, heading) {
  const body = splitFM(text).body;
  if (!heading) return body;
  const lines = body.split('\n');
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (start < 0 && m[2].trim().toLowerCase() === heading.toLowerCase()) { start = i; level = m[1].length; continue; }
    if (start >= 0 && m[1].length <= level) return lines.slice(start, i).join('\n');
  }
  return start >= 0 ? lines.slice(start).join('\n') : body;
}

// 渲染后增强：Callout、嵌入笔记、热力图、Base 嵌入、代码复制
export async function enhance(root, from, depth = 0) {
  sanitize(root);
  callouts(root);
  root.querySelectorAll('pre.code-block').forEach(pre => {
    const b = h('button', { class: 'code-copy', title: '复制', html: iconHTML('copy', 14) });
    b.onclick = () => { navigator.clipboard?.writeText(pre.innerText); b.innerHTML = iconHTML('check', 14); setTimeout(() => (b.innerHTML = iconHTML('copy', 14)), 1200); };
    pre.append(b);
  });
  for (const el of root.querySelectorAll('.embed-note')) {
    const p = el.dataset.path;
    if (depth >= 2 || p === from) { el.innerHTML = `<a class="internal-link" data-path="${esc(p)}">${esc(p.split('/').pop().replace(/\.md$/, ''))}</a>`; continue; }
    el.innerHTML = '<div class="embed-loading">载入中…</div>';
    api.read(p).then(async r => {
      const name = p.split('/').pop().replace(/\.md$/, '');
      el.innerHTML = '';
      const head = h('div', { class: 'embed-title' }, h('a', { class: 'internal-link', 'data-path': p }, name + (el.dataset.heading ? ' › ' + el.dataset.heading : '')));
      const body = h('div', { class: 'markdown-rendered embed-body', html: renderMarkdown(sectionOf(r.content, el.dataset.heading), p) });
      el.append(head, body);
      await enhance(body, p, depth + 1);
    }).catch(() => { el.innerHTML = `<span class="embed-missing">无法载入 ${esc(p)}</span>`; });
  }
  const heat = root.querySelectorAll('.x-heatmap');
  if (heat.length) { const { renderHeatmap } = await import('./heatmap.js'); heat.forEach(el => renderHeatmap(el, parseHeatConfig(el.dataset.config))); }
  const bases = root.querySelectorAll('.embed-base');
  if (bases.length && depth < 1) {
    const { embedBase } = await import('./views/base.js');
    bases.forEach(el => embedBase(el, el.dataset.path ? { path: el.dataset.path } : { yaml: el.dataset.yaml }));
  }
}

function parseHeatConfig(text) {
  let c = {};
  try { c = window.jsyaml.load(text) || {}; } catch { }
  return { days: Number(c.dateRangeValue) || 250, title: c.title, rules: Array.isArray(c.cellStyleRules) ? c.cellStyleRules.map(r => ({ color: r.color, min: Number(r.min), max: Number(r.max) })) : null };
}

// 提取标题（大纲）
export function headingsOf(text) {
  const out = [];
  const lines = splitFM(text).body.split('\n');
  let inCode = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) inCode = !inCode;
    if (inCode) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(l);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2'), line: i });
  });
  return out;
}

export function wordCount(text) {
  const body = splitFM(text).body;
  const cjk = (body.match(/[一-鿿㐀-䶿]/g) || []).length;
  const words = (body.replace(/[一-鿿㐀-䶿]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length;
  return { words: cjk + words, chars: body.replace(/\s/g, '').length };
}
