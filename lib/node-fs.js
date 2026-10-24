// Node 文件系统适配器：把仓库内的相对路径（/ 分隔）映射到磁盘，供 public/core/vault.js 使用
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function nodeFs(root) {
  root = path.resolve(root);
  const abs = rel => {
    const p = path.resolve(root, rel || '');
    if (p !== root && !p.startsWith(root + path.sep)) throw Object.assign(new Error('路径越界'), { status: 400 });
    return p;
  };
  return {
    root,
    name: path.basename(root),
    async readdir(rel) {
      const ents = await fsp.readdir(abs(rel), { withFileTypes: true });
      return ents.filter(e => e.isDirectory() || e.isFile()).map(e => ({ name: e.name, dir: e.isDirectory() }));
    },
    async stat(rel) {
      const st = await fsp.stat(abs(rel));
      return { file: st.isFile(), dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs };
    },
    readText: rel => fsp.readFile(abs(rel), 'utf8'),
    async writeText(rel, text) { const p = abs(rel); await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, text, 'utf8'); },
    async writeBinary(rel, buf) { const p = abs(rel); await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, Buffer.from(buf)); },
    async mkdir(rel) { await fsp.mkdir(abs(rel), { recursive: true }); },
    async move(from, to) { const d = abs(to); await fsp.mkdir(path.dirname(d), { recursive: true }); await fsp.rename(abs(from), d); },
    async exists(rel) { return fs.existsSync(abs(rel)); },
    stream: rel => fs.createReadStream(abs(rel)),
    abs,
    watch(onChange) {
      try {
        const w = fs.watch(root, { recursive: true }, (ev, fname) => { if (fname) onChange(fname.split(path.sep).join('/')); });
        return () => w.close();
      } catch { return null; }
    },
  };
}

module.exports = { nodeFs };
