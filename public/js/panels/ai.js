// AI 助手：侧栏对话、笔记动作（按模板补全 / 总结 / 双链 / 费曼解释 / 自测）、Ctrl+J 行内改写
import { h, esc, splitFM, toast, store, basename, debounce } from '../util.js';
import { icon, iconHTML } from '../icons.js';
import { api } from '../api.js';
import { app } from '../ctx.js';
import { renderMarkdown, enhance } from '../markdown.js';
import { openModal } from '../modals.js';
import { CARD_SECTIONS } from '../schema.js';

const SYSTEM = `你是「AI 版 Obsidian」内置的读书笔记助手，服务于一个按「卡片笔记法 + 主题阅读 + 费曼学习法」组织的中文知识库。
仓库约定：
- 永久知识卡片之间用 [[双链]] 连接。值得单独成卡的人物、概念、书籍、事件、地名，用 [[名称]] 包起来，名称取最常见的中文写法，不要加书名号。
- 概念卡片固定六段：## 1 简要描述 / ## 2 详细解释 / ## 3 图形展示 / ## 4 我的理解 / ## 5 相关概念 / ## 6 概念出处。
- 每段内部用有序列表，每条写成「1. 内容，」，最后一条以「。」结尾；一条只讲一个要点，短句、具体、不空泛。
- 书籍笔记命名为「【书籍】书名」，「## 2 详细解释」按章节列出 [[书名 章节名]] 形式的子卡片；电影笔记命名为「【电影】片名」。
- 人物卡片结构：## 1 人物姓名 / ## 2 具体职位 / ## 3 见面场所 / ## 4 相关图片 / ## 5 额外信息。
- 用简体中文和 Obsidian Markdown 输出；除非用户要求，不输出 YAML frontmatter，不寒暄，不复述问题，不使用表情符号。`;

const TEMPLATE_HINT = {
  书籍: '这是一张书籍卡片：「## 1 简要描述」用 2-3 条概括全书主旨与作者；「## 2 详细解释」按章节列出 [[书名 章节名]] 子卡片；「## 4 我的理解」写 2-3 条启发；「## 5 相关概念」列出书中关键概念的双链；「## 6 概念出处」写作者与出版信息。',
  人物: '这是一张人物卡片：按「## 1 人物姓名 / ## 2 具体职位 / ## 3 见面场所 / ## 4 相关图片 / ## 5 额外信息」填写；历史人物「## 3 见面场所」可写主要活动地点，「## 5 额外信息」列代表作与关联人物的双链。',
  电影: '这是一张电影卡片：「## 1 简要描述」写剧情梗概；「## 2 详细解释」列导演、主演、关键情节与配乐的双链；「## 4 我的理解」写主题与看点。',
  主题: '这是一张主题索引卡片：围绕主题由宏观到具体列出一组 [[概念]] 双链，形成阅读路径。',
};

function sectionsHint(type) {
  return TEMPLATE_HINT[type] || `这是一张概念卡片，按六段结构填写：${CARD_SECTIONS.map(s => '## ' + s).join(' / ')}。「## 3 图形展示」若无图片可写一个 Mermaid 或文字示意；「## 5 相关概念」列 5-8 个双链；「## 6 概念出处」写最早提出者、经典著作或学科。`;
}

const ACTIONS = {
  fill: { label: '按模板补全卡片', icon: 'wand', needNote: true, apply: 'body',
    prompt: (n) => `请根据笔记标题「${n.title}」和已有内容，把这张卡片补全。${sectionsHint(n.type)}\n保留已有内容和已有双链，只补充空白段落、完善不足之处。直接输出完整正文（从第一个 ## 标题开始，不要 frontmatter）。` },
  summary: { label: '总结要点', icon: 'list', needNote: true, prompt: n => `用 3-5 条有序列表总结笔记「${n.title}」的核心要点，按仓库格式（「1. 内容，」，最后一条以「。」结尾），关键概念加 [[双链]]。` },
  links: { label: '生成相关概念双链', icon: 'link', needNote: true, apply: 'section:相关概念',
    prompt: n => `为笔记「${n.title}」推荐 6-10 个值得建立卡片的相关概念/人物/书籍。只输出有序列表，每条格式为「1. [[名称]]：一句话说明关系，」，最后一条以「。」结尾。优先推荐正文里已经提到但还没加双链的概念。` },
  feynman: { label: '费曼式解释', icon: 'bulb', needNote: true, prompt: n => `用费曼学习法讲解「${n.title}」：先用一个十岁孩子能听懂的话解释（不超过 120 字），再给一个生活中的类比，最后指出最容易误解的 2 个地方。` },
  quiz: { label: '出题自测', icon: 'target', needNote: true, prompt: n => `根据笔记「${n.title}」的内容出 5 道自测题（由易到难，包含 1 道开放题），每题后面用 > [!tip]- 答案 的折叠 callout 给出参考答案。` },
  outline: { label: '生成读书大纲', icon: 'book-open', needNote: true, apply: 'section:详细解释',
    prompt: n => `为书籍「${n.title.replace(/^【书籍】/, '')}」列出章节结构，用于「## 2 详细解释」。只输出有序列表，每条格式「1. [[${n.title.replace(/^【书籍】/, '')} 章节名]]，」，最后一条以「。」结尾。如不确定真实目录，请按主题合理划分并在最后单独一行注明「（目录为 AI 推测，请核对）」。` },
  polish: { label: '润色（去 AI 味）', icon: 'feather', selection: true, apply: 'selection',
    prompt: () => '润色下面的文字：保留原意和作者语气，删掉套话、空洞的排比和“不是…而是…”“值得注意的是”之类的模板化表达，句子更短更具体。只输出改好的文字。' },
  translate: { label: '中英互译', icon: 'languages', selection: true, apply: 'selection', prompt: () => '把下面的文字翻译成另一种语言（中文→英文，英文→中文），保留 Markdown 格式与 [[双链]]。只输出译文。' },
};

function noteInfo(view) {
  if (!view || view.type !== 'note') return null;
  const { fm, body } = splitFM(view.content);
  return { title: view.title, path: view.path, type: fm['类型'] || '', fm, body };
}

async function buildSystem({ useNote, useVault, query, view, selection }) {
  let sys = SYSTEM;
  const n = noteInfo(view);
  if (useNote && n) {
    const props = Object.entries(n.fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('、') : v instanceof Date ? v.toISOString().slice(0, 10) : v}`).join('\n');
    sys += `\n\n# 当前笔记\n标题：${n.title}\n路径：${n.path}\n${props ? '属性：\n' + props + '\n' : ''}正文：\n"""\n${n.body.slice(0, 14000)}\n"""`;
  }
  if (selection) sys += `\n\n# 用户选中的文字\n"""\n${selection.slice(0, 6000)}\n"""`;
  let refs = [];
  if (useVault && query) {
    try { refs = await api.retrieve(query + (n ? ' ' + n.title : ''), 6, n?.path); } catch { }
    if (refs.length) sys += `\n\n# 知识库中可能相关的笔记（回答时可引用，用 [[笔记名]] 标注来源）\n` + refs.map(r => `## [[${r.name}]]\n${r.excerpt.slice(0, 1200)}`).join('\n\n');
  }
  return { system: sys, refs };
}

function insertIntoSection(view, heading, text) {
  const lines = view.content.split('\n');
  const i = lines.findIndex(l => /^#{1,6}\s/.test(l) && l.includes(heading));
  if (i < 0) { view.appendText(`## ${heading}\n${text.trim()}`); return; }
  let j = i + 1;
  while (j < lines.length && !/^#{1,6}\s/.test(lines[j])) j++;
  while (j - 1 > i && !lines[j - 1].trim()) j--;
  const existing = lines.slice(i + 1, j).filter(l => l.trim() && !/^\d+\.\s*$/.test(l.trim()));
  lines.splice(i + 1, j - i - 1, ...existing, ...text.trim().split('\n'));
  view.setContent(lines.join('\n'));
}

export class AIPanel {
  constructor() {
    this.messages = store.get('ai:history', []);
    this.useNote = store.get('ai:useNote', true);
    this.useVault = store.get('ai:useVault', true);
    this.busy = null;
    this.el = h('div', { class: 'panel ai-panel' });
    this.status = h('button', { class: 'ai-model', title: '模型设置' });
    this.status.onclick = () => app.openSettings('ai');
    const newBtn = h('button', { class: 'icon-btn', title: '新对话' }, icon('plus', 17));
    newBtn.onclick = () => { this.messages = []; this.persist(); this.renderMessages(); };
    const ctxNote = this.toggle('当前笔记', 'file-text', () => this.useNote, v => { this.useNote = v; store.set('ai:useNote', v); });
    const ctxVault = this.toggle('知识库检索', 'database', () => this.useVault, v => { this.useVault = v; store.set('ai:useVault', v); });
    this.quick = h('div', { class: 'ai-quick' }, ...['fill', 'summary', 'links', 'feynman', 'quiz'].map(k => {
      const b = h('button', { class: 'chip' }, icon(ACTIONS[k].icon, 13), ' ', ACTIONS[k].label);
      b.onclick = () => this.runAction(k);
      return b;
    }));
    this.list = h('div', { class: 'ai-messages' });
    this.input = h('textarea', { class: 'ai-input', rows: 1, placeholder: '问问你的知识库…', title: 'Enter 发送，Shift+Enter 换行' });
    this.sendBtn = h('button', { class: 'ai-send', title: '发送' }, icon('send', 17));
    this.sendBtn.onclick = () => this.busy ? this.stop() : this.send();
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); } });
    this.input.addEventListener('input', () => { this.input.style.height = 'auto'; this.input.style.height = Math.min(160, this.input.scrollHeight) + 'px'; });
    this.el.append(
      h('div', { class: 'ai-head' }, h('div', { class: 'ai-title' }, icon('sparkles', 16), h('span', null, 'AI 助手')), this.status, newBtn),
      h('div', { class: 'ai-ctx' }, ctxNote, ctxVault),
      this.quick,
      h('div', { class: 'panel-scroll ai-scroll' }, this.list),
      h('div', { class: 'ai-composer' }, this.input, this.sendBtn));
    this.list.addEventListener('click', e => {
      const a = e.target.closest('a.internal-link'); if (!a) return;
      e.preventDefault();
      if (a.dataset.path) app.open(a.dataset.path, { newTab: e.ctrlKey || e.metaKey }); else if (a.dataset.href) app.createAndOpen(a.dataset.href);
    });
    this.renderMessages();
  }

  toggle(label, ic, get, set) {
    const b = h('button', { class: 'chip' + (get() ? ' active' : '') }, icon(ic, 13), ' ', label);
    b.onclick = () => { set(!get()); b.classList.toggle('active', get()); };
    return b;
  }
  persist() { store.set('ai:history', this.messages.slice(-30).map(m => ({ role: m.role, content: m.content, action: m.action, notePath: m.notePath }))); }

  setStatus(s) {
    this.cfg = s;
    const preset = s.presets?.[s.ai.provider];
    const ok = s.ai.hasKey || preset?.noKey;
    this.status.innerHTML = '';
    this.status.append(h('span', { class: 'dot ' + (ok ? 'dot-ok' : 'dot-warn') }), h('span', null, ok ? `${preset?.label || s.ai.provider} · ${s.ai.model || preset?.model || '未设置模型'}` : '未配置 API'));
  }
  get configured() { const s = this.cfg; if (!s) return false; return !!(s.ai.hasKey || s.presets?.[s.ai.provider]?.noKey); }

  renderMessages() {
    this.list.innerHTML = '';
    if (!this.messages.length) {
      this.list.append(h('div', { class: 'ai-empty' },
        h('div', { class: 'ai-empty-ico', html: iconHTML('sparkles', 26) }),
        h('p', null, '我会结合当前笔记和整个知识库回答问题，也可以按你的卡片模板补全内容。'),
        h('div', { class: 'ai-examples' }, ...['这本书和我读过的哪些书有关联？', '用三句话解释这个概念', '帮我把这张卡片的相关概念补全'].map(q => { const b = h('button', { class: 'ai-example' }, q); b.onclick = () => { this.input.value = q; this.send(); }; return b; }))));
      return;
    }
    this.messages.forEach((m, i) => this.list.append(this.messageEl(m, i)));
    this.scrollDown();
  }
  scrollDown() { const s = this.list.parentElement; s.scrollTop = s.scrollHeight; }

  messageEl(m, i) {
    if (m.role === 'user') return h('div', { class: 'ai-msg user' }, h('div', { class: 'ai-bubble' }, m.display || m.content));
    const body = h('div', { class: 'ai-bubble markdown-rendered' });
    body.innerHTML = renderMarkdown(m.content || '', m.notePath || '');
    enhance(body, m.notePath || '', 2);
    const wrap = h('div', { class: 'ai-msg assistant' + (m.error ? ' is-error' : '') }, body);
    if (m.refs?.length) wrap.append(h('div', { class: 'ai-refs' }, h('span', { class: 'muted' }, '参考：'), ...m.refs.map(r => h('a', { class: 'internal-link ref-chip', 'data-path': r.path }, r.name))));
    if (!m.streaming && !m.error && m.content) wrap.append(this.toolbar(m));
    m.el = body;
    void i;
    return wrap;
  }

  toolbar(m) {
    const bar = h('div', { class: 'ai-tools' });
    const add = (ic, label, fn, primary) => { const b = h('button', { class: 'ai-tool' + (primary ? ' primary' : '') }, icon(ic, 13), label); b.onclick = fn; bar.append(b); };
    const view = () => { const v = app.activeView(); if (!v || v.type !== 'note') { toast('请先打开一篇笔记', 'error'); return null; } return v; };
    const act = ACTIONS[m.action];
    if (act?.apply === 'body') add('wand', '替换正文', () => { const v = view(); if (v) { v.replaceBody(m.content); toast('已替换正文，属性保持不变', 'success'); } }, true);
    if (act?.apply?.startsWith('section:')) { const sec = act.apply.slice(8); add('insert', `写入「${sec}」`, () => { const v = view(); if (v) { insertIntoSection(v, sec, m.content); toast('已写入', 'success'); } }, true); }
    if (act?.apply === 'selection' && m.selection) add('wand', '替换选中', () => { const v = view(); if (v && !v.replaceSelection(m.content)) toast('请先在编辑模式中选中文字', 'error'); }, true);
    add('insert', '插入光标处', () => { const v = view(); if (v) v.insertAtCursor(m.content); });
    add('plus', '追加到末尾', () => { const v = view(); if (v) { v.appendText(m.content); toast('已追加', 'success'); } });
    add('file-plus', '存为新笔记', async () => { const firstLine = m.content.split('\n').find(l => l.trim())?.replace(/^[#>\-*\d.\s]+/, '').slice(0, 30) || 'AI 笔记'; await app.createNote({ name: firstLine.replace(/[\\/:*?"<>|\[\]]/g, ''), content: m.content, folder: app.meta.newFileFolder || '' }); });
    add('copy', '复制', () => { navigator.clipboard?.writeText(m.content); toast('已复制'); });
    return bar;
  }

  async send(text, opts = {}) {
    text = (text ?? this.input.value).trim();
    if (!text || this.busy) return;
    if (!this.configured) { toast('请先配置 AI 模型和 API Key', 'error'); app.openSettings('ai'); return; }
    this.input.value = ''; this.input.style.height = 'auto';
    const view = app.activeView();
    const selection = opts.selection || '';
    const userMsg = { role: 'user', content: text, display: opts.display };
    this.messages.push(userMsg);
    const { system, refs } = await buildSystem({ useNote: opts.useNote ?? this.useNote, useVault: opts.useVault ?? this.useVault, query: opts.query || text, view, selection });
    const ans = { role: 'assistant', content: '', streaming: true, action: opts.action, notePath: view?.path, selection, refs };
    this.messages.push(ans);
    this.renderMessages();
    const history = this.messages.filter(m => m !== ans && !m.error).slice(-11).map(m => ({ role: m.role, content: m.content }));
    this.setBusy(true);
    const paint = debounce(() => { ans.el.innerHTML = renderMarkdown(ans.content, ans.notePath || ''); this.scrollDown(); }, 60);
    try {
      this.busy = api.chat({ system, messages: history }, (t, full) => { ans.content = full; paint(); });
      await this.busy.done;
    } catch (e) {
      if (e.name === 'AbortError') ans.content += '\n\n*（已停止）*';
      else { ans.content = '出错了：' + e.message; ans.error = true; }
    }
    paint.cancel();
    ans.streaming = false;
    this.setBusy(false);
    this.persist();
    this.renderMessages();
    return ans;
  }
  stop() { this.busy?.abort?.(); }
  setBusy(b) { if (!b) this.busy = null; this.sendBtn.replaceChildren(icon(b ? 'stop' : 'send', 17)); this.sendBtn.classList.toggle('is-busy', b); this.el.classList.toggle('is-busy', b); }

  runAction(key, view = app.activeView()) {
    const a = ACTIONS[key];
    const n = noteInfo(view);
    if (a.needNote && !n) { toast('请先打开一篇笔记', 'error'); return; }
    app.showRight('ai');
    const selection = view?.getSelection?.() || '';
    if (a.selection && !selection) { toast('请先选中一段文字', 'error'); return; }
    const prompt = a.prompt(n || {});
    return this.send(a.selection ? prompt : prompt, { action: key, display: a.label + (n ? ` · ${n.title}` : ''), selection: a.selection ? selection : '', useNote: a.needNote ? true : undefined, query: n?.title });
  }
}

// 笔记标题栏「AI」菜单
export function noteMenu(view) {
  const panel = app.aiPanel;
  const t = splitFM(view.content).fm['类型'];
  return [
    { header: 'AI 动作' },
    { label: '按模板补全卡片', icon: 'wand', onClick: () => panel.runAction('fill', view) },
    { label: '直接写入（流式补全）', icon: 'sparkles', onClick: () => fillNote(view) },
    t === '书籍' ? { label: '生成读书大纲', icon: 'book-open', onClick: () => panel.runAction('outline', view) } : null,
    { label: '生成相关概念双链', icon: 'link', onClick: () => panel.runAction('links', view) },
    { label: '总结要点', icon: 'list', onClick: () => panel.runAction('summary', view) },
    { label: '费曼式解释', icon: 'bulb', onClick: () => panel.runAction('feynman', view) },
    { label: '出题自测', icon: 'target', onClick: () => panel.runAction('quiz', view) },
    { sep: true },
    { label: '改写选中内容…', icon: 'feather', hint: 'Ctrl+J', onClick: () => inline(view) },
  ];
}

// 直接把 AI 输出流式写入笔记正文（新建 AI 卡片时使用）
export async function fillNote(view, extra = '') {
  const panel = app.aiPanel;
  if (!panel.configured) { toast('请先配置 AI 模型和 API Key', 'error'); app.openSettings('ai'); return; }
  const n = noteInfo(view);
  if (!n) return;
  const { system } = await buildSystem({ useNote: true, useVault: true, query: n.title, view });
  const { hasFM, fmEnd } = splitFM(view.content);
  const head = hasFM ? view.content.slice(0, fmEnd) : '';
  const original = view.content;
  if (view.mode === 'read') view.setMode('edit');
  view.el.classList.add('is-ai-writing');
  app.setSaveState('saving', 'AI 正在写入…');
  try {
    const job = api.chat({ system, messages: [{ role: 'user', content: ACTIONS.fill.prompt(n) + (extra ? '\n补充要求：' + extra : '') }] }, (t, full) => {
      view.content = head + full;
      view.editor?.setValue(view.content);
    });
    view.aiJob = job;
    const full = await job.done;
    view.setContent(head + full.trim() + '\n');
    toast('AI 已完成写入', 'success');
  } catch (e) {
    if (e.name !== 'AbortError') { toast('AI 出错：' + e.message, 'error'); view.setContent(original, { save: false }); }
    else view.setContent(view.content);
  } finally { view.el.classList.remove('is-ai-writing'); view.aiJob = null; }
}

// Ctrl+J：改写选中内容 / 在光标处生成
export function inline(view) {
  if (!app.aiPanel.configured) { toast('请先配置 AI 模型和 API Key', 'error'); app.openSettings('ai'); return; }
  const sel = view.getSelection();
  const range = view.editor?.range();
  const input = h('input', { class: 'input', placeholder: sel ? '想怎么改？例如：改成三条要点' : '想写点什么？例如：补充这个概念的历史背景', style: { width: '100%' } });
  const chips = h('div', { class: 'ai-quick' }, ...(sel ? ['润色（去 AI 味）', '扩写', '精简', '改成有序列表', '翻译', '加上双链'] : ['续写一段', '写一个例子', '列出关键概念', '写一个类比']).map(q => { const b = h('button', { class: 'chip' }, q); b.onclick = () => { input.value = q; go(); }; return b; }));
  const out = h('div', { class: 'markdown-rendered inline-out' });
  const replaceBtn = h('button', { class: 'btn btn-primary', disabled: true }, sel ? '替换选中' : '插入');
  const belowBtn = h('button', { class: 'btn', disabled: true }, '插入到下方');
  const m = openModal({ title: sel ? 'AI 改写选中内容' : 'AI 在光标处生成', width: 600, body: h('div', { class: 'form' }, sel ? h('blockquote', { class: 'inline-sel' }, sel.slice(0, 400) + (sel.length > 400 ? '…' : '')) : null, input, chips, out), footer: [belowBtn, replaceBtn], onClose: () => job?.abort() });
  let job = null, result = '';
  async function go() {
    const q = input.value.trim(); if (!q) return;
    job?.abort();
    out.innerHTML = '<span class="muted">生成中…</span>';
    const { system } = await buildSystem({ useNote: true, useVault: false, view, selection: sel });
    const user = sel ? `请按要求处理选中的文字：${q}。只输出处理后的文字，不要解释。` : `在当前笔记光标处写一段内容：${q}。只输出要插入的内容。`;
    job = api.chat({ system, messages: [{ role: 'user', content: user }] }, (t, full) => { result = full; out.innerHTML = renderMarkdown(full, view.path); });
    try { await job.done; replaceBtn.disabled = false; belowBtn.disabled = false; } catch (e) { if (e.name !== 'AbortError') out.innerHTML = `<span class="embed-missing">${esc(e.message)}</span>`; }
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) go(); });
  const restore = () => { if (range && view.editor) { view.editor.focus(); view.editor.setSelection(range[0], range[1]); } };
  replaceBtn.onclick = () => { m.close(); restore(); if (view.mode === 'read' || !view.editor) view.appendText(result); else view.editor.insert(result.trim()); };
  belowBtn.onclick = () => { m.close(); restore(); if (!view.editor || view.mode === 'read') { view.appendText(result); return; } const end = range ? range[1] : view.editor.value.length; view.editor.insert('\n\n' + result.trim() + '\n', end, end); };
  setTimeout(() => input.focus(), 30);
}

export { ACTIONS };
