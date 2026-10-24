# AI 版 Obsidian

开箱即用的网页版 Obsidian：在浏览器里直接读写本地 Obsidian 仓库，并内置大模型 AI 助手。
仓库结构、卡片模板、分类方式参照「读书笔记」仓库（`D:\Obsidian\Yucheng的知识体系\读书笔记`）；界面风格取自个人网站 liyucheng.me（玻璃质感 + 墨黑胶囊 + 燃烧橙点缀），并保留 Blue Topaz 主题的特征。

## 快速开始

只需要 Node.js 18+，**无需 npm install**（所有依赖已内置在 `public/vendor/`）。

```bash
node server.js
```

或在 Windows 上双击 `启动.bat`。浏览器会自动打开 http://localhost:5173 ，默认载入内置的示例仓库 `sample-vault/`。

打开你自己的仓库，有两种方式：

```bash
node server.js --vault "D:\Obsidian\Yucheng的知识体系\读书笔记"
```

也可以在网页里通过「设置 → 仓库」打开，路径会被记住。

| 参数 | 说明 |
| --- | --- |
| `--vault <路径>` | 仓库文件夹（包含 `.obsidian` 的那一层） |
| `--port <端口>` | 默认 5173 |
| `--no-open` | 启动时不自动打开浏览器 |

## 功能

**编辑与浏览**
- 阅读 / 编辑（实时预览）/ 源码三种模式，自动保存；如果桌面版 Obsidian 同时改了同一篇笔记，会提示冲突
- **实时预览**（CodeMirror 6）：只有光标所在行显示 Markdown 源码，其余行就地渲染标题、双链、图片、任务勾选框、表格、Callout、嵌入和热力图；frontmatter 显示为可直接修改的属性表；点击渲染后的链接直接跳转
- 双链 `[[ ]]`（支持别名、标题、`|显示文字`），输入 `[[` 自动补全，悬停可预览
- 嵌入 `![[图片|宽度]]`、`![[笔记#标题]]`、`![[x.base]]`、PDF / 音视频
- Callout（可折叠）、任务勾选、`==高亮==`、`%%注释%%`、标签、表格、代码块
- 属性面板：点击直接修改，常用属性（类型、书籍、states、研究领域…）带候选值
- 列表回车续写，并自动重新编号（对应仓库启用的 automatic-renumbering 插件）
- 粘贴或拖入图片，自动存进 `04_图片附件库`，命名为 `Pasted image YYYYMMDDHHmmss.png`
- 重命名 / 移动笔记时，会同步更新其他笔记里的双链；删除的文件移到仓库内的 `.trash`

**仓库特性**
- 文件列表：一级文件夹配色读取 `obsidian-file-color` 插件配置，并显示笔记数
- 从模板新建：读取 `03_模板文件库` 下的 9 种卡片模板，按类型推荐存放的文件夹和文件名前缀（如 `【书籍】`）
- Bases 数据库：解析 `.base` 文件，支持卡片 / 看板 / 表格 / 列表视图，以及 filters、sort、groupBy 和封面图
- 首页：笔记统计、250 天热力图（配色沿用 `00_热力视图.md`）、主题索引、最近编辑
- 反向链接、出链、未链接提及、大纲、局部 / 全屏关系图谱、Canvas 白板浏览
- 全文搜索支持 `tag:#标签`、`path:文件夹`、`file:名称`、`[类型:书籍]`、`"精确短语"`
- 快速打开（Ctrl+O）、命令面板（Ctrl+P），可流畅处理 8 万多篇笔记的仓库

**AI 助手**
- 右侧 AI 面板：可结合「当前笔记」和「知识库检索」作答，并列出引用的笔记
- 笔记动作：按模板补全卡片、生成相关概念双链、总结要点、费曼式解释、出题自测、生成读书大纲
- 结果可以直接替换正文（属性保持不变）、写入指定段落、插入到光标处或另存为新笔记
- **AI 写卡片**：输入一个概念名，AI 按六段卡片模板流式写入整张卡片
- **Ctrl+J**：改写选中的文字（润色、去 AI 味、扩写、翻译…），或在光标处生成内容
- 支持 DeepSeek、Claude、OpenAI、Kimi、通义千问、智谱、硅基流动、Ollama（本地）以及任意 OpenAI 兼容接口
- API Key 只保存在本机的 `config.json`，浏览器通过本地服务转发请求，Key 不会出现在前端

## 外观

- **玻璃**（默认）：取自个人网站 `268_我的个人网站/me.html`。#fbfbfd 白底，侧栏和正文是半透明玻璃卡；选中项用墨黑胶囊，点缀用 #ff9500 燃烧橙；标题用 800/900 粗体，英文和数字用 Sora 字体（已内置）
- **简约**：苹果式设计规范（单一主题蓝、中性灰、白卡片）
- **秋日 Topaz**：取自 Blue Topaz 的 Autumn 配色
- 保留了 Blue Topaz 的几项特征：彩色文件夹、彩虹标签、双链下划线；每一项都可以在「设置 → 外观」里单独开关
- 默认正文 18px、界面 14px，正文字号可在 15–24px 之间调节；支持浅色 / 深色 / 跟随系统，窄屏下自动适配
- 深链接：`http://localhost:5173/#path=<笔记路径>&mode=edit` 可直接打开某篇笔记

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| Ctrl+O / Ctrl+P | 快速打开 / 命令面板 |
| Ctrl+N / Ctrl+Shift+N | 新建笔记 / 从模板新建 |
| Ctrl+E | 切换阅读与编辑 |
| Ctrl+J | AI 改写或生成 |
| Ctrl+T | 插入模板 |
| Ctrl+Shift+F / Ctrl+Shift+A | 全局搜索 / AI 助手 |
| Ctrl+K / Ctrl+B / Ctrl+I / Ctrl+Shift+H | 双链 / 加粗 / 斜体 / 高亮 |

## 兼容性说明

- Bases：支持常用的表达式（`==`、`!=`、比较运算、`&&`、`||`、`file.name`、`file.inFolder()`、`file.hasTag()`、`.contains()`、`.length` 等），map 视图以表格形式展示
- Dataview 代码块只显示源码，不执行；Excalidraw 文件不渲染；Canvas 只能浏览，不能编辑
- 服务只监听 127.0.0.1，局域网内的其他设备无法访问

## 目录结构

```
server.js            本地服务：静态文件、仓库 API、AI 转发
lib/vault.js         仓库索引（frontmatter、双链、反链、标签、搜索、检索）
lib/bases.js         .base 解析与表达式求值
lib/ai.js            各家模型的流式接口适配
public/              前端（原生 ES 模块，无需构建）
  vendor/            CodeMirror 6 打包文件、marked、js-yaml、Sora 字体
  css/tokens.css     苹果式设计变量
  css/app.css        界面样式（含秋日 Topaz 配色）
  js/                工作区、编辑器、视图、面板、AI
sample-vault/        示例仓库（node scripts/seed.js --force 可重新生成）
```
