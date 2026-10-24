#!/usr/bin/env node
// 生成示例仓库 sample-vault/：沿用读书笔记仓库的文件夹分类、卡片模板、Bases 视图与文件夹配色
// 用法：node scripts/seed.js [--force]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'sample-vault');
if (fs.existsSync(ROOT) && !process.argv.includes('--force')) { console.log('sample-vault 已存在，如需重建请加 --force'); process.exit(0); }
fs.rmSync(ROOT, { recursive: true, force: true });

const files = {};
const put = (p, c) => { files[p] = c; };
const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`; };
let seq = 0;
const nextDay = () => day((seq++ * 37) % 240 + (seq % 3));
const fm = obj => '---\n' + Object.entries(obj).map(([k, v]) => Array.isArray(v) ? `${k}:\n${v.map(x => `  - ${x}`).join('\n')}` : `${k}: ${v ?? ''}`.trimEnd()).join('\n') + '\n---\n';
const list = items => items.map((t, i) => `${i + 1}. ${t}${i === items.length - 1 ? '。' : '，'}`).join('\n');
const card = (sections) => ['1 简要描述', '2 详细解释', '3 图形展示', '4 我的理解', '5 相关概念', '6 概念出处'].map((s, i) => `## ${s}\n${sections[i] ? (Array.isArray(sections[i]) ? list(sections[i]) : sections[i]) : ''}`).join('\n');

// ---------- .obsidian 配置 ----------
put('.obsidian/app.json', JSON.stringify({ alwaysUpdateLinks: true, newFileLocation: 'folder', attachmentFolderPath: '04_图片附件库', trashOption: 'local', promptDelete: false, newFileFolderPath: '00_闪念收集箱', readableLineLength: true, strictLineBreaks: false, propertiesInDocument: 'visible' }, null, 2));
put('.obsidian/templates.json', JSON.stringify({ folder: '03_模板文件库', dateFormat: 'YYYY/MM/DD' }, null, 2));
put('.obsidian/appearance.json', JSON.stringify({ theme: 'moonstone', cssTheme: 'Blue Topaz', baseFontSize: 19 }, null, 2));
const palette = [['Red', '#fe4365'], ['Green', '#407334'], ['Blue', '#26bcd5'], ['Orange', '#f8931d'], ['Purple', '#8239ff'], ['Yellow', '#f4d000'], ['StrongBlue', '#14446a'], ['StrongGreen', '#20df63']].map(([name, value], i) => ({ id: 'c' + i, name, value }));
const colorOf = n => palette.find(p => p.name === n).id;
put('.obsidian/plugins/obsidian-file-color/data.json', JSON.stringify({ cascadeColors: false, colorBackground: true, palette, fileColors: [
  ['00_闪念收集箱', 'Red'], ['01_书籍电影分类', 'Green'], ['02_永久知识卡片盒', 'Blue'], ['03_模板文件库', 'Orange'], ['04_图片附件库', 'StrongGreen'],
  ['05_输出文章', 'Purple'], ['06_笔记数据库检索', 'Red'], ['07_Kindle笔记同步', 'StrongBlue'], ['08_我的流程图', 'StrongGreen'], ['09_古籍阅读', 'Blue'], ['10_Excalidraw', 'Yellow'],
].map(([p, c]) => ({ path: p, color: colorOf(c) })) }, null, 2));

// ---------- 模板（与仓库 03_模板文件库 一致） ----------
const T = '03_模板文件库/';
put(T + '【卡片】书籍类.md', '---\ndate: "{{date}}"\n类型: 书籍\n书籍:\nstates:\ncover:\n---\n');
put(T + '【卡片】人物类.md', '---\ndate: "{{date}}"\n类型: 人物\n人物性质: \n人物关系: \n研究领域: \ncover:\n---\n');
put(T + '【卡片】公司类.md', '---\ndate: "{{date}}"\n类型: 公司\n公司:\n公司类型:\ncover:\n---\n');
put(T + '【卡片】大学类.md', '---\ndate: "{{date}}"\n类型: 大学\n大学:\ncover:\n---\n');
put(T + '【卡片】概念类.md', '---\ndate: "{{date}}"\n类型: 概念\n---\n## 1 简要描述\n\n## 2 详细解释\n1. \n## 3 图形展示\n\n## 4 我的理解\n\n## 5 相关概念\n\n## 6 概念出处\n');
put(T + '【卡片】游戏类.md', '---\ndate: "{{date}}"\n类型: 游戏\n游戏类型:\n状态:\ncover:\n---\n');
put(T + '【卡片】电影类.md', '---\ndate: "{{date}}"\n类型: 电影\n电影:\n电影类型:\ncover:\n---\n');
put(T + '【卡片】电视剧类.md', '---\ndate: "{{date}}"\n类型: 电视剧\n电视剧类型:\n电视剧:\ncover:\n---\n');
put(T + '【卡片】纪录片类.md', '---\ndate: "{{date}}"\n类型: 纪录片\n纪录片类型:\n纪录片:\ncover:\n---\n');

// ---------- 封面（纯色 SVG） ----------
const COVER_COLORS = ['#1d3557', '#2a6f4f', '#8c2f39', '#5b4b8a', '#b5651d', '#264653', '#6d597a', '#3d5a80', '#7f5539', '#355070', '#0b525b', '#9c6644'];
function cover(file, title, sub, i) {
  const bg = COVER_COLORS[i % COVER_COLORS.length];
  const chars = [...title].slice(0, 8);
  const big = chars.length <= 4 ? 64 : chars.length <= 6 ? 50 : 40;
  const tspans = chars.map((c, k) => `<tspan x="150" dy="${k === 0 ? 0 : big * 1.12}">${c.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</tspan>`).join('');
  const startY = 210 - (chars.length - 1) * big * 0.56;
  put('04_图片附件库/' + file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420" width="300" height="420"><rect width="300" height="420" fill="${bg}"/><rect x="18" y="18" width="264" height="384" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/><text font-family="Songti SC, STSong, SimSun, serif" font-size="${big}" font-weight="600" fill="#fff" text-anchor="middle" y="${startY}">${tspans}</text><text x="150" y="378" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="15" fill="rgba(255,255,255,.75)" text-anchor="middle">${sub}</text></svg>`);
  return `"[[${file}]]"`;
}

// ---------- 00 闪念收集箱 ----------
const F0 = '00_闪念收集箱/00_主题学习/';
put(F0 + '【主题】00_宇宙宏观视角.md', fm({ date: nextDay(), 类型: '主题', cover: cover('封面-宇宙宏观视角.svg', '宇宙', '主题学习', 0) }) + card([
  ['[[宇宙]]'], ['[[地球]]', '[[太阳系]]', '[[银河系]]', '[[可观测宇宙]]', '[[黑洞]]'], '[[【电影】2001太空漫游]]\n[[【电影】星际穿越]]', ['从「我在哪里」出发，按尺度由小到大建立空间感', '每读一本天文书，就把新概念挂到这条链上'], ['[[相对论]]', '[[【书籍】时间简史]]'], ['仓库主题阅读法'],
]));
put(F0 + '【主题】01_我的学习方法论.md', fm({ date: nextDay(), 类型: '主题', cover: cover('封面-学习方法论.svg', '学习方法', '主题学习', 1) }) + card([
  ['[[卡片笔记法]] + [[主题阅读]] + [[费曼学习法]]'], ['[[卡片笔记法]]：一张卡片只写一个概念，用双链相连', '[[主题阅读]]：围绕一个问题同时读多本书', '[[费曼学习法]]：用自己的话讲给别人听', '[[间隔重复]]：在快要忘记时复习', '[[认知负荷]]：控制每次输入的信息量'], '', ['输入靠主题阅读，加工靠卡片，输出靠费曼'], ['[[【书籍】如何阅读一本书]]', '[[【书籍】卡片笔记写作法]]', '[[【书籍】刻意练习]]'], ['[[尼克拉斯·卢曼]]', '[[理查德·费曼]]', '[[莫提默·艾德勒]]'],
]));
put(F0 + '【主题】02_中国哲学入门.md', fm({ date: nextDay(), 类型: '主题', cover: cover('封面-中国哲学.svg', '中国哲学', '主题学习', 2) }) + card([
  ['先秦儒道两家是中国哲学的源头'], ['[[孔子]]与[[仁]]', '[[老子]]与[[道]]、[[无为]]', '[[【书籍】论语]]', '[[【书籍】道德经]]'], '', ['儒家讲入世修身，道家讲顺应自然，二者互补'], ['[[苏格拉底]]（同一「轴心时代」的西方哲人）'], ['《史记·老子韩非列传》'],
]));
put('00_闪念收集箱/灵感：读书笔记也能让 AI 补全.md', fm({ date: day(1) }) + `今天想到：新建一张空白的概念卡片之后，可以让 AI 先按 #卡片模板 把六段结构填满，我再改成自己的话。 #灵感 #待整理

- [x] 试试 AI 写卡片
- [ ] 把「[[间隔重复]]」这张空卡片补全
- [ ] 给 [[认知负荷]] 加上图示

> [!tip] 小技巧
> 在编辑模式里按 Ctrl+J，可以让 AI 改写选中的句子。
`);

// ---------- 01 书籍电影分类 ----------
const CATS = ['哲学政治', '学习思考', '地理历史', '基础学科', '人物传记', '科学技术', '中国古书', '经济法律', '医学书籍', '艺术书籍', '文学小说', '论文写作', '自然世界', '电影记录'];
const catDir = c => `01_书籍电影分类/${String(CATS.indexOf(c) + 1).padStart(2, '0')}_${c}`;
const SUB = { 哲学政治: ['01_中国哲学', '02_西方哲学', '03_中国政治', '04_西方政治'], 地理历史: ['01_中国地理历史', '02_世界地理历史'], 科学技术: ['00_宇宙时空', '03_结构算法', '04_电子信息', '09_人工智能'], 文学小说: ['01_中国文学', '02_外国文学', '03_现代诗歌', '04_科幻小说'] };
const dirs = [];
for (const c of CATS) { dirs.push(catDir(c)); for (const s of SUB[c] || []) dirs.push(catDir(c) + '/' + s); }

let ci = 3;
function book(cat, sub, name, states, author, s1, chapters, mine, rel) {
  const p = `${catDir(cat)}${sub ? '/' + sub : ''}/【书籍】${name}.md`;
  put(p, fm({ date: nextDay(), 类型: '书籍', 书籍: cat, states, cover: cover(`【书籍】${name}-cover.svg`, name, author, ci++) }) + card([s1, chapters.map(c => `[[${name} ${c}]]`), '', mine, rel, [`${author} 著`]]));
}
book('中国古书', '', '论语', '阅读完成', '孔子弟子及再传弟子', ['记录[[孔子]]及其弟子言行的语录体著作', '儒家最核心的经典之一'], ['学而篇', '为政篇', '八佾篇', '里仁篇'], ['「学而时习之」讲的是学习要经常实践', '[[仁]]是全书反复出现的核心概念'], ['[[仁]]', '[[孔子]]', '[[【主题】02_中国哲学入门]]']);
book('中国古书', '', '道德经', 'Kindle正在阅读', '老子', ['[[老子]]所著，五千言，分道经与德经'], ['第一章', '第八章', '第三十七章'], ['「上善若水」让我理解了柔弱胜刚强'], ['[[道]]', '[[无为]]']);
book('学习思考', '', '如何阅读一本书', '阅读完成', '莫提默·艾德勒', ['讲阅读的四个层次：基础、检视、分析、主题阅读', '作者是[[莫提默·艾德勒]]'], ['第一篇 阅读的层次', '第二篇 分析阅读', '第三篇 阅读不同读物的方法', '第四篇 阅读的最终目标'], ['[[主题阅读]]是最高层次，也是这个仓库的组织方式'], ['[[主题阅读]]', '[[费曼学习法]]']);
book('学习思考', '', '卡片笔记写作法', 'AI辅助正在阅读', '申克·阿伦斯', ['介绍[[尼克拉斯·卢曼]]的卡片盒笔记法'], ['导论', '写作的四个基本原则', '成功的六个步骤'], ['一张卡片只写一个想法，靠链接产生新想法'], ['[[卡片笔记法]]']);
book('学习思考', '', '刻意练习', 'Kindle心愿书单', '安德斯·艾利克森', ['专家并非天生，而是靠有目的的练习'], ['第一章 有目的的练习', '第二章 大脑的适应能力'], [], ['[[间隔重复]]']);
book('科学技术', '00_宇宙时空', '时间简史', 'Neatreader正在阅读', '史蒂芬·霍金', ['从大爆炸到[[黑洞]]，讲宇宙的起源与命运'], ['我们的宇宙图像', '空间和时间', '黑洞'], ['用尽量少的公式讲清楚[[相对论]]的直觉'], ['[[黑洞]]', '[[相对论]]', '[[【主题】00_宇宙宏观视角]]']);
book('哲学政治', '02_西方哲学', '苏菲的世界', 'Neatreader心愿书单', '乔斯坦·贾德', ['以小说形式讲述西方哲学史'], ['伊甸园', '苏格拉底'], [], ['[[苏格拉底]]']);
book('人物传记', '', '爱因斯坦传', 'AI辅助心愿清单', '沃尔特·艾萨克森', ['[[阿尔伯特·爱因斯坦]]的完整传记'], ['奇迹年', '广义相对论'], [], ['[[相对论]]']);
book('地理历史', '02_世界地理历史', '人类简史', '阅读完成', '尤瓦尔·赫拉利', ['认知革命、农业革命、科学革命三次转折'], ['认知革命', '农业革命', '人类的融合统一', '科学革命'], ['「虚构的故事」让陌生人可以大规模合作'], []);
book('文学小说', '04_科幻小说', '三体', '阅读完成', '刘慈欣', ['地球文明与三体文明的第一次接触'], ['科学边界', '三体游戏', '红岸基地'], ['黑暗森林法则是对宇宙社会学的冷峻想象'], ['[[宇宙]]']);

function movie(name, status, kind, director, s1, more) {
  put(`${catDir('电影记录')}/【电影】${name}.md`, fm({ date: nextDay(), 类型: '电影', 电影: status, 电影类型: kind, cover: cover(`【电影】${name}-cover.svg`, name, director, ci++) }) + card([s1, [`导演：[[${director}]]`, ...more], '', [], [], []]));
}
movie('2001太空漫游', '欣赏完成', '科幻片', '斯坦利·库布里克', ['人类从猿到星孩的进化寓言'], ['黑色石碑贯穿全片', '配乐《[[查拉图斯特拉如是说]]》与《[[蓝色多瑙河]]》']);
movie('星际穿越', '欣赏完成', '科幻片', '克里斯托弗·诺兰', ['穿越虫洞为人类寻找新家园'], ['[[黑洞]]「卡冈图雅」的视觉化', '[[相对论]]中的时间膨胀']);
movie('霸王别姬', '共同欣赏', '剧情片', '陈凯歌', ['两位京剧艺人半个世纪的命运'], []);
movie('海上钢琴师', '心愿电影', '剧情片', '朱塞佩·托纳多雷', ['一生没有下过船的钢琴天才'], []);

// ---------- 02 永久知识卡片盒 ----------
const P = '02_永久知识卡片盒/01_人物类/';
const person = (name, f, body, aliases) => put(P + name + '.md', fm({ date: nextDay(), 类型: '人物', 人物性质: '现实人物', 人物关系: '历史人物', 研究领域: f, ...(aliases ? { aliases } : {}) }) + body);
const pbody = (pos, place, extra) => `## 1 人物姓名\n## 2 具体职位\n${list(pos)}\n## 3 见面场所\n${place}\n## 4 相关图片\n\n## 5 额外信息\n${list(extra)}\n`;
person('孔子', '哲学思想', pbody(['春秋末期思想家、教育家', '儒家学派创始人'], '鲁国曲阜', ['核心思想是[[仁]]', '言行收录于[[【书籍】论语]]']));
person('老子', '哲学思想', pbody(['春秋时期思想家', '道家学派创始人'], '周王室守藏室', ['提出[[道]]与[[无为]]', '著有[[【书籍】道德经]]']));
person('苏格拉底', '哲学思想', pbody(['古希腊哲学家'], '雅典', ['「认识你自己」', '以对话法追问概念']));
person('阿尔伯特·爱因斯坦', '科学技术', pbody(['理论物理学家'], '伯尔尼专利局、普林斯顿', ['提出[[相对论]]', '1921 年诺贝尔物理学奖']), ['爱因斯坦']);
person('理查德·费曼', '科学技术', pbody(['理论物理学家', '量子电动力学奠基人之一'], '加州理工学院', ['以通俗讲解著称，启发了[[费曼学习法]]']), ['费曼']);
person('斯坦利·库布里克', '影视创作', pbody(['电影导演'], '伦敦', ['代表作[[【电影】2001太空漫游]]']), ['库布里克']);
person('尼克拉斯·卢曼', '教育学术', pbody(['德国社会学家'], '比勒费尔德大学', ['一生积累约九万张卡片', '[[卡片笔记法]]的代表人物']), ['卢曼']);
person('莫提默·艾德勒', '教育学术', pbody(['美国哲学家、教育家'], '芝加哥大学', ['著有[[【书籍】如何阅读一本书]]']));

const C = '02_永久知识卡片盒/02_概念类/';
const concept = (name, secs, extra = {}) => put(C + name + '.md', fm({ date: nextDay(), 类型: '概念', ...extra }) + card(secs));
concept('宇宙', [['所有时间、空间、物质与能量的总和'], ['可观测部分直径约 930 亿光年', '起源于约 138 亿年前的大爆炸'], '```mermaid\ngraph LR\n  地球 --> 太阳系 --> 银河系 --> 本星系群 --> 可观测宇宙\n```', ['尺度越大，人越容易谦卑'], ['[[可观测宇宙]]', '[[银河系]]', '[[黑洞]]'], ['[[【书籍】时间简史]]']]);
concept('地球', [['太阳系由内向外的第三颗行星'], ['目前已知唯一存在生命的天体'], '', [], ['[[太阳系]]'], []]);
concept('太阳系', [['以太阳为中心、受其引力约束的天体系统'], ['包括八大行星、矮行星、小行星带与柯伊伯带'], '', [], ['[[地球]]', '[[银河系]]'], []]);
concept('银河系', [['太阳系所在的棒旋星系'], ['直径约 10 万光年', '中心有超大质量[[黑洞]]人马座 A*'], '', [], ['[[太阳系]]', '[[宇宙]]'], []]);
concept('可观测宇宙', [['光自大爆炸以来来得及到达地球的区域'], [], '', [], ['[[宇宙]]'], []]);
concept('黑洞', [['引力强到连光都无法逃逸的天体'], ['由大质量恒星坍缩形成', '边界称为事件视界'], '', ['[[【电影】星际穿越]]把它拍得最直观'], ['[[相对论]]', '[[银河系]]'], ['[[阿尔伯特·爱因斯坦]]的广义相对论预言']]);
concept('相对论', [['[[阿尔伯特·爱因斯坦]]提出的时空理论，分狭义与广义'], ['狭义相对论：光速不变，时间会膨胀', '广义相对论：引力是时空弯曲'], '', [], ['[[黑洞]]'], ['1905 年与 1915 年的论文']]);
concept('仁', [['儒家最核心的道德概念'], ['「仁者爱人」', '「克己复礼为仁」', '「己所不欲，勿施于人」'], '', ['仁是从亲人推及他人的同理心'], ['[[孔子]]', '[[【书籍】论语]]'], ['《论语·颜渊》']]);
concept('道', [['道家哲学的最高范畴，指万物的本源与规律'], ['「道可道，非常道」', '「道生一，一生二，二生三，三生万物」'], '', [], ['[[老子]]', '[[无为]]'], ['[[【书籍】道德经]]']]);
concept('无为', [['顺应自然、不妄为的处世与治国原则'], ['「道常无为而无不为」'], '', [], ['[[道]]', '[[老子]]'], ['[[【书籍】道德经]] 第三十七章']]);
concept('费曼学习法', [['用简单的语言把概念讲给别人听，以检验自己是否真懂'], ['选择一个概念', '假装讲给一个孩子听', '卡住的地方回到原文重学', '简化语言并使用类比'], '', ['卡片里的「## 4 我的理解」就是费曼式复述'], ['[[卡片笔记法]]', '[[主题阅读]]'], ['源自[[理查德·费曼]]的教学风格']], { aliases: ['费曼技巧'] });
concept('卡片笔记法', [['一张卡片记录一个原子化想法，用链接组织知识'], ['闪念笔记：随手记录', '文献笔记：用自己的话复述', '永久笔记：可独立理解并与其他卡片相连'], '', ['仓库的 00 闪念收集箱 → 02 永久知识卡片盒 正是这条流水线'], ['[[费曼学习法]]', '[[主题阅读]]'], ['[[尼克拉斯·卢曼]]', '[[【书籍】卡片笔记写作法]]']], { aliases: ['Zettelkasten'] });
concept('主题阅读', [['围绕同一主题同时阅读多本书并比较观点'], ['确定主题与问题', '找到相关章节', '建立中立的词汇', '整理不同观点'], '', [], ['[[卡片笔记法]]'], ['[[【书籍】如何阅读一本书]] 第四篇']]);
concept('间隔重复', []);
concept('认知负荷', [['完成学习任务时工作记忆所承受的负担'], [], '', [], [], []]);
dirs.push('02_永久知识卡片盒/03_章回类/01_周易');
put('02_永久知识卡片盒/03_章回类/07_中国古文/论语 学而篇.md', fm({ date: nextDay(), 类型: '论语' }) + `## 1 原文
> 子曰：「学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？」

## 2 译文
${list(['学了又时常温习和练习，不是很愉快吗', '有志同道合的人从远方来，不是很快乐吗', '别人不了解我，我也不怨恨，不也是君子吗'])}
## 3 关联
${list(['[[【书籍】论语]]', '[[孔子]]', '[[间隔重复]]'])}
`);
put('02_永久知识卡片盒/04_说文解字类/学.md', fm({ date: nextDay(), 类型: '说文解字' }) + `## 1 字形\n1. 甲骨文像双手摆弄算筹，下面是房屋与孩子。\n## 2 本义\n1. 觉悟、仿效。\n## 3 相关\n1. [[论语 学而篇]]。\n`);
put('02_永久知识卡片盒/04_说文解字类/习.md', fm({ date: nextDay(), 类型: '说文解字' }) + `## 1 字形\n1. 上面是羽毛，下面是日，像鸟在日光下反复练习飞翔。\n## 2 本义\n1. 鸟反复试飞，引申为练习、温习。\n`);

// ---------- 05 输出文章 ----------
put('05_输出文章/01_我的公众号写作/01_我如何用卡片笔记搭建第二大脑.md', fm({ date: nextDay(), 类型: '输出文章', 状态: '已发布', 平台: '公众号', 标签: ['学习方法', '卡片笔记', '主题阅读'], cover: cover('文章-第二大脑.svg', '第二大脑', '公众号', 8), 发布日期: day(30) }) + `## 1 标题
**我如何用卡片笔记 + 主题阅读 + 费曼学习法，搭建一个第二大脑**

## 2 正文
${list(['先用 [[主题阅读]] 决定读什么', '再用 [[卡片笔记法]] 把每个概念拆成一张卡片', '最后用 [[费曼学习法]] 写成文章，检验自己是否真懂'])}

![[【主题】01_我的学习方法论#2 详细解释]]
`);
put('05_输出文章/01_我的公众号写作/02_AI 辅助读书的三个用法.md', fm({ date: day(2), 类型: '输出文章', 状态: '草稿', 平台: '公众号' }) + `## 1 标题
AI 辅助读书的三个用法

## 2 正文
1. 让 AI 按模板补全卡片，
2. 让 AI 推荐相关概念，
3. 让 AI 出题自测。
`);
for (const d of ['05_输出文章/02_AI辅助写作', '05_输出文章/03_ClaudeCode输出文章', '05_输出文章/04_小红书输出内容']) dirs.push(d);

// ---------- 06 笔记数据库检索（Bases 视图，取自仓库） ----------
const B = '06_笔记数据库检索/';
put(B + '00_热力视图.md', fm({ date: nextDay(), 类型: '概念' }) + "## 1 过去250天的笔记热力图\n```contributionGraph\ntitle: Contributions\ngraphType: month-track\ndateRangeValue: 250\ndateRangeType: LATEST_DAYS\nstartOfWeek: 1\ncellStyleRules:\n  - id: default_b\n    color: \"#9be9a8\"\n    min: 1\n    max: \"10\"\n  - id: default_c\n    color: \"#40c463\"\n    min: \"10\"\n    max: \"100\"\n  - id: default_d\n    color: \"#30a14e\"\n    min: \"100\"\n    max: \"200\"\n  - id: default_e\n    color: \"#216e39\"\n    min: \"200\"\n    max: \"10000\"\n```\n");
put(B + '01_主题索引.base', 'views:\n  - type: cards\n    name: 主题索引\n    filters:\n      and:\n        - 类型 == "主题"\n    image: note.cover\n    cardSize: 140\n');
const rl = [['Neatreader正在阅读', 'Neatreader正在阅读'], ['NeatReader心愿书单', 'Neatreader心愿书单'], ['Kindle正在阅读', 'Kindle正在阅读'], ['Kindle心愿书单', 'Kindle心愿书单'], ['AI辅助心愿清单', 'AI辅助心愿清单'], ['AI辅助正在阅读', 'AI辅助正在阅读'], ['阅读归档', '阅读完成']];
put(B + '02_读书清单.base', 'views:\n' + rl.map(([n, s]) => `  - type: cards\n    name: ${n}\n    filters:\n      and:\n        - states == "${s}"\n    order:\n      - file.name\n    sort:\n      - property: date\n        direction: DESC\n    cardSize: 140\n    imageAspectRatio: 0.7\n    image: note.cover\n    imageFit: contain\n`).join(''));
put(B + '03_书籍分类.base', 'views:\n' + CATS.slice(0, 13).filter(c => c !== '论文写作').map((c, i) => `  - type: kanban\n    name: ${String(CATS.indexOf(c) + 1).padStart(2, '0')}_${c}\n    filters:\n      and:\n        - 书籍 == "${c}"\n    groupBy:\n      property: states\n      direction: ASC\n    order:\n      - file.name\n      - date\n    cardSize: 130\n    image: note.cover\n    imageAspectRatio: 0.7\n    columnWidth: 200\n`).join(''));
put(B + '04_输出文章.base', 'views:\n  - type: cards\n    name: 01_公众号草稿\n    filters:\n      and:\n        - 类型 == "输出文章"\n        - 平台 == "公众号"\n        - 状态 == "草稿"\n    order:\n      - file.name\n      - date\n    cardSize: 160\n    image: note.cover\n  - type: cards\n    name: 02_公众号发布\n    filters:\n      and:\n        - 类型 == "输出文章"\n        - 平台 == "公众号"\n        - 状态 == "已发布"\n    order:\n      - file.name\n      - date\n    cardSize: 160\n    image: note.cover\n  - type: table\n    name: 03_全部文章\n    filters:\n      and:\n        - 类型 == "输出文章"\n    order:\n      - file.name\n      - 状态\n      - 平台\n      - date\n');
const fields = ['政治军事', '哲学思想', '宗教神话', '文学历史', '科学技术', '商业管理', '教育学术', '影视创作'];
put(B + '05_人物分类.base', 'views:\n  - type: cards\n    name: 01_全部人物\n    filters:\n      and:\n        - 类型 == "人物"\n    groupBy:\n      property: 研究领域\n      direction: ASC\n    order:\n      - file.name\n      - 研究领域\n    sort:\n      - property: file.basename\n        direction: ASC\n    image: note.cover\n    cardSize: 120\n' + fields.map((f, i) => `  - type: cards\n    name: ${String(i + 2).padStart(2, '0')}_${f}\n    filters:\n      and:\n        - 类型 == "人物"\n        - 研究领域 == "${f}"\n    order:\n      - file.name\n    image: note.cover\n    cardSize: 120\n`).join('') + '  - type: table\n    name: 99_人物总表\n    filters:\n      and:\n        - 类型 == "人物"\n    order:\n      - file.name\n      - 研究领域\n      - 人物性质\n      - 人物关系\n      - date\n');
put(B + '06_电影归档.base', 'views:\n  - type: cards\n    name: 01_我看过的电影\n    filters:\n      or:\n        - 电影 == "欣赏完成"\n    groupBy:\n      property: 电影类型\n      direction: ASC\n    sort:\n      - property: date\n        direction: DESC\n    image: note.cover\n    imageFit: contain\n    imageAspectRatio: 0.7\n    cardSize: 130\n  - type: cards\n    name: 02_一起看的电影\n    filters:\n      and:\n        - 电影 == "共同欣赏"\n    image: note.cover\n    imageAspectRatio: 0.7\n    cardSize: 130\n  - type: cards\n    name: 03_心愿电影\n    filters:\n      and:\n        - 电影 == "心愿电影"\n    image: note.cover\n    imageAspectRatio: 0.7\n    cardSize: 130\n');
put(B + '19_字数分类.base', 'views:\n' + [1, 2, 3, 4, 5].map(n => `  - type: cards\n    name: ${String(n).padStart(2, '0')}_${['说文解字', '双字笔记', '三字笔记', '四字笔记', '五字笔记'][n - 1]}\n    filters:\n      and:\n        - file.name.length == ${n}\n    cardSize: 100\n`).join(''));

// ---------- 07 Kindle 笔记同步 ----------
put('07_Kindle笔记同步/道德经 Kindle 标注.md', fm({ date: nextDay(), 'kindle-sync': '示例', tags: ['Kindle', '道家'] }) + `# 道德经 · Kindle 标注

> [!quote] 第八章
> 上善若水。水善利万物而不争，处众人之所恶，故几于道。

> [!quote] 第三十三章
> 知人者智，自知者明。胜人者有力，自胜者强。

相关：[[【书籍】道德经]] · [[道]] · [[无为]]
`);

// ---------- 08 我的流程图（Canvas） ----------
put('08_我的流程图/读书工作流.canvas', JSON.stringify({
  nodes: [
    { id: 'a', type: 'text', text: '## 闪念\n读书时随手记下的想法\n→ 00_闪念收集箱', x: 0, y: 0, width: 260, height: 140, color: '1' },
    { id: 'b', type: 'text', text: '## 文献笔记\n用自己的话复述书中观点\n→ 01_书籍电影分类', x: 340, y: 0, width: 260, height: 140, color: '4' },
    { id: 'c', type: 'text', text: '## 永久卡片\n一张卡片一个概念\n→ 02_永久知识卡片盒', x: 680, y: 0, width: 260, height: 140, color: '5' },
    { id: 'd', type: 'file', file: '02_永久知识卡片盒/02_概念类/费曼学习法.md', x: 680, y: 220, width: 300, height: 260 },
    { id: 'e', type: 'text', text: '## 输出\n公众号 / 小红书文章\n→ 05_输出文章', x: 1020, y: 0, width: 260, height: 140, color: '6' },
    { id: 'g', type: 'group', label: '卡片笔记流水线', x: -30, y: -50, width: 1340, height: 560 },
  ],
  edges: [
    { id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' },
    { id: 'e2', fromNode: 'b', fromSide: 'right', toNode: 'c', toSide: 'left' },
    { id: 'e3', fromNode: 'c', fromSide: 'right', toNode: 'e', toSide: 'left', label: '费曼式复述' },
    { id: 'e4', fromNode: 'c', fromSide: 'bottom', toNode: 'd', toSide: 'top' },
  ],
}, null, 2));

// ---------- 09 古籍阅读 / 10 Excalidraw ----------
for (const s of ['01_诸子百家', '02_二十四史', '03_兵法术数', '04_中医书籍', '05_佛经典籍', '06_明清小说', '07_笔记杂著']) dirs.push('09_古籍阅读/' + s);
dirs.push('10_Excalidraw');

// ---------- 使用指南 ----------
put('00_闪念收集箱/使用指南.md', fm({ date: day(0), 类型: '概念', tags: ['使用指南'] }) + `## 1 简要描述
这是「AI 版 Obsidian」的示例仓库，结构和你的读书笔记仓库一致：00–10 编号文件夹、9 种卡片模板、按「类型」属性分类，以及 06 文件夹里的 Bases 数据库视图。

## 2 详细解释
1. 左侧「文件」里的一级文件夹沿用 File Color 插件的配色，右边的数字是笔记数，
2. 点击 [[【主题】01_我的学习方法论]] 这样的双链跳转，鼠标悬停可以预览，
3. 打开 [[02_读书清单.base|读书清单]]、[[03_书籍分类.base|书籍分类]] 查看卡片 / 看板视图，
4. 按 Ctrl+O 快速打开，Ctrl+P 打开命令面板，Ctrl+Shift+N 从模板新建。

## 3 图形展示
![[读书工作流.canvas]]

## 4 我的理解
> [!tip] AI 功能
> 1. 右侧「AI」面板会结合当前笔记与知识库检索回答问题；
> 2. 笔记右上角的 **AI** 按钮可以「按模板补全卡片」「生成相关概念双链」「费曼式解释」「出题自测」；
> 3. 编辑模式下选中文字按 **Ctrl+J** 改写；
> 4. 首页的「AI 写卡片」：输入一个概念名，AI 按 6 段模板写好整张卡片。

> [!warning]- 先配置 API
> 点击左下角齿轮 → AI 模型，选择 DeepSeek / Claude / Kimi / 通义 / Ollama 等，填入 API Key 即可。

## 5 相关概念
- [ ] 打开 [[间隔重复]]，试试「按模板补全卡片」
- [ ] 在设置 → 仓库 里打开你自己的 Obsidian 仓库
- [x] 阅读这份使用指南

## 6 概念出处
==示例内容均为演示用途==，可以随意修改或删除。 #使用指南
`);

// ---------- 写入 ----------
for (const d of dirs) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
for (const [p, c] of Object.entries(files)) {
  const full = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, c, 'utf8');
}
console.log(`示例仓库已生成：${ROOT}（${Object.keys(files).length} 个文件）`);
