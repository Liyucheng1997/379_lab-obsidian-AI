// 对话框、右键菜单、选择器（快速切换 / 命令面板 共用）
import { h } from './util.js';
import { icon, iconHTML } from './icons.js';

const stack = [];
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); e.stopPropagation(); stack[stack.length - 1].close(); }
}, true);

export function openModal({ title, body, footer, width = 520, cls = '', onClose, noHeader }) {
  const overlay = h('div', { class: 'modal-overlay' });
  const box = h('div', { class: 'modal ' + cls, style: { width: width + 'px' } });
  if (!noHeader) {
    const x = h('button', { class: 'modal-x', title: '关闭' }, icon('x', 16));
    box.append(h('div', { class: 'modal-header' }, h('span', null, title || ''), x));
    x.onclick = () => api.close();
  }
  const bodyEl = h('div', { class: 'modal-body' });
  if (body) bodyEl.append(body);
  box.append(bodyEl);
  if (footer) box.append(h('div', { class: 'modal-footer' }, ...footer));
  overlay.append(box);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) api.close(); });
  document.body.append(overlay);
  const api = {
    el: box, body: bodyEl, overlay,
    close() {
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      overlay.remove(); onClose?.();
    },
  };
  stack.push(api);
  return api;
}

export function promptText({ title, value = '', placeholder = '', okText = '确定', hint = '' }) {
  return new Promise(resolve => {
    const input = h('input', { class: 'input', value, placeholder, style: { width: '100%' } });
    let done = false;
    const ok = h('button', { class: 'btn btn-primary' }, okText);
    const cancel = h('button', { class: 'btn' }, '取消');
    const m = openModal({ title, body: h('div', { class: 'form' }, input, hint ? h('div', { class: 'muted', style: { fontSize: '12px' } }, hint) : null), footer: [cancel, ok], width: 440, onClose: () => { if (!done) resolve(null); } });
    const finish = v => { done = true; m.close(); resolve(v); };
    ok.onclick = () => finish(input.value.trim());
    cancel.onclick = () => m.close();
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) finish(input.value.trim()); });
    setTimeout(() => { input.focus(); const dot = value.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : value.length); }, 30);
  });
}

export function confirmBox({ title = '确认', message, okText = '确定', danger }) {
  return new Promise(resolve => {
    let done = false;
    const ok = h('button', { class: 'btn btn-primary' + (danger ? ' btn-danger' : '') }, okText);
    const cancel = h('button', { class: 'btn' }, '取消');
    const m = openModal({ title, body: h('div', { class: 'modal-msg' }, message), footer: [cancel, ok], width: 420, onClose: () => { if (!done) resolve(false); } });
    ok.onclick = () => { done = true; m.close(); resolve(true); };
    cancel.onclick = () => m.close();
    setTimeout(() => ok.focus(), 30);
  });
}

// 右键 / 更多菜单
let menuEl;
export function showMenu(x, y, items) {
  closeMenu();
  menuEl = h('div', { class: 'popover menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { menuEl.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.header) { menuEl.append(h('div', { class: 'menu-header' }, it.header)); continue; }
    const row = h('div', { class: 'menu-item' + (it.danger ? ' is-danger' : '') + (it.disabled ? ' disabled' : '') },
      h('span', { class: 'menu-icon', html: it.icon ? iconHTML(it.icon, 16) : '' }),
      h('span', { class: 'menu-label' }, it.label),
      it.hint ? h('span', { class: 'menu-shortcut' }, it.hint) : null);
    if (!it.disabled) row.addEventListener('click', () => { closeMenu(); it.onClick?.(); });
    menuEl.append(row);
  }
  document.body.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
  menuEl.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
}
function outside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
export function closeMenu() { menuEl?.remove(); menuEl = null; document.removeEventListener('mousedown', outside, true); }
export function menuAt(anchor, items) { const r = anchor.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, items); }

// 选择器：快速切换、命令面板、文件夹选择
export function pickList({ placeholder, getItems, onPick, hints, initial = '' }) {
  const input = h('input', { class: 'picker-input', placeholder, value: initial });
  const list = h('div', { class: 'picker-list' });
  const foot = hints ? h('div', { class: 'picker-hints' }, ...hints.map(([k, t]) => h('span', null, h('kbd', null, k), ' ', t))) : null;
  const m = openModal({ body: h('div', { class: 'picker' }, input, list, foot), width: 640, noHeader: true, cls: 'modal-picker' });
  let items = [], sel = 0, token = 0;
  const render = () => {
    list.innerHTML = '';
    if (!items.length) { list.append(h('div', { class: 'picker-empty' }, input.value ? '没有匹配结果' : '输入以搜索…')); return; }
    items.forEach((it, i) => {
      const row = h('div', { class: 'picker-item' + (i === sel ? ' is-selected' : '') },
        h('span', { class: 'picker-ico', html: iconHTML(it.icon || 'file-text', 16) }),
        h('span', { class: 'picker-main' }, h('span', { class: 'picker-title' }, it.title), it.note ? h('span', { class: 'picker-note' }, it.note) : null),
        it.hint ? h('kbd', { class: 'picker-kbd' }, it.hint) : null);
      row.addEventListener('mousemove', () => { if (sel !== i) { sel = i; render(); } });
      row.addEventListener('click', e => pick(i, e));
      list.append(row);
    });
    list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  };
  const update = async () => {
    const t = ++token;
    const r = await getItems(input.value.trim());
    if (t !== token) return;
    items = r; sel = 0; render();
  };
  const pick = (i, e) => { const it = items[i]; if (!it) return; m.close(); onPick(it, e || {}); };
  input.addEventListener('input', update);
  input.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) pick(sel, e); else if (input.value.trim()) { m.close(); onPick({ create: input.value.trim() }, e); } }
  });
  update();
  setTimeout(() => input.focus(), 20);
  return m;
}
