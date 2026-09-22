/*!
 * resume-md.js —— 轻量 Markdown → 简历 HTML 渲染引擎（零依赖，浏览器 / Node 通用）
 *
 * 语法约定（详见 README.md）：
 *   #  姓名            → 简历抬头（第一个 h1）
 *   ## 章节标题         → 章节
 *   ### 公司 · 职位 | 时间 → 条目（用 · 分隔主副标题，用 | 分隔右对齐的时间/地点）
 *   -  列表项           → 要点（支持两级缩进）
 *   | a | b |          → 表格
 *   ---                → 手动分页（*** 为分隔线）
 *   开头 --- ... ---    → 前置配置（模板 / 主色 / 字号 / 行距 / 页边距 / 字体）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ResumeMD = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ 常量 */

  var DEFAULTS = {
    template: 'classic',
    accent: '#2563eb',
    font: 'sans',
    fontSize: '14px',
    lineHeight: '1.65',
    margin: '16mm 18mm',
    photo: '',
    photoSize: '26mm',
    photoAlign: 'right',
    photoShape: 'rounded'
  };
  var TEMPLATES = ['classic', 'modern', 'compact', 'timeline', 'minimal', 'banner', 'sidebar'];
  var FONTS = ['sans', 'serif'];
  var PHOTO_ALIGNS = ['right', 'left'];
  var PHOTO_SHAPES = ['rounded', 'circle', 'square'];
  var MARGIN_PRESETS = [
    { label: '窄 (12mm / 14mm)', value: '12mm 14mm' },
    { label: '常规 (16mm / 18mm)', value: '16mm 18mm' },
    { label: '宽 (20mm / 22mm)', value: '20mm 22mm' }
  ];
  var ACCENT_PRESETS = ['#2563eb', '#0f766e', '#b91c1c', '#7c3aed', '#c2410c', '#111827'];
  var FRONT_KEYS = ['template', 'accent', 'font', 'fontSize', 'lineHeight', 'margin', 'photo', 'photoSize', 'photoAlign', 'photoShape'];
  var A4 = { width: 210, height: 297 }; // mm
  var MM_PER_PX = 25.4 / 96;
  var TOKEN = '\u0001';

  /* ------------------------------------------------------------------ 基础工具 */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toMm(value, unit) {
    var n = parseFloat(value);
    if (!isFinite(n)) return 0;
    switch (unit) {
      case 'cm': return n * 10;
      case 'in': return n * 25.4;
      case 'pt': return n * 25.4 / 72;
      case 'px': return n * MM_PER_PX;
      default: return n; // mm
    }
  }

  var LENGTH_RE = /^\s*(\d+(?:\.\d+)?)(mm|cm|in|pt|px)?\s*(?:(\d+(?:\.\d+)?)(mm|cm|in|pt|px)?)?\s*$/;

  function normalizeMargin(v) {
    var m = LENGTH_RE.exec(String(v == null ? '' : v));
    if (!m) return DEFAULTS.margin;
    var a = (m[1] || '') + (m[2] || 'mm');
    if (m[3] == null && m[4] == null) return a;
    return a + ' ' + ((m[3] || '') + (m[4] || m[2] || 'mm'));
  }

  /** 证件照只按宽度算，高度按图片自身比例 */
  function normalizePhotoSize(v) {
    var m = LENGTH_RE.exec(String(v == null ? '' : v));
    if (!m) return DEFAULTS.photoSize;
    return (m[1] || '') + (m[2] || 'mm');
  }

  /**
   * 只放行安全的证件照来源：内嵌 data URI、http(s)、file://、相对路径。
   * 另外允许直接写 Windows 绝对路径（D:\photos\me.jpg），会转成 file:///D:/photos/me.jpg。
   * 其它协议（javascript: 等）一律拒绝。
   */
  function sanitizePhoto(raw) {
    var u = String(raw == null ? '' : raw).trim().replace(/^["']|["']$/g, '');
    if (!u) return '';
    if (/^data:image\/(png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(u)) return u;
    if (/^https?:\/\//i.test(u)) return u;
    if (/^file:\/\//i.test(u)) return u;
    if (/^[a-z]:[\\/]/i.test(u)) return 'file:///' + u.replace(/\\/g, '/');
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '';
    return u;
  }

  function clampNum(v, min, max, dft) {
    var n = parseFloat(v);
    if (!isFinite(n)) return dft;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeSettings(meta) {
    meta = meta || {};
    var tpl = String(meta.template == null ? '' : meta.template).trim();
    var font = String(meta.font == null ? '' : meta.font).trim();
    var accent = String(meta.accent == null ? '' : meta.accent).trim();
    return {
      template: TEMPLATES.indexOf(tpl) >= 0 ? tpl : DEFAULTS.template,
      accent: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent) ? accent.toLowerCase() : DEFAULTS.accent,
      font: FONTS.indexOf(font) >= 0 ? font : DEFAULTS.font,
      fontSize: (Math.round(clampNum(meta.fontSize, 10, 20, 14) * 100) / 100) + 'px',
      lineHeight: String(Math.round(clampNum(meta.lineHeight, 1.15, 2.4, 1.65) * 100) / 100),
      margin: normalizeMargin(meta.margin),
      photo: sanitizePhoto(meta.photo),
      photoSize: normalizePhotoSize(meta.photoSize),
      photoAlign: PHOTO_ALIGNS.indexOf(String(meta.photoAlign || '').trim()) >= 0 ? String(meta.photoAlign).trim() : DEFAULTS.photoAlign,
      photoShape: PHOTO_SHAPES.indexOf(String(meta.photoShape || '').trim()) >= 0 ? String(meta.photoShape).trim() : DEFAULTS.photoShape
    };
  }

  /** 把 settings 拆成 { y, x } 两方向的毫米值，供预览分页计算使用 */
  function marginMm(settings) {
    var m = LENGTH_RE.exec(normalizeMargin((settings || {}).margin));
    if (!m) return { y: 16, x: 18 };
    var y = toMm(m[1], m[2] || 'mm');
    var x = (m[3] == null) ? y : toMm(m[3], m[4] || m[2] || 'mm');
    return { y: y, x: x };
  }

  /* ------------------------------------------------------------------ 行内语法 */

  function safeUrl(url) {
    var u = String(url == null ? '' : url).trim();
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (/^www\./i.test(u)) return 'https://' + u;
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(u)) return 'mailto:' + u;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return 'https://' + u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '#';   // 屏蔽 javascript: 等协议
    return u;
  }

  function inline(text) {
    if (text == null) return '';
    var bucket = [];
    function stash(html) {
      bucket.push(html);
      return TOKEN + (bucket.length - 1) + TOKEN;
    }

    var s = esc(text);

    // 1) 先把链接、图片、裸链接抽成占位符，避免后续规则破坏 href/src
    //    图片必须排在链接前面，否则 ![alt](url) 会被当成普通链接
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, src) {
      var u = sanitizePhoto(src);
      if (!u) return alt;   // 不安全的地址：退化成文字
      return stash('<img class="r-inline-img" src="' + esc(u) + '" alt="' + alt + '">');
    });
    s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, label, href) {
      return stash('<a href="' + esc(safeUrl(href)) + '" target="_blank" rel="noreferrer">' + label + '</a>');
    });
    s = s.replace(/(^|[\s(（【])((?:https?:\/\/|www\.)[^\s<)）】]+)/g, function (m, pre, url) {
      var tail = '';
      var trail = /[.,;:、。]+$/.exec(url);
      if (trail) { tail = trail[0]; url = url.slice(0, -tail.length); }
      return pre + stash('<a href="' + esc(safeUrl(url)) + '" target="_blank" rel="noreferrer">' + url + '</a>') + tail;
    });
    s = s.replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, function (m, mail) {
      return stash('<a href="mailto:' + mail + '">' + mail + '</a>');
    });

    // 2) 其余行内标记
    s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+?)~~/g, '<del>$1</del>');

    // 3) 还原占位符
    return s.replace(new RegExp(TOKEN + '(\\d+)' + TOKEN, 'g'), function (m, i) {
      return bucket[+i] || '';
    });
  }

  /** 联系方式：邮箱 / 网址 / 域名自动变成可点击链接，其余行内语法照常解析 */
  function contactHTML(text) {
    var t = String(text == null ? '' : text).trim();
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t)) return '<a href="mailto:' + t + '">' + esc(t) + '</a>';
    var m = /(https?:\/\/[^\s]+|www\.[^\s]+|[\w-]+\.(?:com|cn|net|org|io|dev|me|xyz|top|edu)(?:\/[^\s]*)?)/i.exec(t);
    if (!m) return inline(t);
    var url = m[1];
    var href = /^https?:/i.test(url) ? url : 'https://' + url;
    return inline(t.slice(0, m.index)) +
      '<a href="' + esc(href) + '" target="_blank" rel="noreferrer">' + esc(url) + '</a>' +
      inline(t.slice(m.index + url.length));
  }

  /* ------------------------------------------------------------------ 前置配置 */

  function splitFrontMatter(text) {
    var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
    if (!m) return { meta: {}, body: src, raw: null, extraLines: [] };
    var meta = {};
    var extraLines = [];
    m[1].split('\n').forEach(function (line) {
      // 只把「认识的键」收进 meta；注释、空行、中文键、自定义键一律原样保留，
      // 免得改写配置块时把它们悄悄删掉
      var kv = /^\s*([^\s:=][^:=]*?)\s*[:=]\s*(.*)$/.exec(line);
      var key = kv ? kv[1].trim() : '';
      if (kv && FRONT_KEYS.indexOf(key) >= 0) {
        meta[key] = kv[2].trim().replace(/^["']|["']$/g, '');
      } else {
        extraLines.push(line);
      }
    });
    while (extraLines.length && !extraLines[extraLines.length - 1].trim()) extraLines.pop();
    return { meta: meta, body: src.slice(m[0].length), raw: m[0], extraLines: extraLines };
  }

  function serializeFrontMatter(settings, extraLines) {
    var s = normalizeSettings(settings);
    // 没有证件照时不写 photo 相关几行，避免配置块里出现空键
    var photoKeys = { photo: 1, photoSize: 1, photoAlign: 1, photoShape: 1 };
    var lines = FRONT_KEYS.filter(function (k) {
      if (photoKeys[k]) return !!s.photo;
      return true;
    }).map(function (k) { return k + ': ' + s[k]; });
    (extraLines || []).forEach(function (line) { lines.push(line); });
    return '---\n' + lines.join('\n') + '\n---\n';
  }

  /** 更新（或补写）文首配置块，正文保持不变 */
  function upsertFrontMatter(md, patch) {
    var fm = splitFrontMatter(md);
    var settings = normalizeSettings(Object.assign({}, fm.meta, patch || {}));
    var body = fm.body.replace(/^\n+/, '');
    return serializeFrontMatter(settings, fm.extraLines) + '\n' + body;
  }

  /* ------------------------------------------------------------------ 块级解析 */

  var LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }

  function isTableSeparator(line) {
    if (!line) return false;
    var t = line.trim();
    if (t.indexOf('-') < 0) return false;
    if (!/^\|?[\s:|-]+\|?$/.test(t)) return false;
    return splitRow(t).every(function (c) { return /^:?-{2,}:?$/.test(c); });
  }

  function makeEntry(raw) {
    var text = String(raw).trim();
    var meta = '';
    var pipe = text.indexOf('|');
    if (pipe >= 0) {
      meta = text.slice(pipe + 1).trim();
      text = text.slice(0, pipe).trim();
    }
    var title = text;
    var subtitle = '';
    var dot = /\s+[·•‧・]\s*|\s*[·•‧・]\s+/.exec(text);
    if (dot) {
      title = text.slice(0, dot.index).trim();
      subtitle = text.slice(dot.index + dot[0].length).trim();
    }
    return { type: 'entry', title: title, subtitle: subtitle, meta: meta, sub: '', children: [] };
  }

  function buildList(items) {
    var base = Math.min.apply(null, items.map(function (i) { return i.indent; }));
    var root = { type: 'list', ordered: items[0].ordered, items: [] };
    var stack = [{ node: root, indent: base }];
    items.forEach(function (it) {
      while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) stack.pop();
      var top = stack[stack.length - 1];
      if (it.indent > top.indent && top.node.items.length) {
        var parent = top.node.items[top.node.items.length - 1];
        parent.children = parent.children || { type: 'list', ordered: it.ordered, items: [] };
        parent.children.items.push({ text: it.text, children: null });
        stack.push({ node: parent.children, indent: it.indent });
      } else {
        top.node.items.push({ text: it.text, children: null });
      }
    });
    return root;
  }

  function parseDocument(body) {
    var src = String(body == null ? '' : body).replace(/\r\n?/g, '\n');
    var lines = src.split('\n');
    var doc = { header: null, children: [] };
    var cur = { section: null, entry: null };

    function target() { return cur.entry || cur.section || doc; }
    function push(node) { target().children.push(node); }
    function ensureSection() {
      if (!cur.section) {
        cur.section = { type: 'section', title: '', children: [] };
        doc.children.push(cur.section);
      }
      return cur.section;
    }
    function headerLine(text) {
      if (!doc.header) doc.header = { name: '', subtitle: '', contacts: [] };
      var segs = text.split('|').map(function (s) { return s.trim(); }).filter(Boolean);
      if (segs.length > 1) {
        if (!doc.header.subtitle) doc.header.subtitle = segs.shift();
        segs.forEach(function (s) { doc.header.contacts.push(s); });
      } else if (segs.length === 1) {
        if (!doc.header.subtitle) doc.header.subtitle = segs[0];
        else doc.header.contacts.push(segs[0]);
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, '');
      var t = line.trim();
      if (!t) continue;

      // 分页 / 分隔线
      if (/^-{3,}$/.test(t) || /^\\(?:pagebreak|newpage)$/i.test(t)) { push({ type: 'pagebreak' }); continue; }
      if (/^([*_])\1{2,}$/.test(t)) { push({ type: 'hr' }); continue; }

      // 标题（允许空标题：`#` / `# ` / `##` —— 姓名被清空时不能退化成正文）
      var hm = /^(#{1,6})(?:\s+(.*?))?\s*#*$/.exec(t);
      if (hm) {
        var level = hm[1].length;
        var txt = (hm[2] || '').trim();
        if (level === 1) {
          doc.header = { name: txt, subtitle: '', contacts: [] };
          cur.section = null; cur.entry = null;
        } else if (level === 2) {
          cur.section = { type: 'section', title: txt, children: [] };
          cur.entry = null;
          doc.children.push(cur.section);
        } else if (level === 3) {
          var sec = ensureSection();
          cur.entry = makeEntry(txt);
          sec.children.push(cur.entry);
        } else {
          push({ type: 'subhead', text: txt });
        }
        continue;
      }

      // 引用
      if (/^>\s?/.test(t)) { push({ type: 'quote', text: t.replace(/^>\s?/, '') }); continue; }

      // 紧跟姓名的独立图片行 = 证件照（等价于配置块里的 photo:）
      var photoLine = /^!\[[^\]]*\]\(([^)\s]+)\)$/.exec(t);
      if (photoLine && doc.header && !cur.section && !cur.entry) {
        if (!doc.header.photo) doc.header.photo = photoLine[1];
        continue;
      }

      // 表格
      if (t.charAt(0) === '|' && isTableSeparator(lines[i + 1])) {
        var head = splitRow(t);
        var aligns = splitRow(lines[i + 1]).map(function (c) {
          if (/^:-+:$/.test(c)) return 'center';
          if (/-+:$/.test(c)) return 'right';
          return 'left';
        });
        var rows = [];
        var j = i + 2;
        while (j < lines.length && /^\s*\|/.test(lines[j])) { rows.push(splitRow(lines[j])); j++; }
        push({ type: 'table', head: head, aligns: aligns, rows: rows });
        i = j - 1;
        continue;
      }

      // 列表
      var lm = LIST_RE.exec(line);
      if (lm) {
        var items = [];
        while (i < lines.length) {
          var m2 = LIST_RE.exec(lines[i]);
          if (!m2) break;
          items.push({
            indent: m2[1].replace(/\t/g, '  ').length,
            ordered: /\d/.test(m2[2]),
            text: m2[3].trim()
          });
          i++;
        }
        i--;
        push(buildList(items));
        continue;
      }

      // 抬头信息 / 普通段落
      if (doc.header && !cur.section && !cur.entry) { headerLine(t); continue; }

      var entry = cur.entry;
      if (entry) {
        var hasList = entry.children.some(function (c) { return c.type === 'list'; });
        var looksMeta = /(\d{4}|至今|今|present)/i.test(t) || /[|｜]/.test(t) || /[·•‧・]/.test(t);
        if (!entry.sub && !hasList && looksMeta && t.length <= 80) {
          // 整行加粗的副信息（时间 / 地点 / 团队）去掉加粗标记，交给 .r-entry-sub 样式
          entry.sub = t.replace(/^\*\*(.+)\*\*$/, '$1').replace(/^__(.+)__$/, '$1');
          continue;
        }
      }
      push({ type: 'paragraph', text: t });
    }

    return doc;
  }

  /* ------------------------------------------------------------------ 渲染 */

  function renderList(list) {
    var ordered = list.ordered && list.items.every(function (i) { return /^\d/.test(i.text) || true; });
    var tag = list.ordered ? 'ol' : 'ul';
    var html = '<' + tag + ' class="r-list">';
    list.items.forEach(function (item) {
      html += '<li>' + inline(item.text);
      if (item.children) html += renderList(item.children);
      html += '</li>';
    });
    return html + '</' + tag + '>';
  }

  function renderTable(table) {
    var html = '<table class="r-table"><thead><tr>';
    table.head.forEach(function (c, idx) {
      html += '<th class="ta-' + (table.aligns[idx] || 'left') + '">' + inline(c) + '</th>';
    });
    html += '</tr></thead><tbody>';
    table.rows.forEach(function (row) {
      html += '<tr>';
      table.head.forEach(function (_, idx) {
        html += '<td class="ta-' + (table.aligns[idx] || 'left') + '">' + inline(row[idx] == null ? '' : row[idx]) + '</td>';
      });
      html += '</tr>';
    });
    return html + '</tbody></table>';
  }

  function renderEntry(entry) {
    var html = '<div class="r-entry">';
    html += '<div class="r-entry-head"><h3 class="r-entry-title">' + inline(entry.title);
    if (entry.subtitle) html += '<span class="r-entry-role">' + inline(entry.subtitle) + '</span>';
    html += '</h3>';
    if (entry.meta) html += '<span class="r-entry-meta">' + inline(entry.meta) + '</span>';
    html += '</div>';
    if (entry.sub) html += '<p class="r-entry-sub">' + inline(entry.sub) + '</p>';
    html += renderChildren(entry.children);
    return html + '</div>';
  }

  function renderChildren(nodes) {
    var html = '';
    (nodes || []).forEach(function (node) {
      switch (node.type) {
        case 'section':
          if (!node.title) { html += renderChildren(node.children); break; }
          html += '<section class="r-section"><h2 class="r-section-title"><span>' + inline(node.title) + '</span></h2>' +
            renderChildren(node.children) + '</section>';
          break;
        case 'entry':
          html += renderEntry(node);
          break;
        case 'list':
          html += renderList(node);
          break;
        case 'table':
          html += renderTable(node);
          break;
        case 'quote':
          html += '<blockquote class="r-quote">' + inline(node.text) + '</blockquote>';
          break;
        case 'paragraph':
          html += '<p class="r-paragraph">' + inline(node.text) + '</p>';
          break;
        case 'subhead':
          html += '<h4 class="r-subhead">' + inline(node.text) + '</h4>';
          break;
        case 'hr':
          html += '<hr class="r-hr">';
          break;
        case 'pagebreak':
          html += '<div class="page-break"><span>手动分页</span></div>';
          break;
        default:
          break;
      }
    });
    return html;
  }

  function renderHeader(header, settings) {
    var photo = sanitizePhoto(header.photo || (settings && settings.photo) || '');
    var html = '<header class="r-header">';
    html += '<div class="r-header-main">';
    if (header.name) html += '<h1 class="r-name">' + inline(header.name) + '</h1>';
    if (header.subtitle) html += '<p class="r-subtitle">' + inline(header.subtitle) + '</p>';
    if (header.contacts && header.contacts.length) {
      html += '<ul class="r-contacts">' + header.contacts.map(function (c) {
        return '<li>' + contactHTML(c) + '</li>';
      }).join('') + '</ul>';
    }
    html += '</div>';
    if (photo) html += '<img class="r-photo" src="' + esc(photo) + '" alt="证件照">';
    return html + '</header>';
  }

  function sheetClasses(settings, hasPhoto) {
    var cls = 'resume-sheet tpl-' + settings.template + ' font-' + settings.font;
    if (hasPhoto) {
      cls += ' has-photo photo-' + settings.photoAlign + ' shape-' + settings.photoShape;
    }
    return cls;
  }

  function styleVars(settings) {
    var mm = marginMm(settings);
    return [
      '--r-accent: ' + settings.accent,
      '--r-font-size: ' + settings.fontSize,
      '--r-line-height: ' + settings.lineHeight,
      '--r-margin-y: ' + mm.y + 'mm',
      '--r-margin-x: ' + mm.x + 'mm',
      '--r-photo-w: ' + settings.photoSize
    ].join('; ');
  }

  function pageRule(settings) {
    return '@page { size: A4; margin: ' + normalizeMargin(settings.margin) + '; }';
  }

  /* ------------------------------------------------------------------ 对外 API */

  function renderResume(md, overrides) {
    var fm = splitFrontMatter(md);
    var settings = normalizeSettings(Object.assign({}, fm.meta, overrides || {}));
    var doc = parseDocument(fm.body);
    var hasPhoto = !!(settings.photo || (doc.header && doc.header.photo));
    var html = (doc.header ? renderHeader(doc.header, settings) : '') + renderChildren(doc.children);

    var plain = fm.body
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[#*`>_~|\-]/g, '')
      .replace(/\s/g, '');
    var stats = {
      chars: plain.length,
      sections: (html.match(/class="r-section"/g) || []).length,
      entries: (html.match(/class="r-entry"/g) || []).length,
      bullets: (html.match(/<li>/g) || []).length,
      manualBreaks: (html.match(/class="page-break"/g) || []).length,
      hasPhoto: hasPhoto
    };

    return {
      html: html,
      settings: settings,
      meta: fm.meta,
      header: doc.header,
      doc: doc,
      stats: stats,
      hasPhoto: hasPhoto,
      sheetClasses: sheetClasses(settings, hasPhoto),
      style: styleVars(settings)
    };
  }

  /** 生成一个完整、可独立打开（也可被无头浏览器打印）的 HTML 文档 */
  function toDocumentHTML(md, options) {
    options = options || {};
    var r = renderResume(md, options.settings);
    var title = options.title || (r.header && r.header.name) || '简历';
    var css = options.css || '';
    var preview = !!options.preview;
    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + esc(title) + '</title>\n' +
      '<style>\n' + pageRule(r.settings) + '\n' +
      'html, body { margin: 0; padding: 0; background: #fff; }\n' +
      (preview ? '' : 'body.resume-export .resume-sheet { width: auto; min-height: 0; padding: 0; margin: 0; box-shadow: none; border-radius: 0; }\n') +
      css + '\n</style>\n</head>\n<body class="' + (preview ? 'resume-preview' : 'resume-export') + '">\n' +
      '<article class="' + r.sheetClasses + '" style="' + r.style + '">' + r.html + '</article>\n' +
      '</body>\n</html>\n';
  }

  return {
    DEFAULTS: DEFAULTS,
    TEMPLATES: TEMPLATES,
    FONTS: FONTS,
    MARGIN_PRESETS: MARGIN_PRESETS,
    PHOTO_ALIGNS: PHOTO_ALIGNS,
    PHOTO_SHAPES: PHOTO_SHAPES,
    ACCENT_PRESETS: ACCENT_PRESETS,
    FRONT_KEYS: FRONT_KEYS,
    A4: A4,
    MM_PER_PX: MM_PER_PX,
    esc: esc,
    inline: inline,
    sanitizePhoto: sanitizePhoto,
    normalizePhotoSize: normalizePhotoSize,
    splitFrontMatter: splitFrontMatter,
    serializeFrontMatter: serializeFrontMatter,
    upsertFrontMatter: upsertFrontMatter,
    normalizeSettings: normalizeSettings,
    normalizeMargin: normalizeMargin,
    marginMm: marginMm,
    parseDocument: parseDocument,
    renderResume: renderResume,
    toDocumentHTML: toDocumentHTML,
    pageRule: pageRule
  };
});
