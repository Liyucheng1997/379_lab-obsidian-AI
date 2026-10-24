// Obsidian Bases（.base）解析与求值：filters / sort / groupBy / cards / table / kanban
import { deps } from './deps.js';
import { collator, dirOf } from './vault.js';

// ---------- 表达式：词法 + Pratt 解析 ----------
function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; } else s += src[j++]; }
      toks.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue; }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('<>!+-*/%().,[]'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    let j = i;
    while (j < src.length && /[\p{L}\p{N}_$\-]/u.test(src[j])) {
      if (src[j] === '-' && !/[\p{L}\p{N}_]/u.test(src[j + 1] || '')) break;
      j++;
    }
    if (j === i) { j = i + 1; }
    toks.push({ t: 'id', v: src.slice(i, j) }); i = j;
  }
  return toks;
}

const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = v => { const t = next(); if (!t || t.v !== v) throw new Error('期望 ' + v); };
  function primary() {
    const t = next();
    if (!t) throw new Error('表达式不完整');
    let node;
    if (t.t === 'str') node = { k: 'lit', v: t.v };
    else if (t.t === 'num') node = { k: 'lit', v: t.v };
    else if (t.v === '(') { node = expr(0); expect(')'); }
    else if (t.v === '!') return { k: 'not', a: primary() };
    else if (t.v === '-') return { k: 'neg', a: primary() };
    else if (t.v === '[') { const items = []; while (peek() && peek().v !== ']') { items.push(expr(0)); if (peek()?.v === ',') next(); } expect(']'); node = { k: 'arr', items }; }
    else if (t.t === 'id') {
      if (t.v === 'true') node = { k: 'lit', v: true };
      else if (t.v === 'false') node = { k: 'lit', v: false };
      else if (t.v === 'null') node = { k: 'lit', v: null };
      else node = { k: 'id', v: t.v };
    } else throw new Error('无法识别 ' + t.v);
    // 后缀：.prop / .method() / [idx] / fn()
    while (peek() && (peek().v === '.' || peek().v === '(' || peek().v === '[')) {
      const o = next();
      if (o.v === '.') { const id = next(); node = { k: 'get', o: node, n: id.v }; }
      else if (o.v === '[') { const idx = expr(0); expect(']'); node = { k: 'idx', o: node, i: idx }; }
      else { const args = []; while (peek() && peek().v !== ')') { args.push(expr(0)); if (peek()?.v === ',') next(); } expect(')'); node = { k: 'call', f: node, args }; }
    }
    return node;
  }
  function expr(minP) {
    let left = primary();
    while (peek() && peek().t === 'op' && PREC[peek().v] && PREC[peek().v] > minP) {
      const op = next().v;
      const right = expr(PREC[op]);
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  }
  const r = expr(0);
  if (p < toks.length) throw new Error('多余内容: ' + toks[p].v);
  return r;
}

// ---------- 求值 ----------
function linkName(v) {
  const m = /^\[\[([^\]|#]+)/.exec(String(v));
  return m ? m[1].split('/').pop() : String(v);
}

function fileObj(e, vault) {
  return {
    __file: true,
    name: e.name, basename: e.name, path: e.path, folder: dirOf(e.path), ext: e.ext,
    size: e.size, ctime: e.ctime, mtime: e.mtime,
    tags: e.tags || [], links: (e.links || []), properties: e.fm || {},
    inFolder: f => { f = String(f).replace(/\/$/, ''); return e.path.startsWith(f + '/'); },
    hasTag: (...ts) => ts.some(t => { t = String(t).replace(/^#/, ''); return (e.tags || []).some(x => x === t || x.startsWith(t + '/')); }),
    hasLink: l => { const r = vault.resolve(linkName(l), e.path); return !!r && (e.out || []).includes(r); },
    hasProperty: k => e.fm && Object.prototype.hasOwnProperty.call(e.fm, k),
  };
}

function callMethod(obj, name, args) {
  if (obj == null) {
    if (name === 'isEmpty') return true;
    return null;
  }
  if (obj.__file && typeof obj[name] === 'function') return obj[name](...args);
  const s = Array.isArray(obj) ? obj : String(obj);
  switch (name) {
    case 'contains': return Array.isArray(obj) ? obj.some(x => String(x) === String(args[0]) || linkName(x) === linkName(args[0])) : s.includes(String(args[0]));
    case 'containsAny': return args.some(a => callMethod(obj, 'contains', [a]));
    case 'containsAll': return args.every(a => callMethod(obj, 'contains', [a]));
    case 'startsWith': return String(obj).startsWith(String(args[0]));
    case 'endsWith': return String(obj).endsWith(String(args[0]));
    case 'isEmpty': return Array.isArray(obj) ? obj.length === 0 : String(obj).trim() === '';
    case 'lower': return String(obj).toLowerCase();
    case 'upper': return String(obj).toUpperCase();
    case 'trim': return String(obj).trim();
    case 'toString': return String(obj);
    case 'join': return Array.isArray(obj) ? obj.join(args[0] ?? ', ') : String(obj);
    case 'slice': return s.slice(args[0], args[1]);
    case 'split': return String(obj).split(String(args[0]));
    case 'replace': return String(obj).split(String(args[0])).join(String(args[1] ?? ''));
    case 'length': return s.length;
    default: return null;
  }
}

function getProp(obj, name) {
  if (obj == null) return null;
  if (name === 'length' && (typeof obj === 'string' || Array.isArray(obj))) return obj.length;
  if (typeof obj === 'object') return obj[name] ?? null;
  return null;
}

function cmpVals(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
  return collator.compare(String(a), String(b));
}

function eq(a, b) {
  if (Array.isArray(a)) return a.some(x => eq(x, b));
  if (a == null || b == null) return (a == null || a === '') && (b == null || b === '');
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  if (a instanceof Date) a = a.toISOString().slice(0, 10);
  return String(a) === String(b) || linkName(a) === String(b);
}

function evaluate(node, ctx) {
  switch (node.k) {
    case 'lit': return node.v;
    case 'arr': return node.items.map(n => evaluate(n, ctx));
    case 'id': {
      if (node.v === 'file') return ctx.file;
      if (node.v === 'note') return ctx.note;
      if (node.v === 'formula') return ctx.formula;
      if (node.v === 'this') return ctx.thisFile || {};
      return ctx.note[node.v] ?? null;
    }
    case 'get': {
      const o = evaluate(node.o, ctx);
      if (o && o.__formula) return ctx.formulaValue(node.n);
      return getProp(o, node.n);
    }
    case 'idx': { const o = evaluate(node.o, ctx); const i = evaluate(node.i, ctx); return o == null ? null : o[i] ?? null; }
    case 'call': {
      const args = node.args.map(a => evaluate(a, ctx));
      if (node.f.k === 'get') { const o = evaluate(node.f.o, ctx); return callMethod(o, node.f.n, args); }
      if (node.f.k === 'id') {
        const fn = node.f.v;
        if (fn === 'if') return args[0] ? args[1] : args[2];
        if (fn === 'link') return `[[${args[0]}]]`;
        if (fn === 'number') return Number(args[0]);
        if (fn === 'now') return Date.now();
        if (fn === 'today') return new Date().toISOString().slice(0, 10);
        if (fn === 'list') return Array.isArray(args[0]) ? args[0] : [args[0]];
        if (fn === 'max') return Math.max(...args.map(Number));
        if (fn === 'min') return Math.min(...args.map(Number));
      }
      return null;
    }
    case 'not': return !evaluate(node.a, ctx);
    case 'neg': return -evaluate(node.a, ctx);
    case 'bin': {
      if (node.op === '&&') return evaluate(node.a, ctx) && evaluate(node.b, ctx);
      if (node.op === '||') return evaluate(node.a, ctx) || evaluate(node.b, ctx);
      const a = evaluate(node.a, ctx), b = evaluate(node.b, ctx);
      switch (node.op) {
        case '==': return eq(a, b);
        case '!=': return !eq(a, b);
        case '>': return cmpVals(a, b) > 0;
        case '<': return cmpVals(a, b) < 0;
        case '>=': return cmpVals(a, b) >= 0;
        case '<=': return cmpVals(a, b) <= 0;
        case '+': return (typeof a === 'number' && typeof b === 'number') ? a + b : String(a ?? '') + String(b ?? '');
        case '-': return Number(a) - Number(b);
        case '*': return Number(a) * Number(b);
        case '/': return Number(a) / Number(b);
        case '%': return Number(a) % Number(b);
      }
    }
  }
  return null;
}

const cache = new Map();
function compiled(src) {
  if (!cache.has(src)) { try { cache.set(src, parse(src)); } catch (e) { cache.set(src, { k: 'lit', v: false, err: e.message }); } }
  return cache.get(src);
}

function testFilter(f, ctx) {
  if (f == null) return true;
  if (typeof f === 'string') return !!evaluate(compiled(f), ctx);
  if (Array.isArray(f)) return f.every(x => testFilter(x, ctx));
  if (f.and) return f.and.every(x => testFilter(x, ctx));
  if (f.or) return f.or.some(x => testFilter(x, ctx));
  if (f.not) return !(Array.isArray(f.not) ? f.not : [f.not]).some(x => testFilter(x, ctx));
  return true;
}

function makeCtx(e, vault, formulas) {
  const ctx = { file: fileObj(e, vault), note: e.fm || {}, formula: { __formula: true } };
  const fcache = {};
  ctx.formulaValue = n => {
    if (n in fcache) return fcache[n];
    fcache[n] = null;
    if (formulas && formulas[n]) fcache[n] = evaluate(compiled(String(formulas[n])), ctx);
    return fcache[n];
  };
  return ctx;
}

function valueOf(id, ctx) {
  if (!id) return null;
  if (id.startsWith('file.')) return getProp(ctx.file, id.slice(5));
  if (id.startsWith('note.')) return ctx.note[id.slice(5)] ?? null;
  if (id.startsWith('formula.')) return ctx.formulaValue(id.slice(8));
  return ctx.note[id] ?? null;
}

function display(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(display).filter(Boolean).join('、');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number' && v > 1e11) return new Date(v).toISOString().slice(0, 10);
  return String(v);
}

function resolveImage(v, e, vault) {
  if (!v) return null;
  let s = Array.isArray(v) ? v[0] : v;
  s = String(s).trim();
  if (/^https?:\/\//.test(s)) return { url: s };
  const name = linkName(s).replace(/^!/, '');
  const p = vault.resolve(name, e.path);
  return p ? { path: p } : null;
}

function loadBase(text) {
  let def;
  try { def = deps.yaml.load(text) || {}; } catch (err) { throw Object.assign(new Error('Base 文件 YAML 解析失败：' + err.message), { status: 400 }); }
  if (!Array.isArray(def.views) || !def.views.length) def.views = [{ type: 'table', name: '表格' }];
  return def;
}

function runView(def, viewIdx, vault, opts = {}) {
  const view = def.views[viewIdx] || def.views[0];
  const limit = opts.limit || 3000;
  const rows = [];
  let total = 0;
  for (const e of vault.files.values()) {
    if (e.ext !== 'md') continue;
    const ctx = makeCtx(e, vault, def.formulas);
    if (!testFilter(def.filters, ctx) || !testFilter(view.filters, ctx)) continue;
    total++;
    rows.push({ e, ctx });
  }
  const sorts = Array.isArray(view.sort) && view.sort.length ? view.sort : [{ property: 'file.name', direction: 'ASC' }];
  rows.sort((x, y) => {
    for (const s of sorts) {
      const c = cmpVals(display(valueOf(s.property, x.ctx)), display(valueOf(s.property, y.ctx)));
      if (c) return String(s.direction).toUpperCase() === 'DESC' ? -c : c;
    }
    return 0;
  });
  const order = Array.isArray(view.order) && view.order.length ? view.order : ['file.name'];
  const imgId = view.image;
  const groupProp = view.groupBy?.property;
  const groups = new Map();
  for (const { e, ctx } of rows.slice(0, limit)) {
    const item = { path: e.path, name: e.name, props: {} };
    for (const id of order) item.props[id] = display(valueOf(id, ctx));
    if (imgId) item.image = resolveImage(valueOf(imgId, ctx), e, vault);
    const key = groupProp ? (display(valueOf(groupProp, ctx)) || '（未设置）') : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  let gl = [...groups.entries()].map(([key, items]) => ({ key, items }));
  if (groupProp) {
    const dir = String(view.groupBy.direction || 'ASC').toUpperCase();
    gl.sort((a, b) => { const c = cmpVals(a.key, b.key); return dir === 'DESC' ? -c : c; });
  }
  const propNames = def.properties || {};
  const columns = order.map(id => ({ id, label: propNames[id]?.displayName || (id === 'file.name' ? '文件名' : id.replace(/^(note|file|formula)\./, '')) }));
  return {
    views: def.views.map((v, i) => ({ name: v.name || `视图 ${i + 1}`, type: v.type || 'table' })),
    index: def.views.indexOf(view),
    view: { name: view.name, type: view.type || 'table', cardSize: view.cardSize, imageAspectRatio: view.imageAspectRatio, imageFit: view.imageFit, columnWidth: view.columnWidth, hasImage: !!imgId, groupBy: groupProp || null },
    columns, groups: gl, total, truncated: total > limit,
  };
}

export { loadBase, runView, parse, evaluate };
