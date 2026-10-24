// 浏览器文件系统适配器：File System Access API 的文件夹句柄（用户选的本地仓库，或 OPFS 里的示例仓库 / 导入副本）
// 接口与 lib/node-fs.js 一致，供 core/vault.js 使用；路径是仓库内的相对路径（/ 分隔）
const notFound = rel => Object.assign(new Error('文件不存在：' + rel), { code: 'ENOENT', status: 404 });
const missing = e => e.name === 'NotFoundError' || e.name === 'TypeMismatchError';

export function handleFs(rootHandle, { name, root } = {}) {
  const split = rel => (rel ? rel.split('/') : []);

  async function dirHandle(rel, create = false) {
    let d = rootHandle;
    for (const seg of split(rel)) {
      try { d = await d.getDirectoryHandle(seg, { create }); } catch (e) { throw missing(e) ? notFound(rel) : e; }
    }
    return d;
  }
  async function parentOf(rel, create = false) {
    const i = rel.lastIndexOf('/');
    return [await dirHandle(i >= 0 ? rel.slice(0, i) : '', create), rel.slice(i + 1)];
  }
  async function fileHandle(rel, create = false) {
    const [d, n] = await parentOf(rel, create);
    try { return await d.getFileHandle(n, { create }); } catch (e) { throw missing(e) ? notFound(rel) : e; }
  }
  async function entry(rel) {
    if (!rel) return rootHandle;
    const [d, n] = await parentOf(rel);
    try { return await d.getFileHandle(n); } catch { }
    try { return await d.getDirectoryHandle(n); } catch { }
    throw notFound(rel);
  }
  async function write(rel, data) {
    const w = await (await fileHandle(rel, true)).createWritable();
    await w.write(data);
    await w.close();
  }
  // 复制文件 / 文件夹（浏览器不支持 move() 时的退路）
  async function copyTo(h, destDir, newName) {
    if (h.kind === 'file') {
      const w = await (await destDir.getFileHandle(newName, { create: true })).createWritable();
      await w.write(await h.getFile());
      await w.close();
      return;
    }
    const d = await destDir.getDirectoryHandle(newName, { create: true });
    for await (const [n, child] of h.entries()) await copyTo(child, d, n);
  }

  return {
    root: root || rootHandle.name,
    name: name || rootHandle.name,
    async readdir(rel) {
      const d = await dirHandle(rel);
      const out = [];
      for await (const [n, h] of d.entries()) out.push({ name: n, dir: h.kind === 'directory' });
      return out;
    },
    // blob：浏览器里读到的 File，vault 用它取文本、生成附件的 blob: 地址
    async stat(rel) {
      const h = await entry(rel);
      if (h.kind === 'directory') return { file: false, dir: true, size: 0, mtime: 0, ctime: 0 };
      const f = await h.getFile();
      return { file: true, dir: false, size: f.size, mtime: f.lastModified, ctime: f.lastModified, blob: f };
    },
    async readText(rel) { return (await (await fileHandle(rel)).getFile()).text(); },
    writeText: write,
    writeBinary: write,
    async mkdir(rel) { await dirHandle(rel, true); },
    async exists(rel) { try { await entry(rel); return true; } catch { return false; } },
    async move(from, to) {
      const h = await entry(from);
      const [dest, n] = await parentOf(to, true);
      if (h.move) { try { await h.move(dest, n); return; } catch { /* 本地文件夹不支持时改为复制 + 删除 */ } }
      await copyTo(h, dest, n);
      const [src, sn] = await parentOf(from);
      await src.removeEntry(sn, { recursive: true });
    },
  };
}
