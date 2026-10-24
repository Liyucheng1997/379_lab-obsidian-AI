// 纯前端模式：没有本地服务时（例如部署在 GitHub Pages 上），在浏览器里直接读写仓库，AI 请求由浏览器直接发给服务商
// 仓库来源：用户用 showDirectoryPicker 选的本地文件夹（Chrome / Edge），或浏览器私有存储 OPFS 里的示例仓库 / 导入副本
import { Vault } from '../../core/vault.js';
import { Service } from '../../core/service.js';
import { PRESETS, streamChat } from '../../core/ai.js';
import { handleFs } from './handle-fs.js';
import { kv } from './idb.js';
import { openModal } from '../modals.js';
import { h } from '../util.js';

const AI_STORE = 'ai-obsidian.ai';
const DEFAULT_AI = { provider: 'deepseek', baseUrl: '', apiKey: '', model: '', maxTokens: 8000, temperature: '' };
const canPick = 'showDirectoryPicker' in window;
const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function loadAI() { try { return { ...DEFAULT_AI, ...JSON.parse(localStorage.getItem(AI_STORE) || '{}') }; } catch { return { ...DEFAULT_AI }; } }

// ---------- 仓库来源 ----------
async function opfsDir(...names) {
  let d = await navigator.storage.getDirectory();
  for (const n of names) d = await d.getDirectoryHandle(n, { create: true });
  return d;
}

// 示例仓库：第一次使用时从站点上的 sample-vault/ 拷进 OPFS，之后可以随意编辑
async function sampleDir() {
  const dir = await opfsDir('sample-vault');
  const manifest = await fetch(new URL('sample-vault/manifest.json', location.href)).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!manifest || (await kv.get('sampleSeeded')) === manifest.version) return dir;
  const fsx = handleFs(dir);
  await Promise.all(manifest.files.map(async f => {
    const res = await fetch(new URL('sample-vault/' + f.url.split('/').map(encodeURIComponent).join('/'), location.href));
    if (res.ok) await fsx.writeBinary(f.path, await res.blob());
  }));
  await kv.set('sampleSeeded', manifest.version);
  return dir;
}

async function remember(cur) {
  const recent = (await kv.get('recent')) || [];
  const same = async r => r.kind === cur.kind && (r.kind === 'local' ? await r.handle.isSameEntry(cur.handle) : r.name === cur.name);
  const rest = [];
  for (const r of recent) if (!(await same(r))) rest.push(r);
  await kv.set('recent', [cur, ...rest].slice(0, 8));
  await kv.set('current', cur);
}

async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'ai-obsidian-vault', mode: 'readwrite' });
  return { kind: 'local', name: handle.name, handle };
}

// 不支持 showDirectoryPicker 的浏览器：把选中的文件夹整个复制进 OPFS（修改只保存在浏览器里）
function importFolder() {
  return new Promise((resolve, reject) => {
    const input = h('input', { type: 'file', webkitdirectory: true, multiple: true, style: { display: 'none' } });
    input.onchange = async () => {
      try {
        const files = [...input.files];
        if (!files.length) return resolve(null);
        const name = files[0].webkitRelativePath.split('/')[0];
        const parent = await opfsDir('copies');
        try { await parent.removeEntry(name, { recursive: true }); } catch { }
        const fsx = handleFs(await parent.getDirectoryHandle(name, { create: true }));
        await Promise.all(files.map(f => fsx.writeBinary(f.webkitRelativePath.split('/').slice(1).join('/'), f)));
        resolve({ kind: 'copy', name });
      } catch (e) { reject(e); } finally { input.remove(); }
    };
    input.addEventListener('cancel', () => resolve(null));
    document.body.append(input);
    input.click();
  });
}

// 上次的本地文件夹需要重新授权：浏览器要求由用户点击触发
function askPermission(cur) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; m.close(); resolve(v); };
    const cont = h('button', { class: 'btn btn-primary' }, '继续打开');
    const other = h('button', { class: 'btn' }, '选择其他文件夹');
    const sample = h('button', { class: 'btn' }, '使用示例仓库');
    cont.onclick = async () => { finish((await cur.handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')) === 'granted' ? cur : { kind: 'sample' }); };
    other.onclick = async () => { try { const c = await pickFolder(); await remember(c); finish(c); } catch { } };
    sample.onclick = () => finish({ kind: 'sample' });
    const m = openModal({
      title: '打开仓库', width: 460, onClose: () => finish({ kind: 'sample' }),
      body: h('p', { class: 'modal-msg' }, `上次打开的仓库「${cur.name}」需要你再确认一次，浏览器才允许读写这个文件夹。`),
      footer: [sample, other, cont],
    });
  });
}

async function openCurrent() {
  let cur = (await kv.get('current')) || { kind: 'sample' };
  if (cur.kind === 'local') {
    const perm = await cur.handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
    if (perm !== 'granted') cur = await askPermission(cur);
  }
  if (cur.kind === 'local') return { cur, fsx: handleFs(cur.handle) };
  if (cur.kind === 'copy') {
    try { return { cur, fsx: handleFs(await (await opfsDir('copies')).getDirectoryHandle(cur.name), { root: cur.name + '（浏览器内副本）' }) }; } catch { cur = { kind: 'sample' }; }
  }
  return { cur: { kind: 'sample' }, fsx: handleFs(await sampleDir(), { name: 'sample-vault', root: '示例仓库（保存在浏览器里）' }) };
}

// ---------- 对外接口：与 api.js 里的本地服务版本同形 ----------
export async function createLocalApi() {
  const { cur, fsx } = await openCurrent();
  const vault = new Vault(fsx);
  const svc = new Service(vault, { isSample: cur.kind === 'sample', extraInfo: () => ({ mode: 'browser', vaultKind: cur.kind }) });
  vault.build().catch(e => console.error('索引失败', e));

  // 浏览器不推送文件变化：窗口重新获得焦点时比对一次修改时间（桌面版 Obsidian 可能同时在改）
  let lastScan = 0;
  window.addEventListener('focus', async () => {
    if (Date.now() - lastScan < 5000) return;
    lastScan = Date.now();
    const n = await vault.rescan().catch(() => 0);
    if (n) (await import('../ctx.js')).app.afterFsChange?.();
  });

  // 附件地址：索引时拿到的 File 直接生成 blob: 地址；不在索引里的文件先放占位图，再异步补上
  const urls = new Map();
  const blobUrl = (key, blob) => {
    let c = urls.get(key);
    if (!c || c.blob !== blob) { if (c) URL.revokeObjectURL(c.url); c = { blob, url: URL.createObjectURL(blob) }; urls.set(key, c); }
    return c.url;
  };
  const hydrate = async el => {
    const m = /#vault-raw=(.*)$/.exec(el.getAttribute('src') || '');
    if (!m) return;
    const p = decodeURIComponent(m[1]);
    try { const st = await fsx.stat(vault.rel(p)); if (st.blob) el.src = blobUrl(p, st.blob); } catch { }
  };
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'attributes') { hydrate(m.target); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches('[src*="#vault-raw="]')) hydrate(n);
        n.querySelectorAll('[src*="#vault-raw="]').forEach(hydrate);
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });

  // 错误统一成本地服务的样子：e.status / e.data
  const wrap = fn => async (...a) => {
    try { return await fn(...a); } catch (e) {
      const err = new Error(e.code === 'ENOENT' ? '文件不存在' : e.message);
      err.status = e.status || (e.code === 'ENOENT' ? 404 : 500);
      err.data = e.body || { error: err.message };
      throw err;
    }
  };
  const friendly = e => {
    if (e.name === 'TypeError' && /fetch|network|load/i.test(e.message)) return new Error('浏览器无法直接访问这个服务商（跨域限制或网络不通）。可以换用 Claude、DeepSeek、OpenAI、Kimi、通义千问或硅基流动，Ollama 需设置 OLLAMA_ORIGINS；智谱等服务商请改用本地服务模式（node server.js）。');
    return e;
  };

  const api = {
    mode: 'browser',
    info: wrap(() => svc.info()),
    tree: wrap((dir, offset, limit) => svc.tree(dir, offset, limit)),
    read: wrap(path => svc.readFile(path)),
    write: wrap((path, content, extra = {}) => svc.writeFile({ path, content, ...extra })),
    rename: wrap((from, to) => svc.rename(from, to)),
    trash: wrap(path => svc.trash(path)),
    mkdir: wrap(path => svc.mkdir(path)),
    names: wrap(() => svc.names()),
    search: wrap((q, limit) => svc.search(q, limit)),
    backlinks: wrap(path => svc.backlinks(path)),
    tags: wrap(() => svc.tags()),
    heatmap: wrap(() => svc.heatmap()),
    recent: wrap(n => svc.recent(n)),
    graph: wrap((path, depth) => svc.graph(path, depth)),
    base: wrap((path, view) => svc.base(path, view)),
    baseQuery: wrap((yaml, view = 0) => svc.baseQuery(yaml, view)),
    bases: wrap(() => svc.bases()),
    templates: wrap(() => svc.templates()),
    folders: wrap(() => svc.folders()),
    retrieve: wrap((q, k, exclude) => svc.retrieve(q, k, exclude)),
    upload: wrap((file, name, folder) => svc.upload(file, name, folder)),
    reindex: async () => { vault.build().catch(e => console.error(e)); return { ok: true }; },
    raw(path) {
      const e = vault.files.get(path);
      return e?.blob ? blobUrl(path, e.blob) : PLACEHOLDER + '#vault-raw=' + encodeURIComponent(path);
    },

    // ---------- 设置（保存在本浏览器） ----------
    async settings() {
      const ai = loadAI();
      const recent = (await kv.get('recent')) || [];
      return { mode: 'browser', canPick, ai: { ...ai, hasKey: !!ai.apiKey }, presets: PRESETS, vaultPath: fsx.root, vaultKind: cur.kind, recentVaults: recent.map(r => (r.kind === 'copy' ? r.name + '（浏览器内副本）' : r.name)) };
    },
    async saveSettings(s) {
      if (s.ai) { const next = { ...loadAI(), ...s.ai }; delete next.hasKey; localStorage.setItem(AI_STORE, JSON.stringify(next)); }
      return { ok: true };
    },
    async testAI(ai) {
      let out = '';
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      try {
        await streamChat({ ...loadAI(), ...ai }, { messages: [{ role: 'user', content: '用一句话回复：连接成功' }], maxTokens: 256 }, x => { out += x; }, ctrl.signal);
        return { ok: true, reply: out.trim().slice(0, 200) };
      } catch (e) { return { ok: false, error: e.name === 'AbortError' ? '请求超时' : friendly(e).message }; }
      finally { clearTimeout(t); }
    },
    // target：'pick' 选择本地文件夹 / 'import' 导入副本 / 'sample' 示例仓库 / 数字 = 最近打开的第几个
    async openVault(target) {
      let next;
      try {
        if (target === 'pick') next = await pickFolder();
        else if (target === 'import') next = await importFolder();
        else if (target === 'sample') next = { kind: 'sample' };
        else {
          next = ((await kv.get('recent')) || [])[target];
          if (next?.kind === 'local' && (await next.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') next = null;
        }
      } catch (e) { if (e.name === 'AbortError') next = null; else throw e; }
      if (!next) return { cancelled: true };
      if (next.kind === 'sample') await kv.set('current', next); else await remember(next);
      return { ok: true };
    },

    chat({ system, messages, maxTokens }, onText) {
      const ctrl = new AbortController();
      const done = (async () => {
        let full = '';
        const msgs = (messages || []).filter(m => m && m.content && (m.role === 'user' || m.role === 'assistant'));
        try {
          await streamChat(loadAI(), { system, messages: msgs, maxTokens }, t => { full += t; onText(t, full); }, ctrl.signal);
        } catch (e) { throw friendly(e); }
        return full;
      })();
      return { abort: () => ctrl.abort(), done };
    },
  };
  return api;
}
