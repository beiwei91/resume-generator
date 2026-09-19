/*!
 * resume-form.js —— 表单模式的「纯逻辑层」：把 Markdown 拆成模块，并按块改写
 *
 * 这里只有字符串与行号运算，不碰 DOM，因此可以在 Node 里直接单测。
 * 设计要点：每次编辑只重写「那一块」对应的行，其余内容（包括文首配置块、手工排版）
 * 一个字节都不动 —— 表单模式和 Markdown 模式因此可以安全地随时互换。
 *
 * 约定（与 resume-md.js 的解析规则一致）：
 *   # 姓名                     抬头（第一个 # 标题）
 *   （紧跟姓名的行）             职位 | 联系方式…
 *   ## 章节                    章节
 *   ### 主标题 · 职位 | 时间     条目
 *   （条目下第一段）            副信息
 *   - 要点 /   - 子要点          要点（两个空格缩进为二级）
 *   | a | b |                  表格
 *   > 引用                     引用块（个人简介常用）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./resume-md.js'));
  else root.ResumeForm = factory(root.ResumeMD);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MD) {
  'use strict';

  var HEAD_RE = /^(#{1,6})\s+(.*?)\s*#*$/;
  var LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  var SECTION_TEMPLATES = [
    { title: '工作经历', kind: 'entries' },
    { title: '项目经历', kind: 'entries' },
    { title: '实习经历', kind: 'entries' },
    { title: '教育背景', kind: 'entries' },
    { title: '技能清单', kind: 'list' },
    { title: '证书与荣誉', kind: 'list' },
    { title: '自我评价', kind: 'quote' },
    { title: '其他信息', kind: 'list' }
  ];

  function isTableSeparator(line) {
    if (!line) return false;
    var t = line.trim();
    if (t.charAt(0) !== '|' || t.indexOf('-') < 0) return false;
    return /^\|?[\s:|-]+\|?$/.test(t);
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }

  /* ------------------------------------------------------------------ 解析 */

  /** 把 Markdown 拆成「文首配置块 + 抬头 + 章节列表」，并保留每块的行号信息 */
  function walk(md) {
    var src = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
    var fm = MD.splitFrontMatter(src);
    var prefix = src.slice(0, src.length - fm.body.length);   // 含收尾换行；无配置块时为 ''
    var prefixLines = prefix ? prefix.split('\n').length - 1 : 0;
    var lines = fm.body.split('\n');

    var header = { nameIdx: -1, name: '', info: { subtitle: '', contacts: [] }, infoIdx: [], photoIdx: -1, start: 0 };
    var sections = [];
    var i;

    // 抬头：第一个 # 标题 + 其后直到首个 ## 的正文行
    var firstSectionIdx = -1;
    for (i = 0; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) { firstSectionIdx = i; break; }
    }
    var headerEnd = firstSectionIdx < 0 ? lines.length : firstSectionIdx;

    for (i = 0; i < headerEnd; i++) {
      var hm = HEAD_RE.exec(lines[i].trim());
      if (hm && hm[1].length === 1) {
        header.nameIdx = i;
        header.name = hm[2].trim();
        break;
      }
    }

    if (header.nameIdx >= 0) {
      var segs = [];
      for (i = header.nameIdx + 1; i < headerEnd; i++) {
        if (!lines[i].trim()) continue;
        if (HEAD_RE.test(lines[i].trim())) continue;
        // 姓名下一行的「独立图片」是证件照（与渲染引擎的约定一致），不能当成抬头信息，
        // 否则表单会把它显示成职位/联系方式，一编辑就把照片那行冲掉
        if (/^!\[[^\]]*\]\([^)\s]+\)$/.test(lines[i].trim())) { header.photoIdx = i; continue; }
        header.infoIdx.push(i);
        segs = segs.concat(lines[i].split('|').map(function (s) { return s.trim(); }).filter(Boolean));
      }
      if (segs.length) {
        header.info.subtitle = segs[0];
        header.info.contacts = segs.slice(1);
      }
    }

    // 章节
    for (i = 0; i < lines.length; i++) {
      if (!/^##\s/.test(lines[i])) continue;
      var sm = HEAD_RE.exec(lines[i].trim());
      var start = i;
      var end = lines.length;
      for (var j = i + 1; j < lines.length; j++) {
        if (/^##\s/.test(lines[j])) { end = j; break; }
      }
      sections.push(buildSection(lines, start, end, sm ? sm[2].trim() : ''));
      i = end - 1;
    }

    return { prefix: prefix, prefixLines: prefixLines, lines: lines, header: header, sections: sections };
  }

  function buildSection(lines, start, end, title) {
    var sec = { titleIdx: start, title: title, start: start, end: end, kind: 'empty', entries: [], items: [], table: null, text: '', quote: false };

    // 条目（### 开头）
    var headIdxs = [];
    for (var i = start + 1; i < end; i++) {
      var hm = HEAD_RE.exec(lines[i].trim());
      if (hm && hm[1].length === 3) headIdxs.push(i);
    }
    if (headIdxs.length) {
      sec.kind = 'entries';
      for (var k = 0; k < headIdxs.length; k++) {
        var eStart = headIdxs[k];
        var eEnd = k + 1 < headIdxs.length ? headIdxs[k + 1] : end;
        sec.entries.push(buildEntry(lines, eStart, eEnd));
      }
      return sec;
    }

    // 表格
    var tableIdx = -1;
    for (var t = start + 1; t < end - 1; t++) {
      if (lines[t].trim().charAt(0) === '|' && isTableSeparator(lines[t + 1])) { tableIdx = t; break; }
    }
    if (tableIdx >= 0) {
      sec.kind = 'table';
      var rows = [splitRow(lines[tableIdx])];
      var r = tableIdx + 2;
      while (r < end && lines[r].trim().charAt(0) === '|') { rows.push(splitRow(lines[r])); r++; }
      sec.table = { headIdx: tableIdx, rows: rows, separator: lines[tableIdx + 1], endIdx: r };
      return sec;
    }

    // 要点列表
    var items = collectBullets(lines, start + 1, end);
    if (items.length) {
      sec.kind = 'list';
      sec.items = items;
      return sec;
    }

    // 段落 / 引用
    var texts = [];
    var quote = false;
    for (var p = start + 1; p < end; p++) {
      if (!lines[p].trim()) continue;
      if (/^>\s?/.test(lines[p].trim())) { quote = true; texts.push(lines[p].trim().replace(/^>\s?/, '')); }
      else texts.push(lines[p].trim());
    }
    if (texts.length) {
      sec.kind = quote ? 'quote' : 'paragraph';
      sec.quote = quote;
      sec.text = texts.join('\n');
    }
    return sec;
  }

  function buildEntry(lines, start, end) {
    var raw = HEAD_RE.exec(lines[start].trim())[2].trim();
    var meta = '';
    var pipe = raw.indexOf('|');
    if (pipe >= 0) { meta = raw.slice(pipe + 1).trim(); raw = raw.slice(0, pipe).trim(); }
    var title = raw;
    var role = '';
    var dot = /\s*[·•‧・]\s*/.exec(raw);
    if (dot) {
      title = raw.slice(0, dot.index).trim();
      role = raw.slice(dot.index + dot[0].length).trim();
    }

    var entry = { headIdx: start, start: start, end: end, title: title, role: role, meta: meta, sub: '', subIdx: -1, bullets: [] };
    // 副信息：条目下、第一个要点之前的那一段
    for (var i = start + 1; i < end; i++) {
      var line = lines[i];
      if (!line.trim()) continue;
      if (LIST_RE.test(line)) break;
      if (HEAD_RE.test(line.trim())) break;
      entry.subIdx = i;
      entry.sub = line.trim().replace(/^\*\*(.+)\*\*$/, '$1');
      break;
    }
    entry.bullets = collectBullets(lines, start + 1, end);
    return entry;
  }

  function collectBullets(lines, from, to) {
    var out = [];
    for (var i = from; i < to; i++) {
      var m = LIST_RE.exec(lines[i]);
      if (!m) continue;
      if (HEAD_RE.test(lines[i].trim())) continue;
      out.push({ idx: i, indent: m[1].replace(/\t/g, '  ').length, text: m[3].trim() });
    }
    return out;
  }

  /* ------------------------------------------------------------------ 拼装 */

  function headText(level, text) {
    return new Array(level + 1).join('#') + ' ' + String(text == null ? '' : text).trim();
  }

  function entryHeadText(entry) {
    var raw = String(entry.title == null ? '' : entry.title).trim();
    if (String(entry.role || '').trim()) raw += ' · ' + String(entry.role).trim();
    if (String(entry.meta || '').trim()) raw += ' | ' + String(entry.meta).trim();
    return '### ' + raw;
  }

  /** 从某一行开始，往后吃掉属于同一块的续行（更深的列表项、缩进的续行） */
  function blockRange(lines, idx, limit) {
    var m = LIST_RE.exec(lines[idx]);
    if (!m) return [idx, idx + 1];
    var indent = m[1].replace(/\t/g, '  ').length;
    var end = idx + 1;
    while (end < limit) {
      var line = lines[end];
      if (!line.trim()) break;
      var nm = LIST_RE.exec(line);
      if (nm) {
        if (nm[1].replace(/\t/g, '  ').length <= indent) break;
      } else if (!/^\s/.test(line)) {
        break;
      }
      end++;
    }
    return [idx, end];
  }

  /** 去掉块尾的空行（块首不动），用于交换两块时保持空行分隔 */
  function trimEnd(lines, start, end) {
    var e = end;
    while (e > start + 1 && !lines[e - 1].trim()) e--;
    return e;
  }

  /** 交换两个前后相邻的块（A 在前、B 在后），中间的空行原样保留 */
  function swapBlocks(lines, aStart, aEnd, bStart, bEnd) {
    return lines.slice(0, aStart)
      .concat(lines.slice(bStart, bEnd), lines.slice(aEnd, bStart), lines.slice(aStart, aEnd), lines.slice(bEnd));
  }

  /* ------------------------------------------------------------------ 改写操作 */

  function withBody(md, fn) {
    var w = walk(md);
    var out = fn(w.lines.slice(), w);
    if (!out) return md;
    return w.prefix + out.join('\n');
  }

  function sec(w, i) { return w.sections[i] || null; }

  var ops = {
    walk: walk,

    setHeaderName: function (md, name) {
      return withBody(md, function (lines, w) {
        if (w.header.nameIdx < 0) return null;
        lines[w.header.nameIdx] = headText(1, name) || '# ';
        return lines;
      });
    },

    /** 职位 + 联系方式合并写在姓名下一行（与解析约定一致） */
    setHeaderInfo: function (md, info) {
      return withBody(md, function (lines, w) {
        if (w.header.nameIdx < 0) return null;
        var segs = [];
        if (String(info.subtitle || '').trim()) segs.push(String(info.subtitle).trim());
        (info.contacts || []).forEach(function (c) { if (String(c || '').trim()) segs.push(String(c).trim()); });

        // 没有内容要写、原本也没有抬头行：保持原样（否则每次敲键盘都会重排文档空白）
        if (!segs.length && !w.header.infoIdx.length) return null;

        var out = lines.slice();
        var idx = w.header.infoIdx.slice();
        var text = segs.join(' | ');

        if (idx.length) {
          // 只动抬头那几行：姓名下的证件照行必须原样留着（否则一改职位就把照片删了）
          if (segs.length) out[idx[0]] = text;
          for (var i = idx.length - 1; i >= (segs.length ? 1 : 0); i--) out.splice(idx[i], 1);
          return out;
        }

        // 原本没有抬头行 —— 插到证件照行之后（没有照片就紧跟姓名）
        var at = (w.header.photoIdx >= 0 ? w.header.photoIdx : w.header.nameIdx) + 1;
        var block = [];
        if (out[at - 1] && out[at - 1].trim()) block.push('');
        block.push(text);
        var after = out.slice(at);
        while (after.length && !after[0].trim()) after.shift();
        return out.slice(0, at).concat(block, [''], after);
      });
    },

    setSectionTitle: function (md, si, title) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s) return null;
        lines[s.titleIdx] = headText(2, title);
        return lines;
      });
    },

    /** 新增章节：kind = entries | list | quote | paragraph */
    addSection: function (md, title, kind) {
      return withBody(md, function (lines) {
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        var block = ['', '', headText(2, title || '新章节'), ''];
        if (kind === 'entries') block = block.concat(['### 公司名称 · 职位 | 2021.06 – 至今', '', '- 做了什么，结果如何（用数字量化）', '']);
        else if (kind === 'list') block = block.concat(['- 要点内容', '']);
        else if (kind === 'quote') block = block.concat(['> 一句话介绍你的核心竞争力与代表成果', '']);
        else block = block.concat(['在这里写正文', '']);
        return lines.concat(block, ['']);
      });
    },

    removeSection: function (md, si) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s) return null;
        var start = s.start;
        var end = s.end;
        while (start > 0 && !lines[start - 1].trim()) start--;
        while (end < lines.length && !lines[end].trim()) end++;
        var out = lines.slice(0, start).concat(lines.slice(end));
        while (out.length > 1 && !out[out.length - 1].trim() && !out[out.length - 2].trim()) out.pop();
        return out;
      });
    },

    moveSection: function (md, si, dir) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s) return null;
        var other = si + dir;
        var a = w.sections[Math.min(si, other)];
        var b = w.sections[Math.max(si, other)];
        if (!a || !b) return null;
        return swapBlocks(lines, a.start, trimEnd(lines, a.start, a.end), b.start, trimEnd(lines, b.start, b.end));
      });
    },

    addEntry: function (md, si, afterEntry) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s) return null;
        var block = [headText(3, '公司名称 · 职位 | 2021.06 – 至今'), '', '- 做了什么，结果如何（用数字量化）', ''];
        var at;
        if (afterEntry == null || !s.entries[afterEntry]) {
          at = s.kind === 'entries' && s.entries.length ? s.entries[s.entries.length - 1].end : s.start + 1;
        } else {
          at = s.entries[afterEntry].end;
        }
        while (at < lines.length && !lines[at].trim()) at++;
        var insert = block.slice();
        if (at > 0 && lines[at - 1].trim()) insert = [''].concat(insert);
        return lines.slice(0, at).concat(insert, lines.slice(at));
      });
    },

    removeEntry: function (md, si, ei) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s || !s.entries[ei]) return null;
        var e = s.entries[ei];
        var start = e.start;
        var end = e.end;
        while (end > start && !lines[end - 1].trim()) end--;
        if (end === start) end = start + 1;
        if (start > 0 && !lines[start - 1].trim()) start--;
        return lines.slice(0, start).concat(lines.slice(end));
      });
    },

    moveEntry: function (md, si, ei, dir) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s || !s.entries[ei]) return null;
        var other = ei + dir;
        var a = s.entries[Math.min(ei, other)];
        var b = s.entries[Math.max(ei, other)];
        if (!a || !b) return null;
        return swapBlocks(lines, a.start, trimEnd(lines, a.start, a.end), b.start, trimEnd(lines, b.start, b.end));
      });
    },

    setEntryHead: function (md, si, ei, patch) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s || !s.entries[ei]) return null;
        var e = s.entries[ei];
        var next = { title: patch.title !== undefined ? patch.title : e.title, role: patch.role !== undefined ? patch.role : e.role, meta: patch.meta !== undefined ? patch.meta : e.meta };
        lines[e.headIdx] = entryHeadText(next);
        return lines;
      });
    },

    setEntrySub: function (md, si, ei, text) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s || !s.entries[ei]) return null;
        var e = s.entries[ei];
        var value = String(text == null ? '' : text).trim();
        if (e.subIdx >= 0) {
          if (!value) {
            var out = lines.slice(0, e.subIdx).concat(lines.slice(e.subIdx + 1));
            return out;
          }
          lines[e.subIdx] = value;
          return lines;
        }
        if (!value) return null;
        var at = e.headIdx + 1;
        if (lines[at] && lines[at].trim()) return lines.slice(0, at).concat(['', value], lines.slice(at));
        if (!lines[at]) return lines.slice(0, at).concat([value, ''], lines.slice(at + 1));
        return lines.slice(0, at).concat([value], lines.slice(at));
      });
    },

    setBullet: function (md, si, ei, bi, text) {
      return withBody(md, function (lines, w) {
        var b = bulletAt(w, si, ei, bi);
        if (!b) return null;
        var indent = new Array(b.indent + 1).join(' ');
        lines[b.idx] = indent + '- ' + String(text == null ? '' : text).trim();
        return lines;
      });
    },

    addBullet: function (md, si, ei, afterBi) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s) return null;
        var list = ei == null ? s.items : (s.entries[ei] ? s.entries[ei].bullets : null);
        if (!list) return null;
        var indent = 0;
        var at;
        if (afterBi != null && list[afterBi]) {
          indent = list[afterBi].indent;
          at = blockRange(lines, list[afterBi].idx, s.end)[1];
        } else if (list.length) {
          indent = list[list.length - 1].indent;
          at = blockRange(lines, list[list.length - 1].idx, s.end)[1];
        } else {
          at = (ei != null && s.entries[ei] && s.entries[ei].subIdx >= 0) ? s.entries[ei].subIdx + 1
            : (ei != null && s.entries[ei] ? s.entries[ei].headIdx + 1 : s.start + 1);
          if (lines[at] && !lines[at].trim()) at++;
        }
        while (at < lines.length && !lines[at].trim()) at++;
        var line = new Array(indent + 1).join(' ') + '- ';
        return lines.slice(0, at).concat([line], lines.slice(at));
      });
    },

    /** 在指定要点下面加一条子要点（二级缩进，插在该要点所有子项之后） */
    addSubBullet: function (md, si, ei, afterBi) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s) return null;
        var list = ei == null ? s.items : (s.entries[ei] ? s.entries[ei].bullets : null);
        if (!list || !list.length) return null;
        var target = (afterBi != null && list[afterBi]) ? list[afterBi] : list[list.length - 1];
        var indent = target.indent + 2;
        var at = blockRange(lines, target.idx, s.end)[1];
        var line = new Array(indent + 1).join(' ') + '- ';
        return lines.slice(0, at).concat([line], lines.slice(at));
      });
    },

    removeBullet: function (md, si, ei, bi) {
      return withBody(md, function (lines, w) {
        var b = bulletAt(w, si, ei, bi);
        if (!b) return null;
        var range = blockRange(lines, b.idx, lines.length);
        return lines.slice(0, range[0]).concat(lines.slice(range[1]));
      });
    },

    moveBullet: function (md, si, ei, bi, dir) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s) return null;
        var list = ei == null ? s.items : (s.entries[ei] ? s.entries[ei].bullets : null);
        if (!list) return null;
        var other = bi + dir;
        var a = list[Math.min(bi, other)];
        var b = list[Math.max(bi, other)];
        if (!a || !b) return null;
        var aR = blockRange(lines, a.idx, s.end);
        var bR = blockRange(lines, b.idx, s.end);
        return swapBlocks(lines, aR[0], aR[1], bR[0], bR[1]);
      });
    },

    /** 段落 / 引用整块替换（引用会保留 > 前缀）；只对这两种章节生效，避免误清列表或表格 */
    setSectionText: function (md, si, text) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s) return null;
        if (s.kind !== 'quote' && s.kind !== 'paragraph' && s.kind !== 'empty') return null;
        var value = String(text == null ? '' : text);
        var block = value.split('\n').map(function (l) {
          return s.quote ? ('> ' + l).replace(/\s+$/, '') : l;
        });
        if (s.quote) {
          while (block.length && !block[block.length - 1].replace(/^>\s?/, '').trim()) block.pop();
        }
        var head = lines.slice(0, s.start + 1);
        var tail = lines.slice(s.end);
        while (tail.length && !tail[0].trim()) tail.shift();
        return head.concat([''], block, [''], tail);
      });
    },

    setTableCell: function (md, si, ri, ci, value) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s || !s.table) return null;
        var t = s.table;
        var lineIdx = t.headIdx + (ri === 0 ? 0 : ri + 1);
        if (lineIdx >= lines.length) return null;
        var row = splitRow(lines[lineIdx]);
        while (row.length <= ci) row.push('');
        row[ci] = String(value == null ? '' : value).trim();
        lines[lineIdx] = '| ' + row.join(' | ') + ' |';
        return lines;
      });
    },

    addTableRow: function (md, si) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s || !s.table) return null;
        var cols = s.table.rows[0].length;
        var row = [];
        for (var i = 0; i < cols; i++) row.push('');
        return lines.slice(0, s.table.endIdx).concat(['| ' + row.join(' | ') + ' |'], lines.slice(s.table.endIdx));
      });
    },

    removeTableRow: function (md, si, ri) {
      return withBody(md, function (lines, w) {
        var s = sec(w, si);
        if (!s || !s.table || ri === 0) return null;
        if (!s.table.rows[ri]) return null;
        var lineIdx = s.table.headIdx + ri + 1;
        return lines.slice(0, lineIdx).concat(lines.slice(lineIdx + 1));
      });
    }
  };

  function bulletAt(w, si, ei, bi) {
    var s = sec(w, si);
    if (!s) return null;
    var list = ei == null ? s.items : (s.entries[ei] ? s.entries[ei].bullets : null);
    return list && list[bi] ? list[bi] : null;
  }

  return {
    walk: walk,
    SECTION_TEMPLATES: SECTION_TEMPLATES,
    setHeaderName: ops.setHeaderName,
    setHeaderInfo: ops.setHeaderInfo,
    setSectionTitle: ops.setSectionTitle,
    addSection: ops.addSection,
    removeSection: ops.removeSection,
    moveSection: ops.moveSection,
    addEntry: ops.addEntry,
    removeEntry: ops.removeEntry,
    moveEntry: ops.moveEntry,
    setEntryHead: ops.setEntryHead,
    setEntrySub: ops.setEntrySub,
    setBullet: ops.setBullet,
    addBullet: ops.addBullet,
    addSubBullet: ops.addSubBullet,
    removeBullet: ops.removeBullet,
    moveBullet: ops.moveBullet,
    setSectionText: ops.setSectionText,
    setTableCell: ops.setTableCell,
    addTableRow: ops.addTableRow,
    removeTableRow: ops.removeTableRow
  };
});
