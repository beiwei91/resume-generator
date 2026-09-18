#!/usr/bin/env node
/**
 * build-single.mjs —— 把整个应用打包成一个「单文件 HTML」
 *
 * 产物可以直接双击打开、拷进 U 盘、发邮件，不需要 Node，也不需要服务器。
 * 用法：node build-single.mjs [输出路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '简历生成器-单文件.html'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let html = read('index.html');

/* 内联样式 */
html = html.replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">\r?\n?/g, (m, href) => {
  return '<style>\n/* ==== ' + href + ' ==== */\n' + read(href).trim() + '\n</style>\n';
});

/* 内联脚本（转义 </script 以免提前结束脚本块） */
html = html.replace(/[ \t]*<script src="([^"]+)"><\/script>\r?\n?/g, (m, src) => {
  const js = read(src).replace(/<\/script/gi, '<\\/script');
  return '<script>\n/* ==== ' + src + ' ==== */\n' + js.trim() + '\n</script>\n';
});

/* 标签页图标改用内嵌 data URI，避免依赖外部文件 */
const iconRel = 'assets/icons/icon-192.png';
html = html.replace(/[ \t]*<link rel="icon"[^>]*>\r?\n?/g, () => {
  const b64 = fs.readFileSync(path.join(ROOT, iconRel)).toString('base64');
  return '<link rel="icon" type="image/png" sizes="192x192" href="data:image/png;base64,' + b64 + '">\n';
});

/* 顶部加一段说明，方便别人拿到文件后知道这是什么 */
const stamp = new Date().toISOString().slice(0, 10);
html = html.replace('<head>', '<head>\n<!-- 简历生成器 · 单文件便携版（构建于 ' + stamp + '）\n' +
  '     直接双击用浏览器打开即可：写 Markdown、实时预览 A4、导出 PDF。\n' +
  '     没有外部依赖，可以拷到任何地方离线使用。\n' +
  '     由 build-single.mjs 生成，请勿手工编辑；改源码后重新运行该脚本。 -->');

/* 自检：确认已经没有外部引用 */
const leftovers = (html.match(/(?:src|href)="assets?\/[^"]*"/g) || []);
if (leftovers.length) {
  console.error('打包失败：仍有外部引用 ' + leftovers.join(', '));
  process.exit(1);
}
if (!/<style>/.test(html) || !/resume-md\.js ====/.test(html) || !/app\.js ====/.test(html)) {
  console.error('打包失败：样式或脚本没有内联成功');
  process.exit(1);
}

fs.writeFileSync(OUT, html, 'utf8');
console.log('✓ 单文件版已生成：' + OUT);
console.log('  ' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB，双击即可打开（无需 Node、无需服务器）');
