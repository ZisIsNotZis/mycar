// 批量导出：把蓝图的各个预设导出成 .glb 文件，供 Blender 等外部工具使用。
// 用法: node scripts/export-glb.mjs [outdir=/tmp/mycar-glb] [蓝图-参数化-v12.html]
import { chromium } from '/home/z/vibe/vibeos/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const outdir = path.resolve(process.argv[2] || '/tmp/mycar-glb');
const file = path.resolve(process.argv[3] || '蓝图-参数化-v12.html');
fs.mkdirSync(outdir, { recursive: true });

// 与蓝图页面里的预设保持一致（名称 → 参数/状态补丁）
const SETS = [
  ['01-通勤',        { M: { fbwd: false, pop: 'closed' }, P: { fold: 0, pAng: 90 } }],
  ['02-行车观影',    { M: { fbwd: false, pop: 'closed' }, P: { fold: 0.45, pAng: 90 } }],
  ['03-会客办公',    { M: { fbwd: true, pop: 'closed' }, P: { fold: 0, pAng: 90 } }],
  ['04-驻车大床',    { M: { fbwd: true, pop: 'closed' }, P: { fold: 1, pAng: 0, rLift: -120, fLift: -20 } }],
  ['05-露营站立',    { M: { fbwd: true, pop: 'stand' }, P: { fold: 1, pAng: 0, rLift: -120, fLift: -20 } }],
  ['06-露营上铺',    { M: { fbwd: true, pop: 'bunk' }, P: { fold: 1, pAng: 0, rLift: -120, fLift: -20, pr: 700 } }],
  ['07-干湿清洗',    { M: { fbwd: false, pop: 'closed' }, P: { fold: 0, pAng: 90 } }],
];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto('file://' + file);
await p.waitForTimeout(400);

const rows = [];
for (const [name, patch] of SETS) {
  const r = await p.evaluate((patch) => {
    const saved = { P: { ...MY.P }, M: { ...MY.M } };
    Object.assign(MY.P, patch.P || {}); Object.assign(MY.M, patch.M || {});
    const g = MY.glbFromScene({ solid: false });
    const gs = MY.glbFromScene({ solid: true });
    const size = [MY.P.L, MY.P.W, MY.P.H, MY.P.fold, MY.M.fbwd, MY.M.pop];
    Object.assign(MY.P, saved.P); Object.assign(MY.M, saved.M);
    // btoa 只吃 latin1：分块转换避免栈溢出
    let bin = '', CH = 0x8000;
    for (let i = 0; i < g.bytes.length; i += CH) bin += String.fromCharCode.apply(null, g.bytes.subarray(i, i + CH));
    const enc = (bytes) => { let b2 = ''; for (let i = 0; i < bytes.length; i += CH) b2 += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(b2); };
    return { b64: enc(g.bytes), b64s: enc(gs.bytes), tri: g.tri, size, len: g.bytes.length };
  }, patch);
  fs.writeFileSync(path.join(outdir, name + '.glb'), Buffer.from(r.b64, 'base64'));      // 剖切版（默认）
  fs.writeFileSync(path.join(outdir, name + '-solid.glb'), Buffer.from(r.b64s, 'base64')); // 封闭实体版
  rows.push([name, `${(r.len / 1024).toFixed(0)}KB`, `${r.tri}面`, `L${r.size[0]} W${r.size[1]} H${r.size[2]} fold${r.size[3]} ${r.size[4] ? 'rot' : 'fwd'} ${r.size[5]}`]);
}
await b.close();
for (const r of rows) console.log(r.join('\t'));
console.log('导出目录:', outdir, '· 页面报错:', errs.length ? errs.join('|') : '无');
