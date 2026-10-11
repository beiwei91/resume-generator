const MD = require("./assets/resume-md.js");
const md = "---\ntemplate: twocol\nrail: 技能清单, 证书与荣誉\n---\n\n# 张三\n\n前端工程师 | 138\n\n## 个人简介\n\n> 一句话\n\n## 技能清单\n\n- JavaScript\n\n## 证书与荣誉\n\n- CET-6\n\n## 工作经历\n\n### 某公司 · 前端\n\n- 做了事\n";
const r = MD.renderResume(md);
const i = r.html.indexOf("r-rail"), j = r.html.indexOf("r-main");
console.log("rail 位置=" + i + "  main 位置=" + j);
console.log("整体结构（前 500 字）:"); console.log(r.html.slice(0, 500));
console.log("\n左栏片段:"); console.log(i >= 0 ? r.html.slice(i, i + 300) : "(没有左栏)");
