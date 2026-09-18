#!/usr/bin/env node
/**
 * tools/make-icons.mjs —— 生成应用图标（零依赖，自写 PNG 编码器 + 3 倍超采样抗锯齿）
 *
 * 产物（assets/icons/）：
 *   icon-192.png              PWA 图标
 *   icon-256.png              快捷方式用
 *   icon-512.png              PWA 大图标
 *   icon-maskable-512.png     Android / Windows 蒙版图标（内容留安全区）
 *   resume.ico                桌面快捷方式图标（内嵌 256px PNG）
 *
 * 用法：node tools/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'icons');

/* ------------------------------------------------------------------ 绘制 */

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const BG_TOP = hex('#3b82f6');
const BG_BOTTOM = hex('#1d4ed8');
const SHEET = [255, 255, 255];
const BAR = hex('#2563eb');
const LINE_A = [203, 213, 225];
const LINE_B = [226, 232, 240];

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const cx = Math.min(Math.max(x, x0 + rr), x1 - rr);
  const cy = Math.min(Math.max(y, y0 + rr), y1 - rr);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rr * rr;
}

/** 简历纸张 + 文字行，画在渐变底色的圆角方块上 */
function render(size, maskable) {
  const SS = 3;                                  // 超采样倍数
  const rgba = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.76 : 1;             // maskable 需要留出安全区
  const off = (1 - scale) / 2;
  const S = (v) => off + v * scale;
  const bgRadius = maskable ? 0 : 0.22;

  const rows = [
    [0.335, 0.665, 0.275, 0.325, BAR, 0.025],    // 姓名条（主色）
    [0.335, 0.665, 0.395, 0.435, LINE_A, 0.02],
    [0.335, 0.665, 0.485, 0.525, LINE_B, 0.02],
    [0.335, 0.575, 0.575, 0.615, LINE_A, 0.02],
    [0.335, 0.620, 0.665, 0.705, LINE_B, 0.02]
  ];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          let col = null;
          if (inRoundRect(x, y, 0, 0, 1, 1, bgRadius)) {
            col = mix(BG_TOP, BG_BOTTOM, Math.min(1, Math.max(0, x * 0.35 + y * 0.65)));
            if (inRoundRect(x, y, S(0.255), S(0.165), S(0.745), S(0.835), 0.055 * scale)) col = SHEET;
            for (let k = 0; k < rows.length; k++) {
              const row = rows[k];
              if (inRoundRect(x, y, S(row[0]), S(row[2]), S(row[1]), S(row[3]), row[5] * scale)) col = row[4];
            }
          }
          if (col) {
            r += col[0]; g += col[1]; b += col[2]; covered++;
          }
        }
      }
      const total = SS * SS;
      const i = (py * size + px) * 4;
      if (covered) {
        rgba[i] = Math.round(r / covered);
        rgba[i + 1] = Math.round(g / covered);
        rgba[i + 2] = Math.round(b / covered);
        rgba[i + 3] = Math.round((covered / total) * 255);
      }
    }
  }
  return encodePNG(size, size, rgba);
}

/** ICO：单张 PNG 压缩的 256×256 图标（Vista+ 支持） */
function makeIco(png) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);   // reserved
  dir.writeUInt16LE(1, 2);   // type: icon
  dir.writeUInt16LE(1, 4);   // count
  const entry = Buffer.alloc(16);
  entry[0] = 0;              // width 0 = 256
  entry[1] = 0;              // height 0 = 256
  entry[2] = 0;              // palette
  entry[3] = 0;              // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6);// bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([dir, entry, png]);
}

/* ------------------------------------------------------------------ 输出 */

fs.mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, false],
  ['icon-256.png', 256, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true]
];

const written = [];
for (const [name, size, maskable] of targets) {
  const png = render(size, maskable);
  fs.writeFileSync(path.join(OUT, name), png);
  written.push([name, size, png.length]);
}

const icoPng = render(256, false);
fs.writeFileSync(path.join(OUT, 'resume.ico'), makeIco(icoPng));
written.push(['resume.ico', 256, fs.statSync(path.join(OUT, 'resume.ico')).size]);

console.log('图标已生成到 ' + path.relative(ROOT, OUT) + '：');
for (const [name, size, bytes] of written) {
  console.log('  ' + name.padEnd(24) + size + '×' + size + '  ' + (bytes / 1024).toFixed(1) + ' KB');
}
