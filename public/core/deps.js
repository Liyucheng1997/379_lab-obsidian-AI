// 前后端共用的第三方依赖：浏览器里来自 vendor/ 的全局变量，Node 服务启动时注入
export const deps = { yaml: globalThis.jsyaml || null };
