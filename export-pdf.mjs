#!/usr/bin/env node
/**
 * export-pdf.mjs —— 命令行把 Markdown 简历导出为 PDF（调用本地 Chrome / Edge 无头模式，零依赖）
 *
 * 用法：
 *   node export-pdf.mjs resume.sample.md
 *   node export-pdf.mjs 我的简历.md -o 张三-前端工程师.pdf
 *   node export-pdf.mjs 我的简历.md --template modern --accent "#0f766e" --margin "14mm 16mm"
 *   node export-pdf.mjs 我的简历.md --png 首页预览.png
 *
 * 说明：Markdown 文首的配置块（template / accent / font / fontSize / lineHeight / margin）
 *       会自动生效；命令行参数可临时覆盖它们。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ResumeMD = require('./assets/resume-md.js');
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `用法：node export-pdf.mjs <简历.md> [选项]

选项：
  -o, --out <文件.pdf>      输出 PDF 路径（默认：与输入同名）
      --png <文件.png>      额外导出首页预览图
      --html <文件.html>    额外导出一个可单独打开的 HTML
      --keep-html           保留中间产物 .build/*.html
      --title <标题>        文档标题（默认取简历姓名）
      --template <名称>     classic | modern | compact
      --accent <#色值>      主题色，如 "#0f766e"
      --font <sans|serif>   字体族
      --font-size <14px>    正文字号
      --line-height <1.65>  行距
      --margin <16mm 18mm>  页边距
      --browser <路径>      指定 Chrome / Edge 可执行文件
  -h, --help                显示帮助

示例：
  node export-pdf.mjs resume.sample.md -o 简历.pdf
  node export-pdf.mjs 我的简历.md --template compact --margin "12mm 14mm"
`;

function parseArgs(argv) {
  const args = { input: null, out: null, settings: {}, browser: null, png: null, html: null, keepHtml: false, title: null };
  const take = (i) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      console.error('参数 ' + argv[i] + ' 缺少取值');
      process.exit(2);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else if (a === '-o' || a === '--out') { args.out = take(i); i++; }
    else if (a === '--template') { args.settings.template = take(i); i++; }
    else if (a === '--accent') { args.settings.accent = take(i); i++; }
    else if (a === '--font') { args.settings.font = take(i); i++; }
    else if (a === '--font-size') { args.settings.fontSize = take(i); i++; }
    else if (a === '--line-height') { args.settings.lineHeight = take(i); i++; }
    else if (a === '--margin') { args.settings.margin = take(i); i++; }
    else if (a === '--title') { args.title = take(i); i++; }
    else if (a === '--browser') { args.browser = take(i); i++; }
    else if (a === '--png') { args.png = take(i); i++; }
    else if (a === '--html') { args.html = take(i); i++; }
    else if (a === '--keep-html') { args.keepHtml = true; }
    else if (a.startsWith('-')) { console.error('未知参数：' + a + '\n\n' + USAGE); process.exit(2); }
    else if (!args.input) { args.input = a; }
    else { console.error('多余的位置参数：' + a); process.exit(2); }
  }
  return args;
}

function findBrowser(explicit) {
  const candidates = [
    explicit,
    process.env.RESUME_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* ignore */ }
  }
  return null;
}

function toFileUrl(p) {
  return pathToFileURL(path.resolve(p)).href;
}

function countPdfPages(buf) {
  const text = buf.toString('latin1');
  const m = /\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/.exec(text);
  if (m) return Number(m[1]);
  const single = text.match(/\/Type\s*\/Page[^s]/g);
  return single ? single.length : 0;
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function runBrowser(browser, flags) {
  const res = spawnSync(browser, flags, { stdio: 'ignore', timeout: 180000, windowsHide: true });
  if (res.error) throw new Error('启动浏览器失败：' + res.error.message);
  return res.status;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.log(USAGE);
    process.exit(2);
  }
  if (!fs.existsSync(args.input)) {
    console.error('找不到输入文件：' + args.input);
    process.exit(1);
  }

  const browser = findBrowser(args.browser);
  if (!browser) {
    console.error('未找到 Chrome / Edge。请用 --browser <可执行文件路径> 指定，或设置环境变量 RESUME_BROWSER。');
    process.exit(1);
  }

  const md = fs.readFileSync(args.input, 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'resume.css'), 'utf8');
  const base = path.basename(args.input).replace(/\.(md|markdown|txt)$/i, '');
  const outPdf = path.resolve(args.out || base + '.pdf');

  const buildDir = path.join(ROOT, '.build');
  fs.mkdirSync(buildDir, { recursive: true });
  const htmlPath = path.join(buildDir, base + '.html');
  const previewHtmlPath = path.join(buildDir, base + '.preview.html');
  const profileDir = path.join(buildDir, '.chrome-profile');

  fs.writeFileSync(htmlPath, ResumeMD.toDocumentHTML(md, { css, settings: args.settings, title: args.title }), 'utf8');

  const common = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--mute-audio',
    '--hide-scrollbars',
    '--user-data-dir=' + profileDir,
    '--virtual-time-budget=5000'
  ];

  if (args.out !== 'none') {
    fs.rmSync(outPdf, { force: true });
    runBrowser(browser, common.concat([
      '--no-pdf-header-footer',
      '--print-to-pdf-no-header',
      '--print-to-pdf=' + outPdf,
      toFileUrl(htmlPath)
    ]));
    if (!fs.existsSync(outPdf)) {
      console.error('PDF 生成失败。可尝试手动执行：\n  "' + browser + '" ' + common.join(' ') + ' --print-to-pdf="' + outPdf + '" "' + toFileUrl(htmlPath) + '"');
      process.exit(1);
    }
    const buf = fs.readFileSync(outPdf);
    const pages = countPdfPages(buf);
    console.log('✓ PDF 已生成：' + outPdf);
    console.log('  ' + (pages ? pages + ' 页 · ' : '') + humanSize(buf.length) + ' · 浏览器：' + path.basename(browser));
  }

  if (args.png) {
    fs.writeFileSync(previewHtmlPath, ResumeMD.toDocumentHTML(md, { css, settings: args.settings, title: args.title, preview: true }), 'utf8');
    const outPng = path.resolve(args.png);
    runBrowser(browser, common.concat([
      '--screenshot=' + outPng,
      '--window-size=794,1123',
      '--force-device-scale-factor=2',
      toFileUrl(previewHtmlPath)
    ]));
    if (fs.existsSync(outPng)) console.log('✓ 首页预览图：' + outPng);
    else console.error('预览图生成失败：' + outPng);
  }

  if (args.html) {
    const outHtml = path.resolve(args.html);
    fs.copyFileSync(htmlPath, outHtml);
    console.log('✓ 独立 HTML：' + outHtml);
  }

  if (!args.keepHtml) {
    const keep = new Set();
    if (args.png) keep.add(previewHtmlPath);
    for (const f of [htmlPath, previewHtmlPath]) {
      if (!keep.has(f)) fs.rmSync(f, { force: true });
    }
  } else {
    console.log('  中间 HTML 保留在：' + buildDir);
  }
}

main();
