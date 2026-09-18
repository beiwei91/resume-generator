#!/usr/bin/env node
/**
 * server.js —— 零依赖本地静态服务器
 *
 * 用法：node server.js [--port 5173] [--exit-after 60]
 *
 * 几个刻意为之的设计：
 *   - 只监听 127.0.0.1：外面访问不到，纯本机工具；
 *   - 写 .server.json（含端口 / PID）并每 5 秒刷新修改时间当心跳，
 *     供「启动简历生成器.vbs」判断服务是否在跑（不依赖 WMI）；
 *   - /__alive 是一条 SSE 长连接，页面开着就连着。**最后一个窗口关掉后，
 *     默认 60 秒自动退出**，不会留下看不见的后台进程；--exit-after 0 可关掉这个行为；
 *   - /__shutdown 可以让页面上的「退出服务」按钮立刻停掉服务，
 *     必须带 /__info 里下发的随机令牌（跨站页面读不到它，防误触/防被别的网页调用）。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, '.server.json');

function readArg(name, fallback) {
  const args = process.argv.slice(2);
  const hit = args.find((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return fallback;
  const v = hit.includes('=') ? hit.split('=')[1] : args[args.indexOf(hit) + 1];
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

const PORT = readArg('port', Number(process.env.PORT) || 5173);
const EXIT_AFTER = Math.max(0, readArg('exit-after', 60));   // 秒；0 = 不自动退出
const TOKEN = crypto.randomBytes(16).toString('hex');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf'
};

/* ------------------------------------------------------------------ 窗口连接与自动退出 */

const windows = new Set();      // 打开着的页面（SSE 连接）
let sawAWindow = false;         // 是否曾经有窗口连上来
let exitTimer = null;

function cancelAutoExit() {
  if (exitTimer) {
    clearTimeout(exitTimer);
    exitTimer = null;
  }
}

function armAutoExit() {
  cancelAutoExit();
  if (!EXIT_AFTER || !sawAWindow || windows.size > 0) return;
  exitTimer = setTimeout(() => {
    if (windows.size === 0) {
      console.log('  最后一个窗口已关闭，' + EXIT_AFTER + ' 秒内没有新窗口接入，服务自动退出。');
      shutdown(0);
    }
  }, EXIT_AFTER * 1000);
}

function shutdown(code) {
  clearStateFile();
  windows.forEach((res) => { try { res.end(); } catch (e) { /* ignore */ } });
  windows.clear();
  try { server.close(); } catch (e) { /* ignore */ }
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  setTimeout(() => process.exit(code), 30);
}

/* ------------------------------------------------------------------ 启动信息文件 */

/**
 * 启动信息文件（纯 ASCII JSON）：给「启动/停止简历生成器.vbs」这类启动器用，
 * 它们靠它判断服务是否已在运行、监听哪个端口、进程号是多少。
 * 每 5 秒刷新一次修改时间当作心跳 —— 启动器只看「文件是否存在 + 修改时间够新」，
 * 不依赖 WMI 等受限环境下不可靠的接口。
 */
function writeStateFile() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      port: PORT,
      pid: process.pid,
      url: 'http://127.0.0.1:' + PORT + '/',
      exitAfter: EXIT_AFTER,
      startedAt: new Date().toISOString()
    }, null, 2) + '\n', 'utf8');
  } catch (e) { /* 只读目录等情况下忽略 */ }
}

let heartbeat = null;

function startHeartbeat() {
  heartbeat = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(STATE_FILE, now, now);
    } catch (e) { /* 文件被删掉就忽略 */ }
  }, 5000);
  heartbeat.unref();
}

function clearStateFile() {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  try {
    const info = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (info && info.pid === process.pid) fs.unlinkSync(STATE_FILE);
  } catch (e) { /* 文件不存在或不是本进程写的，保持不动 */ }
}

/* ------------------------------------------------------------------ 控制接口 */

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

/** 页面长连接：窗口开着就不断，关掉后触发自动退出倒计时 */
function handleAlive(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  windows.add(res);
  sawAWindow = true;
  cancelAutoExit();

  const ka = setInterval(() => {
    try { res.write(': keep-alive\n\n'); } catch (e) { /* ignore */ }
  }, 15000);

  const drop = () => {
    clearInterval(ka);
    if (windows.delete(res)) armAutoExit();
  };
  req.on('close', drop);
  res.on('error', drop);
}

/** 只允许同源页面读取（跨站页面拿不到令牌，因此无法调用 /__shutdown） */
function handleInfo(req, res) {
  sendJson(res, 200, {
    token: TOKEN,
    port: PORT,
    pid: process.pid,
    exitAfter: EXIT_AFTER
  });
}

function handleShutdown(req, res) {
  const site = req.headers['sec-fetch-site'];
  const sameOrigin = site === undefined || site === 'same-origin' || site === 'none';
  if (req.method !== 'POST') { sendJson(res, 405, { error: '请用 POST' }); return; }
  if (!sameOrigin || req.headers['x-resume-token'] !== TOKEN) {
    sendJson(res, 403, { error: '令牌不正确' });
    return;
  }
  sendJson(res, 200, { ok: true, message: '服务即将退出' });
  setTimeout(() => shutdown(0), 60);
}

/* ------------------------------------------------------------------ 静态文件 */

function handleStatic(req, res, pathname) {
  const target = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!target.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(target, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}

/* ------------------------------------------------------------------ 服务器 */

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (pathname === '/__alive') { handleAlive(req, res); return; }
  if (pathname === '/__info') { handleInfo(req, res); return; }
  if (pathname === '/__shutdown') { handleShutdown(req, res); return; }

  handleStatic(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  writeStateFile();
  startHeartbeat();
  console.log('');
  console.log('  简历生成器已启动：http://127.0.0.1:' + PORT);
  console.log('  编辑左侧 Markdown，右侧实时预览，点「导出 PDF」在打印对话框里选「另存为 PDF」。');
  console.log('  Chromium 浏览器里还可以把它「安装为应用」，之后离线也能打开。');
  console.log(EXIT_AFTER > 0
    ? '  窗口关掉后 ' + EXIT_AFTER + ' 秒没有新窗口接入就会自动退出（--exit-after 0 可禁用）。'
    : '  不会自动退出，按 Ctrl+C 结束。');
  console.log('');
});

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => shutdown(0));
});
process.on('exit', clearStateFile);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，请换一个：node server.js --port ' + (PORT + 1));
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
