/*!
 * form-view.js —— 表单模式的界面层：把模块模型渲染成可折叠、可增删排序的表单
 *
 * 只做三件事：读模型 → 画表单 → 调 ResumeForm 的改写操作。
 * 文本输入不重画表单（避免丢焦点），只有结构变化（增删/移动）才整体重绘。
 */
(function (root) {
  'use strict';

  var Form = root.ResumeForm;
  var MD = root.ResumeMD;
  if (!Form || !MD) return;

  var KIND_LABEL = { entries: '经历条目', list: '要点列表', quote: '引用段落', paragraph: '正文段落', table: '表格', empty: '空章节' };
  var collapsed = Object.create(null);   // 按章节标题记住折叠状态

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** 给输入框挂上路径，并记住「这个值已经写进文档了」——用于重绘前的快速差量提交 */
  function withPath(input, path, value) {
    input.setAttribute('data-path', path);
    input.__mdValue = value == null ? '' : String(value);
    return input;
  }

  function field(label, value, opts) {
    opts = opts || {};
    var wrap = el('label', 'fld' + (opts.wide ? ' fld-wide' : ''));
    if (label) wrap.appendChild(el('span', 'fld-label', label));
    var input = document.createElement(opts.area ? 'textarea' : 'input');
    input.className = 'fld-input';
    if (opts.area) input.rows = opts.rows || 3;
    else input.type = 'text';
    input.value = value == null ? '' : value;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.path) withPath(input, opts.path, input.value);
    wrap.appendChild(input);
    return wrap;
  }

  function iconBtn(text, title, cls) {
    var b = el('button', 'ibtn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.title = title;
    return b;
  }

  function mount(container, api) {
    var sel = function (q) { return container.querySelector(q); };

    function apply(md, structural, focusPath) {
      api.apply(md, structural, focusPath);
    }

    /** 一个输入框的值 → 写进文档（只处理稳定路径；contact-new 是临时空位，在输入监听里单独处理） */
    function applyPath(md, path, value) {
      var parts = path.split(':');
      if (path === 'name') return Form.setHeaderName(md, value);
      if (path === 'subtitle' || parts[0] === 'contact') {
        var h = Form.walk(md).header.info;
        var contacts = h.contacts.slice();
        var subtitle = h.subtitle;
        if (path === 'subtitle') subtitle = value;
        else contacts[Number(parts[1])] = value;
        return Form.setHeaderInfo(md, { subtitle: subtitle, contacts: contacts });
      }
      if (parts[0] !== 'sec') return null;
      var si = Number(parts[1]);
      if (parts[2] === 'title') return Form.setSectionTitle(md, si, value);
      if (parts[2] === 'text') return Form.setSectionText(md, si, value);
      if (parts[2] === 'bullet') return Form.setBullet(md, si, null, Number(parts[3]), value);
      if (parts[2] === 'cell') return Form.setTableCell(md, si, Number(parts[3]), Number(parts[4]), value);
      if (parts[2] === 'entry') {
        // 「要点列表」型章节没有条目，路径里写作 entry:x —— 必须还原成 null，
        // 否则 Number('x') = NaN，写入时会静默失败（列表要点改不动）
        var ei = parts[3] === 'x' ? null : Number(parts[3]);
        if (parts[4] === 'sub') return ei == null ? null : Form.setEntrySub(md, si, ei, value);
        if (parts[4] === 'bullet') return Form.setBullet(md, si, ei, Number(parts[5]), value);
        if (ei == null) return null;
        var patch = {};
        patch[parts[4]] = value;
        return Form.setEntryHead(md, si, ei, patch);
      }
      return null;
    }

    /** 给输入框挂上路径，并记住「这个值已经写进文档了」——用于重绘前的快速差量提交 */
    function withPath(input, path, value) {
      input.setAttribute('data-path', path);
      input.__mdValue = value == null ? '' : String(value);
      return input;
    }

    /**
     * 重绘前把界面上「改过但还没写进文档」的输入提交进文档。
     * 表单里的文本编辑是不重绘的（为了不打断打字），所以文档里可能有「界面已改、文档还没写」的
     * 内容 —— 一旦结构性操作触发重绘，这些内容就会被冲掉。这里统一兜一层。
     * 用 __mdValue 做差量判断：正常情况一个字段都不用处理，大文档也不会卡。
     */
    function commitInputs() {
      var before = api.getMd();
      var md = before;
      var fields = container.querySelectorAll('[data-path]');
      for (var i = 0; i < fields.length; i++) {
        var el0 = fields[i];
        var path = el0.getAttribute('data-path');
        if (!path || path === 'contact-new') continue;
        if (el0.__mdValue === undefined || el0.value === el0.__mdValue) continue;
        var next = applyPath(md, path, el0.value);
        if (next && next !== md) { md = next; el0.__mdValue = el0.value; }
      }
      return md === before ? null : md;
    }

    /** 结构性操作统一入口：先提交界面输入 → 再执行操作 → 最后重绘（focusPath 可以是函数，按新文档算） */
    function structural(fn, focusPath) {
      var merged = commitInputs();
      var base = merged || api.getMd();
      var next = fn(base);
      if (next == null || next === base) { render(); return; }
      api.apply(next, true, typeof focusPath === 'function' ? focusPath(next) : focusPath);
    }

    function render(focusPath) {
      var md = api.getMd();
      var model = Form.walk(md);
      container.innerHTML = '';
      container.appendChild(renderBasic(model));
      model.sections.forEach(function (sec, si) { container.appendChild(renderSection(sec, si, model.sections.length)); });
      container.appendChild(renderAddSection());
      if (focusPath) {
        var target = sel('[data-path="' + focusPath + '"]');
        if (target) {
          target.focus();
          if (target.select) target.select();
          // 刚「+ 添加要点」出来的空要点：记一笔，失焦时还空着就收掉，别在 .md 里留空 `-` 行
          if (/:bullet:\d+$/.test(focusPath) && !String(target.value || '').trim()) target.__freshBullet = true;
        }
      }
    }

    /* ---------------------------------------------------------- 基本信息 */

    function renderBasic(model) {
      var card = el('div', 'fcard');
      var head = el('div', 'fcard-head');
      head.appendChild(el('span', 'fcard-title', '基本信息'));
      card.appendChild(head);

      var body = el('div', 'fcard-body');
      body.appendChild(field('姓名', model.header.name, { path: 'name', placeholder: '张三' }));

      var row = el('div', 'frow');
      row.appendChild(field('职位 / 求职意向', model.header.info.subtitle, { path: 'subtitle', placeholder: '前端工程师' }));
      body.appendChild(row);

      var contacts = el('div', 'fgroup');
      contacts.appendChild(el('div', 'fgroup-title', '联系方式（电话 / 邮箱 / 链接 / 城市，邮箱和网址会自动变可点链接）'));
      var list = model.header.info.contacts.slice();
      list.forEach(function (c, i) {
        var line = el('div', 'frow frow-tight');
        line.appendChild(field('', c, { path: 'contact:' + i, placeholder: '138-0000-0000' }));
        var del = iconBtn('×', '删除这条联系方式', 'ibtn-danger');
        del.addEventListener('click', function () {
          structural(function (md) {
            // 读「此刻」的文档，别用渲染时的旧快照 —— 否则会把刚输入还没重绘的内容覆盖掉
            var cur = Form.walk(md).header.info;
            var next = cur.contacts.slice();
            next.splice(i, 1);
            return Form.setHeaderInfo(md, { subtitle: cur.subtitle, contacts: next });
          });
        });
        line.appendChild(del);
        contacts.appendChild(line);
      });

      var addContact = el('button', 'fbtn', '+ 添加联系方式');
      addContact.type = 'button';
      addContact.setAttribute('data-act', 'add-contact');
      addContact.title = '先加一个空位，输入内容后才会写进 .md';
      addContact.addEventListener('click', function () {
        // 只在界面上加一个空输入框并聚焦：不写空值进 .md，也不会用旧快照覆盖刚输入的内容
        var line = el('div', 'frow frow-tight');
        var wrap = field('', '', { path: 'contact-new', placeholder: '138-0000-0000' });
        line.appendChild(wrap);
        var drop = iconBtn('×', '不要这一条', 'ibtn-danger');
        drop.addEventListener('click', function () { if (line.parentNode) line.parentNode.removeChild(line); });
        line.appendChild(drop);
        contacts.insertBefore(line, addContact);
        var box = wrap.querySelector('input');
        if (box && box.focus) box.focus();
      });
      contacts.appendChild(addContact);
      body.appendChild(contacts);

      // 证件照：这里只放入口，宽度 / 位置 / 形状仍由右上「排版」面板统管
      var photo = el('div', 'fgroup');
      photo.appendChild(el('div', 'fgroup-title', '证件照'));
      var prow = el('div', 'frow frow-tight');
      var pick = el('button', 'fbtn', api.hasPhoto() ? '更换证件照' : '选择证件照…');
      pick.type = 'button';
      pick.addEventListener('click', function () { api.pickPhoto(); });
      prow.appendChild(pick);
      if (api.hasPhoto()) {
        var rm = el('button', 'fbtn fbtn-danger', '移除证件照');
        rm.type = 'button';
        rm.addEventListener('click', function () { api.removePhoto(); });
        prow.appendChild(rm);
        prow.appendChild(el('span', 'fhint', '宽度 / 位置 / 形状在右上角「排版」里调'));
      } else {
        prow.appendChild(el('span', 'fhint', '会自动压缩成内嵌图片，跟着 .md 文件走'));
      }
      photo.appendChild(prow);
      body.appendChild(photo);

      card.appendChild(body);
      return card;
    }

    /* ---------------------------------------------------------- 章节 */

    function renderSection(sec, si, total) {
      var card = el('div', 'fcard');
      var head = el('div', 'fcard-head');
      var isCollapsed = !!collapsed[sec.title];

      var toggle = iconBtn(isCollapsed ? '▸' : '▾', isCollapsed ? '展开' : '折叠', 'ibtn-toggle');
      toggle.addEventListener('click', function () {
        collapsed[sec.title] = !collapsed[sec.title];
        render();
      });
      head.appendChild(toggle);

      var titleInput = document.createElement('input');
      titleInput.className = 'fcard-title-input';
      titleInput.type = 'text';
      titleInput.value = sec.title;
      withPath(titleInput, 'sec:' + si + ':title', sec.title);
      titleInput.placeholder = '章节标题';
      head.appendChild(titleInput);

      head.appendChild(el('span', 'fcard-kind', KIND_LABEL[sec.kind] || sec.kind));
      head.appendChild(el('span', 'fcard-flex'));

      var locate = iconBtn('定位', '在右侧预览里定位到这个章节', 'ibtn-text');
      locate.addEventListener('click', function () { api.locate(si); });
      head.appendChild(locate);

      var up = iconBtn('↑', '上移章节');
      up.disabled = si === 0;
      up.addEventListener('click', function () { structural(function (md) { return Form.moveSection(md, si, -1); }); });
      head.appendChild(up);

      var down = iconBtn('↓', '下移章节');
      down.disabled = si === total - 1;
      down.addEventListener('click', function () { structural(function (md) { return Form.moveSection(md, si, 1); }); });
      head.appendChild(down);

      var del = iconBtn('×', '删除整个章节', 'ibtn-danger');
      del.addEventListener('click', function () {
        if (!root.confirm('删除章节「' + (sec.title || '(无标题)') + '」及其全部内容？')) return;
        structural(function (md) { return Form.removeSection(md, si); });
      });
      head.appendChild(del);

      card.appendChild(head);
      if (isCollapsed) return card;

      var body = el('div', 'fcard-body');
      if (sec.kind === 'entries') {
        sec.entries.forEach(function (entry, ei) { body.appendChild(renderEntry(sec, si, entry, ei)); });
        var addEntry = el('button', 'fbtn', '+ 添加经历 / 项目条目');
        addEntry.type = 'button';
        addEntry.setAttribute('data-act', 'add-entry');
        addEntry.addEventListener('click', function () {
          structural(function (md) {
            return Form.addEntry(md, si, Form.walk(md).sections[si].entries.length - 1);
          }, 'sec:' + si + ':entry:' + (sec.entries.length) + ':title');
        });
        body.appendChild(addEntry);
      } else if (sec.kind === 'list' || sec.kind === 'empty') {
        renderBullets(body, sec, si, null, sec.items);
        if (sec.kind === 'empty') {
          var hint = el('div', 'fhint', '这个章节还没有内容。');
          body.appendChild(hint);
          var mkEntry = el('button', 'fbtn', '+ 改成「经历条目」型');
          mkEntry.type = 'button';
          mkEntry.setAttribute('data-act', 'make-entries');
          mkEntry.addEventListener('click', function () {
            structural(function (md) { return Form.addEntry(md, si, null); }, 'sec:' + si + ':entry:0:title');
          });
          body.appendChild(mkEntry);
        }
      } else if (sec.kind === 'table') {
        body.appendChild(renderTable(sec, si));
      } else {
        var area = field('', sec.text, { area: true, rows: Math.min(8, Math.max(2, sec.text.split('\n').length + 1)), path: 'sec:' + si + ':text', wide: true });
        body.appendChild(area);
      }

      card.appendChild(body);
      return card;
    }

    function renderEntry(sec, si, entry, ei) {
      var box = el('div', 'fentry');
      var head = el('div', 'fentry-head');
      head.appendChild(el('span', 'fentry-index', '条目 ' + (ei + 1)));
      head.appendChild(el('span', 'fcard-flex'));

      var up = iconBtn('↑', '上移条目');
      up.disabled = ei === 0;
      up.addEventListener('click', function () { structural(function (md) { return Form.moveEntry(md, si, ei, -1); }); });
      head.appendChild(up);

      var down = iconBtn('↓', '下移条目');
      down.disabled = ei === sec.entries.length - 1;
      down.addEventListener('click', function () { structural(function (md) { return Form.moveEntry(md, si, ei, 1); }); });
      head.appendChild(down);

      var del = iconBtn('×', '删除这条', 'ibtn-danger');
      del.addEventListener('click', function () {
        if (!root.confirm('删除「' + (entry.title || '这条经历') + '」？')) return;
        structural(function (md) { return Form.removeEntry(md, si, ei); });
      });
      head.appendChild(del);
      box.appendChild(head);

      var body = el('div', 'fentry-body');
      var r1 = el('div', 'frow');
      r1.appendChild(field('主标题（公司 / 学校 / 项目）', entry.title, { path: 'sec:' + si + ':entry:' + ei + ':title', placeholder: '某某科技有限公司' }));
      r1.appendChild(field('职位 / 专业', entry.role, { path: 'sec:' + si + ':entry:' + ei + ':role', placeholder: '高级前端工程师' }));
      body.appendChild(r1);

      var r2 = el('div', 'frow');
      r2.appendChild(field('时间 / 地点（右对齐显示）', entry.meta, { path: 'sec:' + si + ':entry:' + ei + ':meta', placeholder: '2021.06 – 至今' }));
      r2.appendChild(field('副信息（团队 / 城市，灰色小字）', entry.sub, { path: 'sec:' + si + ':entry:' + ei + ':sub', placeholder: '上海 · 电商中台组' }));
      body.appendChild(r2);

      renderBullets(body, sec, si, ei, entry.bullets);
      box.appendChild(body);
      return box;
    }

    function renderBullets(body, sec, si, ei, bullets) {
      var group = el('div', 'fgroup');
      group.appendChild(el('div', 'fgroup-title', '要点（建议写成「做了什么 + 结果如何」，带数字最有说服力）'));
      bullets.forEach(function (b, bi) {
        var line = el('div', 'frow frow-tight' + (b.indent ? ' frow-sub' : ''));
        line.appendChild(field('', b.text, {
          path: 'sec:' + si + ':entry:' + (ei == null ? 'x' : ei) + ':bullet:' + bi,
          placeholder: '负责……，性能提升 40%'
        }));
        var up = iconBtn('↑', '上移');
        up.disabled = bi === 0;
        up.addEventListener('click', function () { structural(function (md) { return Form.moveBullet(md, si, ei, bi, -1); }); });
        line.appendChild(up);
        var down = iconBtn('↓', '下移');
        down.disabled = bi === bullets.length - 1;
        down.addEventListener('click', function () { structural(function (md) { return Form.moveBullet(md, si, ei, bi, 1); }); });
        line.appendChild(down);
        var del = iconBtn('×', '删除这条要点', 'ibtn-danger');
        del.addEventListener('click', function () { structural(function (md) { return Form.removeBullet(md, si, ei, bi); }); });
        line.appendChild(del);
        group.appendChild(line);
      });

      var add = el('button', 'fbtn', '+ 添加要点');
      add.type = 'button';
      add.setAttribute('data-act', 'add-bullet');
      add.addEventListener('click', function () {
        // 加在「最外层最后一条」之后：即使末尾是子要点，新增的也是同级要点
        var baseIndent = bullets.length ? Math.min.apply(null, bullets.map(function (b) { return b.indent; })) : 0;
        var lastOuter = -1;
        bullets.forEach(function (b, i) { if (b.indent === baseIndent) lastOuter = i; });
        structural(function (md) { return Form.addBullet(md, si, ei, lastOuter >= 0 ? lastOuter : null); },
          'sec:' + si + ':entry:' + (ei == null ? 'x' : ei) + ':bullet:' + bullets.length);
      });
      group.appendChild(add);

      if (ei != null && bullets.length) {
        var sub = el('button', 'fbtn fbtn-mini', '+ 给最后一条加子要点');
        sub.type = 'button';
        sub.setAttribute('data-act', 'add-sub');
        sub.title = '行首缩进两个空格的二级要点';
        sub.addEventListener('click', function () {
          structural(function (md) { return Form.addSubBullet(md, si, ei, bullets.length - 1); }, function (md) {
            var list2 = Form.walk(md).sections[si].entries[ei].bullets;
            return 'sec:' + si + ':entry:' + ei + ':bullet:' + (list2.length - 1);
          });
        });
        group.appendChild(sub);
      }
      body.appendChild(group);
    }

    function renderTable(sec, si) {
      var wrap = el('div', 'ftable-wrap');
      var table = el('table', 'ftable');
      var cols = sec.table.rows[0].length;
      sec.table.rows.forEach(function (row, ri) {
        var tr = el('tr');
        for (var ci = 0; ci < cols; ci++) {
          var cell = el(ri === 0 ? 'th' : 'td');
          var input = document.createElement('input');
          input.className = 'fld-input';
          input.type = 'text';
          input.value = row[ci] == null ? '' : row[ci];
          withPath(input, 'sec:' + si + ':cell:' + ri + ':' + ci, input.value);
          cell.appendChild(input);
          if (ri > 0 && ci === cols - 1) {
            var del = iconBtn('×', '删除这一行', 'ibtn-danger');
            del.addEventListener('click', function () { structural(function (md) { return Form.removeTableRow(md, si, ri); }); });
            cell.appendChild(del);
          }
          tr.appendChild(cell);
        }
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      var add = el('button', 'fbtn', '+ 添加一行');
      add.type = 'button';
      add.setAttribute('data-act', 'add-row');
      add.addEventListener('click', function () { structural(function (md) { return Form.addTableRow(md, si); }); });
      wrap.appendChild(add);
      return wrap;
    }

    function renderAddSection() {
      var card = el('div', 'fcard fcard-add');
      var body = el('div', 'fcard-body frow');

      var select = document.createElement('select');
      select.className = 'fld-input';
      Form.SECTION_TEMPLATES.forEach(function (tpl) {
        var o = document.createElement('option');
        o.value = tpl.kind + '|' + tpl.title;
        o.textContent = tpl.title + '（' + (KIND_LABEL[tpl.kind] || tpl.kind) + '）';
        select.appendChild(o);
      });
      var blank = document.createElement('option');
      blank.value = 'paragraph|新章节';
      blank.textContent = '空白章节（自己写正文）';
      select.appendChild(blank);
      body.appendChild(select);

      var add = el('button', 'fbtn fbtn-primary', '+ 添加章节');
      add.type = 'button';
      add.setAttribute('data-act', 'add-section');
      add.addEventListener('click', function () {
        var parts = String(select.value).split('|');
        structural(function (md) { return Form.addSection(md, parts[1], parts[0]); }, function (md) {
          return 'sec:' + (Form.walk(md).sections.length - 1) + ':title';
        });
      });
      body.appendChild(add);

      card.appendChild(body);
      return card;
    }

    /* ---------------------------------------------------------- 事件绑定 */

    container.addEventListener('input', function (ev) {
      var input = ev.target;
      if (!input || !input.getAttribute) return;
      var path = input.getAttribute('data-path');
      if (!path) return;
      var md = api.getMd();

      // 「+ 添加联系方式」产生的空位：第一次输入时才追加进文档，之后转为普通位置编辑
      if (path === 'contact-new') {
        if (!String(input.value || '').trim()) return;
        var h = Form.walk(md).header.info;
        var idx = h.contacts.length;
        var added = Form.setHeaderInfo(md, { subtitle: h.subtitle, contacts: h.contacts.concat([input.value]) });
        if (added && added !== md) {
          input.setAttribute('data-path', 'contact:' + idx);
          input.__mdValue = input.value;
          apply(added, false);
        }
        return;
      }

      var next = applyPath(md, path, input.value);
      if (next && next !== md) {
        input.__mdValue = input.value;
        apply(next, false);
      } else if (!next) {
        // 操作没生效（理论上不该发生）：重绘一次，让输入框回到文档里的真实值，
        // 免得出现「框里有字、文档里没有」的静默不一致
        render();
      }
    });

    // 失焦时收掉「加出来但一直空着」的要点 / 联系方式空位（blur 不冒泡，用捕获）
    container.addEventListener('blur', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var path = t.getAttribute('data-path') || '';
      if (String(t.value || '').trim()) { t.__freshBullet = false; return; }

      if (path === 'contact-new') {
        var row = t.closest ? t.closest('.frow') : null;
        if (row && row.parentNode) row.parentNode.removeChild(row);
        return;
      }
      if (t.__freshBullet && /:bullet:\d+$/.test(path)) {
        t.__freshBullet = false;
        var parts = path.split(':');
        var si = Number(parts[1]);
        var ei = parts[3] === 'x' ? null : Number(parts[3]);
        var bi = Number(parts[5]);
        structural(function (md) { return Form.removeBullet(md, si, ei, bi); });
      }
    }, true);

    render();
    return { render: render };
  }

  root.ResumeFormView = { mount: mount };
})(window);
