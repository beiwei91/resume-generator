#!/usr/bin/env node
/**
 * tools/make-sample-photo.mjs —— 生成一张示例证件照素材（占位人像，非真人）
 *
 * 产物：assets/sample-photo.png（200×280，约 1:1.4 的证件照比例）
 * 用途：想试「证件照」功能时可以直接拿它当素材；测试里也用它验证照片能进 PDF。
 *
 * 用法：node tools/make-sample-photo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'sample-photo.png');

const W = 200;
const H = 280;
const SS = 3;   // 超采样，边缘平滑

const BG_TOP = [238, 242, 247];
const BG_BOTTOM = [214, 224, 236];
const SKIN = [154, 167, 184];
const CLOTH = [120, 136, 158];

function insideEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const cx = Math.min(Math.max(x, x0 + rr), x1 - rr);
  const cy = Math.min(Math.max(y, y0 + rr), y1 - rr);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rr * rr;
}

const rgba = Buffer.alloc(W * H * 4);
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    let r = 0, g = 0, b = 0, covered = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS;
        const y = py + (sy + 0.5) / SS;
        const t = y / H;
        let col = [
          BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
          BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
          BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t
        ];
        // 肩膀/上身
        if (inRoundRect(x, y, 42, 186, 158, 300, 46)) col = CLOTH;
        // 脖子
        if (inRoundRect(x, y, 86, 158, 114, 200, 12)) col = [138, 152, 170];
        // 头
        if (insideEllipse(x, y, 100, 116, 45, 54)) col = SKIN;
        // 头发
        if (insideEllipse(x, y, 100, 96, 47, 44) && y < 112) col = [86, 100, 120];
        r += col[0]; g += col[1]; b += col[2]; covered++;
      }
    }
    const total = SS * SS;
    const i = (py * W + px) * 4;
    rgba[i] = Math.round(r / covered);
    rgba[i + 1] = Math.round(g / covered);
    rgba[i + 2] = Math.round(b / covered);
    rgba[i + 3] = Math.round((covered / total) * 255);
  }
}

const png = encodePNG(W, H, rgba);
fs.writeFileSync(OUT, png);

const dataUri = 'data:image/png;base64,' + png.toString('base64');
console.log('✓ 示例证件照已生成：' + path.relative(ROOT, OUT));
console.log('  ' + W + '×' + H + '  ' + (png.length / 1024).toFixed(1) + ' KB' +
  '（转成内嵌 data URI 约 ' + (dataUri.length / 1024).toFixed(1) + ' KB）');
