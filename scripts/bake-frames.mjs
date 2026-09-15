// 逐帧烘焙：把蓝图 v13 的几何按时间轴采样成 frames.json，供 Blender 建对象 + 打关键帧。
// 为什么不是逐帧 GLB：6000 个文件无法插值、材质会丢、Blender 端无法做运动模糊。
// 用法: node scripts/bake-frames.mjs [out.json] [file.html]
import { chromium } from "/home/z/vibe/vibeos/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] || "/tmp/mycar-film/frames.json");
const file = path.resolve(process.argv[3] || "蓝图-参数化-v13.html");
fs.mkdirSync(path.dirname(out), { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
p.on("console", (m) => {
  if (m.type() === "error") errs.push("CONSOLE " + m.text());
});
await p.goto("file://" + file);
await p.waitForTimeout(300);

const r = await p.evaluate(() => window.MY.bakeFilm());
await b.close();

fs.writeFileSync(out, JSON.stringify(r));
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(
  `baked ${r.frames.length} frames · ${Object.keys(r.partDefs).length} car parts · ` +
    `${Object.keys(r.alpha).length} people · ${kb}KB → ${out}`,
);
console.log(
  "shots:",
  r.shots.map((s) => `${s.name}[${s.f0}-${s.f1}]`).join(" "),
);
console.log("errors:", errs.length ? errs.join("\n") : "none");
