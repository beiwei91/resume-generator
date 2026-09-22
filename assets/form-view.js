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
    if (opts.path) input.setAttribute('data-path', opts.path);
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

    function render(focusPath) {
      var md = api.getMd();
      var model = Form.walk(md);
      container.innerHTML = '';
      container.appendChild(renderBasic(model));
      model.sections.forEach(function (sec, si) { container.appendChild(renderSection(sec, si, model.sections.length)); });
      container.appendChild(renderAddSection());
      if (focusPath) {
        var target = sel('[data-path="' + focusPath + '"]');
        if (target) { target.focus(); if (target.select) target.select(); }
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
          // 读「此刻」的文档，别用渲染时的旧快照 —— 否则会把刚输入还没重绘的内容覆盖掉
          var cur = Form.walk(api.getMd());
          var next = cur.header.info.contacts.slice();
          next.splice(i, 1);
          apply(Form.setHeaderInfo(api.getMd(), { subtitle: cur.header.info.subtitle, contacts: next }), true);
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
      titleInput.setAttribute('data-path', 'sec:' + si + ':title');
      titleInput.placeholder = '章节标题';
      head.appendChild(titleInput);

      head.appendChild(el('span', 'fcard-kind', KIND_LABEL[sec.kind] || sec.kind));
      head.appendChild(el('span', 'fcard-flex'));

      var locate = iconBtn('定位', '在右侧预览里定位到这个章节', 'ibtn-text');
      locate.addEventListener('click', function () { api.locate(si); });
      head.appendChild(locate);

      var up = iconBtn('↑', '上移章节');
      up.disabled = si === 0;
      up.addEventListener('click', function () { apply(Form.moveSection(api.getMd(), si, -1), true); });
      head.appendChild(up);

      var down = iconBtn('↓', '下移章节');
      down.disabled = si === total - 1;
      down.addEventListener('click', function () { apply(Form.moveSection(api.getMd(), si, 1), true); });
      head.appendChild(down);

      var del = iconBtn('×', '删除整个章节', 'ibtn-danger');
      del.addEventListener('click', function () {
        if (!root.confirm('删除章节「' + (sec.title || '(无标题)') + '」及其全部内容？')) return;
        apply(Form.removeSection(api.getMd(), si), true);
      });
      head.appendChild(del);

      card.appendChild(head);
      if (isCollapsed) return card;

      var body = el('div', 'fcard-body');
      if (sec.kind === 'entries') {
        sec.entries.forEach(function (entry, ei) { body.appendChild(renderEntry(sec, si, entry, ei)); });
        var addEntry = el('button', 'fbtn', '+ 添加经历 / 项目条目');
        addEntry.type = 'button';
        addEntry.addEventListener('click', function () {
          apply(Form.addEntry(api.getMd(), si, sec.entries.length - 1), true, 'sec:' + si + ':entry:' + sec.entries.length + ':title');
        });
        body.appendChild(addEntry);
      } else if (sec.kind === 'list' || sec.kind === 'empty') {
        renderBullets(body, sec, si, null, sec.items);
        if (sec.kind === 'empty') {
          var hint = el('div', 'fhint', '这个章节还没有内容。');
          body.appendChild(hint);
          var mkEntry = el('button', 'fbtn', '+ 改成「经历条目」型');
          mkEntry.type = 'button';
          mkEntry.addEventListener('click', function () {
            apply(Form.addEntry(api.getMd(), si, null), true, 'sec:' + si + ':entry:0:title');
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
      up.addEventListener('click', function () { apply(Form.moveEntry(api.getMd(), si, ei, -1), true); });
      head.appendChild(up);

      var down = iconBtn('↓', '下移条目');
      down.disabled = ei === sec.entries.length - 1;
      down.addEventListener('click', function () { apply(Form.moveEntry(api.getMd(), si, ei, 1), true); });
      head.appendChild(down);

      var del = iconBtn('×', '删除这条', 'ibtn-danger');
      del.addEventListener('click', function () {
        if (!root.confirm('删除「' + (entry.title || '这条经历') + '」？')) return;
        apply(Form.removeEntry(api.getMd(), si, ei), true);
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
        up.addEventListener('click', function () { apply(Form.moveBullet(api.getMd(), si, ei, bi, -1), true); });
        line.appendChild(up);
        var down = iconBtn('↓', '下移');
        down.disabled = bi === bullets.length - 1;
        down.addEventListener('click', function () { apply(Form.moveBullet(api.getMd(), si, ei, bi, 1), true); });
        line.appendChild(down);
        var del = iconBtn('×', '删除这条要点', 'ibtn-danger');
        del.addEventListener('click', function () { apply(Form.removeBullet(api.getMd(), si, ei, bi), true); });
        line.appendChild(del);
        group.appendChild(line);
      });

      var add = el('button', 'fbtn', '+ 添加要点');
      add.type = 'button';
      add.addEventListener('click', function () {
        // 加在「最外层最后一条」之后：即使末尾是子要点，新增的也是同级要点
        var baseIndent = bullets.length ? Math.min.apply(null, bullets.map(function (b) { return b.indent; })) : 0;
        var lastOuter = -1;
        bullets.forEach(function (b, i) { if (b.indent === baseIndent) lastOuter = i; });
        apply(Form.addBullet(api.getMd(), si, ei, lastOuter >= 0 ? lastOuter : null), true,
          'sec:' + si + ':entry:' + (ei == null ? 'x' : ei) + ':bullet:' + bullets.length);
      });
      group.appendChild(add);

      if (ei != null && bullets.length) {
        var sub = el('button', 'fbtn fbtn-mini', '+ 给最后一条加子要点');
        sub.type = 'button';
        sub.title = '行首缩进两个空格的二级要点';
        sub.addEventListener('click', function () {
          var md = Form.addSubBullet(api.getMd(), si, ei, bullets.length - 1);
          if (md === api.getMd()) return;
          var list2 = Form.walk(md).sections[si].entries[ei].bullets;
          apply(md, true, 'sec:' + si + ':entry:' + ei + ':bullet:' + (list2.length - 1));
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
          input.setAttribute('data-path', 'sec:' + si + ':cell:' + ri + ':' + ci);
          cell.appendChild(input);
          if (ri > 0 && ci === cols - 1) {
            var del = iconBtn('×', '删除这一行', 'ibtn-danger');
            del.addEventListener('click', function () { apply(Form.removeTableRow(api.getMd(), si, ri), true); });
            cell.appendChild(del);
          }
          tr.appendChild(cell);
        }
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      var add = el('button', 'fbtn', '+ 添加一行');
      add.type = 'button';
      add.addEventListener('click', function () { apply(Form.addTableRow(api.getMd(), si), true); });
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
      add.addEventListener('click', function () {
        var parts = String(select.value).split('|');
        var md = Form.addSection(api.getMd(), parts[1], parts[0]);
        var idx = Form.walk(md).sections.length - 1;
        apply(md, true, 'sec:' + idx + ':title');
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
      var value = input.value;
      var parts = path.split(':');
      var next = null;

      if (path === 'name') next = Form.setHeaderName(md, value);
      else if (path === 'contact-new') {
        // 「+ 添加联系方式」产生的空位：第一次输入时才追加进文档，之后转为普通位置编辑
        var curH = Form.walk(md);
        var newIdx = curH.header.info.contacts.length;
        next = Form.setHeaderInfo(md, {
          subtitle: curH.header.info.subtitle,
          contacts: curH.header.info.contacts.concat([value])
        });
        if (next !== md && input.setAttribute) input.setAttribute('data-path', 'contact:' + newIdx);
      } else if (path === 'subtitle' || parts[0] === 'contact') {
        var model = Form.walk(md);
        var contacts = model.header.info.contacts.slice();
        var subtitle = model.header.info.subtitle;
        if (path === 'subtitle') subtitle = value;
        else contacts[Number(parts[1])] = value;
        next = Form.setHeaderInfo(md, { subtitle: subtitle, contacts: contacts });
      } else if (parts[0] === 'sec') {
        var si = Number(parts[1]);
        if (parts[2] === 'title') next = Form.setSectionTitle(md, si, value);
        else if (parts[2] === 'text') next = Form.setSectionText(md, si, value);
        else if (parts[2] === 'entry') {
          var ei = Number(parts[3]);
          if (parts[4] === 'title' || parts[4] === 'role' || parts[4] === 'meta') {
            var patch = {};
            patch[parts[4]] = value;
            next = Form.setEntryHead(md, si, ei, patch);
          } else if (parts[4] === 'sub') next = Form.setEntrySub(md, si, ei, value);
          else if (parts[4] === 'bullet') next = Form.setBullet(md, si, ei, Number(parts[5]), value);
        } else if (parts[2] === 'bullet') {
          next = Form.setBullet(md, si, null, Number(parts[3]), value);
        } else if (parts[2] === 'cell') {
          next = Form.setTableCell(md, si, Number(parts[3]), Number(parts[4]), value);
        }
      }
      if (next && next !== md) apply(next, false);
      else if (!next) {
        // 操作没生效（理论上不该发生）：重绘一次，让输入框回到文档里的真实值，
        // 免得出现「框里有字、文档里没有」的静默不一致
        render();
      }
    });

    // 空着的「+ 添加联系方式」空位在失焦时收掉（blur 不冒泡，用捕获）
    container.addEventListener('blur', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute('data-path') !== 'contact-new' || String(t.value || '').trim()) return;
      var row = t.closest ? t.closest('.frow') : null;
      if (row && row.parentNode) row.parentNode.removeChild(row);
    }, true);

    render();
    return { render: render };
  }

  root.ResumeFormView = { mount: mount };
})(window);
