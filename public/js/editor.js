// 编辑器（CodeMirror 6）：实时预览 / 源码两种模式
// 实时预览：光标所在行显示 Markdown 源码，其余行隐藏标记并就地渲染双链、图片、任务、表格、Callout、属性
import * as CM from '../vendor/codemirror.js';
import { h, fuzzy, formatDate, toast, store, extname, IMAGE_EXT } from './util.js';
import { index, api } from './api.js';
import { TYPE_ICON } from './icons.js';
import { renderMarkdown, enhance, tagHue } from './markdown.js';

const {
  EditorState, Compartment, Prec, StateField, StateEffect, Transaction,
  EditorView, keymap, Decoration, WidgetType, drawSelection, dropCursor, placeholder,
  history, historyKeymap, defaultKeymap, indentMore, indentLess,
  syntaxTree, syntaxHighlighting, HighlightStyle, LanguageDescription,
  markdown, markdownLanguage, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, acceptCompletion,
  search, searchKeymap, highlightSelectionMatches, tags, javascript, python, css, json,
} = CM;

// ---------- Obsidian 语法扩展：[[双链]]、==高亮==、#标签、%%注释%% ----------
const OBSIDIAN_SYNTAX = {
  defineNodes: [
    { name: 'WikiLink', style: tags.link }, { name: 'WikiMark', style: tags.processingInstruction },
    { name: 'Highlight' }, { name: 'HighlightMark', style: tags.processingInstruction },
    { name: 'Tag' }, { name: 'Comment', style: tags.comment },
  ],
  parseInline: [
    {
      name: 'WikiLink', before: 'Link',
      parse(cx, next, pos) {
        let open = pos;
        if (next === 33) { if (cx.char(pos + 1) !== 91 || cx.char(pos + 2) !== 91) return -1; open = pos + 1; }
        else if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
        const rest = cx.slice(open + 2, cx.end);
        const i = rest.indexOf(']]');
        if (i <= 0 || /[\[\]\n]/.test(rest.slice(0, i))) return -1;
        const end = open + 4 + i;
        return cx.addElement(cx.elt('WikiLink', pos, end, [cx.elt('WikiMark', pos, open + 2), cx.elt('WikiMark', end - 2, end)]));
      },
    },
    {
      name: 'Highlight', before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== 61 || cx.char(pos + 1) !== 61) return -1;
        const rest = cx.slice(pos + 2, cx.end);
        const i = rest.indexOf('==');
        if (i <= 0 || /^\s/.test(rest) || rest.slice(0, i).includes('\n')) return -1;
        const end = pos + 4 + i;
        return cx.addElement(cx.elt('Highlight', pos, end, [cx.elt('HighlightMark', pos, pos + 2), cx.elt('HighlightMark', end - 2, end)]));
      },
    },
    {
      name: 'Tag',
      parse(cx, next, pos) {
        if (next !== 35) return -1;
        const prev = cx.char(pos - 1);
        if (prev !== -1 && !/[\s(（，。,;；]/.test(String.fromCharCode(prev))) return -1;
        const m = /^#([\p{L}\p{N}_\-\/]*[\p{L}_\-\/][\p{L}\p{N}_\-\/]*)/u.exec(cx.slice(pos, cx.end));
        return m ? cx.addElement(cx.elt('Tag', pos, pos + m[0].length)) : -1;
      },
    },
    {
      name: 'Comment',
      parse(cx, next, pos) {
        if (next !== 37 || cx.char(pos + 1) !== 37) return -1;
        const i = cx.slice(pos + 2, cx.end).indexOf('%%');
        return i < 0 ? -1 : cx.addElement(cx.elt('Comment', pos, pos + 4 + i));
      },
    },
  ],
};

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.62em', fontWeight: '800', letterSpacing: '-0.02em' },
  { tag: tags.heading2, fontSize: '1.34em', fontWeight: '800', letterSpacing: '-0.015em' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: '700' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, class: 'cm-tok-link' },
  { tag: tags.url, class: 'cm-tok-url' },
  { tag: tags.monospace, class: 'cm-tok-code' },
  { tag: [tags.processingInstruction, tags.contentSeparator], class: 'cm-tok-mark' },
  { tag: tags.quote, class: 'cm-tok-quote' },
  { tag: tags.comment, class: 'cm-tok-comment' },
  { tag: tags.keyword, class: 'cm-tok-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'cm-tok-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'cm-tok-number' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'cm-tok-fn' },
  { tag: [tags.typeName, tags.className], class: 'cm-tok-type' },
  { tag: tags.propertyName, class: 'cm-tok-prop' },
]);

const codeLanguages = [
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'ts', 'typescript', 'node'], support: javascript({ typescript: true }) }),
  LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
  LanguageDescription.of({ name: 'css', alias: ['scss', 'less'], support: css() }),
  LanguageDescription.of({ name: 'json', alias: ['jsonc'], support: json() }),
];

// ---------- 实时预览的小部件 ----------
class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { return h('span', { class: 'cm-lp-bullet' }, '•'); }
}
class CheckboxWidget extends WidgetType {
  constructor(checked) { super(); this.checked = checked; }
  eq(o) { return o.checked === this.checked; }
  toDOM(view) {
    const box = h('input', { type: 'checkbox', class: 'task-checkbox cm-lp-check', checked: this.checked });
    box.addEventListener('mousedown', e => e.preventDefault());
    box.addEventListener('click', () => {
      const pos = view.posAtDOM(box);
      const cur = view.state.sliceDoc(pos, pos + 3);
      if (/^\[[ xX]\]$/.test(cur)) view.dispatch({ changes: { from: pos, to: pos + 3, insert: this.checked ? '[ ]' : '[x]' } });
    });
    return box;
  }
}
class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { return h('span', { class: 'cm-lp-hr' }); }
}
class ImageWidget extends WidgetType {
  constructor(src, alt, width, block) { super(); this.src = src; this.alt = alt; this.width = width; this.block = block; }
  eq(o) { return o.src === this.src && o.width === this.width && o.block === this.block; }
  toDOM(view) {
    const img = h('img', { src: this.src, alt: this.alt || '', width: this.width || null, class: 'cm-lp-img' });
    img.addEventListener('load', () => view.requestMeasure());
    return h(this.block ? 'div' : 'span', { class: this.block ? 'cm-lp-imgblock' : 'cm-lp-imginline' }, img);
  }
}
// 整块渲染（表格、Callout、嵌入笔记、热力图等）：点击空白处回到源码
class RenderedWidget extends WidgetType {
  constructor(text, kind, ctx) { super(); this.text = text; this.kind = kind; this.ctx = ctx; }
  eq(o) { return o.text === this.text && o.kind === this.kind; }
  get estimatedHeight() { return this.kind === 'table' ? 40 * this.text.split('\n').length : 80; }
  toDOM(view) {
    const path = this.ctx.path();
    const el = h('div', { class: 'cm-lp-block markdown-rendered cm-lp-' + this.kind });
    el.innerHTML = renderMarkdown(this.text, path);
    enhance(el, path, 1).then(() => view.requestMeasure());
    el.addEventListener('mousedown', e => {
      if (e.target.closest('a, input, button, .base-card, .chip, .callout-title')) return;
      e.preventDefault();
      const pos = view.posAtDOM(el);
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() { return true; }
}
// 属性面板：frontmatter 在实时预览中显示为属性表
class PropsWidget extends WidgetType {
  constructor(text, ctx) { super(); this.text = text; this.ctx = ctx; }
  eq(o) { return o.text === this.text; }
  toDOM(view) {
    const el = h('div', { class: 'cm-lp-props' });
    el.append(this.ctx.renderProps(this.text));
    const src = h('button', { class: 'cm-lp-props-src', title: '编辑 YAML 源码' }, '源码');
    src.addEventListener('mousedown', e => { e.preventDefault(); view.dispatch({ selection: { anchor: 4 } }); view.focus(); });
    el.append(src);
    return el;
  }
  ignoreEvent() { return true; }
}

const hide = Decoration.replace({});
const refreshEffect = StateEffect.define();

function parseWiki(text) {
  const embed = text.startsWith('!');
  const inner = text.slice(embed ? 3 : 2, -2);
  const pipe = inner.indexOf('|');
  const target = pipe >= 0 ? inner.slice(0, pipe) : inner;
  const alias = pipe >= 0 ? inner.slice(pipe + 1) : '';
  const hash = target.indexOf('#');
  return { embed, inner, target, file: (hash >= 0 ? target.slice(0, hash) : target).trim(), heading: hash >= 0 ? target.slice(hash + 1).replace(/^\^/, '') : '', alias, pipe };
}

function buildDecorations(state, ctx) {
  const decos = [];
  const doc = state.doc;
  // 编辑器失焦时不保留「当前行显示源码」，整篇都渲染
  const sel = ctx.focused ? state.selection.ranges : [];
  const active = new Set();
  for (const r of sel) for (let i = doc.lineAt(r.from).number; i <= doc.lineAt(r.to).number; i++) active.add(i);
  const lineActive = pos => active.has(doc.lineAt(pos).number);
  const rangeActive = (from, to) => sel.some(r => r.to >= from && r.from <= to);
  const lineClass = (pos, cls) => decos.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  const blockLines = (from, to) => [doc.lineAt(from).from, doc.lineAt(to).to];
  const from = ctx.path();

  // frontmatter → 属性面板
  let fmEnd = -1;
  const head = doc.sliceString(0, Math.min(doc.length, 30000));
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/.exec(head);
  if (fm) {
    fmEnd = fm[0].length;
    if (!rangeActive(0, fmEnd) && ctx.renderProps) decos.push(Decoration.replace({ widget: new PropsWidget(fm[0], ctx), block: true }).range(0, fmEnd));
  }

  syntaxTree(state).iterate({
    enter: n => {
      if (fm && n.to <= fmEnd + 1 && n.name !== 'Document') return false;
      const name = n.name;
      if (/^ATXHeading\d$/.test(name)) {
        lineClass(n.from, 'cm-lp-h cm-lp-h' + name.slice(-1));
        if (!lineActive(n.from)) {
          const mark = n.node.firstChild;
          if (mark && mark.name === 'HeaderMark') decos.push(hide.range(mark.from, Math.min(mark.to + 1, doc.lineAt(n.from).to)));
        }
        return;
      }
      switch (name) {
        case 'Emphasis': case 'StrongEmphasis': case 'Strikethrough': case 'InlineCode': case 'Highlight': {
          if (name === 'Highlight') decos.push(Decoration.mark({ class: 'cm-lp-hl' }).range(n.from, n.to));
          if (name === 'InlineCode') decos.push(Decoration.mark({ class: 'cm-lp-code' }).range(n.from, n.to));
          if (!lineActive(n.from)) {
            for (let c = n.node.firstChild; c; c = c.nextSibling) if (/Mark$/.test(c.name)) decos.push(hide.range(c.from, c.to));
          }
          return;
        }
        case 'Link': {
          const kids = [];
          for (let c = n.node.firstChild; c; c = c.nextSibling) kids.push(c);
          const marks = kids.filter(c => c.name === 'LinkMark');
          const url = kids.find(c => c.name === 'URL');
          if (marks.length < 2 || !url) return;
          const textFrom = marks[0].to, textTo = marks[1].from;
          if (textTo > textFrom) decos.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-url': doc.sliceString(url.from, url.to) } }).range(textFrom, textTo));
          if (!lineActive(n.from) && textTo > textFrom) { decos.push(hide.range(n.from, textFrom)); decos.push(hide.range(textTo, n.to)); }
          return false;
        }
        case 'URL': {
          const p = n.node.parent;
          if (p && (p.name === 'Link' || p.name === 'Image')) return;
          decos.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-url': doc.sliceString(n.from, n.to) } }).range(n.from, n.to));
          return;
        }
        case 'Image': {
          if (lineActive(n.from)) return false;
          const url = n.node.getChild('URL');
          if (!url) return false;
          let src = doc.sliceString(url.from, url.to);
          if (!/^(https?:|data:)/i.test(src)) { let t = src; try { t = decodeURIComponent(src); } catch { } const r = index.resolve(t, from); src = r ? api.raw(r) : src; }
          const alt = doc.sliceString(n.from + 2, doc.sliceString(n.from, n.to).indexOf(']') + n.from);
          const m = /\|(\d+)/.exec(alt);
          decos.push(Decoration.replace({ widget: new ImageWidget(src, alt, m ? m[1] : '', false) }).range(n.from, n.to));
          return false;
        }
        case 'WikiLink': {
          const w = parseWiki(doc.sliceString(n.from, n.to));
          const resolved = w.file ? index.resolve(w.file, from) : from;
          if (w.embed) {
            if (lineActive(n.from)) { decos.push(Decoration.mark({ class: 'cm-tok-link' }).range(n.from, n.to)); return false; }
            const line = doc.lineAt(n.from);
            const wholeLine = line.text.trim() === doc.sliceString(n.from, n.to);
            if (resolved && IMAGE_EXT.has(extname(resolved))) {
              const width = /^\d+/.exec(w.alias)?.[0] || '';
              if (wholeLine) decos.push(Decoration.replace({ widget: new ImageWidget(api.raw(resolved), w.file, width, true), block: true }).range(line.from, line.to));
              else decos.push(Decoration.replace({ widget: new ImageWidget(api.raw(resolved), w.file, width, false) }).range(n.from, n.to));
            } else if (resolved && wholeLine) {
              decos.push(Decoration.replace({ widget: new RenderedWidget(line.text.trim(), 'embed', ctx), block: true }).range(line.from, line.to));
            } else decos.push(Decoration.mark({ class: 'cm-lp-wikilink' + (resolved ? '' : ' is-unresolved'), attributes: { 'data-href': w.file, ...(resolved ? { 'data-path': resolved } : {}) } }).range(n.from, n.to));
            return false;
          }
          const textFrom = w.pipe >= 0 ? n.from + 2 + w.pipe + 1 : n.from + 2;
          const attrs = { 'data-href': w.file, 'data-heading': w.heading };
          if (resolved) attrs['data-path'] = resolved;
          decos.push(Decoration.mark({ class: 'cm-lp-wikilink' + (resolved ? '' : ' is-unresolved'), attributes: attrs }).range(textFrom, n.to - 2));
          if (!lineActive(n.from)) { decos.push(hide.range(n.from, textFrom)); decos.push(hide.range(n.to - 2, n.to)); }
          return false;
        }
        case 'Tag': {
          const tag = doc.sliceString(n.from + 1, n.to);
          decos.push(Decoration.mark({ class: 'cm-lp-tag', attributes: { 'data-tag': tag, style: `--tag-hue:${tagHue(tag)}` } }).range(n.from, n.to));
          return;
        }
        case 'HorizontalRule': {
          if (!lineActive(n.from)) { decos.push(Decoration.replace({ widget: new HrWidget() }).range(n.from, n.to)); lineClass(n.from, 'cm-lp-hr-line'); }
          return;
        }
        case 'Blockquote': {
          const first = doc.lineAt(n.from);
          const isCallout = /^\s*>\s*\[![\w-]+\]/.test(first.text);
          const [bf, bt] = blockLines(n.from, n.to);
          if (isCallout && !rangeActive(bf, bt)) {
            decos.push(Decoration.replace({ widget: new RenderedWidget(doc.sliceString(bf, bt), 'callout', ctx), block: true }).range(bf, bt));
            return false;
          }
          for (let p = bf; p <= bt;) {
            const l = doc.lineAt(p);
            lineClass(l.from, 'cm-lp-quote');
            if (!active.has(l.number)) { const m = /^\s*(>\s?)+/.exec(l.text); if (m) decos.push(hide.range(l.from, l.from + m[0].length)); }
            p = l.to + 1;
          }
          return;
        }
        case 'QuoteMark': return false;
        case 'Table': {
          const [bf, bt] = blockLines(n.from, n.to);
          if (!rangeActive(bf, bt)) { decos.push(Decoration.replace({ widget: new RenderedWidget(doc.sliceString(bf, bt), 'table', ctx), block: true }).range(bf, bt)); return false; }
          for (let p = bf; p <= bt;) { const l = doc.lineAt(p); lineClass(l.from, 'cm-lp-tableline'); p = l.to + 1; }
          return false;
        }
        case 'FencedCode': {
          const [bf, bt] = blockLines(n.from, n.to);
          const info = n.node.getChild('CodeInfo');
          const lang = info ? doc.sliceString(info.from, info.to).trim() : '';
          if (['contributionGraph', 'base'].includes(lang) && !rangeActive(bf, bt)) {
            decos.push(Decoration.replace({ widget: new RenderedWidget(doc.sliceString(bf, bt), 'code-' + lang, ctx), block: true }).range(bf, bt));
            return false;
          }
          const firstNo = doc.lineAt(bf).number, lastNo = doc.lineAt(bt).number;
          for (let i = firstNo; i <= lastNo; i++) {
            const l = doc.line(i);
            const edge = i === firstNo || (i === lastNo && /^\s*(```|~~~)/.test(l.text));
            lineClass(l.from, 'cm-lp-codeline' + (i === firstNo ? ' is-first' : '') + (i === lastNo ? ' is-last' : '') + (edge ? ' is-fence' : ''));
          }
          return false;
        }
        case 'ListMark': {
          const mark = doc.sliceString(n.from, n.to);
          const next = n.node.nextSibling;
          const isTask = next && next.name === 'Task';
          if (lineActive(n.from)) { decos.push(Decoration.mark({ class: 'cm-lp-listmark' }).range(n.from, n.to)); return; }
          if (isTask) decos.push(hide.range(n.from, Math.min(n.to + 1, next.from)));
          else if (/^[-*+]$/.test(mark)) decos.push(Decoration.replace({ widget: new BulletWidget() }).range(n.from, n.to));
          else decos.push(Decoration.mark({ class: 'cm-lp-listmark' }).range(n.from, n.to));
          return;
        }
        case 'TaskMarker': {
          const checked = /x/i.test(doc.sliceString(n.from, n.to));
          if (checked) lineClass(n.from, 'cm-lp-done');
          if (!lineActive(n.from)) decos.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(n.from, n.to));
          return;
        }
      }
    },
  });
  return Decoration.set(decos, true);
}

// frontmatter 行统一用等宽小字显示（两种模式都生效，避免 YAML 被误识别成标题）
function fmDecorations(state) {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/.exec(state.doc.sliceString(0, Math.min(state.doc.length, 30000)));
  if (!m) return Decoration.none;
  const out = [];
  for (let p = 0; p <= m[0].length && p <= state.doc.length;) { const l = state.doc.lineAt(p); out.push(Decoration.line({ class: 'cm-fm' }).range(l.from)); p = l.to + 1; }
  return Decoration.set(out);
}
const fmField = StateField.define({
  create: fmDecorations,
  update: (d, tr) => tr.docChanged ? fmDecorations(tr.state) : d,
  provide: f => EditorView.decorations.from(f),
});

function livePreview(ctx) {
  const field = StateField.define({
    create: s => buildDecorations(s, ctx),
    update(deco, tr) {
      if (tr.docChanged || tr.selection || tr.effects.some(e => e.is(refreshEffect)) || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return buildDecorations(tr.state, ctx);
      return deco;
    },
    provide: f => EditorView.decorations.from(f),
  });
  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false;
      const el = e.target.closest('.cm-lp-wikilink, .cm-lp-link, .cm-lp-tag');
      if (!el) return false;
      const pos = view.posAtDOM(el);
      const lineNo = view.state.doc.lineAt(pos).number;
      const onActive = view.hasFocus && view.state.selection.ranges.some(r => view.state.doc.lineAt(r.from).number <= lineNo && view.state.doc.lineAt(r.to).number >= lineNo);
      if (onActive && !(e.ctrlKey || e.metaKey)) return false;
      e.preventDefault();
      ctx.open({ path: el.dataset.path, href: el.dataset.href, heading: el.dataset.heading, url: el.dataset.url, tag: el.dataset.tag }, e);
      return true;
    },
  });
  const focus = EditorView.focusChangeEffect.of((state, focusing) => { ctx.focused = focusing; return refreshEffect.of(null); });
  return [field, clicks, focus, EditorView.editorAttributes.of({ class: 'is-live' })];
}

// ---------- [[ 双链补全 ----------
function linkCandidates(q, embed) {
  const out = [];
  const pool = embed ? [...index.notes.map(o => ({ name: o.n, path: o.p, t: o.t })), ...index.files.map(p => ({ name: p.split('/').pop(), path: p, file: true }))] : index.notes.map(o => ({ name: o.n, path: o.p, t: o.t, a: o.a }));
  if (!q) {
    const recent = store.get('recent', []).filter(p => index.pathSet.has(p) && p.endsWith('.md')).slice(0, 12);
    return recent.map(p => ({ title: p.split('/').pop().replace(/\.md$/, ''), note: p.slice(0, p.lastIndexOf('/')), icon: TYPE_ICON[index.typeOf(p)] || 'file-text', insert: p.split('/').pop().replace(/\.md$/, '') }));
  }
  const lq = q.toLowerCase();
  for (const it of pool) {
    let s = fuzzy(q, it.name);
    // 名称本身不含查询词时，才用别名匹配并插入 [[名称|别名]]
    if (it.a && !it.name.toLowerCase().includes(lq)) for (const a of it.a) { const sa = fuzzy(q, a); if (sa > s) { s = sa - 1; it.alias = a; } }
    if (s >= 0) out.push([s, it]);
    if (out.length > 4000) break;
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, 40).map(([, it]) => ({
    title: it.alias ? `${it.alias} → ${it.name}` : it.name,
    note: it.path.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/')) : '',
    icon: it.file ? 'image' : TYPE_ICON[it.t] || 'file-text',
    insert: it.name, alias: it.alias,
  }));
}

function wikiCompletion(ctx) {
  const m = ctx.matchBefore(/!?\[\[[^\[\]\n|#]*$/);
  if (!m) return null;
  const embed = m.text.startsWith('!');
  const q = m.text.slice(embed ? 3 : 2);
  const from = m.from + (embed ? 3 : 2);
  const items = linkCandidates(q, embed);
  if (!items.length) return null;
  return {
    from, filter: false,
    options: items.map(it => ({
      label: it.title, detail: it.note, type: 'note',
      apply(view, c, f, t) {
        const after = view.state.sliceDoc(t, t + 2);
        const text = it.insert + (it.alias ? '|' + it.alias : '');
        view.dispatch({ changes: { from: f, to: t, insert: text + (after === ']]' ? '' : ']]') }, selection: { anchor: f + text.length + 2 } });
      },
    })),
  };
}

function wrap(view, a, b) {
  view.dispatch(view.state.changeByRange(r => {
    const text = view.state.sliceDoc(r.from, r.to);
    return { changes: { from: r.from, to: r.to, insert: a + text + b }, range: CM.EditorSelection.range(r.from + a.length, r.to + a.length) };
  }));
  return true;
}

export function createEditor({ value = '', path = '', mode = 'live', onChange, onSave, onAction, renderProps, onOpen, attachmentFolder = '04_图片附件库' }) {
  let curPath = path;
  const ctx = { path: () => curPath, renderProps, open: (t, e) => onOpen?.(t, e) };
  const live = new Compartment();

  async function handleFiles(view, files) {
    for (const f of files) {
      const ext = (f.name.split('.').pop() || 'png').toLowerCase();
      const name = f.type.startsWith('image/') && (!f.name || f.name === 'image.png') ? `Pasted image ${formatDate('YYYYMMDDHHmmss')}.${ext}` : f.name;
      try {
        const r = await api.upload(f, name, attachmentFolder);
        await index.load();
        view.dispatch(view.state.replaceSelection(`![[${r.path.split('/').pop()}]]`));
        toast('已保存到 ' + r.path, 'success');
      } catch (err) { toast('上传失败：' + err.message, 'error'); }
    }
  }

  // 初始光标放在 frontmatter 之后，属性面板默认以表格显示
  const fmMatch = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(value);
  const startPos = fmMatch ? Math.min(value.length, fmMatch[0].length) : 0;
  const view = new EditorView({
    parent: h('div'),
    state: EditorState.create({
      doc: value,
      selection: { anchor: startPos },
      extensions: [
        history(), drawSelection(), dropCursor(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages, extensions: [OBSIDIAN_SYNTAX] }),
        syntaxHighlighting(highlight), fmField,
        closeBrackets(),
        autocompletion({ override: [wikiCompletion], icons: false, closeOnBlur: true }),
        highlightSelectionMatches(), search({ top: true }),
        placeholder('开始书写…  输入 [[ 插入双链，Ctrl+J 呼出 AI'),
        Prec.high(keymap.of([
          { key: 'Mod-s', run: () => { onSave?.(); return true; } },
          { key: 'Mod-b', run: v => wrap(v, '**', '**') },
          { key: 'Mod-i', run: v => wrap(v, '*', '*') },
          { key: 'Mod-k', run: v => wrap(v, '[[', ']]') },
          { key: 'Mod-Shift-h', run: v => wrap(v, '==', '==') },
          { key: 'Mod-j', run: () => { onAction?.('ai'); return true; } },
          { key: 'Mod-e', run: () => { onAction?.('toggle'); return true; } },
          { key: 'Tab', run: acceptCompletion },
        ])),
        keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, { key: 'Tab', run: indentMore, shift: indentLess }, ...defaultKeymap]),
        live.of(mode === 'live' ? livePreview(ctx) : []),
        EditorView.updateListener.of(u => { if (u.docChanged) onChange?.(u.state.doc.toString(), u); }),
        EditorView.domEventHandlers({
          paste(e, v) { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); handleFiles(v, files); return true; } return false; },
          drop(e, v) { const files = [...(e.dataTransfer?.files || [])]; if (files.length) { e.preventDefault(); handleFiles(v, files); return true; } return false; },
        }),
        EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off' }),
      ],
    }),
  });

  const sel = () => view.state.selection.main;
  return {
    el: view.dom, view,
    get value() { return view.state.doc.toString(); },
    setValue(v, { history: addHistory = false } = {}) {
      if (v === view.state.doc.toString()) return;
      const anchor = Math.min(sel().anchor, v.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v }, selection: { anchor }, annotations: Transaction.addToHistory.of(addHistory) });
    },
    replaceAll(v) {
      const anchor = Math.min(sel().anchor, v.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v }, selection: { anchor } });
    },
    focus() { view.focus(); },
    selection() { return view.state.sliceDoc(sel().from, sel().to); },
    range() { return [sel().from, sel().to]; },
    setSelection(a, b = a) { view.dispatch({ selection: { anchor: a, head: b } }); },
    insert(text, start = sel().from, end = sel().to) {
      view.dispatch({ changes: { from: start, to: end, insert: text }, selection: { anchor: start + text.length }, scrollIntoView: true });
      view.focus();
    },
    gotoLine(n) {
      const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, n + 1)));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 90 }) });
      view.focus();
    },
    setMode(m) { view.dispatch({ effects: live.reconfigure(m === 'live' ? livePreview(ctx) : []) }); },
    refresh() { view.dispatch({ effects: refreshEffect.of(null) }); },
    setPath(p) { curPath = p; },
    destroy() { view.destroy(); },
  };
}
