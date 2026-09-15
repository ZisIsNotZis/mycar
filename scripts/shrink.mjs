#!/usr/bin/env node
/* =========================================================================
   缩小实验（v17 引擎）：不改引擎，在 DEF 参数域内找"满足全部硬判据 + 用户硬要求"
   的最小车长 L，并报出每毫米卡在哪。

   车长恒等式（由 derive() 直接得出，实验只是复核它）：
     L  = (x10+x11) + 床长
     床长 = (x12+x13+x14) + 靠背放平预留 740 + C13 余量 + x04
   所以"缩车"只有两条路：缩「车头→前排」段，或缩「后排座舱 + 尾仓」段；
   床长 ≥1800 是这两段之和的下限。

   用法:
     node scripts/shrink.mjs [蓝图-v17.html] [--matrix|--one] [选项]
       --set=bmF:1000,knG:80     改引擎里的规则参数（梁长 / 膝净空 / 电池口径…）
       --bedBig=1800             大床床面下限（引擎 C6 是 1750，这里可以更严）
       --bedSmall=1750           小床床面下限；0 = C6 只管大床
       --lie=tail|head           躺在床面上的人朝哪头（tail = 引擎原样）
       --relax=c8               实验里**明确标注地**放掉某条判据（例：1150 尾仓与 C8 冲突时）
       --layouts                额外打印一段可贴进 蓝图-v17.html 的布局快照代码
       --floors=x11:500,x12:440  人工下限（引擎里没有"人体空间"判据）
       --rounds=6                二分轮数（默认 6）
       --shot=outdir             把每个场景的最优解画出来存图（必须自己看图）
   ========================================================================= */
import { chromium } from "/home/z/vibe/vibeos/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const file = path.resolve(args.find((a) => !a.startsWith("--")) || "蓝图-v17.html");
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith("--" + k + "="));
  return a ? a.split("=").slice(1).join("=") : d;
};
const num = (k, d) => (opt(k) === undefined ? d : +opt(k));
const parseFloors = (s) => {
  const o = {};
  for (const kv of String(s || "").split(","))
    if (kv.trim()) { const [k, v] = kv.split(":"); o[k.trim()] = +v; }
  return o;
};
/* 电池口径（D62 #3）：500km CLTC × 11.7kWh/100km ÷ 600Wh/L → 需要的极板长度 */
const BASE = {

  bedBig: num("bedBig", 1800),
  bedSmall: num("bedSmall", 1750),
  floors: parseFloors(opt("floors", "")),
  iters: num("iters", 6000),
  patience: num("patience", 700),
  y3Max: num("y3Max", 2000),
  lie: opt("lie", "tail"),
  relax: opt("relax", ""),
  /* --set=bmF:1000,knG:80：直接改引擎里的**规则参数**（缩小实验不许动它们，只是拿来试口径） */
  set: (() => { const o = {}; for (const kv of String(opt("set", "")).split(","))
      if (kv.trim()) { const [k, v] = kv.split(":"); o[k.trim()] = +v; } return o; })(),
};
const SHOT = opt("shot", "");
const TWO_PRESET = opt("presets", "");   // 只查这几个预设（调试用）

/* 场景表：人工下限（引擎没有"人体空间"判据，必须显式给） */
const TODAY = { x11: 680, x12: 440, x13: 500, x14: 380 };
const SCEN = [
  { n: "S0 无人工下限（引擎判据 + 两条要求）", o: { floors: {} } },
  { n: "S1 座舱空间 = 今天（只缩结构）", o: { floors: { ...TODAY } } },
  { n: "S2 紧凑（脚 450/350 · 座垫 420/370）", o: { floors: { x11: 450, x12: 420, x13: 350, x14: 370, x01: 350, x02: 800, x03: 350 } } },
  { n: "S3 更紧（脚 400/300 · 座垫 400/350）", o: { floors: { x11: 400, x12: 400, x13: 300, x14: 350, x01: 300, x02: 600, x03: 300 } } },
];
const MATRIX = args.includes("--matrix");

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
await p.goto("file://" + file);
await p.waitForTimeout(500);

const search = (cfg) =>
  p.evaluate((cfg) => {
    const DEFR = MY.DEF;
    const KEYS = ["x00", "x01", "x02", "x03", "x04", "x10", "x11", "x12", "x13", "x14", "x15", "x30", "xBeam"];
    const Lof = (q) => q.x00 + q.x01 + q.x02 + q.x03 + q.x04;
    const clamp = (k, v) => Math.min(DEFR[k].max, Math.max(DEFR[k].min, v));
    const floorOf = (k) => Math.max(DEFR[k].min, cfg.floors[k] !== undefined ? cfg.floors[k] : -Infinity);
    const SMALL = ["小床", "小床观影"];
    /* 先查最可能红的，早退省时间 */
    const ORDER = ["大床", "小床", "小床观影", "升顶", "升顶站立", "大床观影", "常规", "对坐"];
    const PRES = cfg.only ? MY.PRESETS.filter(([nm]) => cfg.only.includes(nm)) : MY.PRESETS;
    const SEQ = ORDER.map((nm) => PRES.find(([n2]) => n2 === nm)).filter(Boolean);

    const RELAX = String(cfg.relax || "").split(",").filter(Boolean);
    const reds = (cs, preset) =>
      cs.filter((c) => c.lv !== "info" && !c.ok &&
        !(cfg.bedSmall <= 0 && c.id === "C6" && SMALL.includes(preset)) &&
        !RELAX.includes(String(c.id).toLowerCase())).map((c) => c.id);

    /* 躺姿方向：默认 = 引擎原样（D56：髋落在可翻件铰点 → 头朝车尾）；
       cfg.lie==='head' = 实验变量：把躺在床面上的人改成「头朝车头（床头板）、脚朝车尾」，
       摆好后走同一套物理落定、同一套判据（不改引擎、不改判据）。 */
    function lieHeadForward(d) {
      const rag = MY.SIM.rags.find((r) => r.who === "床面");
      if (!rag) return;
      const y2 = MY.P.y2, x0 = d.bed.x0;
      const put = (nm, x, y) => { const q = rag.p.find((z) => z.nm === nm); if (q) { q.x = x; q.y = y; q.vx = 0; q.vy = 0; q.px = x; q.py = y; } };
      put("头", x0 + 115, y2 + 115);
      put("肩", x0 + 330, y2 + 115);
      put("髋", x0 + 850, y2 + 115);
      put("膝", x0 + 1270, y2 + 75);
      put("踝", x0 + 1670, y2 + 55);
      put("趾", x0 + 1750, y2 + 55);
      MY.settle(3, MY.SIM.rags, MY.SIM.hard, MY.SIM.soft);
    }

    function feas(q) {
      const why = [];
      if (q.x10 < q.x00 - 1e-9) why.push("x10<x00");
      for (const k of KEYS) if (q[k] < floorOf(k) - 1e-9) why.push(`${k}<下限${floorOf(k)}`);
      if (why.length) return { ok: false, why: why.join("|") };

      const saved = { ...MY.P };
      let bedBig = null, bedSmall = null;
      for (const [nm, st] of SEQ) {
        Object.assign(MY.P, q, st);
        let cs, d;
        try { d = MY.derive(); if (cfg.lie === "head" && d.bed && MY.P.pAng < 0.5) lieHeadForward(d); cs = MY.checks(); }
        catch (e) { Object.assign(MY.P, saved); return { ok: false, why: nm + ":引擎异常 " + e.message }; }
        if (nm === "大床") bedBig = d.bed ? d.bed.len : null;
        if (nm === "小床") bedSmall = d.bed ? d.bed.len : null;
        if (nm === "大床") {
          const op = d.C.opening;
          if (!(q.xBeam >= op.x0 && q.xBeam <= op.x1)) why.push("顶横梁不在开口内");
        }
        const r = reds(cs, nm);
        if (r.length) { Object.assign(MY.P, saved); return { ok: false, why: nm + ":" + r.join(","), bedBig, bedSmall }; }
      }
      if (MY.P.y3 > cfg.y3Max + 1e-9) why.push(`y3>${cfg.y3Max}`);
      if (bedBig == null || bedBig < cfg.bedBig - 0.5) why.push(`大床${Math.round(bedBig || 0)}<${cfg.bedBig}`);
      if (cfg.bedSmall > 0 && (bedSmall == null || bedSmall < cfg.bedSmall - 0.5))
        why.push(`小床${Math.round(bedSmall || 0)}<${cfg.bedSmall}`);
      Object.assign(MY.P, saved);
      if (why.length) return { ok: false, why: why.join("|"), bedBig, bedSmall };
      return { ok: true, why: "", L: Lof(q), bedBig, bedSmall };
    }

    /* 起点修复：把用户要求（梁长等）抬到下限后，默认参数可能不再可行
       （例：车头变长 → 可翻件竖起来捅穿顶棚的 C8）。
       这里对"红判据条数"做贪心下降，只为找一个可行起点；搜索本身照旧。 */
    function failScore(q) {
      let n = 0;
      if (q.x10 < q.x00 - 1e-9) n++;
      for (const k of KEYS) if (q[k] < floorOf(k) - 1e-9) n++;
      if (MY.P.y3 > cfg.y3Max + 1e-9) n++;
      const saved = { ...MY.P };
      let bedBig = null, bedSmall = null;
      for (const [nm, st] of MY.PRESETS) {
        Object.assign(MY.P, q, st);
        try {
          const d = MY.derive(); const cs = MY.checks();
          if (nm === "大床") bedBig = d.bed ? d.bed.len : null;
          if (nm === "小床") bedSmall = d.bed ? d.bed.len : null;
          n += reds(cs, nm).length;
        } catch (e) { n += 5; }
      }
      Object.assign(MY.P, saved);
      if (bedBig == null || bedBig < cfg.bedBig - 0.5) n++;
      if (cfg.bedSmall > 0 && (bedSmall == null || bedSmall < cfg.bedSmall - 0.5)) n++;
      return n;
    }
    function repairStart(q0) {
      let cur = { ...q0 };
      let sc = failScore(cur);
      if (sc === 0) return cur;
      const ORDER = ["x14", "x13", "x12", "x11", "x15", "xBeam", "x30", "x01", "x03", "x02", "x10", "x00", "x04"];
      for (let rd = 0; rd < 40 && sc > 0; rd++) {
        let moved = false;
        for (const k of ORDER) {
          for (let i = 0; i < 120; i++) {
            const v = Math.max(loOf(k, cur), cur[k] - 10);
            if (v >= cur[k] - 1e-9) break;
            const cand = { ...cur, [k]: v };
            const s2 = failScore(cand);
            if (s2 < sc) { cur = cand; sc = s2; moved = true; if (sc === 0) return cur; break; }
          }
        }
        if (!moved) break;
      }
      return sc === 0 ? cur : null;
    }

    /* 坐标逐个二分：固定其它参数，把每个参数压到「还能行」的最小值；多轮直到不动。
       每步落点都必须真的过一遍 feas()（不能拿二分出来的边界当结果）。 */
    const loOf = (k, q) => {
      let v = floorOf(k);
      if (k === "x10") v = Math.max(v, q.x00);       // L 型不能倒过来（高段盖过低段）
      return v;
    };
    function shrink(start, rounds) {
      const cur = { ...start };
      for (const k of KEYS) cur[k] = Math.max(cur[k], loOf(k, cur));
      cur.x10 = Math.max(cur.x10, cur.x00);
      /* 起点定向修补：把前梁抬到下限后，座舱链变长 → C13 要更多「前段」，
         而前段的和是被 C13 锁死的 → 电池 x02 是填充量，直接补上。 */
      cur.x02 = Math.min(DEFR.x02.max,
        Math.max(cur.x02, (cur.x10 + cur.x11 + cur.x12 + cur.x13 + cur.x14 + 740) - cur.x00 - cur.x01 - cur.x03));
      const fixed = repairStart(cur);
      if (!fixed) throw new Error("起点不可行且修不回来：" + JSON.stringify(feas(cur).why));
      Object.assign(cur, fixed);
      const r0 = feas(cur);
      if (!r0.ok) throw new Error("起点不可行：" + r0.why);
      let evals = 0;
      const ok = (q, k, v) => { evals++; return feas({ ...q, [k]: v }).ok; };
      for (let rd = 0; rd < rounds; rd++) {
        let changed = false;
        for (const k of KEYS) {
          const lo0 = loOf(k, cur), hi = cur[k];
          if (hi - lo0 < 10) continue;
          let v;
          if (ok(cur, k, lo0)) v = lo0;
          else {
            let a = lo0, bb = hi;              // a 不可行 · bb 可行（不变式：cur 一定可行）
            for (let i = 0; i < 14 && bb - a > 5; i++) {
              const m = (a + bb) / 2;
              if (ok(cur, k, m)) bb = m; else a = m;
            }
            v = Math.max(lo0, Math.ceil((bb - 0.001) / 10) * 10);   // 向上取到 10mm 网格
            while (v <= hi && !ok(cur, k, v)) v += 10;            // 网格上未必仍可行 → 往上找
            if (v > hi) v = null;                                 // 兜底：不动
          }
          if (v != null && v < cur[k] - 1e-9) { cur[k] = v; changed = true; }
        }
        if (!changed) break;
      }
      return { P: cur, L: Lof(cur), evals };
    }

    /* 随机多参数下降：坐标二分只能逐个动，会卡在"两三个参数得同时缩"的角上；
       这里同时动 1–3 个参数把它拉出来，再回去二分。
       排序目标 = (L, Sb)：L 是车长，Sb = x10..x14（层B 链长）——
       因为 L ≥ Sb + 1630，先把 Sb 压下去，层A 的余量才会变成可缩的车长。 */
    const Sb = (q) => q.x10 + q.x11 + q.x12 + q.x13 + q.x14;
    const better = (c, o) => Lof(c) < Lof(o) - 1e-9 || (Lof(c) <= Lof(o) + 1e-9 && Sb(c) <= Sb(o) + 1e-9);
    function randPhase(cur0, iters, patience) {
      let cur = cur0, fail = 0, evals = 0;
      const STEP = [10, 10, 20, 20, 50, 100];
      for (let it = 0; it < iters && fail < patience; it++) {
        const n = 1 + ((Math.random() * 3) | 0);
        const cand = { ...cur };
        let any = false;
        for (let i = 0; i < n; i++) {
          const k = KEYS[(Math.random() * KEYS.length) | 0];
          const st = STEP[(Math.random() * STEP.length) | 0];
          const v = Math.max(loOf(k, cand), cand[k] - st);
          if (v < cand[k] - 1e-9) { cand[k] = v; any = true; }
        }
        if (!any || !better(cand, cur)) { fail++; continue; }
        evals++;
        if (feas(cand).ok) { cur = cand; fail = 0; } else fail++;
      }
      return { P: cur, evals };
    }

    function hybrid(start) {
      let cur = { ...start }, evals = 0;
      for (let outer = 0; outer < 6; outer++) {
        const a = shrink(cur, 6); cur = a.P; evals += a.evals;
        const b = randPhase(cur, cfg.rand !== undefined ? cfg.rand : 2500, 900);
        evals += b.evals;
        if (better(b.P, cur)) cur = b.P; else break;
      }
      const z = shrink(cur, 6); cur = z.P; evals += z.evals;
      return { P: cur, L: Lof(cur), evals };
    }

    function binding(P0) {
      const out = {};
      for (const k of KEYS) {
        const cand = { ...P0, [k]: clamp(k, P0[k] - 10) };
        if (cand[k] >= P0[k] - 1e-9) { out[k] = "已在滑块下限"; continue; }
        const r = feas(cand);
        out[k] = r.ok ? "！还能再缩" : r.why;
      }
      return out;
    }

    Object.assign(MY.P, cfg.set || {});          // 规则参数（引擎判据读它）
    const start = {}; for (const k of KEYS) start[k] = MY.P[k];
    const t0 = performance.now();
    const res = hybrid(start);
    const best = res.P;
    const bind = binding(best);

    const saved = { ...MY.P };
    const detail = {}; let allGreen = true;
    for (const [nm, st] of MY.PRESETS) {
      Object.assign(MY.P, best, st);
      const d = MY.derive(); if (cfg.lie === "head" && d.bed && MY.P.pAng < 0.5) lieHeadForward(d);
      const cs = MY.checks();
      const red = reds(cs, nm);
      if (red.length) allGreen = false;
      const c8 = cs.find((c) => c.id === "C8");
      detail[nm] = { red, L: Math.round(d.L), bed: d.bed ? Math.round(d.bed.len) : null,
        c8: c8 ? c8.t : "", c8ok: c8 ? c8.ok : null,
        dolls: d.dolls.map((j) => j.who + (j.hit ? "(穿" + j.hit + ")" : "")),
        hardY: d.dolls.filter((j) => j.hit).map((j) => j.hit) };
    }
    /* 恒等式分解（大床） */
    Object.assign(MY.P, best, MY.PRESETS.find(([n]) => n === "大床")[1]);
    const d = MY.derive();
    const nose = best.x10 + best.x11, S = best.x12 + best.x13 + best.x14;
    const margin = (best.x00 + best.x01 + best.x02 + best.x03) - (d.backZone.x1);
    Object.assign(MY.P, saved);

    return {
      L: res.L, startL: start.x00 + start.x01 + start.x02 + start.x03 + start.x04,
      moves: res.evals, ms: Math.round(performance.now() - t0), allGreen, binding: bind,
      detail, P: best,
      ident: { nose, x10: best.x10, x11: best.x11, S, x12: best.x12, x13: best.x13, x14: best.x14,
        backZone: 740, margin, x04: best.x04, bed: Math.round(res.L - nose),
        headRoom: margin + best.x04 },
    };
  }, cfg);

/* ---------------- 输出 ---------------- */
const pad = (s, n) => String(s).padEnd(n);
function dump(title, cfg, r) {
  const s = r.ident, P = r.P;
  console.log(`\n── ${title}`);
  console.log(`   L ${r.startL} → ${r.L}（省 ${r.startL - r.L}）  全绿=${r.allGreen}  ${r.moves} 次判据评估/${r.ms}ms`);
  console.log(`   层A  x00 ${P.x00} x01 ${P.x01} x02 ${P.x02} x03 ${P.x03} x04 ${P.x04}`);
  console.log(`   层B  x10 ${P.x10} 前脚 ${P.x11} 前座 ${P.x12} 后脚 ${P.x13} 后座 ${P.x14}` +
    ` · x15 ${P.x15} x30 ${P.x30} xBeam ${P.xBeam}`);
  console.log(`   溃缩结构：前 上排 x10 ${P.x10} / 下排 x00 ${P.x00}（下排/上排）· ` +
    `后 上排 x04+x15 ${P.x04 + P.x15} / 下排 x04 ${P.x04}`);
  console.log(`   恒等式：L = (车头→前排 ${s.nose}) + 床 ${s.bed}`);
  console.log(`   床 ${s.bed} = 后排座舱 ${s.S} + 靠背预留 740 + C13 余量 ${s.margin} + 尾仓 ${s.x04}` +
    `   (头到车尾余量 ${s.headRoom})`);
  const bd = Object.entries(r.binding).map(([k, v]) => `${k}→${v}`);
  console.log("   再缩 10mm 死在哪： " + bd.join("\n" + " ".repeat(19)));
  if (r.detail["常规"] && r.detail["常规"].c8 && r.detail["常规"].c8ok === false)
    console.log("   ⚠ 常规 C8：" + r.detail["常规"].c8);
  console.log("   预设复核：" + Object.entries(r.detail).map(([k, v]) =>
    `${k}${v.red.length ? "✗(" + v.red.join(",") + ")" : "✓"}`).join(" "));
}

const runs = [];
if (MATRIX) {
  for (const sc of SCEN) {
    const cfg = { ...BASE, ...sc.o, floors: { ...sc.o.floors } };
    const r = await search(cfg);
    runs.push({ name: sc.n, cfg, r });
    dump(sc.n, cfg, r);
  }
} else {
  const r = await search(BASE);
  runs.push({ name: "单一场景", cfg: BASE, r });
  dump("单一场景", BASE, r);
}

if (SHOT) {
  fs.mkdirSync(SHOT, { recursive: true });
  for (const { name, r } of runs) {
    for (const preset of ["大床", "常规", "升顶站立"]) {
      await p.evaluate(([P, pr]) => {
        Object.assign(MY.P, P, MY.PRESETS.find(([n]) => n === pr)[1]);
        MY.render();
        for (const k in P) {
          const el = document.getElementById(k); if (el) el.value = P[k];
          const v = document.getElementById("v_" + k); if (v) v.textContent = Math.round(P[k]);
          const n = document.getElementById("n_" + k); if (n) n.value = P[k];
        }
      }, [r.P, preset]);
      await p.waitForTimeout(400);
      const f = path.join(SHOT, `${name.replace(/[^\w\u4e00-\u9fa5]+/g, "_")}-${preset}.png`);
      await p.locator(".panel").first().screenshot({ path: f });
      console.log("   图 " + f);
    }
  }
}
console.log("\n" + (errs.length ? "页面报错：\n" + errs.join("\n") : "页面无 console 报错"));
await b.close();
