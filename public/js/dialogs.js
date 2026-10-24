// 模板新建、插入模板、设置
import { h, formatDate, splitFM, toast, store, basename } from './util.js';
import { icon, iconHTML, TYPE_ICON } from './icons.js';
import { api } from './api.js';
import { app } from './ctx.js';
import { openModal } from './modals.js';
import { PROP_VALUES, folderForType, NAME_PREFIX } from './schema.js';
import { setProperty } from './views/note.js';

export function applyTemplate(tpl, title) {
  const meta = app.meta || {};
  return tpl
    .replace(/\{\{date(?::([^}]+))?\}\}/g, (a, f) => formatDate(f || meta.dateFormat || 'YYYY/MM/DD'))
    .replace(/\{\{time(?::([^}]+))?\}\}/g, (a, f) => formatDate(f || meta.timeFormat || 'HH:mm'))
    .replace(/\{\{title\}\}/g, title || '');
}

const tplLabel = n => n.replace(/^【卡片】/, '');

export async function newFromTemplate(opts = {}) {
  const [templates, folders] = await Promise.all([api.templates(), api.folders()]);
  if (!templates.length) { toast(`模板文件夹「${app.meta.templateFolder}」里还没有模板`, 'error'); return; }
  let sel = templates.find(t => t.type === (opts.type || (opts.ai ? '概念' : ''))) || templates[0];
  const grid = h('div', { class: 'tpl-grid' });
  const nameIn = h('input', { class: 'input', placeholder: '卡片名称，例如：费曼学习法', style: { flex: 1 } });
  const folderSel = h('select', { class: 'input', style: { flex: 1 } }, h('option', { value: '' }, '（仓库根目录）'), ...folders.map(f => h('option', { value: f }, f)));
  const propsBox = h('div', { class: 'form' });
  const aiCheck = h('input', { type: 'checkbox', checked: !!opts.ai });
  const aiExtra = h('input', { class: 'input', placeholder: '给 AI 的补充要求（可选），例如：侧重历史背景', style: { flex: 1 } });
  const aiRow = h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, ''), aiExtra);
  aiRow.style.display = opts.ai ? '' : 'none';
  aiCheck.onchange = () => { aiRow.style.display = aiCheck.checked ? '' : 'none'; };
  const propInputs = {};
  const renderProps = () => {
    propsBox.innerHTML = '';
    const { fm } = splitFM(sel.content);
    for (const [k, v] of Object.entries(fm)) {
      if (k === '类型' || k === 'date' || k === 'cover' || !PROP_VALUES[k]) continue;
      const s = h('select', { class: 'input' }, h('option', { value: '' }, '（暂不填写）'), ...PROP_VALUES[k].map(o => h('option', { value: o, selected: o === v }, o)));
      s.onchange = () => { if (k === '书籍') suggestFolder(); };
      propInputs[k] = s;
      propsBox.append(h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, k), s));
    }
  };
  const suggestFolder = () => {
    const vals = Object.fromEntries(Object.entries(propInputs).map(([k, s]) => [k, s.value]));
    const f = opts.folder && !opts.type ? opts.folder : folderForType(sel.type, vals);
    if ([...folderSel.options].some(o => o.value === f)) folderSel.value = f;
    else if (f) { folderSel.append(h('option', { value: f }, f + '（新建）')); folderSel.value = f; }
  };
  const renderGrid = () => {
    grid.innerHTML = '';
    for (const t of templates) {
      const b = h('button', { class: 'tpl-card' + (t === sel ? ' active' : '') }, h('span', { class: 'tpl-ico', html: iconHTML(TYPE_ICON[t.type] || 'template', 20) }), h('span', null, tplLabel(t.name)));
      b.onclick = () => { sel = t; for (const k in propInputs) delete propInputs[k]; renderGrid(); renderProps(); suggestFolder(); };
      grid.append(b);
    }
  };
  renderGrid(); renderProps(); suggestFolder();
  const create = h('button', { class: 'btn btn-primary' }, '创建');
  const cancel = h('button', { class: 'btn' }, '取消');
  const m = openModal({
    title: opts.ai ? 'AI 写卡片' : '从模板新建', width: 620,
    body: h('div', { class: 'form' }, grid,
      h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '名称'), nameIn),
      h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '文件夹'), folderSel),
      propsBox,
      h('label', { class: 'form-check ai-check' }, aiCheck, icon('sparkles', 15), '创建后由 AI 按模板自动填写正文'),
      aiRow),
    footer: [cancel, create],
  });
  cancel.onclick = () => m.close();
  const go = async () => {
    let name = nameIn.value.trim().replace(/[\\/:*?"<>|]/g, '');
    if (!name) { nameIn.focus(); return; }
    const prefix = NAME_PREFIX[sel.type];
    if (prefix && !name.startsWith('【')) name = prefix + name;
    let content = applyTemplate(sel.content, name);
    for (const [k, s] of Object.entries(propInputs)) if (s.value) content = setProperty(content, k, s.value);
    m.close();
    const view = await app.createNote({ folder: folderSel.value, name, content, mode: 'edit' });
    if (view && aiCheck.checked) { const { fillNote } = await import('./panels/ai.js'); fillNote(view, aiExtra.value.trim()); }
  };
  create.onclick = go;
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) go(); });
  setTimeout(() => nameIn.focus(), 40);
}

export async function insertTemplate(view) {
  const templates = await api.templates();
  const { pickList } = await import('./modals.js');
  pickList({
    placeholder: '选择要插入的模板…',
    getItems: q => templates.filter(t => !q || t.name.includes(q)).map(t => ({ title: tplLabel(t.name), note: t.path, icon: TYPE_ICON[t.type] || 'template', t })),
    onPick: it => {
      if (!it.t) return;
      const tpl = applyTemplate(it.t.content, view.title);
      const cur = splitFM(view.content), tp = splitFM(tpl);
      if (!view.content.trim()) view.setContent(tpl);
      else if (tp.hasFM && !cur.hasFM) view.setContent(tpl.slice(0, tp.fmEnd) + view.content.replace(/\s*$/, '\n\n') + tp.body);
      else if (tp.hasFM && cur.hasFM) {
        let c = view.content;
        for (const [k, v] of Object.entries(tp.fm)) if (!(k in cur.fm)) c = setProperty(c, k, v instanceof Date ? formatDate(app.meta.dateFormat, v) : (Array.isArray(v) ? v : String(v ?? '')));
        view.setContent(c.replace(/\s*$/, '\n\n') + tp.body);
      } else view.insertAtCursor(tpl);
      toast('已插入模板：' + tplLabel(it.t.name), 'success');
    },
  });
}

// ---------- 设置 ----------
export async function openSettings(section = 'appearance') {
  const s = await api.settings();
  const nav = h('div', { class: 'settings-nav' });
  const pane = h('div', { class: 'settings-pane' });
  const sections = {
    appearance: ['palette', '外观', () => appearancePane()],
    ai: ['sparkles', 'AI 模型', () => aiPane(s)],
    vault: ['vault', '仓库', () => vaultPane(s)],
    keys: ['keyboard', '快捷键', () => keysPane()],
    about: ['info', '关于', () => aboutPane()],
  };
  const show = k => {
    nav.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', b.dataset.k === k));
    pane.replaceChildren(sections[k][2]());
  };
  for (const [k, [ic, label]] of Object.entries(sections)) {
    const b = h('button', { class: 'settings-tab', 'data-k': k }, icon(ic, 16), label);
    b.onclick = () => show(k);
    nav.append(b);
  }
  openModal({ title: '设置', width: 780, cls: 'modal-settings', body: h('div', { class: 'settings' }, nav, pane) });
  show(sections[section] ? section : 'appearance');
}

function row(label, desc, control) {
  return h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, label), desc ? h('div', { class: 'set-desc' }, desc) : null), h('div', { class: 'set-ctl' }, control));
}
function seg(options, value, onChange) {
  const wrap = h('div', { class: 'seg' });
  for (const [v, label] of options) {
    const b = h('button', { class: 'seg-btn' + (v === value ? ' active' : '') }, label);
    b.onclick = () => { wrap.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); onChange(v); };
    wrap.append(b);
  }
  return wrap;
}
function sw(checked, onChange) {
  const i = h('input', { type: 'checkbox', class: 'switch', checked });
  i.onchange = () => onChange(i.checked);
  return i;
}

function appearancePane() {
  const p = app.prefs;
  const set = (k, v) => { p[k] = v; app.savePrefs(); app.applyPrefs(); };
  const size = h('input', { type: 'range', min: 15, max: 24, step: 1, value: p.fontSize });
  const sizeLabel = h('span', { class: 'tabular muted', style: { width: '36px', textAlign: 'right' } }, p.fontSize + 'px');
  size.oninput = () => { sizeLabel.textContent = size.value + 'px'; set('fontSize', Number(size.value)); };
  return h('div', null,
    h('h3', { class: 'set-title' }, '外观'),
    row('配色方案', '「玻璃」取自个人网站 liyucheng.me；「简约」是苹果式设计规范；「秋日 Topaz」取自仓库在用的 Blue Topaz 主题', seg([['glass', '玻璃'], ['apple', '简约'], ['topaz', '秋日 Topaz']], p.scheme, v => set('scheme', v))),
    row('明暗模式', null, seg([['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']], p.theme, v => set('theme', v))),
    row('正文字号', '默认 18px；桌面版仓库设置为 19px', h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, size, sizeLabel)),
    row('可读行宽', '限制正文最大宽度，阅读更舒适', sw(p.readable, v => set('readable', v))),
    row('彩色文件夹', '文件夹图标沿用 File Color 插件的颜色，并自动调成与主题协调的柔和色', sw(p.folderColors, v => set('folderColors', v))),
    row('彩虹标签', 'Blue Topaz 的 rainbow-tag 风格', sw(p.rainbowTags, v => set('rainbowTags', v))),
    row('双链下划线', 'Blue Topaz 的 link-underline-internal', sw(p.linkUnderline, v => set('linkUnderline', v))),
  );
}

function aiPane(s) {
  const ai = { ...s.ai };
  const presets = s.presets;
  const provider = h('select', { class: 'input' }, ...Object.entries(presets).map(([k, v]) => h('option', { value: k, selected: k === ai.provider }, v.label)));
  const baseUrl = h('input', { class: 'input', value: ai.baseUrl || '', placeholder: presets[ai.provider]?.baseUrl || 'https://…' });
  const key = h('input', { class: 'input', type: 'password', value: ai.apiKey || '', placeholder: presets[ai.provider]?.noKey ? '本地模型无需 Key' : 'sk-…', autocomplete: 'off' });
  const model = h('input', { class: 'input', value: ai.model || '', placeholder: presets[ai.provider]?.model || '模型名称' });
  const maxTok = h('input', { class: 'input', type: 'number', value: ai.maxTokens || 8000, min: 256, max: 64000, step: 256 });
  const temp = h('input', { class: 'input', type: 'number', value: ai.temperature ?? '', min: 0, max: 2, step: 0.1, placeholder: '默认' });
  const result = h('div', { class: 'test-result' });
  provider.onchange = () => {
    const pr = presets[provider.value];
    baseUrl.placeholder = pr.baseUrl || 'https://…'; model.placeholder = pr.model || '模型名称'; key.placeholder = pr.noKey ? '本地模型无需 Key' : 'sk-…';
    baseUrl.value = ''; model.value = '';
    if (provider.value !== s.ai.provider) key.value = '';
    tempRow.style.display = pr.kind === 'anthropic' ? 'none' : '';
  };
  const collect = () => ({ provider: provider.value, baseUrl: baseUrl.value.trim(), apiKey: key.value.trim(), model: model.value.trim(), maxTokens: Number(maxTok.value) || 8000, temperature: temp.value === '' ? '' : Number(temp.value) });
  const save = h('button', { class: 'btn btn-primary' }, '保存');
  const test = h('button', { class: 'btn' }, '测试连接');
  save.onclick = async () => { await api.saveSettings({ ai: collect() }); await app.refreshAIStatus(); toast('AI 设置已保存', 'success'); };
  test.onclick = async () => {
    result.className = 'test-result'; result.textContent = '正在连接…';
    const r = await api.testAI(collect());
    result.className = 'test-result ' + (r.ok ? 'ok' : 'err');
    result.textContent = r.ok ? '连接成功：' + r.reply : '失败：' + r.error;
  };
  const tempRow = row('温度', '留空使用模型默认值', temp);
  if (presets[ai.provider]?.kind === 'anthropic') tempRow.style.display = 'none';
  return h('div', null,
    h('h3', { class: 'set-title' }, 'AI 模型'),
    h('p', { class: 'set-desc', style: { marginTop: 0 } }, 'API Key 只保存在本机的 config.json 中，请求经由本地服务转发，不会出现在浏览器里。支持 DeepSeek、Claude、OpenAI、Kimi、通义千问、智谱、硅基流动、Ollama 以及任意 OpenAI 兼容接口。'),
    row('服务商', null, provider),
    row('API 地址', '留空使用服务商默认地址', baseUrl),
    row('API Key', null, key),
    row('模型', '留空使用默认模型', model),
    row('最大输出长度', 'max_tokens', maxTok),
    tempRow,
    h('div', { class: 'set-actions' }, result, test, save));
}

function vaultPane(s) {
  const input = h('input', { class: 'input', value: s.vaultPath, style: { flex: 1 } });
  const open = h('button', { class: 'btn btn-primary' }, '打开');
  open.onclick = () => app.switchVault(input.value.trim());
  const reindex = h('button', { class: 'btn' }, icon('refresh', 14), '重建索引');
  reindex.onclick = async () => { await api.reindex(); toast('正在重建索引…'); setTimeout(() => app.reloadAll(), 1500); };
  const sample = h('button', { class: 'btn' }, '使用示例仓库');
  sample.onclick = () => app.switchVault(s.sampleVault);
  const st = app.meta.status || {};
  return h('div', null,
    h('h3', { class: 'set-title' }, '仓库'),
    row('当前仓库', `${st.total || 0} 个文件 · 索引耗时 ${((st.ms || 0) / 1000).toFixed(1)} 秒`, h('code', { class: 'path-code' }, s.vaultPath)),
    h('div', { class: 'set-block' }, h('div', { class: 'set-label' }, '打开本地 Obsidian 仓库'), h('div', { class: 'set-desc' }, '填写仓库文件夹的完整路径（包含 .obsidian 的那一层），例如 D:\\Obsidian\\我的知识库\\读书笔记。会读取仓库里的模板、文件夹配色和 Bases 视图。'), h('div', { class: 'form-row', style: { marginTop: '8px' } }, input, open)),
    s.recentVaults?.length ? h('div', { class: 'set-block' }, h('div', { class: 'set-label' }, '最近打开'), ...s.recentVaults.map(p => { const b = h('button', { class: 'recent-vault' }, icon('vault', 15), p); b.onclick = () => app.switchVault(p); return b; })) : null,
    h('div', { class: 'set-actions' }, sample, reindex));
}

function keysPane() {
  const keys = [['Ctrl+O', '快速打开笔记'], ['Ctrl+P', '命令面板'], ['Ctrl+N', '新建笔记'], ['Ctrl+Shift+N', '从模板新建'], ['Ctrl+T', '插入模板'], ['Ctrl+E', '切换阅读 / 编辑'], ['Ctrl+S', '立即保存'], ['Ctrl+J', 'AI 改写 / 生成'], ['Ctrl+Shift+F', '全局搜索'], ['Ctrl+Shift+A', '打开 AI 助手'], ['Ctrl+B / Ctrl+I', '加粗 / 斜体'], ['Ctrl+K', '插入双链'], ['Ctrl+Shift+H', '高亮'], ['Ctrl+W', '关闭标签页'], ['Ctrl+\\', '切换左侧栏'], ['[[', '双链补全']];
  return h('div', null, h('h3', { class: 'set-title' }, '快捷键'), h('div', { class: 'keys-grid' }, ...keys.flatMap(([k, d]) => [h('kbd', null, k), h('span', null, d)])));
}

function aboutPane() {
  return h('div', null, h('h3', { class: 'set-title' }, '关于'),
    h('p', { class: 'set-desc' }, 'AI 版 Obsidian：在浏览器里直接读写本地 Obsidian 仓库，并内置大模型助手。'),
    h('ul', { class: 'about-list' },
      h('li', null, '兼容：双链与别名、嵌入、Callout、任务、标签、属性、Bases（.base）卡片 / 看板 / 表格视图、Canvas 白板浏览、热力图'),
      h('li', null, '分类：沿用读书笔记仓库的 00–10 文件夹结构、9 种卡片模板和「类型」属性'),
      h('li', null, '外观：苹果式简约设计规范 + Blue Topaz 主题特征（彩色文件夹、彩虹标签、双链下划线、秋日配色）'),
      h('li', null, '数据：所有笔记保存在本地磁盘；删除的文件移到仓库内 .trash 文件夹')));
}

export { basename };
