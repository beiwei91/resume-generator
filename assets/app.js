/*!
 * app.js —— 简历生成器工作台逻辑
 * 数据流：Markdown 文本（含文首配置块）是唯一数据源 → 解析渲染 → 预览 / 打印导出
 */
(function () {
  'use strict';

  var MD = window.ResumeMD;
  if (!MD) {
    document.body.innerHTML = '<p style="padding:24px;font:16px sans-serif">assets/resume-md.js 加载失败，请确认文件完整。</p>';
    return;
  }

  /* ------------------------------------------------------------ 常量与状态 */

  var LS = { prefs: 'resume-gen:prefs', docs: 'resume-gen:docs', current: 'resume-gen:current' };
  var PAPER_W_PX = MD.A4.width / MD.MM_PER_PX;   // A4 宽（未缩放 CSS px）
  var PAGE_H_PX = MD.A4.height / MD.MM_PER_PX;   // A4 高（未缩放 CSS px）

  var SAMPLE = [
    '---',
    'template: classic',
    'accent: #2563eb',
    'font: sans',
    'fontSize: 14px',
    'lineHeight: 1.65',
    'margin: 16mm 18mm',
    '---',
    '',
    '# 张三',
    '',
    '前端工程师 | 138-0000-0000 | zhangsan@example.com | github.com/zhangsan | 上海',
    '',
    '## 个人简介',
    '',
    '> 6 年前端开发经验，专注大型 Web 应用的性能优化与工程化建设；主导过 3 个百万级 DAU 项目的前端架构升级，首屏性能平均提升 45%。',
    '',
    '## 工作经历',
    '',
    '### 某某科技有限公司 · 高级前端工程师 | 2021.06 – 至今',
    '',
    '**上海 · 电商中台组（8 人）**',
    '',
    '- 主导交易链路前端重构，将单体应用拆分为 6 个微前端子应用，发布耗时由 40 分钟降至 8 分钟。',
    '- 建设公司级组件库（58 个组件，接入率 82%），新项目搭建成本从 5 天缩短到 0.5 天。',
    '- 推动首屏性能专项：路由级代码分割 + 图片懒加载 + 接口聚合，**LCP 从 3.4s 优化到 1.6s**。',
    '  - 建立性能预算与 CI 卡点，阻止劣化合入主干。',
    '',
    '### 某某网络技术有限公司 · 前端工程师 | 2019.03 – 2021.05',
    '',
    '- 独立负责 B 端数据看板（React + ECharts），支撑 200+ 企业客户的日常运营分析。',
    '- 设计可视化配置平台，运营可自助搭建 30 种图表，需求交付周期缩短 60%。',
    '',
    '## 项目经历',
    '',
    '### 开源项目 · 轻量表单引擎 | 2022.03 – 2022.11',
    '',
    '- GitHub 1.2k Star，JSON Schema 驱动表单渲染与校验，已被 20+ 团队接入。',
    '- 采用 monorepo + Changesets 管理 5 个包，单元测试覆盖率 91%。',
    '',
    '## 技能清单',
    '',
    '| 技能 | 说明 |',
    '| --- | --- |',
    '| 语言 | TypeScript、JavaScript (ES2023)、HTML/CSS、Node.js |',
    '| 框架 | React、Vue 3、Next.js、NestJS |',
    '| 方向 | 工程化（Vite / Webpack / monorepo / CI/CD）、性能优化、微前端、数据可视化 |',
    '',
    '## 教育背景',
    '',
    '### 某某大学 · 计算机科学与技术 · 本科 | 2015.09 – 2019.06',
    '',
    '- 主修课程：数据结构、操作系统、计算机网络、数据库原理；GPA 3.7/4.0。',
    '- 校级科技创新一等奖（2018）。',
    '',
    '## 其他信息',
    '',
    '- 技术博客 60 篇原创文章，年阅读量 30 万+；英语 CET-6，可无障碍阅读英文技术文档。',
    ''
  ].join('\n');

  var NEW_DOC = [
    '---',
    'template: classic',
    'accent: #2563eb',
    'font: sans',
    'fontSize: 14px',
    'lineHeight: 1.65',
    'margin: 16mm 18mm',
    '---',
    '',
    '# 姓名',
    '',
    '求职意向 | 手机号 | 邮箱 | 城市',
    '',
    '## 个人简介',
    '',
    '> 一句话说明你的核心竞争力、年限与代表成果。',
    '',
    '## 工作经历',
    '',
    '### 公司名称 · 职位 | 起止时间',
    '',
    '- 做了什么：负责的模块、技术方案。',
    '- 结果如何：用数字量化（性能、效率、营收、规模）。',
    '',
    '## 技能清单',
    '',
    '| 技能 | 说明 |',
    '| --- | --- |',
    '| 语言 |  |',
    '| 框架 |  |',
    '',
    '## 教育背景',
    '',
    '### 学校 · 专业 · 学历 | 起止时间',
    '',
    '- 主修课程、GPA、奖项。',
    ''
  ].join('\n');

  var state = {
    name: '我的简历',
    markdown: SAMPLE,
    settings: MD.normalizeSettings({}),
    fileHandle: null,
    pages: 1,
    savedAt: 0,
    dirty: false
  };

  var prefs = Object.assign(
    { zoom: 'fit', guides: true, editorWidth: 460, autoSave: true, helpSeen: false, mode: 'form', mobileView: 'edit', hideStarBanner: false, theme: 'system' },
    readJSON(LS.prefs, {})
  );

  var renderTimer = null;
  var saveTimer = null;
  var toastTimer = null;
  var guideTimer = null;

  /* ------------------------------------------------------------ DOM */

  var $ = function (id) { return document.getElementById(id); };
  var editor = $('editor');
  var formView = $('formView');
  var formCtl = null;          // 表单视图控制器（init 时挂载）
  var sheet = $('sheet');
  var sheetWrap = $('sheetWrap');
  var previewScroll = $('previewScroll');
  var workspace = $('workspace');
  var splitter = $('splitter');
  var toastEl = $('toast');
  var helpModal = $('helpModal');

  /* ------------------------------------------------------------ 本地存储小工具 */

  function readJSON(key, dft) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : dft;
    } catch (e) { return dft; }
  }
  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;          // 存储满 / 隐私模式：让调用方知道写失败了，别谎报已保存
    }
  }
  function readRaw(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeRaw(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }
  function savePrefs() { writeJSON(LS.prefs, prefs); }

  /* ------------------------------------------------------------ 渲染 */

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(render, 100);
  }
  function scheduleGuides() {
    window.clearTimeout(guideTimer);
    guideTimer = window.setTimeout(updateGuides, 60);
  }

  function render() {
    var r = MD.renderResume(state.markdown);
    state.settings = r.settings;
    state.header = r.header;

    sheet.className = r.sheetClasses;
    sheet.setAttribute('style', r.style);
    sheet.innerHTML = r.html;

    $('printPageStyle').textContent = MD.pageRule(r.settings);

    syncControls(r.settings);
    updateGuides();
    updateStats(r);

    var base = fileName().replace(/\.md$/i, '');
    document.title = base + ' · 简历生成器';
    $('statusDoc').textContent = state.name || '未命名';
  }

  function currentZoom() {
    if (prefs.zoom === 'fit') {
      var avail = previewScroll.clientWidth - 56;
      var z = avail / PAPER_W_PX;
      return Math.min(2, Math.max(0.3, isFinite(z) && z > 0 ? z : 1));
    }
    var n = parseFloat(prefs.zoom);
    return isFinite(n) && n > 0 ? n : 1;
  }

  function applyZoom() {
    sheetWrap.style.zoom = String(currentZoom());
    scheduleGuides();
  }

  /** 计算分页位置（返回未缩放布局 px 的数组，均为“下一页开始处”） */
  function pageBreaks() {
    var zoom = currentZoom();
    var sheetRect = sheet.getBoundingClientRect();
    var sheetTop = sheetRect.top;
    var sheetH = sheetRect.height / zoom;

    var breaks = [];
    var nodes = sheet.querySelectorAll('.page-break');
    for (var i = 0; i < nodes.length; i++) {
      breaks.push((nodes[i].getBoundingClientRect().top - sheetTop) / zoom);
    }
    breaks.sort(function (a, b) { return a - b; });

    var positions = [];
    var cursor = PAGE_H_PX;
    var prev = 0;
    var guard = 0;
    while (cursor <= sheetH - 2 && guard++ < 200) {
      for (var k = 0; k < breaks.length; k++) {
        if (breaks[k] > prev + 6 && breaks[k] <= cursor - 2) { cursor = breaks[k]; break; }
      }
      positions.push(cursor);
      prev = cursor;
      cursor += PAGE_H_PX;
    }
    return { positions: positions, height: sheetH };
  }

  function updateGuides() {
    var old = sheetWrap.querySelectorAll('.page-guide');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);

    var info = pageBreaks();
    state.pages = 1 + info.positions.length;

    if (prefs.guides) {
      info.positions.forEach(function (top, idx) {
        var d = document.createElement('div');
        d.className = 'page-guide';
        d.style.top = top + 'px';
        var label = document.createElement('span');
        label.className = 'page-guide-label';
        label.textContent = '第 ' + (idx + 2) + ' 页开始';
        d.appendChild(label);
        sheetWrap.appendChild(d);
      });
    }
    updateStats();
  }

  function updateStats(r) {
    var stats = r ? r.stats : MD.renderResume(state.markdown).stats;
    $('statusStats').textContent = stats.chars + ' 字 · ' + stats.sections + ' 章节 · ' + stats.entries + ' 条目';

    var pageEl = $('statusPages');
    pageEl.textContent = '共 ' + state.pages + ' 页';
    pageEl.classList.toggle('overflow', state.pages > 1);
    if (state.pages > 1) pageEl.textContent += '（多页简历请留意接缝）';
  }

  /* ------------------------------------------------------------ 排版控件 ↔ 文首配置 */

  function buildStaticOptions() {
    var TEMPLATE_LABELS = {
      classic: '经典（居中抬头）',
      modern: '现代（色块标题）',
      compact: '紧凑（单行抬头）',
      timeline: '时间轴（左侧连线）',
      minimal: '极简（无框线）',
      banner: '色块（整条标题栏）',
      sidebar: '侧栏标题（左侧留白栏）',
      twocol: '双栏（自动分左右栏）'
    };
    MD.TEMPLATES.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t;
      o.textContent = TEMPLATE_LABELS[t] || t;
      $('tplSelect').appendChild(o);
    });
    MD.MARGIN_PRESETS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.value;
      o.textContent = p.label;
      $('marginSelect').appendChild(o);
    });
    MD.ACCENT_PRESETS.forEach(function (color) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = color;
      b.title = color;
      b.dataset.color = color;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { patchSettings({ accent: color }); });
      $('accentSwatches').appendChild(b);
    });
  }

  function syncControls(s) {
    $('tplSelect').value = s.template;
    $('fontSelect').value = s.font;
    $('accentInput').value = s.accent;
    $('fontSizeInput').value = parseFloat(s.fontSize);
    $('fontSizeVal').textContent = parseFloat(s.fontSize) + 'px';
    $('lineHeightInput').value = parseFloat(s.lineHeight);
    $('lineHeightVal').textContent = s.lineHeight;

    var swatches = $('accentSwatches').querySelectorAll('.swatch');
    for (var i = 0; i < swatches.length; i++) {
      swatches[i].setAttribute('aria-pressed', String(swatches[i].dataset.color.toLowerCase() === s.accent.toLowerCase()));
    }

    var sel = $('marginSelect');
    var found = false;
    for (var j = 0; j < sel.options.length; j++) {
      if (sel.options[j].value === s.margin) found = true;
    }
    if (!found) {
      var o = document.createElement('option');
      o.value = s.margin;
      o.textContent = '自定义 (' + s.margin + ')';
      sel.appendChild(o);
    }
    sel.value = s.margin;

    $('zoomSelect').value = String(prefs.zoom);
    $('guideToggle').checked = !!prefs.guides;
    $('autoSaveToggle').checked = !!prefs.autoSave;
    if (prefs.zoom === 'fit') applyZoom();

    // 证件照：没有照片时整行隐藏
    var hasPhoto = !!(s.photo || (state.header && state.header.photo));
    $('photoField').hidden = !hasPhoto;
    $('photoSizeInput').value = parseFloat(s.photoSize) || 26;
    $('photoSizeVal').textContent = s.photoSize;
    $('photoAlignSelect').value = s.photoAlign;
    $('photoShapeSelect').value = s.photoShape;
  }

  /** 同步应用一份排版设置：压页时要在循环里立刻量出页数，等不了防抖 */
  function applySettingsNow(settings) {
    var next = MD.upsertFrontMatter(state.markdown, settings);
    state.markdown = next;
    editor.value = next;
    markDirty();             // 压页改的是文档本身：必须标脏并触发保存，否则刷新就白压了
    scheduleAutoSave();
    render();
    updateGuides();
  }

  /** 一键压到一页：依次收紧 字号 → 行距 → 页边距 → 证件照宽度，压到就停；整体算一步可撤销 */
  function fitToOnePage() {
    if (state.pages <= 1) { toast('已经是一页了，不用压'); return; }
    var base = Object.assign({}, state.settings);
    var cur = Object.assign({}, base);
    var steps = [];
    var v;
    for (v = parseFloat(cur.fontSize) - 0.5; v >= 10; v -= 0.5) {
      steps.push(['fontSize', (Math.round(v * 10) / 10) + 'px']);
    }
    for (v = parseFloat(cur.lineHeight) - 0.05; v >= 1.15; v -= 0.05) {
      steps.push(['lineHeight', (Math.round(v * 100) / 100).toFixed(2)]);
    }
    var curY = MD.marginMm(cur).y;
    MD.MARGIN_PRESETS
      .filter(function (m) { return MD.marginMm({ margin: m.value }).y < curY; })
      .sort(function (a, b) { return MD.marginMm({ margin: b.value }).y - MD.marginMm({ margin: a.value }).y; })
      .forEach(function (m) { steps.push(['margin', m.value]); });
    if (cur.photo) {
      for (v = (parseFloat(cur.photoSize) || 26) - 1; v >= 18; v -= 1) steps.push(['photoSize', v + 'mm']);
    }

    pushUndo(true);                       // 整个「压到一页」记成一步
    var hit = null;
    for (var i = 0; i < steps.length; i++) {
      var next = Object.assign({}, cur);
      next[steps[i][0]] = steps[i][1];
      cur = next;
      applySettingsNow(cur);
      if (state.pages <= 1) { hit = cur; break; }
    }
    if (!hit) {
      applySettingsNow(base);
      toast('内容确实太多，压不进一页；建议删掉几条要点，或换「紧凑」模板', 5200);
      return;
    }
    var bits = [];
    if (hit.fontSize !== base.fontSize) bits.push('字号 ' + hit.fontSize);
    if (hit.lineHeight !== base.lineHeight) bits.push('行距 ' + hit.lineHeight);
    if (hit.margin !== base.margin) bits.push('页边距 ' + hit.margin);
    if (hit.photoSize !== base.photoSize) bits.push('证件照 ' + hit.photoSize);
    toast('已压到一页：' + (bits.length ? bits.join('，') : '无需改动'));
  }

  /** 把排版参数写回 Markdown 文首配置块（保持正文不动） */
  function patchSettings(patch) {
    var next = MD.upsertFrontMatter(state.markdown, patch);
    if (next === state.markdown) return;
    setMarkdown(next, true);
    // 模板 / 左栏会影响表单渲染（双栏下每张章节卡片多一个「→ 左栏 / ← 右栏」按钮），
    // 所以这两项变化时必须重绘表单，否则界面与文档不一致
    if (patch && (patch.template !== undefined || patch.rail !== undefined)) refreshForm();
  }

  /* ------------------------------------------------------------ 编辑与保存 */

  function fileName() {
    var base = String(state.name || '我的简历').replace(/[\\/:*?"<>|]/g, '-').replace(/\.md$/i, '');
    return (base || '我的简历') + '.md';
  }

  function setMarkdown(text, keepCaret) {
    var s = editor.selectionStart;
    var e = editor.selectionEnd;
    state.markdown = text;
    editor.value = text;
    if (keepCaret) {
      editor.selectionStart = Math.min(s, text.length);
      editor.selectionEnd = Math.min(e, text.length);
    }
    // 任何新的改动都让「重做」作废（撤销/重做自己改文档时用 skipRedoClear 跳过）
    if (!skipRedoClear) {
      redoStack.length = 0;
      updateUndoBtn();
    }
    markDirty();
    scheduleRender();
    scheduleAutoSave();
  }

  function markDirty() {
    state.dirty = true;
    var el = $('statusSaved');
    el.classList.remove('saved');
    el.textContent = '未保存';
  }

  function scheduleAutoSave() {
    window.clearTimeout(saveTimer);
    if (!prefs.autoSave) return;
    saveTimer = window.setTimeout(function () { saveCurrent(true); }, 900);
  }

  /**
   * 立刻把待保存的改动落盘。
   * 切换文档 / 离开页面之前必须先调用：自动保存有 900ms 防抖，若在防抖窗口内切换文档，
   * 定时器醒来时 state.markdown 已经是「另一份文档」的内容，原来那份的最新改动就丢了
   * —— 表现就是「改完内容点一下就变回原来的样子」。
   */
  function flushAutoSave() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    if (state.dirty) saveCurrent(true);
  }

  function loadDocs() { return readJSON(LS.docs, {}); }
  function writeDocs(docs) { return writeJSON(LS.docs, docs); }

  function saveCurrent(silent) {
    if (!state.name) state.name = '我的简历';
    var docs = loadDocs();
    docs[state.name] = state.markdown;
    var okDocs = writeDocs(docs);
    var okCur = writeRaw(LS.current, state.name);
    if (!okDocs || !okCur) {
      toast('保存失败：浏览器存储可能已满或被隐私模式限制；建议用「导出备份」或「下载 MD」留一份', 6400);
      return;                       // 保持 dirty，别让状态栏谎报已保存
    }
    state.dirty = false;
    state.savedAt = Date.now();
    var el = $('statusSaved');
    el.classList.add('saved');
    el.textContent = '已保存 ' + new Date().toTimeString().slice(0, 5);
    refreshDocList();
    if (!silent) toast('已保存到浏览器存储（文档：' + state.name + '）');
  }

  var docListKey = null;   // 记住上次渲染出来的文档清单，没变就不重建

  function refreshDocList() {
    var docs = loadDocs();
    var names = Object.keys(docs).sort(function (a, b) { return a.localeCompare(b, 'zh-Hans-CN'); });
    var sel = $('docList');
    var key = names.join('\u0000');

    if (key !== docListKey) {
      // 清单真的变了才重建；同一份清单重建会打断手机上正在打开的系统选择器
      docListKey = key;
      sel.innerHTML = '';
      if (!names.length) {
        var o = document.createElement('option');
        o.value = '';
        o.textContent = '（暂无已保存文档）';
        sel.appendChild(o);
        sel.disabled = true;
        return;
      }
      names.forEach(function (n) {
        var opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        sel.appendChild(opt);
      });
    }
    sel.disabled = !names.length;
    if (names.length) sel.value = docs[state.name] != null ? state.name : names[0];
  }

  /** 切换 / 新建 / 删除文档前，先把当前这份的改动落盘，避免防抖窗口内丢内容 */
  function switchDocGuard() {
    flushAutoSave();
  }

  function openDoc(name) {
    var docs = loadDocs();
    if (docs[name] == null) return;
    if (name === state.name) return;
    flushAutoSave();                 // 切走之前先把这份的改动落盘
    state.name = name;
    state.fileHandle = null;
    $('docName').value = name;
    setMarkdown(docs[name], false);
    writeRaw(LS.current, name);
    $('statusSaved').classList.add('saved');
    $('statusSaved').textContent = '已打开';
    render();
    resetDocHistory();
    refreshForm();
    toast('已打开《' + name + '》');
  }

  function newDoc() {
    flushAutoSave();                 // 新建之前先把当前这份落盘
    var name = '未命名简历 ' + new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    state.name = name;
    state.fileHandle = null;
    $('docName').value = name;
    setMarkdown(NEW_DOC, false);
    saveCurrent(true);
    render();
    resetDocHistory();
    refreshForm();
    toast('已新建空白简历');
  }

  function saveAs() {
    var input = window.prompt('另存为（浏览器内的文档名）：', state.name || '我的简历');
    if (input == null) return;
    var name = input.trim();
    if (!name) return;
    flushAutoSave();
    state.name = name;
    $('docName').value = name;
    saveCurrent();
    render();
  }

  function deleteDoc() {
    flushAutoSave();                 // 删除前先落盘（确认框取消时也不会白改）
    var docs = loadDocs();
    if (!docs[state.name]) {
      toast('当前文档尚未保存到浏览器');
      return;
    }
    if (!window.confirm('确定删除《' + state.name + '》？该操作不可撤销。')) return;
    delete docs[state.name];
    writeDocs(docs);
    var names = Object.keys(docs);
    if (names.length) {
      state.name = names[0];
      $('docName').value = state.name;
      setMarkdown(docs[state.name], false);
    } else {
      state.name = '我的简历';
      $('docName').value = state.name;
      setMarkdown(NEW_DOC, false);
    }
    saveCurrent(true);
    refreshDocList();
    render();
    resetDocHistory();
    refreshForm();
    toast('已删除');
  }

  function downloadMD() {
    var blob = new Blob([state.markdown], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    toast('已下载 ' + fileName());
  }

  /** 把浏览器里的全部简历（含排版偏好）导出成一个 JSON 备份 */
  function exportBackup() {
    flushAutoSave();
    var docs = loadDocs();
    var payload = {
      app: '简历生成器',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      current: state.name,
      prefs: prefs,
      docs: docs
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '简历备份-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    toast('已导出备份：' + Object.keys(docs).length + ' 份简历（换电脑 / 换浏览器都能恢复）');
  }

  var BACKUP_BLOCKED_KEYS = ['__proto__', 'constructor', 'prototype'];
  var BACKUP_MAX_BYTES = 8 * 1024 * 1024;
  var PREF_BOOL_KEYS = ['guides', 'autoSave', 'hideStarBanner'];

  /** 从备份 JSON 恢复：可「同名覆盖」，也可只补充本地没有的 */
  function importBackup(file) {
    if (!file) return;
    if (file.size > BACKUP_MAX_BYTES) {
      toast('备份文件太大（超过 8MB），已取消导入', 5200);
      return;
    }
    file.text().then(function (text) {
      var data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (!data || typeof data !== 'object' || !data.docs || typeof data.docs !== 'object') {
        toast('这不是本应用的备份文件');
        return;
      }
      var incoming = Object.keys(data.docs);
      if (!incoming.length) { toast('备份里没有简历'); return; }
      flushAutoSave();
      var overwrite = window.confirm('备份里有 ' + incoming.length + ' 份简历。\n\n' +
        '确定 = 覆盖：同名的用备份内容替换\n取消 = 补充：只导入本地没有的');
      var docs = loadDocs();
      var added = 0;
      var updated = 0;
      var skipped = 0;
      var touchedCurrent = false;
      incoming.forEach(function (name) {
        // 危险键名与非字符串值一律跳过：避免把 constructor 之类当成"文档"存下来，
        // 也避免用 "null"/"[object Object]" 这类垃圾覆盖真实简历
        if (BACKUP_BLOCKED_KEYS.indexOf(name) >= 0) { skipped++; return; }
        var value = data.docs[name];
        if (typeof value !== 'string') { skipped++; return; }
        if (docs[name] == null) { docs[name] = value; added++; }
        else if (overwrite) { docs[name] = value; updated++; }
        else { skipped++; return; }
        if (name === state.name) touchedCurrent = true;
      });
      writeDocs(docs);
      refreshDocList();
      if (data.prefs && typeof data.prefs === 'object') {
        // 只接受白名单里的偏好，并做类型 / 范围校验，损坏的备份不至于把界面搞坏
        var p = data.prefs;
        if (p.theme === 'system' || p.theme === 'light' || p.theme === 'dark') prefs.theme = p.theme;
        if (p.mode === 'form' || p.mode === 'markdown') prefs.mode = p.mode;
        if (p.mobileView === 'edit' || p.mobileView === 'preview') prefs.mobileView = p.mobileView;
        if (typeof p.editorWidth === 'number' && p.editorWidth >= 280 && p.editorWidth <= 900) prefs.editorWidth = p.editorWidth;
        if (p.zoom === 'fit' || (typeof p.zoom === 'string' && parseFloat(p.zoom) > 0 && parseFloat(p.zoom) <= 2)) prefs.zoom = p.zoom;
        PREF_BOOL_KEYS.forEach(function (k) { if (typeof p[k] === 'boolean') prefs[k] = p[k]; });
        savePrefs();
        setEditorMode(prefs.mode);
        applyMobileView();
        applyStarBanner();
        applyTheme();
        applyZoom();
        syncControls(state.settings);
      }
      // 备份覆盖了正在看的这份：立刻换成恢复后的内容，
      // 否则内存里还是旧内容，下一次自动保存会把刚恢复的版本又写回去
      if (touchedCurrent) {
        setMarkdown(docs[state.name], false);
        resetDocHistory();
        render();
        refreshForm();
      }
      toast('已恢复：新增 ' + added + ' 份' + (updated ? '，覆盖 ' + updated + ' 份' : '') +
        (skipped ? '，跳过 ' + skipped + ' 项' : '') +
        (touchedCurrent ? '；当前文档已换成恢复后的内容' : ''));
    }).catch(function () { toast('读取备份失败'); });
  }

  function saveToDisk() {
    var name = fileName();
    if (window.showSaveFilePicker) {
      var opts = {
        suggestedName: name,
        types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown'] } }]
      };
      var p = state.fileHandle ? state.fileHandle.createWritable() : window.showSaveFilePicker(opts).then(function (h) {
        state.fileHandle = h;
        return h.createWritable();
      });
      p.then(function (w) {
        return w.write(state.markdown).then(function () { return w.close(); });
      }).then(function () {
        var el = $('statusSaved');
        el.classList.add('saved');
        el.textContent = '已写入磁盘';
        state.dirty = false;
        toast('已保存到磁盘：' + (state.fileHandle && state.fileHandle.name || name));
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        if (state.fileHandle) state.fileHandle = null;
        downloadMD();
      });
      return;
    }
    downloadMD();
  }

  function importFile(file) {
    if (!file) return;
    flushAutoSave();                 // 导入会替换当前内容，先把现有的落盘
    file.text().then(function (text) {
      state.name = file.name.replace(/\.(md|markdown|txt)$/i, '') || '导入的简历';
      state.fileHandle = null;
      $('docName').value = state.name;
      setMarkdown(String(text).replace(/\r\n?/g, '\n'), false);
      saveCurrent(true);
      render();
      resetDocHistory();
      refreshForm();
      toast('已导入 ' + file.name);
    }).catch(function () { toast('读取文件失败'); });
  }

  function exportPdf() {
    render();
    document.title = fileName().replace(/\.md$/i, '');
    toast('在打印对话框中选择「另存为 PDF」；建议取消勾选“页眉和页脚”', 4200);
    window.setTimeout(function () { window.print(); }, 160);
  }

  /* ------------------------------------------------------------ 编辑器小工具 */

  function onEditorInput() {
    state.markdown = editor.value;
    markDirty();
    scheduleRender();
    scheduleAutoSave();
  }

  function wrapSelection(before, after, placeholder) {
    var s = editor.selectionStart;
    var e = editor.selectionEnd;
    var sel = editor.value.slice(s, e) || placeholder || '';
    var v = editor.value;
    editor.value = v.slice(0, s) + before + sel + after + v.slice(e);
    editor.selectionStart = s + before.length;
    editor.selectionEnd = s + before.length + sel.length;
    editor.focus();
    onEditorInput();
  }

  function insertText(text) {
    var s = editor.selectionStart;
    var e = editor.selectionEnd;
    var v = editor.value;
    editor.value = v.slice(0, s) + text + v.slice(e);
    editor.selectionStart = editor.selectionEnd = s + text.length;
    editor.focus();
    onEditorInput();
  }

  function insertBlock(text) {
    var s = editor.selectionStart;
    var e = editor.selectionEnd;
    var v = editor.value;
    var before = v.slice(0, s);
    var lead = (!before || /\n[ \t]*$/.test(before)) ? '' : '\n';
    var insert = lead + text + '\n';
    editor.value = before + insert + v.slice(e);
    editor.selectionStart = editor.selectionEnd = s + insert.length;
    editor.focus();
    onEditorInput();
  }

  function applyAct(act) {
    switch (act) {
      case 'bold': wrapSelection('**', '**', '加粗文字'); break;
      case 'italic': wrapSelection('*', '*', '斜体文字'); break;
      case 'code': wrapSelection('`', '`', 'code'); break;
      case 'section': insertBlock('## 章节标题'); break;
      case 'entry': insertBlock('### 公司名称 · 职位 | 2021.06 – 至今\n\n- 负责……，结果：……'); break;
      case 'list': insertBlock('- 要点内容'); break;
      case 'table': insertBlock('| 技能 | 说明 |\n| --- | --- |\n| 语言 | TypeScript、JavaScript |\n| 框架 | React、Vue 3 |'); break;
      case 'break': insertBlock('---'); break;
      case 'hr': insertBlock('***'); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------ 证件照 */

  var PHOTO_MAX_SIDE = 720;      // 压缩后最长边（像素），足够 A4 打印
  var PHOTO_QUALITY = 0.86;

  /** 选图 → 等比压缩 → 内嵌成 data URI 写进配置块（图片跟着 .md 走，PDF 与单文件版都不会丢） */
  function insertPhoto(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('请选择图片文件'); return; }

    var reader = new FileReader();
    reader.onerror = function () { toast('读取图片失败，换一张试试'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { toast('这张图片解不开，换一张试试'); };
      img.onload = function () {
        var scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';     // 铺白底：透明区域在 PDF 里会变黑
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        var dataUri;
        try {
          dataUri = canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
        } catch (err) {
          toast('这张图片处理失败了，换一张试试（建议 JPG / PNG）', 5200);
          return;
        }
        if (!dataUri) { toast('这张图片处理失败了，换一张试试'); return; }
        patchSettings({ photo: dataUri, photoSize: state.settings.photoSize || '26mm' });
        refreshForm();
        toast('已插入证件照：' + w + '×' + h + '，约 ' + Math.round(dataUri.length / 1024) +
          ' KB，已内嵌进 .md（可在「排版」里调宽度或移除）', 4200);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function removePhoto() {
    if (!state.settings.photo && !(state.header && state.header.photo)) {
      toast('当前简历没有证件照');
      return;
    }
    var next = MD.upsertFrontMatter(state.markdown, { photo: '' });
    // 同时清掉「姓名下面那行独立图片」（photo 的另一种写法），只处理第一个 ## 之前的部分
    var idx = next.search(/^##[ \t]/m);
    var head = idx < 0 ? next : next.slice(0, idx);
    var body = idx < 0 ? '' : next.slice(idx);
    head = head.replace(/^[ \t]*!\[[^\]]*\]\([^)\r\n]+\)[ \t]*\r?\n/m, '');
    setMarkdown(head + body, true);
    refreshForm();
    toast('已移除证件照');
  }

  /* ------------------------------------------------------------ 表单模式 / 撤销 / 定位 */

  var undoStack = [];
  var redoStack = [];
  var lastUndoAt = 0;
  var skipRedoClear = false;      // 撤销 / 重做自己改文档时，别把重做栈清掉

  function updateUndoBtn() {
    var u = $('btnUndo');
    if (u) u.disabled = undoStack.length === 0;
    var r = $('btnRedo');
    if (r) r.disabled = redoStack.length === 0;
  }

  /** structural=true 时一定记一步；连续打字的修改合并成一步，免得撤销要按几十次 */
  function pushUndo(structural) {
    var now = Date.now();
    if (!structural && undoStack.length && now - lastUndoAt < 1500) { lastUndoAt = now; return; }
    undoStack.push(state.markdown);
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;              // 一旦有新改动，之前的「重做」就作废
    lastUndoAt = now;
    updateUndoBtn();
  }

  function resetDocHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoBtn();
  }

  function undoLast() {
    if (!undoStack.length) { toast('没有可撤销的操作'); return; }
    redoStack.push(state.markdown);
    if (redoStack.length > 80) redoStack.shift();
    skipRedoClear = true;
    setMarkdown(undoStack.pop(), true);
    skipRedoClear = false;
    refreshForm();
    updateUndoBtn();
    toast('已撤销');
  }

  function redoLast() {
    if (!redoStack.length) { toast('没有可重做的操作'); return; }
    undoStack.push(state.markdown);
    if (undoStack.length > 80) undoStack.shift();
    lastUndoAt = 0;
    skipRedoClear = true;
    setMarkdown(redoStack.pop(), true);
    skipRedoClear = false;
    refreshForm();
    updateUndoBtn();
    toast('已重做');
  }

  function refreshForm(focusPath) {
    if (formCtl) formCtl.render(focusPath);
  }

  function hasPhoto() {
    return !!(state.settings.photo || (state.header && state.header.photo));
  }

  /** 表单视图需要的回调：读写文档、证件照入口、在预览里定位 */
  function formApi() {
    return {
      getMd: function () { return state.markdown; },
      apply: function (md, structural, focusPath) {
        if (md == null || md === state.markdown) return;
        pushUndo(!!structural);
        setMarkdown(md, true);
        if (structural) refreshForm(focusPath);
      },
      hasPhoto: hasPhoto,
      notice: toast,
      pickPhoto: function () { $('photoInput').click(); },
      removePhoto: removePhoto,
      locate: locateSection
    };
  }

  /** 把预览滚动到第 i 个章节，并闪一下高亮 */
  function locateSection(i) {
    var nodes = sheet.querySelectorAll('.r-section');
    var node = nodes[i];
    if (!node) { toast('预览里没有对应的章节内容'); return; }
    var wrapRect = sheetWrap.getBoundingClientRect();
    var nodeRect = node.getBoundingClientRect();
    previewScroll.scrollTop += (nodeRect.top - wrapRect.top) - 24;
    node.classList.add('is-target');
    window.setTimeout(function () { node.classList.remove('is-target'); }, 1200);
  }

  function setEditorMode(mode) {
    prefs.mode = mode === 'markdown' ? 'markdown' : 'form';
    savePrefs();
    var isForm = prefs.mode === 'form';
    var tabs = $('modeTabs').querySelectorAll('.mode-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('is-active', tabs[i].dataset.mode === prefs.mode);
    }
    formView.hidden = !isForm;
    editor.hidden = isForm;
    $('mdTools').hidden = isForm;
    $('btnUndo').hidden = !isForm;
    $('btnRedo').hidden = !isForm;
    updateUndoBtn();
    if (isForm) refreshForm();
    else editor.focus();
  }

  /* ------------------------------------------------------------ 界面主题 */

  function applyTheme() {
    var mode = prefs.theme || 'system';
    var dark = mode === 'dark' ||
      (mode === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var sel = $('themeSelect');
    if (sel) sel.value = mode;
  }

  function bindSystemTheme() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { if ((prefs.theme || 'system') === 'system') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ------------------------------------------------------------ 版本号 */

  var APP_VERSION = (function () {
    var m = document.querySelector('meta[name="app-version"]');
    return m && m.content ? String(m.content) : '';
  })();

  function applyVersion() {
    var v = $('statusVersion');
    if (v) v.textContent = APP_VERSION ? 'v' + APP_VERSION : '';
    var note = $('helpVersion');
    if (note) note.textContent = APP_VERSION ? '界面版本 v' + APP_VERSION : '';
  }

  /* ------------------------------------------------------------ 顶部求 star 横幅 */

  function applyStarBanner() {
    var b = $('ghBanner');
    if (b) b.hidden = !!prefs.hideStarBanner;
  }

  /* ------------------------------------------------------------ 窄屏：编辑 / 预览 切换 */

  function applyMobileView() {
    var isPreview = prefs.mobileView === 'preview';
    var app = $('app');
    app.classList.toggle('mobile-preview', isPreview);
    app.classList.toggle('mobile-edit', !isPreview);
    var btns = $('mobileView').querySelectorAll('.mv-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('is-active', btns[i].dataset.view === prefs.mobileView);
    }
    // 预览面板刚从 display:none 显示出来时宽度才有效，需要重新算「适应宽度」
    if (isPreview) window.requestAnimationFrame(function () { applyZoom(); });
  }

  function setMobileView(view) {
    prefs.mobileView = view === 'preview' ? 'preview' : 'edit';
    savePrefs();
    applyMobileView();
  }

  /* ------------------------------------------------------------ 提示与弹窗 */

  function toast(message, timeout) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toastEl.hidden = true; }, timeout || 2400);
  }

  function toggleHelp(show) {
    helpModal.hidden = show === undefined ? !helpModal.hidden : !show;
    if (!helpModal.hidden) prefs.helpSeen = true;
  }

  /* ------------------------------------------------------------ 事件绑定 */

  function bind() {
    editor.addEventListener('input', onEditorInput);

    editor.addEventListener('keydown', function (ev) {
      var mod = ev.ctrlKey || ev.metaKey;

      if (ev.key === 'Tab') {
        ev.preventDefault();
        insertText('  ');
        return;
      }
      if (mod && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        if (state.fileHandle) saveToDisk(); else saveCurrent();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'b') {
        ev.preventDefault();
        applyAct('bold');
        return;
      }
      if (mod && ev.key.toLowerCase() === 'p') {
        ev.preventDefault();
        exportPdf();
        return;
      }
      if (ev.key === 'Enter' && !ev.shiftKey) {
        var pos = editor.selectionStart;
        if (pos !== editor.selectionEnd) return;
        var lineStart = editor.value.lastIndexOf('\n', pos - 1) + 1;
        var line = editor.value.slice(lineStart, pos);
        var m = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(.*)$/.exec(line);
        if (!m) return;
        ev.preventDefault();
        if (!m[4].trim()) {                       // 空条目 → 退出列表
          editor.value = editor.value.slice(0, lineStart) + editor.value.slice(pos);
          editor.selectionStart = editor.selectionEnd = lineStart;
          onEditorInput();
          return;
        }
        var marker = m[2];
        if (/\d/.test(marker)) marker = (parseInt(marker, 10) + 1) + marker.replace(/^\d+/, '');
        insertText('\n' + m[1] + marker + m[3]);
      }
    });

    // 把文件拖到窗口任意位置都能导入：.md 导入简历、备份 .json 恢复、图片当证件照
    ['dragenter', 'dragover'].forEach(function (type) {
      document.addEventListener(type, function (ev) {
        if (!ev.dataTransfer || !ev.dataTransfer.types) return;
        var hasFile = Array.prototype.indexOf.call(ev.dataTransfer.types, 'Files') >= 0;
        if (!hasFile) return;
        ev.preventDefault();
        document.body.classList.add('drop-active');
      });
    });
    document.addEventListener('dragleave', function (ev) {
      if (ev.relatedTarget) return;                 // 移到子元素上不算离开窗口
      document.body.classList.remove('drop-active');
    });
    document.addEventListener('drop', function (ev) {
      document.body.classList.remove('drop-active');
      if (!ev.dataTransfer || !ev.dataTransfer.files || !ev.dataTransfer.files.length) return;
      ev.preventDefault();
      var f = ev.dataTransfer.files[0];
      if (ev.dataTransfer.files.length > 1) toast('一次只导入一个文件，已取第一个：' + f.name, 4200);
      if (/\.(md|markdown|txt)$/i.test(f.name)) importFile(f);
      else if (/\.json$/i.test(f.name)) importBackup(f);
      else if (/^image\//.test(f.type)) insertPhoto(f);
      else toast('只能拖入 .md 简历、.json 备份或图片');
    });

    // Esc：先关弹窗，再关排版面板
    document.addEventListener('keydown', function (ev) {
      if (String(ev.key || '').toLowerCase() !== 'escape') return;
      var modal = $('helpModal');
      if (modal && !modal.hidden) { modal.hidden = true; return; }
      var panel = $('settingsPanel');
      if (panel && !panel.hidden) { panel.hidden = true; $('btnMore').textContent = '排版 ▾'; }
    });

    var tools = document.querySelectorAll('.tool[data-act]');
    for (var i = 0; i < tools.length; i++) {
      tools[i].addEventListener('click', function () { applyAct(this.dataset.act); });
    }

    $('btnPdf').addEventListener('click', exportPdf);
    $('btnPdfMobile').addEventListener('click', exportPdf);
    $('btnDownload').addEventListener('click', downloadMD);
    $('btnSaveDisk').addEventListener('click', saveToDisk);
    $('btnNew').addEventListener('click', newDoc);
    $('btnSaveAs').addEventListener('click', saveAs);
    $('btnDelDoc').addEventListener('click', deleteDoc);
    $('btnHelp').addEventListener('click', function () { toggleHelp(true); });
    $('btnHelpClose').addEventListener('click', function () { toggleHelp(false); });
    helpModal.addEventListener('click', function (ev) { if (ev.target === helpModal) toggleHelp(false); });

    $('btnOpen').addEventListener('click', function () {
      if (window.showOpenFilePicker) {
        window.showOpenFilePicker({
          types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }],
          multiple: false
        }).then(function (handles) {
          if (!handles || !handles[0]) return;
          state.fileHandle = handles[0];
          return handles[0].getFile().then(importFile);
        }).catch(function () { /* 用户取消 */ });
      } else {
        $('fileInput').click();
      }
    });

    $('fileInput').addEventListener('change', function () {
      if (this.files && this.files[0]) importFile(this.files[0]);
      this.value = '';
    });

    $('docName').addEventListener('change', function () {
      var next = this.value.trim() || '我的简历';
      flushAutoSave();               // 改名也算换文档，先落盘
      var docs = loadDocs();
      if (next !== state.name && docs[next] != null) {
        if (!window.confirm('已经有一份叫《' + next + '》的简历，改名会覆盖它。继续吗？')) {
          this.value = state.name;
          return;
        }
      }
      if (next !== state.name && docs[state.name] != null) {
        docs[next] = state.markdown;
        delete docs[state.name];
        writeDocs(docs);
      }
      state.name = next;
      this.value = next;
      saveCurrent(true);
      render();
    });
    $('docName').addEventListener('input', function () { $('statusDoc').textContent = this.value || '未命名'; });

    $('docList').addEventListener('change', function () { openDoc(this.value); });

    $('tplSelect').addEventListener('change', function () {
      var tpl = this.value;
      var FR = window.ResumeForm;
      // 切到双栏且还没配左栏：自动把技能 / 证书 / 教育这类章节放进去，省得手写配置
      if (tpl === 'twocol' && FR && !FR.railTitles(state.markdown).length) {
        var picked = FR.suggestRail(state.markdown);
        if (picked.length) {
          patchSettings({ template: tpl, rail: picked.join(', ') });
          toast('已切到双栏，并把「' + picked.join('、') + '」放进左栏；每张章节卡片上都有「→ 左栏 / ← 右栏」可随时调整', 5600);
          return;
        }
      }
      patchSettings({ template: tpl });
      if (tpl === 'twocol') toast('双栏已就绪：在章节卡片上点「→ 左栏」把章节放进左栏', 4600);
    });
    $('btnFitPage').addEventListener('click', fitToOnePage);
    $('fontSelect').addEventListener('change', function () { patchSettings({ font: this.value }); });
    $('themeSelect').addEventListener('change', function () {
      prefs.theme = this.value;
      savePrefs();
      applyTheme();
    });
    $('accentInput').addEventListener('input', function () { patchSettings({ accent: this.value }); });
    $('fontSizeInput').addEventListener('input', function () { patchSettings({ fontSize: parseFloat(this.value) + 'px' }); });
    $('lineHeightInput').addEventListener('input', function () { patchSettings({ lineHeight: String(parseFloat(this.value)) }); });
    $('marginSelect').addEventListener('change', function () { patchSettings({ margin: this.value }); });
    $('zoomSelect').addEventListener('change', function () {
      prefs.zoom = this.value === 'fit' ? 'fit' : parseFloat(this.value);
      savePrefs(); applyZoom();
    });
    $('guideToggle').addEventListener('change', function () {
      prefs.guides = this.checked; savePrefs(); updateGuides();
    });
    $('autoSaveToggle').addEventListener('change', function () {
      prefs.autoSave = this.checked; savePrefs();
      toast(this.checked ? '已开启自动保存' : '已关闭自动保存');
    });

    $('btnFit').addEventListener('click', function () {
      prefs.zoom = 'fit'; savePrefs(); $('zoomSelect').value = 'fit'; applyZoom();
    });

    // 证件照
    $('btnPhoto').addEventListener('click', function () { $('photoInput').click(); });
    $('photoInput').addEventListener('change', function () {
      if (this.files && this.files[0]) insertPhoto(this.files[0]);
      this.value = '';
    });
    $('photoSizeInput').addEventListener('input', function () {
      patchSettings({ photoSize: parseFloat(this.value) + 'mm' });
    });
    $('photoAlignSelect').addEventListener('change', function () {
      patchSettings({ photoAlign: this.value });
    });
    $('photoShapeSelect').addEventListener('change', function () {
      patchSettings({ photoShape: this.value });
    });
    $('btnRemovePhoto').addEventListener('click', removePhoto);

    $('btnMore').addEventListener('click', function () {
      var panel = $('settingsPanel');
      panel.hidden = !panel.hidden;
      this.setAttribute('aria-expanded', String(!panel.hidden));
      this.textContent = panel.hidden ? '排版 ▾' : '排版 ▴';
    });

    // 表单 / Markdown 页签
    $('modeTabs').addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.mode-tab') : null;
      if (btn) setEditorMode(btn.dataset.mode);
    });
    $('btnUndo').addEventListener('click', undoLast);
    $('btnRedo').addEventListener('click', redoLast);
    $('btnBackup').addEventListener('click', exportBackup);
    $('btnRestore').addEventListener('click', function () { $('backupInput').click(); });
    $('backupInput').addEventListener('change', function () {
      if (this.files && this.files[0]) importBackup(this.files[0]);
      this.value = '';
    });

    var bannerClose = $('ghBannerClose');
    if (bannerClose) {
      bannerClose.addEventListener('click', function () {
        prefs.hideStarBanner = true;
        savePrefs();
        applyStarBanner();
        toast('已关闭这个提示，谢谢支持 🐾');
      });
    }

    // 窄屏：编辑 / 预览 切换；「更多」把工具栏展开成第二行
    $('mobileView').addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.mv-btn') : null;
      if (btn) setMobileView(btn.dataset.view);
    });
    $('btnTools').addEventListener('click', function () {
      var bar = document.querySelector('.appbar');
      var open = bar.classList.toggle('tools-open');
      this.textContent = open ? '收起 ⌃' : '更多 ⋯';
    });
    $('appbarMain').addEventListener('click', function (ev) {
      if (ev.target && ev.target.tagName === 'BUTTON') {
        document.querySelector('.appbar').classList.remove('tools-open');
        $('btnTools').textContent = '更多 ⋯';
      }
    });

    // 离开页面 / 切到后台时立刻落盘：手机浏览器可能在防抖窗口内就把页面丢弃了
    window.addEventListener('pagehide', flushAutoSave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushAutoSave();
    });

    // 表单模式下焦点不在编辑器里，快捷键在这里兜底（编辑器内的由上面的 handler 处理）
    document.addEventListener('keydown', function (ev) {
      var mod = ev.ctrlKey || ev.metaKey;
      if (!mod || ev.target === editor) return;
      var key = String(ev.key || '').toLowerCase();
      if (key === 's') {
        ev.preventDefault();
        if (state.fileHandle) saveToDisk(); else saveCurrent();
      } else if (key === 'p') {
        ev.preventDefault();
        exportPdf();
      } else if (key === 'z' && prefs.mode === 'form') {
        ev.preventDefault();
        if (ev.shiftKey) redoLast(); else undoLast();
      } else if (key === 'y' && prefs.mode === 'form') {
        ev.preventDefault();
        redoLast();
      }
    });

    // 拖动分隔条
    splitter.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
      splitter.classList.add('dragging');
      var left = workspace.getBoundingClientRect().left;
      function move(e2) {
        var w = Math.min(Math.max(e2.clientX - left, 280), window.innerWidth * 0.75);
        workspace.style.setProperty('--editor-w', w + 'px');
        prefs.editorWidth = Math.round(w);
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        splitter.classList.remove('dragging');
        savePrefs();
        applyZoom();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !helpModal.hidden) toggleHelp(false);
    });

    // 浏览器不给本地文件系统选择器时（用 file:// 直接打开），提前说明保存会退化成下载
    if (!window.showSaveFilePicker) {
      $('btnSaveDisk').title = '直接用浏览器打开 HTML 时，保存会用「下载」代替系统文件选择器；' +
        '功能一样，只是需要手动选择保存位置';
    }

    window.addEventListener('resize', function () { if (prefs.zoom === 'fit') applyZoom(); });
    previewScroll.addEventListener('scroll', function () { /* 预留：滚动同步 */ });

    window.addEventListener('beforeunload', function (ev) {
      if (!prefs.autoSave && state.dirty) {
        ev.preventDefault();
        ev.returnValue = '';
      }
    });
  }

  /* ------------------------------------------------------------ 启动 */

  function init() {
    buildStaticOptions();
    bind();

    workspace.style.setProperty('--editor-w', (prefs.editorWidth || 460) + 'px');

    var docs = loadDocs();
    var current = readRaw(LS.current);
    if (current && docs[current] != null) {
      state.name = current;
      state.markdown = docs[current];
    } else {
      var names = Object.keys(docs);
      if (names.length) {
        state.name = names[0];
        state.markdown = docs[names[0]];
      } else {
        state.name = '我的简历';
        state.markdown = SAMPLE;
        saveCurrent(true);
      }
    }

    $('docName').value = state.name;
    editor.value = state.markdown;

    render();
    refreshDocList();
    applyZoom();
    if (window.ResumeFormView) formCtl = window.ResumeFormView.mount(formView, formApi());
    setEditorMode(prefs.mode);
    applyMobileView();
    applyStarBanner();
    applyTheme();
    bindSystemTheme();
    applyVersion();
    $('statusSaved').textContent = loadDocs()[state.name] != null ? '已加载' : '未保存';

    // 应用快捷方式：index.html?action=new 直接新建一份空白简历
    try {
      if (new URLSearchParams(window.location.search).get('action') === 'new') newDoc();
    } catch (e) { /* 老浏览器忽略 */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
