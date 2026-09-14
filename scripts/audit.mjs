// 系统性审计：对一组（参数,状态）跑页面内的逐项几何体检 MY.probe()，输出窄表。
// 体检的数学全部在蓝图 HTML 里（与绘制同源）；本脚本只负责摆放状态与打印。
// 用法: node scripts/audit.mjs [file.html] [states.json]
import { chromium } from '/home/z/vibe/vibeos/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = path.resolve(process.argv[2] || '蓝图-参数化-v12.html');
const stateFile = path.resolve(process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'audit-states.json'));

function readStates() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch (e) { console.error('读不到/解析不了状态文件:', stateFile, e.message); process.exit(1); }
}

const STATES = readStates();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await p.goto('file://' + file);

let bad = 0;
for (const st of STATES) {
  const r = await p.evaluate((patch) => {
    const MY = window.MY;
    if (!MY) return { err: 'no window.MY' };
    if (typeof MY.probe !== 'function') return { err: 'no window.MY.probe' };
    MY.set(patch || {});
    return { rows: MY.probe(MY.P, MY.M) };
  }, st.patch || {});
  console.log('\n=== ' + st.name + ' ===');
  if (r.err) { console.log('  !! ' + r.err); bad++; continue; }
  for (const row of r.rows) {
    if (!row.ok) bad++;
    console.log(`  ${row.ok ? 'ok  ' : 'FAIL'} ${String(row.id).padEnd(6)} ${row.t}`);
  }
}
await b.close();
console.log('\nconsole errors:', errs.length ? errs.join('\n') : 'none');
console.log('failing probes:', bad);
process.exit(bad ? 1 : 0);
