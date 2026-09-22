/**
 * tests/edge.mjs —— 边界与不变式排查
 *
 * 思路：把「畸形 / 极端」的 Markdown 喂给渲染引擎与表单逻辑，断言
 *   1) 不抛异常、不产出 NaN / undefined；
 *   2) 不会把用户内容弄丢，也不会把危险内容当 HTML 执行；
 *   3) 结构操作（增删移动）做了再撤销，结构化模型必须回到原样。
 * 加一条 CLI 层的参数健壮性检查。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MD = require(path.join(ROOT, 'assets', 'resume-md.js'));
const Form = require(path.join(ROOT, 'assets', 'resume-form.js'));

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failures.push(name + (detail ? ' → ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }
/**
 * 只比较「内容」：行号（start/end/idx…）属于排版位置，改写时空白行归一化会让它们
 * 小幅变化，那是预期；内容（标题/条目/要点/单元格/文字）必须一字不差。
 */
function stripPos(node) {
  if (Array.isArray(node)) return node.map(stripPos);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) {
      // lines / prefix 是原始文本（末尾空格等归一化差异属于预期），位置字段同理
      if (/^(start|end|idx|headIdx|titleIdx|subIdx|photoIdx|endIdx|lines|prefix|raw)$/.test(k)) continue;
      out[k] = stripPos(node[k]);
    }
    return out;
  }
  return node;
}
const model = (md) => JSON.stringify(stripPos(Form.walk(String(md).replace(/\s+$/, ''))));

/** 需要子进程输出时不要用管道（受限环境会 EPERM），改成重定向到文件再读 */
function runTo(cmd, args) {
  const outFile = path.join(ROOT, '.build', 'edge-cli-' + Math.random().toString(36).slice(2) + '.txt');
  fs.mkdirSync(path.join(ROOT, '.build'), { recursive: true });
  const fd = fs.openSync(outFile, 'w');
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: ['ignore', fd, fd], timeout: 120000, windowsHide: true });
  fs.closeSync(fd);
  const out = fs.readFileSync(outFile, 'utf8');
  fs.rmSync(outFile, { force: true });
  return { status: res.status, out };
}

/* ------------------------------------------------------------------ 用例语料 */

const DOCS = {
  最小文档: '# 甲\n',
  无H1: '## 章节\n\n- 要点\n',
  只有配置块: '---\ntemplate: modern\n---\n',
  空文档: '',
  只有空白: '\n\n   \n\t\n',
  CRLF换行: '# 甲\r\n\r\n## 章节\r\n\r\n- 要点\r\n',
  连续空行: '# 甲\n\n\n\n## 章节\n\n\n- 要点\n\n\n',
  行尾空格: '# 甲   \n\n## 章节  \n\n- 要点   \n',
  Tab缩进要点: '# 甲\n\n## 章节\n\n- 一级\n\t- 二级用Tab\n',
  三级要点: '## 章\n\n- 一\n  - 二\n    - 三\n',
  多种列表标记: '## 章\n\n* 星号\n+ 加号\n1. 有序\n2) 有序2\n',
  条目无要点: '## 工作经历\n\n### 公司 · 职位 | 时间\n\n只有一段描述，没有要点\n',
  条目只有要点: '## 工作经历\n\n### 公司\n\n- 干了一件事\n',
  散要点与条目混排: '## 章\n\n- 散落在条目外的要点\n\n### 条目 · 职位 | 时间\n\n- 条目内要点\n',
  表格带对齐: '## 技能\n\n| 名称 | 水平 |\n|:---|--:|\n| JS | 高 |\n',
  表格缺列: '## 技能\n\n| A | B | C |\n| --- | --- | --- |\n| 只有一列 |\n',
  表格多列: '## 技能\n\n| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n',
  引用多行: '## 简介\n\n> 第一行\n> 第二行\n',
  手动分页: '## A\n\n- x\n\n---\n\n## B\n\n- y\n',
  分隔线: '## A\n\n***\n\n- x\n',
  图片在中间: '## A\n\n![图](./a.png)\n\n文字\n',
  姓名后跟证件照: '# 甲\n\n![证件照](./me.jpg)\n\n职位 | 123\n\n## A\n',
  HTML注入: '# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n## A\n\n- <b>粗体</b>\n',
  危险链接: '## A\n\n- [点我](javascript:alert(1))\n- ![图](javascript:alert(1))\n',
  危险照片: '---\nphoto: javascript:alert(1)\n---\n\n# 甲\n',
  照片dataURI: '---\nphoto: data:image/png;base64,AAA+/=\n---\n\n# 甲\n',
  照片Windows路径: '---\nphoto: D:\\我的 照片\\me.jpg\nphotoSize: 30mm\n---\n\n# 甲\n',
  photoSize垃圾值: '---\nphoto: ./a.png\nphotoSize: abc\n---\n\n# 甲\n',
  排版越界值: '---\nfontSize: 200px\nlineHeight: 9\nmargin: -5mm\ntemplate: 不存在\naccent: red\n---\n\n# 甲\n',
  未知配置键: '---\ntemplate: classic\n自定义键: 值\n---\n\n# 甲\n',
  配置块未闭合: '---\ntemplate: modern\n\n# 甲\n\n## A\n',
  多个H1: '# 甲\n\n# 乙\n\n## A\n\n- x\n',
  H1在章节之后: '## A\n\n- x\n\n# 甲\n',
  emoji与全角: '# 张😀三\n\n前端 | 123 | me@a.com\n\n## 技能\n\n- 会 🚀\n',
  超长行: '## A\n\n- ' + 'x'.repeat(5000) + '\n',
  井号在文本里: '## A\n\n- 价格是 #1 名\n- 含 # 号\n',
  未闭合加粗: '## A\n\n- **没有闭合的加粗\n- 正常 **加粗**\n',
  反引号与代码: '## A\n\n- 用 `npm i` 安装\n- 反引号不成对 `\n'
};
const names = Object.keys(DOCS);

/* ------------------------------------------------------------------ 1. 渲染健壮性 */

section('渲染：不抛异常、不产出 NaN / undefined');
{
  let threw = null;
  let bad = null;
  for (const n of names) {
    try {
      const r = MD.renderResume(DOCS[n]);
      const doc = MD.toDocumentHTML(DOCS[n], { css: '/*x*/' });
      const blob = r.html + r.sheetClasses + r.style + doc;
      if (/NaN|undefined/.test(blob) && !bad) bad = n;
    } catch (e) {
      if (!threw) threw = n + ': ' + e.message;
    }
  }
  check(names.length + ' 个用例都能渲染', !threw, threw || '');
  check('渲染结果里没有 NaN / undefined 泄漏', !bad, bad ? '出现在「' + bad + '」' : '干净');
}

section('安全：危险内容只能当文字，不能当 HTML');
{
  const html = MD.renderResume(DOCS.HTML注入).html;
  const noEscaped = html.replace(/&lt;[\s\S]*?&gt;/g, '');   // 去掉「被转义的尖括号」内容
  check('script / onerror 只以文字形式出现，不会成为标签或属性',
    !/<script/i.test(html) && !/onerror=/i.test(noEscaped) && !/<img/i.test(html) && /&lt;script&gt;/.test(html));
  const linkHtml = MD.renderResume(DOCS.危险链接).html;
  check('javascript: 链接被中和', linkHtml.indexOf('javascript:') < 0, linkHtml.match(/href="[^"]*"/) ? linkHtml.match(/href="[^"]*"/)[0] : '');
  const photoHtml = MD.renderResume(DOCS.危险照片).html;
  check('javascript: 证件照被拒绝', photoHtml.indexOf('<img') < 0);
  check('sanitizePhoto 各类输入',
    MD.sanitizePhoto('javascript:alert(1)') === '' &&
    MD.sanitizePhoto('data:image/svg+xml,<svg onload=alert(1)>') === '' &&
    MD.sanitizePhoto('data:text/html;base64,AAA') === '' &&
    MD.sanitizePhoto('D:\\a b\\c.jpg') === 'file:///D:/a b/c.jpg' &&
    MD.sanitizePhoto('/abs/path.png') === '/abs/path.png' &&
    MD.sanitizePhoto('  ./a.png  ') === './a.png');
}

section('文本不丢失：编辑引用块 / 条目 / 表格时其它内容原样保留');
{
  const md = DOCS.散要点与条目混排;
  const afterEntryEdit = Form.setEntryHead(md, 0, 0, { title: '新公司', role: '新职位', meta: '2025.01 – 至今' });
  check('改条目不会吃掉条目外的散要点', afterEntryEdit.indexOf('散落在条目外的要点') >= 0);
  const afterBullet = Form.setBullet(md, 0, 0, 0, '改了条目内要点');
  check('改条目内要点不会吃掉散要点', afterBullet.indexOf('散落在条目外的要点') >= 0 && afterBullet.indexOf('改了条目内要点') >= 0);

  const quote = DOCS.引用多行;
  const afterQuote = Form.setSectionText(quote, 0, '新的一段\n第二行');
  check('多行引用改写后仍保留 > 前缀', /^> 新的一段$/m.test(afterQuote) && /^> 第二行$/m.test(afterQuote));

  const longDoc = DOCS.超长行;
  check('超长行不会被截断', Form.walk(Form.setSectionTitle(longDoc, 0, 'T')).sections[0].items[0].text.length === 5000);
}

/* ------------------------------------------------------------------ 2. 表单结构操作不变式 */

section('表单：用原值改写 / 增删移动的往返一致性');
{
  const broken = [];
  for (const n of names) {
    const md = DOCS[n];
    const base = model(md);
    const w = Form.walk(md);

    // (a) 用当前值改写 → 模型不变
    const same = [
      Form.setHeaderName(md, w.header.name),
      Form.setHeaderInfo(md, w.header.info),
      Form.setSectionTitle(md, 0, w.sections[0] ? w.sections[0].title : '')
    ];
    w.sections.forEach((s, si) => {
      if (s.kind === 'quote' || s.kind === 'paragraph') same.push(Form.setSectionText(md, si, s.text));
      s.entries.forEach((e, ei) => {
        same.push(Form.setEntryHead(md, si, ei, { title: e.title, role: e.role, meta: e.meta }));
        if (e.sub) same.push(Form.setEntrySub(md, si, ei, e.sub));
        e.bullets.forEach((b, bi) => same.push(Form.setBullet(md, si, ei, bi, b.text)));
      });
      s.items.forEach((b, bi) => same.push(Form.setBullet(md, si, null, bi, b.text)));
      if (s.kind === 'table') {
        s.table.rows.forEach((row, ri) => row.forEach((cell, ci) => same.push(Form.setTableCell(md, si, ri, ci, cell))));
      }
    });
    if (same.some((out) => model(out) !== base)) broken.push(n + '(改写)');

    // (b) 结构操作往返：加→删、移→移回
    const si0 = w.sections.length ? 0 : -1;
    if (si0 >= 0) {
      const addSec = Form.addSection(md, '临时章节', 'list');
      const backSec = Form.removeSection(addSec, Form.walk(addSec).sections.length - 1);
      if (model(backSec) !== base) broken.push(n + '(章节加删)');
      if (w.sections.length > 1) {
        const moved = Form.moveSection(md, 1, -1);
        const back = Form.moveSection(moved, 0, 1);
        if (model(back) !== base) broken.push(n + '(章节移动往返)');
      }
      const s = w.sections[0];
      if (s.kind === 'entries' && s.entries.length) {
        const addE = Form.addEntry(md, 0, s.entries.length - 1);
        const backE = Form.removeEntry(addE, 0, Form.walk(addE).sections[0].entries.length - 1);
        if (model(backE) !== base) broken.push(n + '(条目加删)');
        if (s.entries.length > 1) {
          const mE = Form.moveEntry(md, 0, 1, -1);
          const bE = Form.moveEntry(mE, 0, 0, 1);
          if (model(bE) !== base) broken.push(n + '(条目移动往返)');
        }
        const e0 = s.entries[0];
        const addB = Form.addBullet(md, 0, 0, e0.bullets.length - 1);
        const wAddB = Form.walk(addB);
        const backB = Form.removeBullet(addB, 0, 0, wAddB.sections[0].entries[0].bullets.length - 1);
        if (model(backB) !== base) broken.push(n + '(要点加删)');
        if (e0.bullets.length > 1) {
          const mB = Form.moveBullet(md, 0, 0, 0, 1);
          const bB = Form.moveBullet(mB, 0, 0, 1, -1);
          if (model(bB) !== base) broken.push(n + '(要点移动往返)');
        }
      }
      if (s.kind === 'list' && s.items.length) {
        const addI = Form.addBullet(md, 0, null, s.items.length - 1);
        const wAddI = Form.walk(addI);
        const backI = Form.removeBullet(addI, 0, null, wAddI.sections[0].items.length - 1);
        if (model(backI) !== base) broken.push(n + '(列表要点加删)');
      }
      if (s.kind === 'table') {
        const addR = Form.addTableRow(md, 0);
        const backR = Form.removeTableRow(addR, 0, Form.walk(addR).sections[0].table.rows.length - 1);
        if (model(backR) !== base) broken.push(n + '(表格加删行)');
      }
    }
  }
  check(names.length + ' 个用例的编辑操作都不改变模型 / 往返一致', broken.length === 0,
    broken.slice(0, 6).join('、') || '全部一致');
}

section('表单：越界与非法索引');
{
  const md = DOCS.散要点与条目混排;
  const bad = [
    Form.setSectionTitle(md, -1, 'x'),
    Form.setSectionTitle(md, 99, 'x'),
    Form.removeSection(md, 99),
    Form.moveSection(md, 0, -1),
    Form.moveSection(md, 99, 1),
    Form.removeEntry(md, 0, 99),
    Form.removeEntry(md, 99, 0),
    Form.setBullet(md, 0, 0, 99, 'x'),
    Form.setTableCell(md, 0, 9, 9, 'x'),
    Form.setEntrySub(md, 99, 0, 'x')
  ];
  check('越界索引一律安全返回（不改坏文档）', bad.every((out) => typeof out === 'string' && out.length > 0));
  check('对非表格章节改单元格不会破坏文档', model(Form.setTableCell(md, 0, 0, 0, 'x')) === model(md));
}

section('配置块：写入幂等、读回一致');
{
  let unstable = null;
  for (const n of names) {
    const once = MD.upsertFrontMatter(DOCS[n], { accent: '#0f766e', fontSize: '15px' });
    const twice = MD.upsertFrontMatter(once, { accent: '#0f766e', fontSize: '15px' });
    if (once !== twice) { unstable = n; break; }
    const s = MD.normalizeSettings(MD.splitFrontMatter(once).meta);
    if (s.accent !== '#0f766e' || s.fontSize !== '15px') { unstable = n + '(读回不一致)'; break; }
  }
  check(names.length + ' 个用例：重复写配置块结果稳定、读回一致', !unstable, unstable || '');

  const preserved = MD.upsertFrontMatter(DOCS.未知配置键, { accent: '#b91c1c' });
  check('自定义配置键被保留', preserved.indexOf('自定义键') >= 0);
  const photoKept = MD.upsertFrontMatter(DOCS.照片Windows路径, { fontSize: '16px' });
  check('改字号不会丢掉证件照', /photo: file:\/\/\/D:\/我的 照片\/me.jpg/.test(photoKept), photoKept.split('\n').slice(1, 4).join(' | '));
}

section('CRLF 与空白规范化');
{
  const htmlLf = MD.renderResume(DOCS.CRLF换行.replace(/\r\n/g, '\n')).html;
  const htmlCrlf = MD.renderResume(DOCS.CRLF换行).html;
  check('CRLF 与 LF 渲染结果一致', htmlLf === htmlCrlf);
  const crlf = Form.walk(DOCS.CRLF换行);
  const lf = Form.walk(DOCS.CRLF换行.replace(/\r\n/g, '\n'));
  check('表单模型对 CRLF 一致', JSON.stringify(crlf.sections) === JSON.stringify(lf.sections));
}

/* ------------------------------------------------------------------ 3. CLI 健壮性 */

section('CLI：参数与错误处理');
{
  const run = (args) => runTo(process.execPath, [path.join(ROOT, 'export-pdf.mjs')].concat(args));
  check('--help 正常退出', run(['--help']).status === 0);
  const noInput = run([]);
  check('不给输入文件时退出码非 0 且有提示', noInput.status !== 0 && /用法/.test(noInput.out));
  const missing = run(['不存在的文件.md']);
  check('输入文件不存在时退出码非 0', missing.status === 1, missing.out.trim().split('\n')[0].slice(0, 50));
  const badFlag = run(['resume.sample.md', '--不认识的参数']);
  check('未知参数退出码为 2', badFlag.status === 2, badFlag.out.trim().split('\n')[0].slice(0, 50));
  const noValue = run(['resume.sample.md', '-o']);
  check('-o 缺取值时退出码为 2', noValue.status === 2, noValue.out.trim().split('\n')[0].slice(0, 50));
  // 真正「带奇怪参数也能导出」的检查放在 verify-export 里（那条需要 Chrome）
}

section('打包：单文件版可重复构建');
{
  const single = path.join(ROOT, '简历生成器-单文件.html');
  const before = fs.readFileSync(single);
  const r1 = runTo(process.execPath, [path.join(ROOT, 'build-single.mjs')]);
  const once = fs.readFileSync(single);
  const r2 = runTo(process.execPath, [path.join(ROOT, 'build-single.mjs')]);
  const twice = fs.readFileSync(single);
  check('构建脚本连续执行都成功', r1.status === 0 && r2.status === 0,
    (r1.out + r2.out).trim().split('\n').slice(-1)[0]);
  check('同一天内重复构建产物一致', once.equals(twice));
  fs.writeFileSync(single, before);   // 还原
}

section('启动器：项目路径含空格 / 中文时仍要正确');
{
  const vbsName = '启动简历生成器.vbs';
  const rootVbs = path.join(ROOT, vbsName);
  if (!fs.existsSync(rootVbs)) {
    check('启动器存在', false, '缺失 ' + vbsName);
  } else {
    // 把启动器 + 单文件版复制到一个「带空格和中文」的目录里再跑 --dry-run
    const weirdDir = path.join(ROOT, '.build', '带 空格 的 目录');
    fs.rmSync(weirdDir, { recursive: true, force: true });
    fs.mkdirSync(weirdDir, { recursive: true });
    fs.copyFileSync(rootVbs, path.join(weirdDir, vbsName));
    fs.copyFileSync(path.join(ROOT, '简历生成器-单文件.html'), path.join(weirdDir, '简历生成器-单文件.html'));

    const res = spawnSync('cscript', ['//nologo', path.join(weirdDir, vbsName), '--dry-run', '--quiet'],
      { cwd: weirdDir, stdio: 'ignore', timeout: 60000, windowsHide: true });
    const logPath = path.join(weirdDir, '.launcher.log');
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf16le') : '';

    check('启动器在含空格路径下正常运行', res.status === 0, 'exit ' + res.status);
    check('日志里没有非 ASCII 残留（命令行必须纯 ASCII）',
      /命令 .+/.test(log) && !/[^\x00-\x7F]/.test((/命令\s*(.+)/.exec(log) || [])[1] || 'x'));
    const url = ((/编码URL\s+(\S+?)(?:（|$)/m.exec(log) || [])[1] || '');
    check('空格被编码成 %20、中文被百分号编码',
      url.indexOf('%20') >= 0 && /%E7%AE%80/.test(url), url.slice(0, 90));
    const decoded = (() => { try { return decodeURIComponent(url.replace(/^file:\/\/\//, '')); } catch (e) { return ''; } })();
    check('解码后指向真实存在的文件', !!decoded && fs.existsSync(decoded), decoded.slice(-40));
    fs.rmSync(weirdDir, { recursive: true, force: true });
  }
}

section('可选-本地服务：移动回来后才生效的清单要自洽');
{
  const optDir = path.join(ROOT, '可选-本地服务');
  const swPath = path.join(optDir, 'sw.js');
  if (!fs.existsSync(swPath)) {
    check('可选服务文件存在', false, '找不到 sw.js');
  } else {
    const sw = fs.readFileSync(swPath, 'utf8');
    const list = (/const PRECACHE = \[([\s\S]*?)\]/.exec(sw) || [])[1] || '';
    const entries = (list.match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
    const missing = entries.filter((e) => {
      const rel = e.replace(/^\.\//, '');
      if (!rel) return false;                                   // './' 即 index.html
      return !fs.existsSync(path.join(ROOT, rel === '' ? 'index.html' : rel)) &&
        !fs.existsSync(path.join(optDir, rel));
    });
    check('sw.js 预缓存清单里的文件都存在（移回根目录后即可离线）', missing.length === 0,
      missing.length ? '缺少 ' + missing.join(', ') : entries.length + ' 项');

    const mani = path.join(optDir, 'manifest.webmanifest');
    let m = null;
    try { m = JSON.parse(fs.readFileSync(mani, 'utf8')); } catch (e) { /* 下面判定 */ }
    const badIcons = m ? (m.icons || []).filter((i) => !fs.existsSync(path.join(ROOT, i.src))) : ['manifest 解析失败'];
    check('manifest 的图标在根目录都存在', badIcons.length === 0,
      badIcons.length ? JSON.stringify(badIcons).slice(0, 80) : (m.icons || []).length + ' 个图标');
    const server = fs.readFileSync(path.join(optDir, 'server.js'), 'utf8');
    check('server.js 会把根目录定位到有 index.html 的那一层（就地运行也不至于 404）',
      /index\.html/.test(server) && /ROOT/.test(server));
  }
}

section('性能：大文档不会卡死（防正则回溯）');
{
  const big = '# 张三\n\n前端工程师 | 138 | me@a.com\n\n' +
    Array.from({ length: 400 }, (_, i) =>
      '## 章节 ' + i + '\n\n### 公司 ' + i + ' · 职位 | 2020.01 – 2021.01\n\n- ' + '要点内容'.repeat(8) + '\n- ' + 'x'.repeat(200) + '\n').join('\n');
  const t0 = Date.now();
  const r = MD.renderResume(big);
  const walkMs = Date.now() - t0;
  const t1 = Date.now();
  Form.walk(big);
  Form.addSection(big, 'X', 'list');
  const formMs = Date.now() - t1;
  check('大文档（约 ' + Math.round(big.length / 1024) + 'KB / 400 章节）渲染 + 表单解析都在 3 秒内',
    walkMs < 3000 && formMs < 3000 && r.stats.sections === 400,
    '渲染 ' + walkMs + 'ms，表单 ' + formMs + 'ms');
}

section('表单：子要点（二级缩进）');
{
  const md = fs.readFileSync(path.join(ROOT, 'resume.sample.md'), 'utf8');
  const before = Form.walk(md);
  const after = Form.addSubBullet(md, 1, 0, 0);
  const w = Form.walk(after);
  const b0 = w.sections[1].entries[0].bullets;
  check('加子要点：数量 +1 且缩进为 2', b0.length === before.sections[1].entries[0].bullets.length + 1 && b0[1].indent === 2,
    '缩进 ' + b0[1].indent);
  check('加子要点：父要点与其余内容不变',
    b0[0].text === before.sections[1].entries[0].bullets[0].text && w.sections.length === before.sections.length);
  check('加子要点：配置块原样保留', after.startsWith(MD.splitFrontMatter(md).raw));
  const back = Form.removeBullet(after, 1, 0, 1);
  check('删掉刚加的子要点即回到原样', model(back) === model(md));
  check('空要点列表时不会瞎插', Form.addSubBullet('## A\n\n- 只有一条\n', 0, null, 0).indexOf('    - ') < 0);
}

section('抬头：姓名清空 / 缺失 / 重填（用户实测踩到的坑）');
{
  const sample = fs.readFileSync(path.join(ROOT, 'resume.sample.md'), 'utf8');

  // 1) 清空姓名：那一行变成 `# `，trim 后是裸 `#`，必须仍然是「标题」而不是正文
  const cleared = Form.setHeaderName(sample, '');
  const wCleared = Form.walk(cleared);
  check('清空姓名后仍识别为抬头（不是普通文字）',
    wCleared.header.nameIdx >= 0 && wCleared.header.name === '',
    'nameIdx=' + wCleared.header.nameIdx + ' 行=' + JSON.stringify(wCleared.lines[wCleared.header.nameIdx]));
  const htmlCleared = MD.renderResume(cleared).html;
  check('清空姓名后预览里不会冒出裸 # 号',
    htmlCleared.indexOf('>#<') < 0 && !/<\/p>#/.test(htmlCleared) && htmlCleared.indexOf('#') < 0);
  check('清空姓名不影响下面的章节与联系方式',
    wCleared.sections.length === Form.walk(sample).sections.length &&
    wCleared.header.info.subtitle === Form.walk(sample).header.info.subtitle);

  // 2) 清空后再输入新名字（用户遇到的那一步）
  const retyped = Form.setHeaderName(cleared, 'gcy');
  const wRetyped = Form.walk(retyped);
  check('清空后重新输入姓名能写进文档', wRetyped.header.name === 'gcy', wRetyped.header.name);
  check('重新输入后预览里抬头正常显示姓名', /class="r-name">gcy</.test(MD.renderResume(retyped).html));

  // 3) 写成裸 `#`（没空格）也要当标题
  const bare = '#\n前端工程师 | 138 | me@a.com\n\n## A\n\n- x\n';
  const wBare = Form.walk(bare);
  check('裸 # 也识别为标题', wBare.header.nameIdx === 0 && wBare.header.name === '');
  check('裸 # 时抬头信息照样解析', wBare.header.info.subtitle === '前端工程师', JSON.stringify(wBare.header.info));
  const htmlBare = MD.renderResume(bare).html;
  check('裸 # 渲染后仍是抬头块（空姓名不输出 h1，但职位/联系方式在）',
    htmlBare.indexOf('class="r-header"') > 0 && htmlBare.indexOf('class="r-subtitle"') > 0 &&
    htmlBare.indexOf('class="r-section"') > 0 && htmlBare.indexOf('>#<') < 0);
  check('名称为空时渲染端不输出空 h1', MD.renderResume(bare).html.indexOf('class="r-name"') < 0);

  // 4) 完全没有姓名行时，姓名 / 职位输入要能自愈（补一行空标题），而不是静默失效
  const noHeader = '## A\n\n- x\n';
  const healed = Form.setHeaderName(noHeader, 'gcy');
  check('没有姓名行时输入姓名会自动补出标题',
    Form.walk(healed).header.name === 'gcy', JSON.stringify(healed.split('\n').slice(0, 4)));
  const healedInfo = Form.setHeaderInfo(noHeader, { subtitle: '前端工程师', contacts: ['138'] });
  check('没有姓名行时输入职位也能写进去',
    Form.walk(healedInfo).header.info.subtitle === '前端工程师' &&
    /前端工程师/.test(MD.renderResume(healedInfo).html));
  check('补标题后原有章节不受影响',
    Form.walk(healed).sections[0].title === 'A' && Form.walk(healed).sections[0].items.length === 1);
}

/* ------------------------------------------------------------------ 结果 */

console.log('\n结果');
console.log('  通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  failures.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
console.log('  边界与不变式排查通过 ✓');
