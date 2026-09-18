# 可选：本地服务（默认不需要）

主流程**不需要**这里的任何文件：

- 双击根目录的 `启动简历生成器.vbs` → 用应用窗口直接打开本地 HTML（无后台进程、不需要 Node）
- 或者直接双击 `简历生成器-单文件.html` / `index.html`

它们只服务一个场景：**把应用安装成 PWA**（桌面图标、独立窗口、离线缓存）。
Service Worker 只能在 `localhost` / HTTPS 下注册，所以那时需要一个本地 HTTP 服务。

## 里面有什么

| 文件 | 作用 |
| --- | --- |
| `server.js` | 零依赖静态服务器：只监听 `127.0.0.1`，支持 `--port` / `--exit-after`，写 `.server.json` 供启动器识别 |
| `sw.js` | Service Worker：预缓存页面与资源，断网也能打开 |
| `manifest.webmanifest` | PWA 清单（名称、图标、独立窗口） |
| `启动（需要服务）.vbs` | 起服务并用应用窗口打开（端口自动顺延，关窗口约 1 分钟后自动退出） |
| `停止（需要服务）.vbs` | 停止服务并清理状态文件 |
| `probe-sw.html` | 验证用探针页：注册 Service Worker 并报告缓存结果 |

## 想恢复的话

1. 把这几个文件移回上一级（项目根）目录：`server.js`、`sw.js`、`manifest.webmanifest`、`启动（需要服务）.vbs`、`停止（需要服务）.vbs`
   —— 服务必须以项目根目录为工作目录，才能提供 `index.html` 与 `assets/`；
2. 在 `index.html` 的 `</head>` 前加回一行：

   ```html
   <link rel="manifest" href="manifest.webmanifest">
   ```

3. 在 `index.html` 的 `</body>` 前加回 Service Worker 注册：

   ```html
   <script>
   if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
     window.addEventListener('load', function () {
       navigator.serviceWorker.register('sw.js').catch(function () {});
     });
   }
   </script>
   ```

4. `node server.js`，浏览器打开 `http://127.0.0.1:5173`，用地址栏右侧的安装图标把它装成应用。

> 页面上的「安装为应用」按钮和状态栏的服务指示已经移除了；恢复后直接用浏览器自带的安装入口即可。
