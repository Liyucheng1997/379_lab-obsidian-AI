#!/usr/bin/env node
// 生成纯前端版（GitHub Pages）：dist/ = public/ + 示例仓库 sample-vault/（附文件清单 manifest.json）
// 用法：node scripts/build-pages.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SAMPLE = path.join(ROOT, 'sample-vault');

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

// 示例仓库：Pages 不发布以 . 开头的路径，.obsidian 这类目录换成 _dot_ 前缀，清单里记下原路径
const files = [];
const hash = crypto.createHash('sha1');
const walk = rel => {
  for (const e of fs.readdirSync(path.join(SAMPLE, rel), { withFileTypes: true })) {
    if (e.name === '.trash') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(r);
    else if (e.isFile()) {
      const url = r.replace(/(^|\/)\./g, '$1_dot_');
      const data = fs.readFileSync(path.join(SAMPLE, r));
      fs.mkdirSync(path.dirname(path.join(DIST, 'sample-vault', url)), { recursive: true });
      fs.writeFileSync(path.join(DIST, 'sample-vault', url), data);
      hash.update(r).update(data);
      files.push({ path: r, url });
    }
  }
};
walk('');
const manifest = { version: hash.digest('hex').slice(0, 12), files };
fs.writeFileSync(path.join(DIST, 'sample-vault', 'manifest.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log(`dist/ 已生成：示例仓库 ${files.length} 个文件（版本 ${manifest.version}）`);
