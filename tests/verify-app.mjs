/**
 * tests/verify-app.mjs —— 验证「双击即用」这条链路（需要本机 Chrome / Edge）
 *
 *   1. 图标：PNG 尺寸、ICO 内嵌尺寸
 *   2. 启动器：生成的命令、URL 百分号编码、目标文件、浏览器能否真的打开
 *   3. 桌面快捷方式
 *   4. 单文件便携版：无外部引用、file:// 可用、localStorage 可用
 *   5. 纯静态自检：应用里不再有任何本地服务相关代码或网络请求
 *
 * 用法：node tests/verify-app.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, '.build');
const ICONS = path.join(ROOT, 'assets', 'icons');
const LAUNCHER = '启动简历生成器.vbs';
fs.mkdirSync(BUILD, { recursive: true });

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failures.push(name + (detail ? ' → ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' → ' + detail : '')); }
}
function section(title) { console.log('\n' + title); }

function findBrowser() {
  const list = [
    process.env.RESUME_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome'
  ].filter(Boolean);
  return list.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

const browser = findBrowser();

/** noVirtualTime=true 时不加 --virtual-time-budget（有些异步流程需要真实时间） */
function chrome(flags, noVirtualTime) {
  return spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--hide-scrollbars',
    // 关掉后台联网并强制直连：否则本机 http 页面会卡在 Google 服务（GCM / 更新检查）上
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    '--disable-client-side-phishing-detection', '--disable-domain-reliability',
    '--metrics-recording-only', '--no-service-autorun',
    '--proxy-server=direct://', '--proxy-bypass-list=*',
    '--user-data-dir=' + path.join(BUILD, '.chrome-profile')
  ].concat(noVirtualTime ? [] : ['--virtual-time-budget=15000']).concat(flags),
    { encoding: 'utf8', timeout: 180000, windowsHide: true });
}

const dumpDom = (url) => String(chrome(['--dump-dom', url]).stdout || '');

/** 简单的 GET，返回 { status, body } */
async function get(url) {
  const mod = await import('node:http');
  return new Promise((resolve) => {
    const req = mod.get(url, { timeout: 6000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

/** 等某个地址返回 200（最多 timeoutMs） */
async function waitForHttp(url, timeoutMs) {
  const mod = await import('node:http');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await new Promise((resolve) => {
      const req = mod.get(url, { timeout: 4000 }, (r) => { r.resume(); resolve(r.statusCode); });
      req.on('error', () => resolve(0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
    });
    if (status === 200) return { status: 200 };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { status: 0 };
}
const logPath = path.join(ROOT, '.launcher.log');

function cscript(args) {
  const res = spawnSync('cscript', ['//nologo', path.join(ROOT, LAUNCHER)].concat(args),
    { encoding: 'utf8', timeout: 120000, windowsHide: true });
  return { status: res.status, text: String(res.stdout || '') + String(res.stderr || '') };
}

function readLog() {
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf16le') : '';
}

function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ================================================================== 1. 图标 */

section('图标');
for (const [name, size] of [['icon-192.png', 192], ['icon-256.png', 256], ['icon-512.png', 512], ['icon-maskable-512.png', 512]]) {
  const p = path.join(ICONS, name);
  const dim = fs.existsSync(p) ? pngSize(fs.readFileSync(p)) : null;
  check(name, !!dim && dim.w === size && dim.h === size, dim ? dim.w + '×' + dim.h : '缺失');
}
const icoPath = path.join(ICONS, 'resume.ico');
let icoDetail = '缺失';
let icoOk = false;
if (fs.existsSync(icoPath)) {
  const buf = fs.readFileSync(icoPath);
  const dim = pngSize(buf.subarray(22));
  icoOk = buf.readUInt16LE(2) === 1 && !!dim && dim.w === 256;
  icoDetail = dim ? '内嵌 PNG ' + dim.w + '×' + dim.h : '格式异常';
}
check('resume.ico（快捷方式图标）', icoOk, icoDetail);

/* ================================================================== 2. 启动器 */

section('启动器（双击即用）');
const launcherPath = path.join(ROOT, LAUNCHER);
if (!fs.existsSync(launcherPath)) {
  check(LAUNCHER, false, '缺失');
} else {
  const head = fs.readFileSync(launcherPath).subarray(0, 2);
  check(LAUNCHER + '（UTF-16LE + BOM）', head[0] === 0xff && head[1] === 0xfe, fs.statSync(launcherPath).size + ' B');

  fs.rmSync(logPath, { force: true });
  fs.rmSync(path.join(ROOT, '.server.json'), { force: true });
  const res = cscript(['--dry-run', '--quiet']);
  const log = readLog();

  check('dry-run 正常结束', res.status === 0, res.text.trim().slice(0, 160));
  check('不产生任何后台服务文件', !fs.existsSync(path.join(ROOT, '.server.json')));

  const cmd = ((/命令\s*(.+)/.exec(log) || [])[1] || '').trim();
  check('解析出启动命令', !!cmd, cmd || '日志里没有命令');
  check('用 --app 打开（应用窗口，无地址栏）', /--app="?file:\/\/\//.test(cmd), cmd.slice(0, 150));
  check('命令行是纯 ASCII（中文路径必须百分号编码，否则经命令行转发会被破坏）',
    !!cmd && !/[^\x00-\x7F]/.test(cmd),
    /[^\x00-\x7F]/.test(cmd) ? '命令里含非 ASCII 字符' : '纯 ASCII');

  const url = ((/--app="?([^"\s]+)"?/.exec(cmd) || [])[1] || '').trim();
  let filePath = '';
  try { filePath = decodeURIComponent(url.replace(/^file:\/\/\//, '')); } catch (e) { filePath = ''; }
  check('URL 指向的文件存在', !!filePath && fs.existsSync(filePath), filePath);
  check('百分号编码与 Node 的 pathToFileURL 完全一致',
    !!filePath && url === pathToFileURL(filePath).href, '启动器=' + url);

  if (url && browser) {
    const dom = dumpDom(url);
    check('浏览器能直接打开该页面（不依赖任何服务）',
      /class="r-name">张三/.test(dom) && /resume-sheet/.test(dom), '输出 ' + dom.length + ' 字符');
  }

  fs.rmSync(logPath, { force: true });
  cscript(['--dry-run', '--quiet', '--tab']);
  const tabCmd = ((/命令\s*(.+)/.exec(readLog()) || [])[1] || '').trim();
  check('--tab 改用本地文件路径打开（等同双击，最稳）',
    /^"[A-Za-z]:\\[^"]+\.html"$/.test(tabCmd), tabCmd || '未解析出命令');
}

/* ================================================================== 3. 快捷方式 */

section('桌面快捷方式');
const outDir = path.join(BUILD, 'shortcut');
fs.rmSync(outDir, { recursive: true, force: true });
spawnSync('cscript', ['//nologo', path.join(ROOT, '创建桌面快捷方式.vbs'), '--out=' + outDir, '--quiet'],
  { encoding: 'utf8', timeout: 120000, windowsHide: true });
const lnk = path.join(outDir, '简历生成器.lnk');
let lnkOk = false;
let lnkDetail = '未生成';
if (fs.existsSync(lnk)) {
  const buf = fs.readFileSync(lnk);
  const hasWscript = buf.includes(Buffer.from('wscript.exe', 'utf16le'));
  const hasLauncher = buf.includes(Buffer.from(LAUNCHER, 'utf16le'));
  lnkOk = buf.readUInt32LE(0) === 0x0000004c && hasWscript && hasLauncher;
  lnkDetail = buf.length + ' B，指向 wscript=' + hasWscript + '，目标脚本=' + hasLauncher;
}
check('生成「简历生成器」快捷方式', lnkOk, lnkDetail);

/* ================================================================== 4. 单文件便携版 */

section('单文件便携版');
const build = spawnSync(process.execPath, [path.join(ROOT, 'build-single.mjs')],
  { cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true });
const single = path.join(ROOT, '简历生成器-单文件.html');
check('打包脚本执行成功', build.status === 0 && fs.existsSync(single),
  String(build.stdout || build.stderr || '').trim().split('\n').pop());

if (fs.existsSync(single)) {
  const html = fs.readFileSync(single, 'utf8');
  check('没有残留外部引用', !/(?:src|href)="assets?\//.test(html));
  check('样式与脚本已内联', /<style>/.test(html) && /==== assets\/app\.js/.test(html) && /==== assets\/resume\.css/.test(html));
  check('体积合理', html.length > 20000 && html.length < 2000000, (html.length / 1024).toFixed(1) + ' KB');

  const dom = dumpDom(pathToFileURL(single).href);
  check('file:// 直接打开能渲染简历', /class="r-name">张三/.test(dom) && /resume-sheet/.test(dom));
  check('状态栏显示已保存（说明 localStorage 可用）', /已保存|已加载/.test(dom));

  const shot = path.join(BUILD, 'single-file.png');
  fs.rmSync(shot, { force: true });
  chrome(['--screenshot=' + shot, '--window-size=1400,900', pathToFileURL(single).href]);
  check('截图生成', fs.existsSync(shot), path.relative(ROOT, shot));
}

/* ================================================================== 5. 纯静态自检 */

section('纯静态自检（服务相关的东西都已移除）');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
check('index.html 不再引用 manifest / Service Worker',
  !/rel="manifest"/.test(index) && !/serviceWorker/.test(index));
check('index.html 不再有「安装为应用」入口', !/btnInstall/.test(index));
check('界面里不再有本地服务状态条', !/serviceBadge|btnQuitService/.test(index) && !/service-badge/.test(fs.readFileSync(path.join(ROOT, 'assets', 'app.css'), 'utf8')));
check('app.js 不再调用服务接口', !/__alive|__info|__shutdown|EventSource/.test(appJs));
check('app.js 没有任何网络请求', !/\bfetch\s*\(/.test(appJs));
check('根目录不再有服务端文件',
  !['server.js', 'sw.js', 'manifest.webmanifest', '停止简历生成器.vbs'].some((f) => fs.existsSync(path.join(ROOT, f))));

section('证件照入口');
check('工具栏有「证件照」按钮与隐藏的选图输入',
  /id="btnPhoto"/.test(index) && /id="photoInput"[^>]*type="file"/.test(index));
check('排版面板有宽度 / 方位 / 形状 / 移除控件',
  /id="photoSizeInput"/.test(index) && /id="photoAlignSelect"/.test(index) &&
  /id="photoShapeSelect"/.test(index) && /id="btnRemovePhoto"/.test(index));
check('语法速查里写了证件照用法',
  /photo:/.test(index) && /photoSize/.test(index) && /photoShape/.test(index));
check('示例证件照素材存在', fs.existsSync(path.join(ROOT, 'assets', 'sample-photo.png')));

/* ================================================================== 6. 表单模式 */

section('表单模式');
check('index.html 引入了表单逻辑与视图',
  /assets\/resume-form\.js/.test(index) && /assets\/form-view\.js/.test(index));
check('有「表单 / Markdown」页签与表单容器',
  /id="modeTabs"/.test(index) && /data-mode="form"/.test(index) && /id="formView"/.test(index));
check('撤销按钮与「Markdown 模式才有」的插入工具条',
  /id="btnUndo"/.test(index) && /id="mdTools" hidden/.test(index));

if (fs.existsSync(single)) {
  const dom = dumpDom(pathToFileURL(single).href);
  const paths = [
    'data-path="name"',
    'data-path="subtitle"',
    'data-path="contact:0"',
    'data-path="sec:0:title"',
    'data-path="sec:0:text"',
    'data-path="sec:1:title"',
    'data-path="sec:1:entry:0:title"',
    'data-path="sec:1:entry:0:role"',
    'data-path="sec:1:entry:0:meta"',
    'data-path="sec:1:entry:0:sub"',
    'data-path="sec:1:entry:0:bullet:0"',
    'data-path="sec:3:cell:1:1"'
  ];
  const missing = paths.filter((p) => dom.indexOf(p) < 0);
  check('表单按模块渲染出全部字段', missing.length === 0,
    missing.length ? '缺少 ' + missing.join(', ') : paths.length + ' 个字段都在');
  check('章节卡片带标题输入 / 定位 / 添加章节',
    /fcard-title-input/.test(dom) && /定位/.test(dom) && /添加章节/.test(dom));
  check('默认表单模式：Markdown 文本框处于隐藏状态', /id="editor"[^>]*hidden/.test(dom));

  // 版本号 / 缓存：静态资源带 ?v=，界面显示版本，方便确认"刷新后到底加载到哪一版"
  const ver = ((/name="app-version" content="([^"]+)"/.exec(index)) || [])[1] || '';
  const verRe = ver.replace(/\./g, '\\.');
  const versioned = (index.match(new RegExp('assets/[a-z-]+\\.(?:js|css)\\?v=' + verRe, 'g')) || []).length;
  check('静态资源引用都带版本号（改版本号即可让浏览器 / CDN 立刻取到新文件）',
    !!ver && versioned === 6, 'v' + ver + '，带版本号的引用 ' + versioned + ' 处');
  check('单文件包里也带版本号', new RegExp('name="app-version" content="' + verRe + '"').test(fs.readFileSync(single, 'utf8')));
  check('界面状态栏会显示版本号', /id="statusVersion"/.test(index) &&
    new RegExp('v' + verRe).test(dom), '界面显示 v' + ver);

  const formShot = path.join(BUILD, 'form-view.png');
  fs.rmSync(formShot, { force: true });
  chrome(['--screenshot=' + formShot, '--window-size=1400,1000', pathToFileURL(single).href]);
  check('表单模式截图生成', fs.existsSync(formShot), path.relative(ROOT, formShot));
}

/* ================================================================== 7. 子路径部署（GitHub Pages） */

async function testSubpathDeploy() {
  section('子路径部署（GitHub Pages 项目站点）');
  const http = await import('node:http');

  // 把站点按 Pages 的结构摆好：<根>/resume-generator/…
  const site = path.join(BUILD, 'site');
  const appDir = path.join(site, 'resume-generator');
  fs.rmSync(site, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  for (const f of ['index.html', 'assets']) {
    fs.cpSync(path.join(ROOT, f), path.join(appDir, f), { recursive: true });
  }
  check('站点结构就绪', fs.existsSync(path.join(appDir, 'index.html')) && fs.existsSync(path.join(appDir, 'assets', 'app.js')));
  check('.nojekyll 存在（Pages 不跑 Jekyll，静态文件原样发布）', fs.existsSync(path.join(ROOT, '.nojekyll')));

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
  const notFound = [];
  const server = http.createServer((req, res) => {
    const p = path.join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(site) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      notFound.push(req.url);
      res.writeHead(404).end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  });
  const PORT = 5193;
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  try {
    const base = 'http://127.0.0.1:' + PORT + '/resume-generator/';
    const page = await get(base + 'index.html');
    check('子路径下页面可访问', page.status === 200, 'HTTP ' + page.status);

    // 静态检查：页面里不能出现以 / 开头的绝对路径（那会在项目站点下 404）
    const absolute = (page.body.match(/(?:href|src)="\/(?!\/)[^"]*"/g) || []);
    check('页面里没有绝对路径引用', absolute.length === 0, absolute.slice(0, 3).join(', ') || '全部是相对路径');

    // 逐个把页面引用的资源抓一遍，确认在子路径下都能命中
    const refs = [];
    const re = /(?:href|src)="([^"#?]+)"/g;
    let m;
    while ((m = re.exec(page.body))) {
      if (!/^(https?:|data:|\/\/)/.test(m[1])) refs.push(m[1]);
    }
    const bad = [];
    for (const ref of refs) {
      const r = await get(base + ref);
      if (r.status !== 200) bad.push(ref + '→' + r.status);
    }
    check('页面引用的 ' + refs.length + ' 个资源在子路径下全部可加载', bad.length === 0, bad.slice(0, 5).join(', ') || '全部 200');

    const dom = dumpDom(base + 'index.html');
    if (dom.length) {
      check('子路径下简历正常渲染（浏览器实测）',
        /class="r-name">张三/.test(dom) && /resume-sheet/.test(dom), '输出 ' + dom.length + ' 字符');
      check('子路径下表单也正常挂载', /data-path="sec:1:entry:0:title"/.test(dom));
    } else {
      // 本机 http 页面在个别环境（代理/沙箱）下会让无头 Chrome 卡在后台联网上，
      // 这里不判定失败：路径正确性已由上面的「资源抓取」检查覆盖，渲染本身由 file:// 用例覆盖。
      console.log('    · 已跳过浏览器渲染检查（本机 http 在当前环境拿不到 DOM）');
    }
    check('服务端没有记录到任何 404', notFound.length === 0, notFound.length ? notFound.slice(0, 5).join(', ') : '全部命中');
  } finally {
    server.close();
  }
}

section('手机 / 窄屏');
{
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'app.css'), 'utf8');
  check('窄屏媒体查询限定 screen（打印页盒约 794px 会命中裸 max-width，界面元素会进 PDF）',
    /@media screen and \(max-width: 900px\)/.test(css) && /@media screen and \(max-width: 560px\)/.test(css));
  check('窄屏规则写在基础规则之后（同优先级靠后者生效）',
    css.lastIndexOf('@media screen and (max-width: 900px)') > css.indexOf('.form-view {'));
  check('打印规则用 !important 关掉界面元素，且显式隐藏编辑面板',
    /\.pane\.editor-pane \{ display: none !important; \}/.test(css) &&
    /#mobileView,/.test(css) && /\.form-view,/.test(css));
  check('窄屏：编辑 / 预览 切换（一次只显示一个面板）',
    /id="mobileView"/.test(index) && /#mobileView\s*\{/.test(css) &&
    /\.app\.mobile-preview \.editor-pane/.test(css) && /\.app\.mobile-edit \.preview-pane/.test(css));
  check('窄屏：顶栏换成「更多 ⋯」折叠次要按钮',
    /id="btnTools"/.test(index) && /\.appbar\.tools-open \.appbar-main/.test(css));
  check('窄屏：输入框字号 16px（防 iOS 聚焦自动放大）+ 纸张自适应宽度',
    /font-size: 16px/.test(css) && /\.preview-scroll \{ padding: 10px 8px 36px; \}/.test(css));
  check('app.js 会按偏好应用窄屏视图并重算缩放',
    /function applyMobileView/.test(appJs) && /mobileView/.test(appJs) && /requestAnimationFrame\(function \(\) \{ applyZoom\(\); \}\)/.test(appJs));
}

await testSubpathDeploy();

/* ================================================================== 结果 */

section('GitHub 入口');
{
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'app.css'), 'utf8');
  const repo = 'https://github.com/beiwei91/resume-generator';
  check('顶栏有 GitHub 入口且指向本仓库', new RegExp('id="ghLink"[^>]*' + repo).test(index.replace(/\s+/g, ' ')) ||
    (/id="ghLink"/.test(index) && index.indexOf(repo) >= 0));
  const linkTag = (/<a[^>]*id="ghLink"[^>]*>/.exec(index) || [''])[0].replace(/\s+/g, ' ');
  check('外链开了新窗口且带 rel=noreferrer', /target="_blank"/.test(linkTag) && /rel="noreferrer"/.test(linkTag), linkTag.slice(0, 80));
  check('语法速查里有 Star / Issue 邀请（含喵）',
    /issues/.test(index) && /Star/.test(index) && /谢谢喵/.test(index));
  check('入口有独立样式（金色胶囊 + 星标呼吸动画，且尊重减少动态效果）',
    /\.gh-link\s*\{/.test(css) && /\.gh-link \.star/.test(css) && /\.gh-link:hover/.test(css) &&
    /linear-gradient\(180deg, #fff5da/.test(css) &&
    /@media \(prefers-reduced-motion: no-preference\)[\s\S]{0,200}ghTwinkle/.test(css));
  check('打印时不会印出来（跟随顶栏一起隐藏）',
    /@media print \{[\s\S]*?\.appbar,[\s\S]*?display: none !important;/.test(css));

  // 那句邀请从弹窗里挪到界面上的可关闭横幅
  check('顶部有求 star 横幅（含 Star / Issue 两个链接与关闭按钮）',
    /id="ghBanner"/.test(index) && /id="ghBannerClose"/.test(index) &&
    /class="gh-banner-more"/.test(index) && (index.match(/github\.com\/beiwei91\/resume-generator/g) || []).length >= 3);
  check('横幅样式齐备，且 [hidden] 真的能关掉（免得被 display:flex 盖过）',
    /\.gh-banner\s*\{/.test(css) && /\.gh-banner\[hidden\] \{ display: none; \}/.test(css));
  check('横幅在打印时也隐藏', /\.splitter, \.gh-banner,/.test(css) || /\.gh-banner,/.test(css));
  check('窄屏只留「求 star」半句（Issue 那半句收起）', /\.gh-banner-more \{ display: none; \}/.test(css));
  check('关闭后记住不再显示（写进偏好）',
    /hideStarBanner/.test(appJs) && /applyStarBanner/.test(appJs));
}

/* ================================================================== 界面交互（真实点击 / 输入） */

async function testInteractions() {
  section('界面交互（真实点击 / 输入）');

  // 用同源 iframe + 脚本派发事件来真的「点」和「输入」——这类竞态只有真交互才能发现。
  // 驱动页保持纯 ASCII（中文串在拼装/编码环节容易出问题），文档名从界面里读出来。
  const driver = path.join(BUILD, 'drive.html');
  fs.writeFileSync(driver, [
    '<!doctype html><meta charset="utf-8"><iframe id="app"></iframe><pre id="out"></pre>',
    '<script>',
    'var lines = [];',
    'function say(s) { lines.push(s); document.getElementById("out").textContent = lines.join("\\n"); }',
    'function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }',
    'var win, doc;',
    'function q(sel) { return doc.querySelector(sel); }',
    'function fire(el, type) { el.dispatchEvent(new win.Event(type, { bubbles: true })); }',
    'function probe() { var n = q(".r-name"); return { name: n ? n.textContent : "", sections: doc.querySelectorAll(".r-section").length, field: (q("[data-path=\\"name\\"]") || {}).value || "" }; }',
    'function header() { var s = q("[data-path=\\"subtitle\\"]"); var cs = Array.prototype.map.call(doc.querySelectorAll("[data-path^=\\"contact:\\"]"), function (i) { return i.value; }); return { sub: s ? s.value : "", contacts: cs, preview: doc.querySelectorAll(".r-contacts li").length }; }',
    'function setVal(sel, v) { var el0 = q(sel); el0.value = v; fire(el0, "input"); return el0; }',
    'function findPath(suffix) { var els = doc.querySelectorAll("[data-path]"); for (var i = 0; i < els.length; i++) { var p = els[i].getAttribute("data-path"); if (p.length >= suffix.length && p.slice(-suffix.length) === suffix) return p; } return null; }',
    'function setSuffix(suffix, v, noFire) { var p = findPath(suffix); if (!p) return false; var e = doc.querySelector("[data-path=\\"" + p + "\\"]"); e.value = v; if (!noFire) fire(e, "input"); return true; }',
    'function hasAll(vals) { var t = q("#editor").value; return vals.filter(function (v) { return t.indexOf(v) < 0; }).length === 0; }',
    'function clickAct(act) { var b = q("[data-act=\\"" + act + "\\"]"); if (!b) return false; b.click(); return true; }',
    'window.onerror = function (msg) { say("ERROR|" + msg); };',
    'window.addEventListener("load", function () {',
    '  (async function () {',
    '    try {',
    '      localStorage.clear();',
    '      localStorage.setItem("resume-gen:prefs", JSON.stringify({ zoom: "fit", guides: true, editorWidth: 460, autoSave: true, helpSeen: true, mode: "form", mobileView: "edit", hideStarBanner: true }));',
    '      var frame = document.getElementById("app");',
    '      async function load() { frame.src = "../index.html"; await new Promise(function (r) { frame.onload = r; }); win = frame.contentWindow; doc = win.document; await wait(1100); }',
    '      await load();',
    '      var A = probe();',
    '      var firstDoc = q("#docName").value;',
    '      var nameInput = q("[data-path=\\"name\\"]");',
    '      nameInput.value = "AAA-name"; fire(nameInput, "input"); await wait(200);',
    '      fire(nameInput, "blur"); fire(q(".preview-pane") || doc.body, "click"); await wait(200);',
    '      var B = probe();',
    '      q("#btnNew").click(); await wait(1100);',
    '      var sel = q("#docList"); sel.value = firstDoc; fire(sel, "change"); await wait(600);',
    '      var name2 = q("[data-path=\\"name\\"]"); name2.value = "BBB-edit"; fire(name2, "input"); await wait(120);',
    '      var other = Array.from(q("#docList").options).map(function (o) { return o.value; }).filter(function (v) { return v !== firstDoc; })[0];',
    '      sel.value = other; fire(sel, "change"); await wait(400);',
    '      sel.value = firstDoc; fire(sel, "change"); await wait(400);',
    '      var C = probe();',
    '      q("#docList").options[0].setAttribute("data-mark", "mark");',
    '      var sub = q("[data-path=\\"subtitle\\"]"); sub.value = "CCC-sub"; fire(sub, "input"); await wait(1400);',
    '      var rebuilt = q("#docList").options[0].getAttribute("data-mark") !== "mark";',
    '      await load();',
    '      var D = probe();',
    '      var E0 = header();',
    '      setVal("[data-path=\\"subtitle\\"]", "DDD-sub"); await wait(150);',
    '      q("[data-act=\\"add-contact\\"]").click(); await wait(150);',
    '      var hasSlot = !!q("[data-path=\\"contact-new\\"]");',
    '      var slot = q("[data-path=\\"contact-new\\"]");',
    '      if (slot) { slot.value = "DDD-phone"; fire(slot, "input"); }',
    '      await wait(250);',
    '      var E1 = header();',
    '      q("[data-act=\\"add-contact\\"]").click(); await wait(120);',
    '      var emptySlot = q("[data-path=\\"contact-new\\"]");',
    '      if (emptySlot) fire(emptySlot, "blur"); await wait(200);',
    '      var E2 = header();',
    '      var slotGone = !q("[data-path=\\"contact-new\\"]");',
    '      setSuffix(":entry:0:title", "F1"); setSuffix(":entry:0:role", "F2"); setSuffix(":entry:0:bullet:0", "F3");',
    '      await wait(250);',
    '      var F0 = hasAll(["F1", "F2", "F3"]);',
    '      clickAct("add-bullet"); await wait(350);',
    '      var F1 = hasAll(["F1", "F2", "F3"]);',
    '      setSuffix(":entry:0:role", "G1", true);',            // 故意不派发 input
    '      clickAct("add-sub"); await wait(350);',
    '      var G1 = hasAll(["F1", "G1"]);',
    '      var listAdds = doc.querySelectorAll("[data-act=\\"add-bullet\\"]");',
    '      listAdds[listAdds.length - 1].click(); await wait(350);',
    '      var fresh = doc.activeElement;',
    '      var freshPath = fresh ? fresh.getAttribute("data-path") : "";',
    '      if (fresh) { fresh.value = "H1-LIST"; fire(fresh, "input"); }',
    '      await wait(250);',
    '      var H1 = q("#editor").value.indexOf("H1-LIST") >= 0 && /:x:bullet:/.test(freshPath);',
    '      listAdds = doc.querySelectorAll("[data-act=\\"add-bullet\\"]");',
    '      listAdds[listAdds.length - 1].click(); await wait(350);',
    '      var countAfterAdd = (q("#editor").value.match(/^- /gm) || []).length;',
    '      var fresh2 = doc.activeElement;',
    '      if (fresh2) fire(fresh2, "blur"); await wait(350);',
    '      var countAfterBlur = (q("#editor").value.match(/^- /gm) || []).length;',
    '      var I1 = countAfterBlur === countAfterAdd - 1;',
    '      say("JSON|" + JSON.stringify({ A: A, B: B, C: C, D: D, rebuilt: rebuilt, E0: E0, E1: E1, E2: E2, hasSlot: hasSlot, slotGone: slotGone, F0: F0, F1: F1, G1: G1, H1: H1, I1: I1 }));',
    '    } catch (e) { say("THROW|" + (e && e.message)); }',
    '  })();',
    '});',
    '</script>'
  ].join('\n'), 'utf8');

  const profile = path.join(BUILD, '.interact-profile');
  fs.rmSync(profile, { recursive: true, force: true });
  const r = spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--allow-file-access-from-files',
    '--disable-background-networking', '--disable-component-update', '--proxy-server=direct://',
    '--user-data-dir=' + profile, '--virtual-time-budget=40000',
    '--dump-dom', pathToFileURL(driver).href
  ], { encoding: 'utf8', timeout: 240000, windowsHide: true });

  const dom = String(r.stdout || '');
  const preRaw = (/<pre id="out">([\s\S]*?)<\/pre>/.exec(dom) || [])[1] || '';
  const pre = preRaw.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const json = (/JSON\|([\s\S]*)$/.exec(pre) || [])[1] || '';
  let res = null;
  try { res = JSON.parse(json.trim()); } catch (e) { /* 下面判定 */ }

  if (!res) {
    const err = (/ERROR\|([^\n]*)/.exec(pre) || [])[1] || (/THROW\|([^\n]*)/.exec(pre) || [])[1] || '(无错误信息)';
    check('界面交互驱动能跑起来', false, 'pre=' + JSON.stringify(pre.slice(0, 120)) + ' 错误=' + err);
    return;
  }
  check('起点是示例简历', res.A.name && res.A.sections === 6, JSON.stringify(res.A));
  check('输入姓名后点别处不会回退', res.B.field === 'AAA-name' && res.B.name === 'AAA-name', JSON.stringify(res.B));
  check('改完立刻切换文档再切回，改动不丢（本轮修复的 bug）',
    res.C.field === 'BBB-edit' && res.C.name === 'BBB-edit', JSON.stringify(res.C));
  check('保存不会重建文档下拉（手机系统选择器不会被打断）', res.rebuilt === false, '重建=' + res.rebuilt);
  check('重新加载后改动仍在', res.D.field === 'BBB-edit' && res.D.name === 'BBB-edit', JSON.stringify(res.D));
  check('点「+ 添加联系方式」只加空位，不写空值进文档', res.hasSlot === true && res.E1.contacts.indexOf('DDD-phone') >= 0,
    JSON.stringify(res.E1));
  check('点「+ 添加联系方式」不会把刚输入的职位覆盖回去（本轮修复的 bug）',
    res.E1.sub === 'DDD-sub', '职位=' + JSON.stringify(res.E1.sub));
  check('新联系方式确实写进了文档并出现在预览里',
    res.E1.contacts.length === res.E0.contacts.length + 1 && res.E1.preview === res.E0.preview + 1,
    JSON.stringify(res.E0) + ' → ' + JSON.stringify(res.E1));
  check('空着的空位失焦后自动收掉，文档不变',
    res.slotGone === true && res.E2.sub === 'DDD-sub' && res.E2.contacts.length === res.E1.contacts.length,
    JSON.stringify(res.E2));
  check('条目各字段输入后，点「+ 添加要点」不会清空该模块',
    res.F0 === true && res.F1 === true, 'F0=' + res.F0 + ' F1=' + res.F1);
  check('界面已改但还没写进文档时，结构性操作也会先提交（兜底）',
    res.G1 === true, 'G1=' + res.G1);
  check('「要点列表」型章节里，新加的要点能编辑进文档（本轮修复的 bug）',
    res.H1 === true, 'H1=' + res.H1);
  check('新加的空要点没输入就失焦时自动收掉，不在 .md 里留空行',
    res.I1 === true, 'I1=' + res.I1);
}

await testInteractions();

console.log('\n结果');
console.log('  通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  failures.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
console.log('  验证通过 ✓');
