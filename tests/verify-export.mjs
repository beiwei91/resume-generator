/**
 * tests/verify-export.mjs —— 端到端验证：用本地 Chrome/Edge 无头模式真的导出 PDF，
 * 检查纸张尺寸、页数、@page 页边距是否与 CSS 完全一致（node tests/verify-export.mjs）
 *
 * 原理：Chromium 生成的内容流里含有
 *   1) 内容盒原点变换（形如 `3.125 0 0 3.125 51 796.92 cm`），其平移量就是 A4 去掉页边距后的原点；
 *   2) 内容盒矩形（形如 `0 0 658 1002 re`），其宽高就是 A4 去掉页边距后的可排版区域（CSS px）。
 * 两者都能证明 @page 页边距被遵守、且浏览器没有额外叠加默认边距。
 * 注意：不能直接信任逐字坐标——同一段文字会在两套坐标系里各输出一次（其中一套被裁掉不可见）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MD = require(path.join(ROOT, 'assets', 'resume-md.js'));

const BUILD = path.join(ROOT, '.build');
const PROFILE = path.join(BUILD, '.chrome-profile');
const PT_PER_MM = 72 / 25.4;
const PX_PER_MM = 96 / 25.4;
const A4 = { w: 210 * PT_PER_MM, h: 297 * PT_PER_MM };

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failures.push(name + (detail ? ' → ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' → ' + detail : '')); }
}

function findBrowser() {
  const list = [
    process.env.RESUME_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  return list.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

const browser = findBrowser();
if (!browser) {
  console.error('未找到 Chrome / Edge，无法执行导出验证。');
  process.exit(1);
}

function chrome(flags, profile) {
  spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--mute-audio', '--hide-scrollbars',
    '--user-data-dir=' + (profile || PROFILE), '--virtual-time-budget=5000'
  ].concat(flags), { stdio: 'ignore', timeout: 180000, windowsHide: true });
}

/* ---------------------------------------------------------------- PDF 解析 */

function inflateStreams(buf) {
  const text = buf.toString('latin1');
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) continue;
    try { out.push(zlib.inflateSync(buf.subarray(start, end)).toString('latin1')); }
    catch (e) { /* 非 Flate 流忽略 */ }
  }
  return out;
}

const NUM = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const MATRIX = '(' + NUM + '(?:\\s+' + NUM + '){5})';
const CONTENT_STREAM_RE = new RegExp('^\\s*' + MATRIX + '\\s+cm');

/** 过滤出页面内容流（排除内嵌字体等二进制流） */
function contentStreams(streams) {
  return streams.filter((txt) =>
    txt.indexOf('\0') === -1 &&
    CONTENT_STREAM_RE.test(txt) &&
    /\bBT\b/.test(txt) &&
    /\d+ Tf/.test(txt));
}

function mul(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]
  ];
}

/** 跟踪 q/Q 栈，返回每个 `cm` 之后的复合变换矩阵（平移量即内容盒原点） */
function composedTransforms(txt) {
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const re = new RegExp(MATRIX + '\\s+cm|(q)|(Q)', 'g');
  let m;
  while ((m = re.exec(txt))) {
    if (m[1]) ctm = mul(m[1].trim().split(/\s+/).map(Number), ctm);
    else if (m[2]) stack.push(ctm.slice());
    else if (m[3] && stack.length) ctm = stack.pop();
    out.push(ctm.slice());
  }
  return out;
}

/** 内容流里所有矩形 `x y w h re`，用来找内容盒尺寸 */
function rects(txt) {
  const out = [];
  const re = new RegExp('(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+re\\b', 'g');
  let m;
  while ((m = re.exec(txt))) out.push([Number(m[3]), Number(m[4])]);
  return out;
}

function pageMeta(buf) {
  const s = buf.toString('latin1');
  const box = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s);
  const count = /\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/.exec(s);
  return {
    box: box ? { w: Number(box[3]), h: Number(box[4]) } : null,
    pages: count ? Number(count[1]) : 0,
    fonts: (s.match(/\/FontFile2|\/FontFile3/g) || []).length
  };
}

/** 对象号 → 解压后的流内容（PDF 里每个字体有自己的 ToUnicode 表，必须按字体分开映射） */
function streamsByObject(buf) {
  const s = buf.toString('latin1');
  const out = new Map();
  const objRe = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = objRe.exec(s))) {
    const start = m.index;
    const endObj = s.indexOf('endobj', start);
    const span = s.slice(start, endObj < 0 ? s.length : endObj);
    const sm = /stream\r?\n/.exec(span);
    if (!sm) continue;
    const from = start + sm.index + sm[0].length;
    const to = s.indexOf('endstream', from);
    if (to < 0) continue;
    try { out.set(Number(m[1]), zlib.inflateSync(buf.subarray(from, to)).toString('latin1')); }
    catch (e) { /* 未压缩或非流对象，忽略 */ }
    objRe.lastIndex = to;
  }
  return out;
}

/** 解析一段 ToUnicode CMap，返回 码位 → 字符 */
function parseCMap(text) {
  const map = new Map();
  const hexToStr = (hex) => {
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    return out;
  };
  let m;
  const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = charRe.exec(text))) {
    const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p;
    while ((p = pairRe.exec(m[1]))) map.set(parseInt(p[1], 16), hexToStr(p[2]));
  }
  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(text))) {
    const rRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    let r;
    while ((r = rRe.exec(m[1]))) {
      const lo = parseInt(r[1], 16);
      const hi = parseInt(r[2], 16);
      if (r[3]) {
        const dst = parseInt(r[3], 16);
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(dst + (c - lo)));
      } else if (r[4]) {
        (r[4].match(/<([0-9A-Fa-f]+)>/g) || []).forEach((item, i) => {
          map.set(lo + i, hexToStr(item.slice(1, -1)));
        });
      }
    }
  }
  return map;
}

/** /F4 → 该字体的码位映射表 */
function fontMaps(buf) {
  const objs = streamsByObject(buf);
  const raw = buf.toString('latin1');
  const fontToCmap = new Map();
  let m;
  const fontRe = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>/g;
  while ((m = fontRe.exec(raw))) {
    const body = m[2];
    if (body.indexOf('/Font') < 0) continue;
    const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(body);
    if (!tu) continue;
    const cmapText = objs.get(Number(tu[1]));
    if (cmapText) fontToCmap.set(Number(m[1]), parseCMap(cmapText));
  }
  const nameToFont = new Map();
  const resRe = /\/Font\s*<<([\s\S]*?)>>/g;
  while ((m = resRe.exec(raw))) {
    const pairRe = /\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g;
    let p;
    while ((p = pairRe.exec(m[1]))) nameToFont.set('/' + p[1], Number(p[2]));
  }
  const byName = new Map();
  nameToFont.forEach((objNum, name) => {
    if (fontToCmap.has(objNum)) byName.set(name, fontToCmap.get(objNum));
  });
  return byName;
}

/** 还原 PDF 里的文字（用于断言 PDF 里到底有什么） */
function pdfText(buf) {
  const byName = fontMaps(buf);
  const fallback = new Map();
  byName.forEach((map) => map.forEach((v, k) => { if (!fallback.has(k)) fallback.set(k, v); }));

  let out = '';
  streamsByObject(buf).forEach((txt) => {
    if (txt.indexOf('\0') !== -1) return;
    if (!CONTENT_STREAM_RE.test(txt) || !/\bBT\b/.test(txt) || !/\d+ Tf/.test(txt)) return;
    let cur = fallback;
    const re = /\/([A-Za-z0-9]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = re.exec(txt))) {
      if (m[1]) { cur = byName.get('/' + m[1]) || fallback; continue; }
      const hex = m[2];
      for (let i = 0; i + 4 <= hex.length; i += 4) out += cur.get(parseInt(hex.substr(i, 4), 16)) || '';
    }
    out += '\n';
  });
  return out;
}

/* ---------------------------------------------------------------- 用例 */

fs.mkdirSync(BUILD, { recursive: true });
const css = fs.readFileSync(path.join(ROOT, 'assets', 'resume.css'), 'utf8');

function renderPdf(name, md, settings) {
  const html = path.join(BUILD, name + '.html');
  const pdf = path.join(BUILD, name + '.pdf');
  fs.writeFileSync(html, MD.toDocumentHTML(md, { css, settings }), 'utf8');
  fs.rmSync(pdf, { force: true });
  chrome(['--no-pdf-header-footer', '--print-to-pdf-no-header', '--print-to-pdf=' + pdf, pathToFileURL(html).href]);
  return fs.existsSync(pdf) ? fs.readFileSync(pdf) : null;
}

const marginX = 18 * PT_PER_MM;
const marginY = 16 * PT_PER_MM;
const sample = fs.readFileSync(path.join(ROOT, 'resume.sample.md'), 'utf8');

console.log('\n纸张与页边距');
const out = renderPdf('sample', sample, {});
if (!out) {
  console.error('  ✗ PDF 生成失败（浏览器：' + browser + '）');
  process.exit(1);
}
const meta = pageMeta(out);
check('纸张为 A4', !!meta.box && Math.abs(meta.box.w - A4.w) < 2 && Math.abs(meta.box.h - A4.h) < 2,
  meta.box ? meta.box.w.toFixed(1) + ' × ' + meta.box.h.toFixed(1) + ' pt' : 'n/a');
check('中文字体已内嵌', meta.fonts > 0, meta.fonts + ' 个字体文件');

const streams = contentStreams(inflateStreams(out));
check('解析到页面内容流', streams.length > 0, streams.length + ' 个');

const cms = streams.flatMap(composedTransforms);
const origin = cms.find((m) => Math.abs(m[4] - marginX) < 1.5 && Math.abs(m[5] - (A4.h - marginY)) < 2);
check('@page 页边距生效且未叠加默认边距',
  !!origin,
  origin ? '内容原点 ' + origin[4].toFixed(1) + ' / ' + origin[5].toFixed(1) + ' pt（期望 ' + marginX.toFixed(1) + ' / ' + (A4.h - marginY).toFixed(1) + '）' : '未找到 18mm/16mm 内容原点');

const expectW = 210 * PX_PER_MM - 36 * PX_PER_MM;
const expectH = 297 * PX_PER_MM - 32 * PX_PER_MM;
const box = streams.flatMap(rects).find((r) => Math.abs(r[0] - expectW) < 2 && Math.abs(r[1] - expectH) < 2);
check('可排版区域 = A4 去掉页边距（174mm × 265mm）',
  !!box,
  box ? box[0].toFixed(1) + ' × ' + box[1].toFixed(1) + ' px（期望 ' + expectW.toFixed(1) + ' × ' + expectH.toFixed(1) + '）' : '未找到内容盒矩形');

check('示例简历整齐落在单页内', meta.pages === 1, meta.pages + ' 页');

const zero = renderPdf('zero-margin', MD.upsertFrontMatter(sample, { margin: '0mm' }), {});
const zeroCms = zero ? contentStreams(inflateStreams(zero)).flatMap(composedTransforms) : [];
check('页边距可配置（0mm 时 18mm 内容偏移消失）',
  !!zero && !zeroCms.some((m) => Math.abs(m[4] - marginX) < 1.5),
  zero ? '0mm 时 ' + zeroCms.length + ' 个变换，无 18mm 偏移' : 'n/a');

const narrow = renderPdf('narrow-margin', MD.upsertFrontMatter(sample, { margin: '12mm 14mm' }), {});
const narrowCms = narrow ? contentStreams(inflateStreams(narrow)).flatMap(composedTransforms) : [];
check('页边距可配置（12mm 时内容原点变为 14mm）',
  narrowCms.some((m) => Math.abs(m[4] - 14 * PT_PER_MM) < 1.5 && Math.abs(m[5] - (A4.h - 12 * PT_PER_MM)) < 2),
  '14mm = ' + (14 * PT_PER_MM).toFixed(1) + ' pt，实测原点 ' +
  (narrowCms.length ? narrowCms.map((m) => m[4].toFixed(1)).join('/') : 'n/a'));

console.log('\n证件照');
const photoUri = 'data:image/png;base64,' +
  fs.readFileSync(path.join(ROOT, 'assets', 'sample-photo.png')).toString('base64');
const photoMd = MD.upsertFrontMatter(sample, { photo: photoUri, photoSize: '26mm' });
const photoPdf = renderPdf('photo', photoMd, {});
const photoMeta = photoPdf ? pageMeta(photoPdf) : null;
check('带证件照仍是标准 A4（不超过 2 页）',
  !!photoPdf && photoMeta.pages >= 1 && photoMeta.pages <= 2 &&
  Math.abs(photoMeta.box.w - A4.w) < 2 && Math.abs(photoMeta.box.h - A4.h) < 2,
  photoMeta ? photoMeta.pages + ' 页，' + photoMeta.box.w.toFixed(1) + ' × ' + photoMeta.box.h.toFixed(1) + ' pt' : '失败');
const imageObjects = photoPdf ? (photoPdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length : 0;
check('证件照真的写进了 PDF（内嵌图像对象）', imageObjects >= 1, imageObjects + ' 个图像对象');
const noPhotoImages = (out.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
check('没有证件照时 PDF 里没有多余图像', noPhotoImages === 0, noPhotoImages + ' 个图像对象');

const photoPreview = path.join(BUILD, 'photo-preview.html');
fs.writeFileSync(photoPreview, MD.toDocumentHTML(photoMd, { css: fs.readFileSync(path.join(ROOT, 'assets', 'resume.css'), 'utf8'), preview: true }), 'utf8');
const photoShot = path.join(BUILD, 'photo-preview.png');
fs.rmSync(photoShot, { force: true });
chrome(['--screenshot=' + photoShot, '--window-size=794,1123', '--force-device-scale-factor=2', pathToFileURL(photoPreview).href]);
check('证件照排版预览图生成', fs.existsSync(photoShot), path.relative(ROOT, photoShot));

console.log('\n模板与界面');
[['classic', '#2563eb'], ['modern', '#0f766e'], ['compact', '#b91c1c']].forEach(([tpl, accent]) => {
  const pdf = renderPdf('tpl-' + tpl, sample, { template: tpl, accent });
  const st = pdf ? pageMeta(pdf) : null;
  check('模板 ' + tpl + ' 可导出单页', !!pdf && st.pages === 1, st ? st.pages + ' 页' : '失败');
});

const longDoc = sample + '\n\n' + Array.from({ length: 30 }, (_, i) => '- 追加条目 ' + (i + 1) + '：用于验证多页分页行为。').join('\n');
const longPdf = renderPdf('multi-page', longDoc, {});
const longMeta = longPdf ? pageMeta(longPdf) : null;
check('内容变长时自动分页', !!longPdf && longMeta.pages >= 2, longMeta ? longMeta.pages + ' 页' : '失败');

const shotApp = path.join(BUILD, 'app-ui.png');
const shotProfile = path.join(BUILD, '.shot-profile');
fs.rmSync(shotApp, { force: true });
fs.rmSync(shotProfile, { recursive: true, force: true });
// 用干净的 profile：否则界面会从 localStorage 读回上一次运行保存的文档，截不到默认示例
chrome(['--screenshot=' + shotApp, '--window-size=1600,1000', '--force-device-scale-factor=1.5', pathToFileURL(path.join(ROOT, 'index.html')).href], shotProfile);
check('界面截图生成', fs.existsSync(shotApp), path.relative(ROOT, shotApp));

console.log('\n应用界面打印（界面元素不能跟正文一起导出）');
{
  // 打印时的页盒宽约 794px（A4），会命中「窄屏」媒体查询 —— 曾经因此把
  // 「编辑 / 预览」切换条印进了 PDF，这里专门守这条
  const profile = path.join(BUILD, '.print-profile');
  const seed = path.join(BUILD, 'seed-prefs.html');
  fs.rmSync(profile, { recursive: true, force: true });
  fs.writeFileSync(seed, '<!doctype html><meta charset="utf-8"><script>localStorage.setItem("resume-gen:prefs", ' +
    JSON.stringify(JSON.stringify({ zoom: 'fit', guides: true, editorWidth: 460, autoSave: true, helpSeen: true, mode: 'form', mobileView: 'edit' })) +
    ');</script>seeded', 'utf8');

  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--hide-scrollbars',
    '--disable-background-networking', '--disable-component-update', '--proxy-server=direct://',
    '--user-data-dir=' + profile, '--virtual-time-budget=15000'
  ];
  const run = (extra) => spawnSync(browser, args.concat(extra), { encoding: 'utf8', timeout: 180000, windowsHide: true });

  run(['--dump-dom', pathToFileURL(seed).href]);          // 预置偏好（file:// 同源）
  const appPdf = path.join(BUILD, 'app-print.pdf');
  fs.rmSync(appPdf, { force: true });
  run(['--no-pdf-header-footer', '--print-to-pdf-no-header', '--print-to-pdf=' + appPdf,
    pathToFileURL(path.join(ROOT, 'index.html')).href]);

  const okFile = fs.existsSync(appPdf);
  const buf = okFile ? fs.readFileSync(appPdf) : null;
  const text = buf ? pdfText(buf) : '';
  const meta = buf ? pageMeta(buf) : null;
  check('应用页面能被打印成 PDF', okFile && meta && meta.pages >= 1, meta ? meta.pages + ' 页' : '打印失败');
  check('PDF 里有简历正文', /张三/.test(text),
    '还原出的文字：' + text.replace(/\s+/g, ' ').slice(0, 60));
  const leaked = ['Markdown', '预览', '排版', '语法速查', '撤销', '导出 PDF'].filter((w) => text.indexOf(w) >= 0);
  check('PDF 里没有夹带界面元素（切换条 / 工具栏 / 状态栏）',
    leaked.length === 0, leaked.length ? '混进了：' + leaked.join('、') : '干净（注意别用「表单」这类词做关键词——示例简历里有「轻量表单引擎」）');
}

console.log('\n结果');
console.log('  通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  failures.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
console.log('  导出链路验证通过 ✓');
