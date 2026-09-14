// 无头渲染 + 几何测量：把蓝图 HTML 渲染成 PNG，并把 SVG 里每个图元的包围盒反算回"世界毫米"。
// 用法: node scripts/render.mjs <file.html> [outdir=/tmp/mycar-render]
// 依赖: playwright（本机在 /home/z/vibe/vibeos/node_modules/playwright）
import { chromium } from '/home/z/vibe/vibeos/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.argv[2] || '蓝图-参数化-v11.html');
const outdir = process.argv[3] || '/tmp/mycar-render';
fs.mkdirSync(outdir, { recursive: true });

const MODES = [
  ['default', []],
  ['rear-bed', ['#m_rlay']],
  ['poptop', ['#m_rlay', '#m_top']],
  ['front-rotated', ['#m_fbwd']],
];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await p.goto('file://' + file);

const snaps = [];
for (const [name, clicks] of MODES) {
  for (const sel of clicks) await p.click(sel);
  await p.waitForTimeout(250);
  await p.locator('.panel').first().screenshot({ path: path.join(outdir, name + '.png') });
  snaps.push(await p.evaluate((mode) => {
    const has = typeof chain === 'function';
    if (!has) return { mode, error: 'no chain() — v12 引擎请导出 measure()' };
    const c = chain();
    const scale = Math.min(980 / P.L, 560 / (P.H + (M.top ? P.pr : 0)));
    const wx = sx => (sx - 70) / scale, wy = sy => (600 - sy) / scale;
    const elements = [];
    for (const e of document.getElementById('root').children) {
      let bb; try { bb = e.getBBox(); } catch { continue; }
      if (!bb.width && !bb.height) continue;
      elements.push({ tag: e.tagName, text: (e.textContent || '').slice(0, 20),
        worldX: [Math.round(wx(bb.x)), Math.round(wx(bb.x + bb.width))],
        worldY: [Math.round(wy(bb.y + bb.height)), Math.round(wy(bb.y))] });
    }
    return { mode, params: { ...P }, flags: { ...M }, world: c, elements };
  }, name));
  if (clicks.length) for (const sel of clicks) await p.click(sel);
}
await b.close();

fs.writeFileSync(path.join(outdir, 'measurements.json'), JSON.stringify(snaps, null, 1));
console.log('rendered:', MODES.map(m => m[0]).join(', '));
console.log('outdir  :', outdir);
console.log('errors  :', errors.length ? errors.join('\n') : 'none');
