// v12 验收脚本：按 .scratch/01-blueprint-parametric/issues/01-fix-v11-geometry.md 的 1–11 条自动判定
// 用法: node scripts/check.mjs [蓝图-参数化-v12.html]
import { chromium } from '/home/z/vibe/vibeos/node_modules/playwright/index.mjs';
import path from 'node:path';

const file = path.resolve(process.argv[2] || '蓝图-参数化-v12.html');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto('file://' + file);
await p.waitForTimeout(400);

const R = [];
const ok = (id, pass, msg) => R.push({ id, pass: !!pass, msg });
const D2R = Math.PI / 180;

/* 在页面里反复调用 build/checks：把参数覆盖传进去 */
const run = (ov, mo) => p.evaluate(([ov, mo]) => {
  const savedP = { ...MY.P }, savedM = { ...MY.M };
  Object.assign(MY.P, ov || {}); Object.assign(MY.M, mo || {});
  const B = MY.build(MY.P, MY.M);
  const cs = MY.checks(MY.P, MY.M, B);
  Object.assign(MY.P, savedP); Object.assign(MY.M, savedM);
  return {
    humanF: B.d.humanF, humanR: B.d.humanR, front: B.d.front, rear: B.d.rear, rearFlat: B.d.rearFlat,
    d: B.d, checks: cs.map(c => ({ id: c.id, ok: c.ok, lv: c.lv, t: c.t })),
    prims: B.prims.length,
  };
}, [ov, mo]);

/* 1) 靠背角与人体同向 */
{
  const rows = [];
  for (const v of [-10, 0, 14, 30, 45, 60]) rows.push(await run({ rBa: v }));
  const monotone = rows.every((r, i) => i === 0 || r.humanR.headC[0] >= rows[i - 1].humanR.headC[0] - 0.5);
  const worst = Math.max(...rows.map(r => {
    const s = r.rear, h = r.humanR;
    const a = Math.atan2(h.shd[0] - h.hip[0], h.shd[1] - h.hip[1]);
    const bb = Math.atan2(s.back.dir[0], s.back.dir[1]);
    return Math.abs(a - bb) / D2R;
  }));
  const f = [];
  for (const v of [-10, 20, 45]) f.push(await run({ fBa: v }));
  const fMono = f.every((r, i) => i === 0 || r.humanF.headC[0] >= f[i - 1].humanF.headC[0] - 0.5);
  ok('1 靠背角与人体同向', monotone && worst <= 8 && fMono,
    `二排头随角度单调朝车尾=${monotone}，躯干-靠背最大夹角=${worst.toFixed(1)}°(≤8)，前排同向=${fMono}`);
}

/* 2) fold 联动 + 放平自报 */
{
  const a = await run({ fold: 0 }), z = await run({ fold: 1 });
  const flat = Math.abs(z.rearFlat.back.ang / D2R - 90) < 0.5 && z.rearFlat.leg.LA / D2R < 0.5;
  const coupled = Math.abs(z.rearFlat.back.ang / D2R - 90) < 0.5 && Math.abs(z.rear.back.ang / D2R - 90) < 0.5;
  const l = await run({ fold: 1, rLa: 80, rBa: 60 });
  const indep = Math.abs(l.rearFlat.back.ang / D2R - 90) < 0.5;
  ok('2 fold 联动驱动靠背与腿托', flat && coupled && indep,
    `放平态靠背水平=${flat}，坐姿角不影响放平态=${indep}`);
}

/* 3) 轮包：弧心=轮心、半径=轮半径+60、包顶>轮顶 */
{
  const { d } = await run({});
  const cF = Math.abs(d.archF.c[1] - (d.archF.wheelTop - d.archF.r + 60)) < 1e-6;
  const rF = Math.abs(d.archF.r - (660 / 2 + 60)) < 1e-6;
  const topF = d.archF.top > d.archF.wheelTop;
  const cR = d.archR.top > d.archR.wheelTop;
  ok('3 轮包弧心=轮心且包顶>轮顶', cF && rF && topF && cR,
    `弧心=${JSON.stringify(d.archF.c)} r=${d.archF.r} 包顶${d.archF.top}>轮顶${d.archF.wheelTop}`);
}

/* 4) 头永不脱离躯干 */
{
  const { humanF, humanR } = await run({});
  const gap = h => Math.hypot(h.headC[0] - h.shd[0], h.headC[1] - h.shd[1]);
  const g1 = gap(humanF), g2 = gap(humanR);
  ok('4 头与躯干不脱离', g1 > 180 && g1 < 260 && g2 > 180 && g2 < 260,
    `前排肩-头心 ${g1.toFixed(0)}mm，二排 ${g2.toFixed(0)}mm（180–260）`);
}

/* 5/6) 升顶站立 / 上铺 */
{
  const st = await run({ fold: 1, pAng: 0, pr: 800 }, { pop: 'stand' });   // 用足够大的 pr 验证可达性
  const need = st.d.standNeed;
  const stand = st.d.popTop >= need;
  const top = st.humanR.headC[1] + 115;
  const bk = await run({ fold: 1, pAng: 0, pr: 800 }, { pop: 'bunk' });
  const bunkOk = bk.d.popTop - bk.d.bunkY >= 450;
  const bad = await run({ fold: 1, pAng: 0, pr: 300 }, { pop: 'stand' });
  const caught = bad.checks.some(c => c.id === 'C3' && !c.ok);
  ok('5 升顶站立净空', stand && caught,
    `顶棚${st.d.popTop}≥所需${need}；pr=300 时判红=${caught}`);
  ok('6 上铺净空', bunkOk, `上铺板到顶棚 ${(bk.d.popTop - bk.d.bunkY).toFixed(0)}mm ≥450`);
}

/* 7) 绘制厚度 = 滑块值 */
{
  const t = await run({ rCt: 240, fCt: 120 });
  const th = q => Math.hypot(q[0][0] - q[3][0], q[0][1] - q[3][1]);   // 上下边的垂直厚度
  const rc = th(t.rear.cush.sh), fc = th(t.front.cush.sh);
  ok('7 坐垫绘制厚度=滑块值', Math.abs(rc - 240) < 5 && Math.abs(fc - 120) < 5,
    `二排画 ${rc.toFixed(0)}mm(设240)，前排画 ${fc.toFixed(0)}mm(设120)`);
}

/* 8/18) 限高 */
{
  const h1 = await run({ H: 2050 }), h2 = await run({ H: 1950 });
  const red = h1.checks.some(c => c.id === 'C18' && !c.ok);
  const sit = h2.checks.find(c => c.id === 'C5');
  ok('8 限高 2m 生效', red && sit && sit.ok, `H=2050 判红=${red}；H=1950 坐姿净空通过=${sit && sit.ok}`);
}

/* 9) 电池为宽度判据，且不存在"电池/人体 vs 轮胎"的侧视判据 */
{
  const { checks } = await run({});
  const hasWidth = checks.some(c => c.id === 'C8');
  const noWheel = !checks.some(c => /轮胎|轮子|tyre/i.test(c.t) && /电池|脚|人/.test(c.t));
  const w = await run({ bw: 1500 });
  const wide = w.checks.some(c => c.id === 'C8' && !c.ok);
  ok('9 电池为宽度判据', hasWidth && noWheel && wide, `宽度判据存在=${hasWidth}，无侧视轮子判据=${noWheel}，bw=1500 判红=${wide}`);
}

/* 10) 中岛 x 绝对可调 + 台面高度判据 */
{
  const a = await run({ ix: 900 }), z = await run({ ix: 3400 });
  const free = Math.abs(a.d.isl.ix - 900) < 1 && Math.abs(z.d.isl.ix - 3400) < 1;
  const low = await run({ ihh: 360 });
  const caught = low.checks.some(c => c.id === 'C11' && !c.ok);
  ok('10 中岛 x 独立可调', free && caught, `ix=900/3400 生效=${free}；台面过低判红=${caught}`);
}

/* 11) 默认即全绿 + 每个滑块都有可行区间 + 参数域内存在全绿解 */
{
  const res = await p.evaluate(() => {
    const keys = Object.keys(MY.DEF);
    const defGreen = MY.hardOK(MY.P, MY.M);
    // (b) 每个滑块：固定其余为默认，扫出可行区间
    const N = 40, noBand = [];
    for (const k of keys) {
      const D = MY.DEF[k]; let any = false;
      for (let i = 0; i <= N; i++) {
        const q = { ...MY.P }; q[k] = D.min + (D.max - D.min) * i / N;
        let g = false; try { g = MY.hardOK(q, MY.M); } catch (e) { g = false; }
        if (g) { any = true; break; }
      }
      if (!any) noBand.push(k);
    }
    // (c) 全域随机搜索：至少存在全绿解，并报告找到的最小 L
    const sample = () => { const o = {}; for (const k of keys) {
      const D = MY.DEF[k], n = Math.round((D.max - D.min) / D.st);
      o[k] = +(D.min + Math.round(Math.random() * n) * D.st).toFixed(3); } return o; };
    let found = 0, minL = null, ex = null;
    for (let i = 0; i < 30000; i++) {
      const o = sample();
      let g = false; try { g = MY.hardOK(o, MY.M); } catch (e) { g = false; }
      if (g) { found++; if (minL === null || o.L < minL) { minL = o.L; ex = o; } }
    }
    return { defGreen, noBand, found, minL, ex };
  });
  ok('11 默认全绿 + 每个滑块都有可行区间 + 存在全绿解',
    res.defGreen && res.noBand.length === 0 && res.found > 0,
    `默认全绿=${res.defGreen}；无可行区间的滑块=${res.noBand.length ? res.noBand.join(',') : '无'}；` +
    `3 万次随机搜索命中全绿 ${res.found} 个，最小 L=${res.minL}（v11 同法需 4800）`);
}

await b.close();
const fail = R.filter(r => !r.pass);
for (const r of R) console.log(`${r.pass ? '✓' : '✗'} ${r.id} — ${r.msg}`);
console.log(`\n${R.length - fail.length}/${R.length} 通过` + (errs.length ? `\n页面报错：\n${errs.join('\n')}` : '\n页面无 console 报错'));
process.exit(fail.length || errs.length ? 1 : 0);
