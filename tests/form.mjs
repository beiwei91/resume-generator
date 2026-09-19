/**
 * tests/form.mjs —— 表单模式（纯逻辑层）自检：模块识别 + 逐块改写
 *
 * 核心不变式：**用当前值改写某一项，应当得到完全相同的文档模型**
 * —— 这能保证「表单里点一下、改一个字」不会意外重排或破坏其它内容。
 */
import fs from 'node:fs';
import path from 'node:path';
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
function section(title) { console.log('\n' + title); }
/** 只比较结构化模型（不含原始 lines —— 表单会把「**副信息**」这类写法规范化掉，属于预期） */
const model = (md) => {
  const m = Form.walk(md);
  return JSON.stringify({ header: m.header, sections: m.sections });
};

const sample = fs.readFileSync(path.join(ROOT, 'resume.sample.md'), 'utf8');
const w = Form.walk(sample);

/* ------------------------------------------------------------------ 模块识别 */

section('模块识别');
check('抬头：姓名', w.header.name === '张三', w.header.name);
check('抬头：职位', w.header.info.subtitle === '前端工程师', w.header.info.subtitle);
check('抬头：联系方式 4 条', w.header.info.contacts.length === 4, w.header.info.contacts.join(' / '));
check('章节数量', w.sections.length === 6, String(w.sections.length));
check('章节标题顺序', w.sections.map((s) => s.title).join(',') === '个人简介,工作经历,项目经历,技能清单,教育背景,其他信息');

const work = w.sections[1];
check('工作经历识别为条目型', work.kind === 'entries' && work.entries.length === 2, work.kind + ' × ' + work.entries.length);
check('条目拆分：主标题 / 职位 / 时间',
  work.entries[0].title === '某某科技有限公司' && work.entries[0].role === '高级前端工程师' && work.entries[0].meta === '2021.06 – 至今',
  [work.entries[0].title, work.entries[0].role, work.entries[0].meta].join(' | '));
check('条目副信息', work.entries[0].sub === '上海 · 电商中台组（8 人）', work.entries[0].sub);
check('条目要点数量（含一个二级要点）', work.entries[0].bullets.length === 4, String(work.entries[0].bullets.length));
check('二级要点缩进被识别', work.entries[0].bullets[3].indent === 2, 'indent=' + work.entries[0].bullets[3].indent);
check('个人简介识别为引用块', w.sections[0].kind === 'quote', w.sections[0].kind);
check('技能清单识别为表格', w.sections[3].kind === 'table' && w.sections[3].table.rows.length === 4,
  w.sections[3].kind + ' × ' + (w.sections[3].table ? w.sections[3].table.rows.length : 0));
check('其他信息识别为要点列表', w.sections[5].kind === 'list' && w.sections[5].items.length === 1, w.sections[5].kind);

/* ------------------------------------------------------------------ 不变式 */

section('不变式：用原值改写不应改变文档模型');
let stable = true;
let stableDetail = '';
const cases = [
  ['姓名', (md) => Form.setHeaderName(md, w.header.name)],
  ['职位+联系方式', (md) => Form.setHeaderInfo(md, w.header.info)],
  ['引用正文', (md) => Form.setSectionText(md, 0, w.sections[0].text)],
  ['表格单元格', (md) => Form.setTableCell(md, 3, 1, 1, w.sections[3].table.rows[1][1])]
];
w.sections.forEach((s, si) => {
  cases.push(['章节标题 ' + s.title, (md) => Form.setSectionTitle(md, si, s.title)]);
  s.entries.forEach((e, ei) => {
    cases.push(['条目头 ' + e.title, (md) => Form.setEntryHead(md, si, ei, { title: e.title, role: e.role, meta: e.meta })]);
    if (e.sub) cases.push(['副信息 ' + e.title, (md) => Form.setEntrySub(md, si, ei, e.sub)]);
    e.bullets.forEach((b, bi) => cases.push(['要点 ' + bi, (md) => Form.setBullet(md, si, ei, bi, b.text)]));
  });
  s.items.forEach((b, bi) => cases.push(['列表要点 ' + bi, (md) => Form.setBullet(md, si, null, bi, b.text)]));
});
for (const [label, fn] of cases) {
  const out = fn(sample);
  if (model(out) !== model(sample)) { stable = false; stableDetail = label; break; }
}
check('全部 ' + cases.length + ' 项按原值改写后模型不变', stable, stable ? '' : '首个不一致：' + stableDetail);

/* ------------------------------------------------------------------ 改写操作 */

section('改写操作');
const renamed = Form.setHeaderName(sample, '李四');
check('改姓名只动那一行', Form.walk(renamed).header.name === '李四' && Form.walk(renamed).sections.length === 6);
check('改姓名保留文首配置块', renamed.startsWith(MD.splitFrontMatter(sample).raw), '配置块未变');

const info = Form.setHeaderInfo(sample, { subtitle: '资深前端工程师', contacts: ['139-1111-2222', 'li@example.com'] });
const wInfo = Form.walk(info);
check('改职位+联系方式生效',
  wInfo.header.info.subtitle === '资深前端工程师' && wInfo.header.info.contacts.length === 2,
  wInfo.header.info.contacts.join(' / '));
check('改抬头后章节不受影响', wInfo.sections.length === 6 && wInfo.sections[1].entries.length === 2);

const title = Form.setSectionTitle(sample, 1, '工作经验');
check('改章节标题', Form.walk(title).sections[1].title === '工作经验');

const head = Form.setEntryHead(sample, 1, 0, { title: '字节跳动', role: '前端专家', meta: '2024.01 – 至今' });
check('改条目头拼回一行',
  Form.walk(head).sections[1].entries[0].title === '字节跳动' &&
  Form.walk(head).sections[1].entries[0].role === '前端专家' &&
  Form.walk(head).sections[1].entries[0].meta === '2024.01 – 至今');

const noSub = Form.setEntrySub(sample, 1, 1, '北京 · 基础架构组');
check('给没有副信息的条目补一行', Form.walk(noSub).sections[1].entries[1].sub === '北京 · 基础架构组');
const dropSub = Form.setEntrySub(sample, 1, 0, '');
check('清空副信息会删掉那一行', Form.walk(dropSub).sections[1].entries[0].sub === '' && dropSub.indexOf('电商中台组') < 0);

const bullet = Form.setBullet(sample, 1, 0, 3, '建立性能预算与 CI 卡点');
check('改二级要点保留缩进', Form.walk(bullet).sections[1].entries[0].bullets[3].indent === 2);

const added = Form.addBullet(sample, 1, 0, 0);
check('新增要点到条目里', Form.walk(added).sections[1].entries[0].bullets.length === 5);
const removed = Form.removeBullet(sample, 1, 0, 3);
check('删除要点（连同它的二级子项）',
  Form.walk(removed).sections[1].entries[0].bullets.length === 3 && removed.indexOf('性能预算') < 0,
  String(Form.walk(removed).sections[1].entries[0].bullets.length));

const movedBullet = Form.moveBullet(sample, 1, 0, 1, -1);
check('要点上移', Form.walk(movedBullet).sections[1].entries[0].bullets[0].text.indexOf('建设公司级组件库') === 0,
  Form.walk(movedBullet).sections[1].entries[0].bullets[0].text.slice(0, 12));

const movedEntry = Form.moveEntry(sample, 1, 1, -1);
check('条目上移', Form.walk(movedEntry).sections[1].entries[0].title === '某某网络技术有限公司',
  Form.walk(movedEntry).sections[1].entries[0].title);

const movedSec = Form.moveSection(sample, 2, -1);
check('章节上移', Form.walk(movedSec).sections[1].title === '项目经历', Form.walk(movedSec).sections[1].title);

const addedSec = Form.addSection(sample, '获奖情况', 'list');
const wAdded = Form.walk(addedSec);
check('新增章节', wAdded.sections.length === 7 && wAdded.sections[6].title === '获奖情况' && wAdded.sections[6].kind === 'list');
const addedEntries = Form.addSection(sample, '实习经历', 'entries');
check('新增条目型章节', Form.walk(addedEntries).sections[6].kind === 'entries' && Form.walk(addedEntries).sections[6].entries.length === 1);
const removedSec = Form.removeSection(sample, 0);
check('删除章节', Form.walk(removedSec).sections.length === 5 && removedSec.indexOf('个人简介') < 0);

const addedEntry = Form.addEntry(sample, 1, 0);
check('新增条目', Form.walk(addedEntry).sections[1].entries.length === 3);
const removedEntry = Form.removeEntry(sample, 1, 0);
check('删除条目', Form.walk(removedEntry).sections[1].entries.length === 1 && removedEntry.indexOf('某某科技有限公司') < 0);

const text = Form.setSectionText(sample, 0, '换一段自我介绍');
check('改引用正文并保留 > 前缀',
  Form.walk(text).sections[0].kind === 'quote' &&
  Form.walk(text).sections[0].text === '换一段自我介绍' &&
  /^>\s*换一段自我介绍$/m.test(text));

const cell = Form.setTableCell(sample, 3, 2, 1, 'React、Vue 3、Svelte');
check('改表格单元格', Form.walk(cell).sections[3].table.rows[2][1] === 'React、Vue 3、Svelte');
const addRow = Form.addTableRow(sample, 3);
check('表格加一行', Form.walk(addRow).sections[3].table.rows.length === 5);
const delRow = Form.removeTableRow(sample, 3, 1);
check('表格删一行', Form.walk(delRow).sections[3].table.rows.length === 3 && delRow.indexOf('TypeScript、JavaScript') < 0);

/* ------------------------------------------------------------------ 健壮性 */

section('健壮性');
check('越界的索引不会改动文档',
  Form.setSectionTitle(sample, 99, 'x') === sample &&
  Form.removeEntry(sample, 99, 0) === sample &&
  Form.setBullet(sample, 1, 0, 99, 'x') === sample &&
  Form.setTableCell(sample, 99, 0, 0, 'x') === sample);
check('没有章节的文档也能识别抬头',
  (() => { const m = Form.walk('# 独苗\n\n前端工程师 | 123\n'); return m.header.name === '独苗' && m.sections.length === 0; })());
check('每个章节模板都能生成可用章节',
  Form.SECTION_TEMPLATES.every((tpl) => {
    const md = Form.addSection('# 甲\n', tpl.title, tpl.kind);
    const mm = Form.walk(md);
    return mm.sections.length === 1 && mm.sections[0].title === tpl.title && MD.renderResume(md).html.indexOf('<h2') >= 0;
  }));
check('表单改写后的文档仍可正常渲染并导出（无异常）',
  cases.every(([, fn]) => {
    const html = MD.renderResume(fn(sample)).html;
    return html.indexOf('r-section') >= 0 && html.indexOf('<h1') >= 0;
  }));

section('结果');
console.log('\n  通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  failures.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
console.log('  表单逻辑自检通过 ✓');
