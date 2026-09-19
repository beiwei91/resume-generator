/**
 * tests/smoke.mjs —— 解析 / 渲染引擎的最小自检（node tests/smoke.mjs）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MD = require(path.join(ROOT, 'assets', 'resume-md.js'));

let pass = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    failures.push(name + (detail ? ' → ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? ' → ' + detail : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

const sample = fs.readFileSync(path.join(ROOT, 'resume.sample.md'), 'utf8');
const result = MD.renderResume(sample);
const html = result.html;

section('前置配置块');
check('解析 template', result.settings.template === 'classic', result.settings.template);
check('解析 accent', result.settings.accent === '#2563eb', result.settings.accent);
check('解析字号 / 行距', result.settings.fontSize === '14px' && result.settings.lineHeight === '1.65');
check('页边距换算为毫米', JSON.stringify(MD.marginMm(result.settings)) === JSON.stringify({ y: 16, x: 18 }), JSON.stringify(MD.marginMm(result.settings)));
check('非法配置回退默认值', MD.normalizeSettings({ template: 'x', accent: 'red', margin: 'oops' }).template === 'classic');
check('补写配置块不影响正文', MD.upsertFrontMatter('# 李四\n\n## 技能\n\n- TS', { accent: '#0f766e' })
  .includes('# 李四') && MD.upsertFrontMatter('# 李四', { accent: '#0f766e' }).startsWith('---\n'));

section('结构解析');
check('姓名入抬头', /<h1 class="r-name">张三<\/h1>/.test(html));
check('职位与联系方式分行处理', /r-subtitle">前端工程师/.test(html) && (html.match(/r-contacts/g) || []).length === 1);
check('邮箱自动加 mailto', html.includes('mailto:zhangsan@example.com'));
check('域名自动补 https', html.includes('href="https://github.com/zhangsan"'));
check('章节数量', result.stats.sections === 6, String(result.stats.sections));
check('条目数量', result.stats.entries === 4, String(result.stats.entries));
check('条目主副标题拆分', /<span class="r-entry-role">高级前端工程师<\/span>/.test(html));
check('条目时间右对齐', /<span class="r-entry-meta">2021\.06 – 至今<\/span>/.test(html));
check('加粗副信息行识别为 entry-sub', /<p class="r-entry-sub">上海 · 电商中台组（8 人）<\/p>/.test(html));
check('二级列表嵌套', (html.match(/<ul class="r-list">/g) || []).length >= 5 &&
  /<ul class="r-list"><li>[\s\S]*?<ul class="r-list">/.test(html));
check('表格渲染', /<table class="r-table">[\s\S]*<th class="ta-left">技能<\/th>[\s\S]*<td class="ta-left">语言<\/td>/.test(html) &&
  (html.match(/<tr>/g) || []).length === 4);
check('引用块渲染', /<blockquote class="r-quote">/.test(html));

section('行内语法与转义');
check('行内加粗', MD.inline('**重要**') === '<strong>重要</strong>');
check('行内斜体', MD.inline('*斜体*').includes('<em>'));
check('行内代码', MD.inline('`npm i`').includes('<code>npm i</code>'));
check('Markdown 链接', MD.inline('[主页](https://a.com)').includes('href="https://a.com"'));
check('裸链接自动识别', MD.inline('见 https://a.com/x 结尾').includes('<a href="https://a.com/x"'));
check('HTML 转义', MD.inline('<script>alert(1)</script>').includes('&lt;script&gt;'));
check('危险协议被保留为纯文本链接目标', MD.inline('[x](javascript:alert(1))').includes('href="javascript:alert(1)"') === false);

section('分页与独立 HTML');
const withBreak = MD.renderResume('---\ntemplate: modern\n---\n\n# 王五\n\n## 一\n\n- a\n\n---\n\n## 二\n\n- b\n');
check('手动分页标记', withBreak.stats.manualBreaks === 1);
check('模板切换生效', withBreak.sheetClasses.includes('tpl-modern'));
const docHtml = MD.toDocumentHTML(sample, { css: '/*css*/' });
check('独立 HTML 含 @page A4', /@page \{ size: A4; margin: 16mm 18mm; \}/.test(docHtml));
check('独立 HTML 含姓名标题', docHtml.includes('<title>张三</title>'));
check('独立 HTML 内联样式', docHtml.includes('/*css*/'));
check('预览模式保留纸张 padding', MD.toDocumentHTML(sample, { preview: true }).includes('resume-preview'));

section('证件照与图片');
const PHOTO_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const photoDoc = MD.renderResume(MD.upsertFrontMatter('# 李四\n\n前端工程师\n', { photo: PHOTO_URI, photoSize: '30mm' }));
check('配置块 photo 渲染出头像 img', /<img class="r-photo" src="data:image\/png;base64,[^"]+" alt="证件照">/.test(photoDoc.html));
check('纸张带上 has-photo 类', photoDoc.sheetClasses.includes('has-photo'));
check('photoSize 写进 CSS 变量', /--r-photo-w: 30mm/.test(photoDoc.style));
check('抬头文字被 .r-header-main 包住', /<header class="r-header"><div class="r-header-main">/.test(photoDoc.html));
check('统计里标记有照片', photoDoc.stats.hasPhoto === true);
check('默认照片靠右且圆角', /photo-right/.test(photoDoc.sheetClasses) && /shape-rounded/.test(photoDoc.sheetClasses));

const leftCircle = MD.renderResume(MD.upsertFrontMatter('# 赵六\n', { photo: PHOTO_URI, photoAlign: 'left', photoShape: 'circle' }));
check('photoAlign / photoShape 生效', /photo-left/.test(leftCircle.sheetClasses) && /shape-circle/.test(leftCircle.sheetClasses));
const badOptions = MD.normalizeSettings({ photo: PHOTO_URI, photoAlign: 'top', photoShape: 'star' });
check('非法方位 / 形状回退默认值', badOptions.photoAlign === 'right' && badOptions.photoShape === 'rounded');

const inlinePhoto = MD.renderResume('# 王五\n\n![证件照](./me.jpg)\n\n前端工程师\n\n## 技能\n\n- 一条\n');
check('姓名下一行的独立图片当作证件照', /<img class="r-photo" src="\.\/me\.jpg"/.test(inlinePhoto.html));
check('这张图片不会在正文里重复出现', (inlinePhoto.html.match(/me\.jpg/g) || []).length === 1);

check('拒绝危险协议的照片地址',
  MD.sanitizePhoto('javascript:alert(1)') === '' &&
  MD.renderResume('# A\n', { photo: 'javascript:alert(1)' }).html.indexOf('<img') < 0);
check('Windows 绝对路径转成 file URL', MD.sanitizePhoto('D:\\photos\\me.jpg') === 'file:///D:/photos/me.jpg');
check('相对路径与网址原样保留',
  MD.sanitizePhoto('./me.jpg') === './me.jpg' && MD.sanitizePhoto('https://a.com/x.png') === 'https://a.com/x.png');
check('正文图片渲染成 img', MD.inline('![图](./a.png)').indexOf('<img class="r-inline-img" src="./a.png"') >= 0);
check('正文里的不安全图片退化为文字', MD.inline('![图](javascript:1)') === '图');
check('有照片时写出 photo 相关配置行，没有照片时一行都不写',
  MD.serializeFrontMatter({ photo: PHOTO_URI }).indexOf('photoSize: 26mm') >= 0 &&
  ['photo:', 'photoSize', 'photoAlign', 'photoShape'].every(function (k) {
    return MD.serializeFrontMatter({}).indexOf(k) < 0;
  }));

section('模板');
check('内置 ' + MD.TEMPLATES.length + ' 套模板', MD.TEMPLATES.length === 7, MD.TEMPLATES.join(' / '));
check('每套模板都能渲染并带上对应的 class',
  MD.TEMPLATES.every(function (t) {
    var r = MD.renderResume(MD.upsertFrontMatter(sample, { template: t }));
    return r.sheetClasses.indexOf('tpl-' + t) >= 0 && r.html.indexOf('r-section') >= 0;
  }));
check('非法模板名回退到 classic', MD.normalizeSettings({ template: '不存在' }).template === 'classic');
check('模板与其它样式可自由组合',
  (function () {
    var r = MD.renderResume(MD.upsertFrontMatter(sample, { template: 'sidebar', font: 'serif', accent: '#b91c1c', fontSize: '15px' }));
    return r.sheetClasses.indexOf('tpl-sidebar') >= 0 && r.sheetClasses.indexOf('font-serif') >= 0 &&
      /--r-accent: #b91c1c/.test(r.style) && /--r-font-size: 15px/.test(r.style);
  })());

section('结果');
console.log('\n  通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  console.log('\n  失败明细：');
  failures.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
console.log('  渲染引擎自检通过 ✓');
