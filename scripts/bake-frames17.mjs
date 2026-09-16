// v17 → frames.json：把「车 + 人 + 相机」按时间轴逐帧烘焙成 blender-film.py 认得的那套 schema
// （v13 的 bake-frames.mjs / blender-film.py 是刻意复用的：灯光、运动模糊、人物淡入淡出都在那边）。
//
// 用法: node scripts/bake-frames17.mjs [out.json] [--plan=film|test] [--fps=24]
//
// 约定（与 blender-film.py 一致）：
//   partDefs[key] = {cls, k}，cls 取 PAL 里的名字，k ∈ box/cyl/prism/quad
//   frames[i] = { i, parts:{key:value}, people:{slot:joints}, cam:{pos,tgt,shell} }
//      box   → [x0,x1,y0,y1,z0,z1]（车 mm；z = 车宽）
//      cyl   → [cx,cy,r,z0,z1]
//      quad  → [px,py,dx,dy,len,th,z0,z1]（铰点 + 方向 + 长 + 厚）
//      prism → [z0,z1,...pts]，pts = [x,y] 序列
//   人   → {k, hip,knee,ankle,foot,shd,neck,headC,elbow,hand}
import { chromium } from "/home/z/vibe/vibeos/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const out = path.resolve(args.find((a) => !a.startsWith("--")) || "/tmp/mycar-film/frames.json");
const FILE = path.resolve("蓝图-v17.html");
const FPS = 24;
fs.mkdirSync(path.dirname(out), { recursive: true });

/* =========================================================================
   影片分镜（v1）：L = 4460 的紧凑布局。每镜一个状态/相机/透明度的曲线。
   时长单位秒；u ∈ [0,1] 是该镜内的进度（已做缓动）。
   ========================================================================= */
const L4460 = { x00: 620, x01: 200, x02: 2150, x03: 600, x04: 890, x10: 1240,
  x11: 450, x12: 420, x13: 350, x14: 370, x15: 400, x30: 1600, xBeam: 2725 };
const L4080 = { x00: 620, x01: 200, x02: 1860, x03: 550, x04: 850, x10: 1240,
  x11: 430, x12: 250, x13: 200, x14: 330, x15: 400, x30: 1600, xBeam: 2515 };
const L4870 = { x00: 620, x01: 430, x02: 2330, x03: 600, x04: 890, x10: 1240,
  x11: 680, x12: 440, x13: 500, x14: 380, x15: 500, x30: 1600, xBeam: 2625 };
const SIT = { rot: 0, fold: 0, pAng: 90, popUp: 0 };
const BED = { rot: 180, fold: 1, pAng: 0, popUp: 0 };

/* 取景：给定机位方向（单位向量）与目标点，按当前车长算出"车刚好装满 + 留边"的距离。
   hfov：FILM_LENS=35mm / 36mm 传感器 → 2·atan(18/35) ≈ 54.5°。 */
const HFOV = 2 * Math.atan(18 / 35);
const frame = (L, tgt, dirU, fill = 0.78) => {
  const need = (L / 2 + 600) / fill;                    // 想装进画面的半宽（车 + 留边）
  const dist = need / Math.tan(HFOV / 2);
  return { pos: [tgt[0] + dirU[0] * dist, tgt[1] + dirU[1] * dist, tgt[2] + dirU[2] * dist], tgt };
};
const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };

const Lof = (c) => c.x00 + c.x01 + c.x02 + c.x03 + c.x04;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const mix = (a, b, u) => a + (b - a) * u;
const mixObj = (a, b, u) => { const o = {}; for (const k in a) o[k] = mix(a[k], (b || a)[k] ?? a[k], u); return o; };

const SHOTS = [
  /* ① 车外 hero：缓缓升起 + 侧移（"外面小"） */
  { n: "外部 hero", sec: 9, car: L4460, state: SIT, shell: () => 1.0, cut: () => null, people: [],
    cam: (u) => frame(Lof(L4460), [Lof(L4460) * 0.5, 950, 0],
      norm([-0.62 + 0.10 * u, 0.32 + 0.18 * u, 0.72 - 0.06 * u]), 0.74) },

  /* ② 环绕 + 剖开（同一运动里完成 → "里面大"） */
  { n: "环绕剖开", sec: 9, car: L4460, state: SIT, shell: () => 1.0,
    cut: (u) => 1180 - 1280 * u, people: [],
    cam: (u) => { const a = -0.95 + 1.15 * u;
      return frame(Lof(L4460), [Lof(L4460) * 0.5, 1000, 0], norm([Math.sin(a), 0.30, Math.cos(a)]), 0.72); } },

  /* ③ 常规：两个人坐着（淡入），缓慢推近 */
  { n: "常规两人", sec: 7, car: L4460, state: SIT, shell: () => 1.0, cut: () => -100,
    people: [{ slot: "A", a: (u) => clamp01((u - 0.02) / 0.25) }, { slot: "B", a: (u) => clamp01((u - 0.12) / 0.25) }],
    cam: (u) => frame(Lof(L4460), [Lof(L4460) * 0.55, 1050, 0],
      norm([0.34, 0.13, 0.93]), 0.95 - 0.13 * u) },

  /* ④ 变形：二排放平 + 腿托 + 前排转身（人淡出静姿） */
  { n: "变形", sec: 12, car: L4460, state: SIT, stateTo: BED, shell: () => 1.0, cut: () => -100,
    people: [{ slot: "A", a: (u) => clamp01(0.9 - u / 0.22) }, { slot: "B", a: (u) => clamp01(0.9 - u / 0.22) }],
    cam: (u) => frame(Lof(L4460), [Lof(L4460) * 0.5, 1000, 0],
      norm([0.10, 0.14 + 0.10 * u, 0.98]), 0.92) },

  /* ⑤ 大床：一个人躺下（淡入），低机位推近 */
  { n: "大床", sec: 8, car: L4460, state: BED, shell: () => 1.0, cut: () => -100,
    people: [{ slot: "A", a: (u) => clamp01((u - 0.06) / 0.3) }],
    cam: (u) => frame(Lof(L4460), [Lof(L4460) * 0.62, 950, 0],
      norm([0.24 - 0.22 * u, 0.10 + 0.16 * u, 0.97]), 0.96 - 0.14 * u) },

  /* ⑥ 升顶站立：镜头跟着升顶抬起来 */
  { n: "升顶站立", sec: 9, car: L4460, state: BED, stateTo: { rot: 0, fold: 1, pAng: 0, popUp: 1 },
    shell: () => 1.0, cut: () => -100,
    people: [{ slot: "B", a: (u) => clamp01((u - 0.22) / 0.28) }],
    cam: (u) => frame(Lof(L4460), [Lof(L4460) * 0.55, 1300 + 800 * u, 0],
      norm([0.26, 0.05 + 0.13 * u, 0.96]), 0.94) },

  /* ⑦ 骨架 + 溃缩结构：壳拿掉，露出"不随机构变"的骨架 */
  { n: "骨架", sec: 9, car: L4460, state: SIT, shell: () => 0.0, cut: () => null, people: [],
    cam: (u) => { const a = 0.38 - 0.78 * u;
      return frame(Lof(L4460), [Lof(L4460) * 0.5, 1000, 0], norm([Math.sin(a), 0.16, Math.cos(a)]), 0.90); } },

  /* ⑧ 缩小实验：相机不动，车自己缩（骨架/轮子不动） */
  { n: "缩小实验", sec: 10, car: L4460, carTo: L4080, state: SIT, shell: () => 1.0, cut: () => 200, people: [],
    cam: () => frame(Lof(L4460), [Lof(L4460) * 0.5, 1000, 0], norm([0.02, 0.10, 0.99]), 0.92) },

  /* ⑨ 收尾：壳合上，缓慢拉开 */
  { n: "收尾", sec: 8, car: L4080, carTo: L4460, state: SIT, shell: () => 1.0, cut: (u) => 200 + 1400 * u, people: [],
    cam: (u) => frame(Lof(L4460), [Lof(L4460) * 0.5, 950, 0],
      norm([-0.55, 0.40, 0.73]), 0.72 - 0.10 * u) },
];

/* ========================================================================= */
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
await p.goto("file://" + FILE);
await p.waitForTimeout(600);

/* 零件键表（bake 与 partDefs 共用一份）：k ∈ box/quad/cyl/prism */
const DEFK = {
  body: { cls: "body3", k: "shell" }, bodyNear: { cls: "body3", k: "prism" },
  floor: { cls: "floor3", k: "box" },
  glassL1: { cls: "glass3", k: "box" }, glassL2: { cls: "glass3", k: "box" },
  glassR1: { cls: "glass3", k: "box" }, glassR2: { cls: "glass3", k: "box" },
  bumperF: { cls: "trim3", k: "box" }, bumperR: { cls: "trim3", k: "box" },
  archFL: { cls: "trim3", k: "cyl" }, archFR: { cls: "trim3", k: "cyl" },
  archRL: { cls: "trim3", k: "cyl" }, archRR: { cls: "trim3", k: "cyl" },
  frunkLo: { cls: "body3", k: "box" }, frunkHi: { cls: "body3", k: "box" },
  machF: { cls: "mach3", k: "box" }, batt: { cls: "batt3", k: "box" },
  machR: { cls: "mach3", k: "box" }, trunkLo: { cls: "body3", k: "box" },
  trunkHi: { cls: "body3", k: "box" },
  seatFc: { cls: "cush3", k: "box" }, seatRc: { cls: "cush3", k: "box" },
  seatFb: { cls: "seat3", k: "quad" }, seatRb: { cls: "seat3", k: "quad" },
  legRest: { cls: "bed3", k: "box" }, deck: { cls: "bed3", k: "quad" },
  bunk: { cls: "bunk3", k: "box" }, topBeam: { cls: "lk3", k: "box" }, roof: { cls: "pop3", k: "box" },
  tentL: { cls: "tent3", k: "box" }, tentR: { cls: "tent3", k: "box" },
  tentF: { cls: "tent3", k: "box" }, tentB: { cls: "tent3", k: "box" },
  tyreF: { cls: "tyre3", k: "cyl" }, tyreFb: { cls: "tyre3", k: "cyl" },
  tyreR: { cls: "tyre3", k: "cyl" }, tyreRb: { cls: "tyre3", k: "cyl" },
  rimF: { cls: "rim3", k: "cyl" }, rimFb: { cls: "rim3", k: "cyl" },
  rimR: { cls: "rim3", k: "cyl" }, rimRb: { cls: "rim3", k: "cyl" },
};
for (const nm of ["Fu", "Fd", "Ru", "Rd"])
  for (const sd of ["L", "R"]) DEFK["beam" + nm + sd] = { cls: "scr3", k: "box" };

/* 每一帧：设参数 + 状态 → derive() → 抽零件/人 */
const grab = (car, state, cut) => p.evaluate(([car, state, DEFK, CUTZ]) => {
  const P = MY.P;
  Object.assign(P, car, state);
  MY.SIM.sig = null;                       // 强制重建布偶（否则沿用上一帧的落定结果）
  const d = MY.derive();
  const R = Math.round, HW = P.W / 2;
  /* 每个键**每帧都要有值**：Blender 端只按出现过的帧打关键帧，缺帧的零件会被常量外推
     （第一版里那块一直飘在车顶的蓝板就是只在升顶镜头里出现过的 pop-top 顶盖）。 */
  const parts = {}, people = {};
  const DEG = {
    box: [0, 0, 0, 0, 0, 0],                 // 零尺寸盒 = 看不见
    quad: [0, 0, 1, 0, 1, 6, 0, 0],          // 1mm 细片 = 看不见
    cyl: [0, 0, 0, 0, 0],
    prism: [0, 10, [0, 0], [1, 0], [1, 1]],  // 退化小三角（点必须是 [x,y] 对，否则 Blender 端解包会炸）
    shell: [0, 10, [0, 0], [1, 0], [1, 1]],
  };
  for (const k in DEFK) parts[k] = DEG[DEFK[k].k].slice();
  /* 剖切：一切零件的 z 都被切到 CUTZ（近侧那半拿掉）——就是一个"半剖模型"，
     比整车半透明干净得多（也正好是本项目侧视剖面的老规矩）。 */
  const CUT = CUTZ == null ? Infinity : CUTZ;
  const CL = (z0, z1) => { const a = Math.min(z0, CUT), b = Math.min(z1, CUT); return b - a < 1 ? null : [a, b]; };
  const box = (k, x0, x1, y0, y1, z0, z1) => {
    const c = CL(z0, z1); if (c) parts[k] = [x0, x1, y0, y1, c[0], c[1]];
  };
  const quad = (k, px, py, dx, dy, len, th, z0, z1) => {
    const c = CL(z0, z1); if (c) parts[k] = [px, py, dx, dy, len, th, c[0], c[1]];
  };
  const cyl = (k, cx, cy, r, z0, z1) => {
    const c = CL(z0, z1); if (c) parts[k] = [cx, cy, r, c[0], c[1]];
  };

  /* 车壳：骨架多边形（凹）→ 交给 Blender 的 prism（只换多边形，不打关键帧） */
  const HO0 = HW + 60;
  const bc = CL(-HO0, HO0);                      // 车壳也要跟着剖（否则"骨架"镜里壳还在）
  if (bc) parts.body = [bc[0], bc[1], ...d.shell.poly];
  /* 近侧那块外板：只有"没剖开"的时候才在 —— 剖开时它自然被 CL 切掉。
     （车壳本体是**不带近侧封盖**的壳，否则剖切时那块实心截面会把内饰全挡住。） */
  const nc = CL(HO0 - 34, HO0);
  if (nc) parts.bodyNear = [nc[0], nc[1], ...d.shell.poly];

  /* 层 A 各件（全宽） */
  box("frunkLo", 0, P.x00, P.y0, P.y1c, -HW, HW);
  box("frunkHi", P.x00, P.x10, P.y1a, P.y1c, -HW, HW);
  box("machF", P.x00, P.x00 + P.x01, P.y0, P.y1a, -HW, HW);
  box("batt", d.A.batt.x0, d.A.batt.x1, P.y0, P.y1, -HW, HW);
  box("machR", d.A.machR.x0, d.A.machR.x1, P.y0, P.y1b, -HW, HW);
  box("trunkLo", d.A.trunk.x0, d.A.trunk.x1, P.y0, P.y2, -HW, HW);
  box("trunkHi", d.A.trunk.x0 - P.x15, d.A.trunk.x0, P.y1b, P.y2 - P.bckT, -HW, HW);
  /* 地板（座舱地面那块板） */
  box("floor", P.x10, d.A.trunk.x0, P.y1 - 40, P.y1, -HW, HW);

  /* 溃缩结构：上下两排 × 左右两根 */
  const BT = 30, rz = HW - 200, rw = 120;
  const rows = [["Fu", 8, P.x10 - 8, P.y1a + 6], ["Fd", 8, P.x00 - 8, P.y0 + 21],
                ["Ru", d.A.trunk.x0 - P.x15 + 8, d.A.trunk.x1 - 8, P.y1b + 6],
                ["Rd", d.A.trunk.x0 + 8, d.A.trunk.x1 - 8, P.y0 + 21]];
  for (const [nm, x0, x1, y0] of rows) {
    box("beam" + nm + "L", x0, x1, y0, y0 + BT, -rz - rw / 2, -rz + rw / 2);
    box("beam" + nm + "R", x0, x1, y0, y0 + BT, rz - rw / 2, rz + rw / 2);
  }

  /* 座椅 / 床件 */
  box("seatFc", d.B.seatF.x0, d.B.seatF.x1, P.y2 - 60, P.y2, -HW * 0.85, HW * 0.85);
  box("seatRc", d.B.seatR.x0, d.B.seatR.x1, P.y2 - 60, P.y2, -HW * 0.85, HW * 0.85);
  const F = d.seat.front, Rp = d.seat.rear;
  quad("seatFb", F.hinge, P.y2, F.dir[0], F.dir[1], F.len, P.bckT, -HW * 0.85, HW * 0.85);
  quad("seatRb", Rp.hinge, P.y2, Rp.dir[0], Rp.dir[1], Rp.len, P.bckT, -HW * 0.85, HW * 0.85);
  if (d.legRest) box("legRest", d.legRest.x0, d.legRest.x1, P.y2 - 40, P.y2, -HW * 0.9, HW * 0.9);
  const a = P.pAng * Math.PI / 180;
  quad("deck", d.deck.x0, P.y2, Math.cos(a), Math.sin(a), d.deck.len, 40, -HW * 0.9, HW * 0.9);
  if (P.popUp > 0.5 && P.fold < 0.5)
    box("bunk", d.C.opening.x0, d.C.opening.x1, P.y3 - 40, P.y3, -HW, HW);
  if (P.popUp > 0.5 && P.fold > 0.5) {                       // 升顶站立：顶横梁 + 帐篷（顶 + 四面围幕）
    box("topBeam", P.xBeam - 40, P.xBeam + 40, P.y3 - 60, P.y3, -HW, HW);
    box("roof", d.C.opening.x0 - 40, d.C.opening.x1 + 40, P.y4 - 40, P.y4, -HW - 20, HW + 20);
    box("tentL", d.C.opening.x0, d.C.opening.x1, P.y3, P.y4 - 40, -HW - 20, -HW + 8);
    box("tentR", d.C.opening.x0, d.C.opening.x1, P.y3, P.y4 - 40, HW - 8, HW + 20);
    box("tentF", d.C.opening.x0 - 8, d.C.opening.x0 + 8, P.y3, P.y4 - 40, -HW, HW);
    box("tentB", d.C.opening.x1 - 8, d.C.opening.x1 + 8, P.y3, P.y4 - 40, -HW, HW);
  } else box("topBeam", P.xBeam - 40, P.xBeam + 40, P.y3 - 60, P.y3, -HW, HW);

  /* 侧窗（两侧薄板，读作"玻璃"）+ 前后保险杠 + 轮包 */
  const HO = HW + 60, gy0 = P.y2 + 430, gy1 = P.y3 - 170;
  /* 侧窗：贴着座位分段（前排一块、二排一块），中间留 B 柱 */
  const wF = [d.B.seatF.x0 + 60, d.B.seatF.x1 + 300], wR = [d.B.seatR.x0 - 80, Math.min(d.L - 300, d.B.seatR.x1 + 420)];
  box("glassL1", wF[0], wF[1], gy0, gy1, -HO - 6, -HO + 16);
  box("glassL2", wR[0], wR[1], gy0, gy1, -HO - 6, -HO + 16);
  box("glassR1", wF[0], wF[1], gy0, gy1, HO - 16, HO + 6);
  box("glassR2", wR[0], wR[1], gy0, gy1, HO - 16, HO + 6);
  /* 前后保险杠 / 轮包**放在车身外皮之外**（原来塞在 ±HW 里，被车壳挡着白做了） */
  box("bumperF", 0, 60, P.y0 + 30, P.y1a + 200, -HO - 16, HO + 16);
  box("bumperR", d.L - 60, d.L, P.y0 + 30, P.y1b + 240, -HO - 16, HO + 16);
  const AR = P.wD / 2 + 74, AW = 96;
  for (const [nm, ax] of [["FL", P.axF], ["FR", P.axF], ["RL", P.axR], ["RR", P.axR]]) {
    const sgn = nm.endsWith("L") ? -1 : 1, z = sgn * (HO + 8 - AW / 2);
    cyl("arch" + nm, ax, AR, AR, z - AW / 2, z + AW / 2);
  }

  /* 轮：胎 + 轮辋（轮底 = 地面 y=0；轮心 y = wD/2） */
  const R2 = P.wD / 2, TW = 230, tz = HW + 60 - TW;
  for (const [nm, ax] of [["F", P.axF], ["R", P.axR]]) {
    cyl("tyre" + nm, ax, R2, R2, -tz - TW, -tz);
    cyl("tyre" + nm + "b", ax, R2, R2, tz, tz + TW);
    cyl("rim" + nm, ax, R2, R2 * 0.55, -tz - 20, -tz);
    cyl("rim" + nm + "b", ax, R2, R2 * 0.55, tz, tz + 20);
  }

  /* 人：布偶关节 → 12 根骨头 + 头（脖子/肘/手是合成的，v17 里没有） */
  /* 手臂（v17 的布偶没有手臂，这里按姿态补两根骨头）：
     躯干基本竖直（坐/站）→ 手往前下方放；躯干水平（躺）→ 手顺着身体朝头那侧。 */
  const arm = (shd, headC, face) => {
    const dx = headC[0] - shd[0], dy = headC[1] - shd[1], L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;                     // 躯干→头 方向
    if (Math.abs(uy) > 0.7) {                           // 坐 / 站：手往前下
      const f = face < 0 ? -1 : 1;
      const elbow = [shd[0] + f * 170, shd[1] - 210];
      const hand = [elbow[0] + f * 230, elbow[1] - 110];
      return [elbow, hand];
    }
    const elbow = [shd[0] + ux * 300, shd[1] + uy * 300];   // 躺：手顺身体
    const hand = [elbow[0] + ux * 260, elbow[1] + uy * 260];
    return [elbow, hand];
  };
  const add = (slot, j) => {
    if (!j || !j.knee) return;
    const neck = [j.shd[0] + (j.headC[0] - j.shd[0]) * 0.32, j.shd[1] + (j.headC[1] - j.shd[1]) * 0.32];
    const [elbow, hand] = arm(j.shd, j.headC, j.face);
    people[slot] = { k: 1, hip: j.hip, knee: j.knee, ankle: j.ankle,
      foot: [j.ankle[0] + (j.toe[0] - j.ankle[0]) * 1.1, j.ankle[1] + (j.toe[1] - j.ankle[1]) * 1.1],
      shd: j.shd, neck, headC: j.headC, elbow, hand };
  };
  for (const j of d.dolls) {
    if (j.who === "前排" || j.who === "床面") add("A", j);
    else if (j.who === "二排" || j.who === "站立") add("B", j);
    else if (j.who === "上铺") add("C", j);
  }
  return { parts, people, L: d.L, cam: { shell: 0 } };
}, [car, state, DEFK, cut]);

/* 组装时间轴 */
const frames = [];
const shotsMeta = [];
let idx = 1;
for (const s of SHOTS) {
  const n = Math.round(s.sec * FPS);
  const f0 = idx;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 1 : i / (n - 1), e = ease(u);
    const car = s.carTo ? mixObj(s.car, s.carTo, e) : s.car;
    const state = s.stateTo ? mixObj(s.state, s.stateTo, e) : s.state;
    // 机构的插值：fold/rot/pAng/popUp 是 0/1 或角度 → 直接线性插值后再取整到合适分辨率
    const st = { ...state };
    st.rot = Math.round(st.rot); st.pAng = Math.round(st.pAng);
    st.fold = st.fold > 0.5 ? 1 : 0; st.popUp = st.popUp > 0.5 ? 1 : 0;
    const g = await grab(car, st, s.cut ? s.cut(e) : null);
    const alpha = {};
    for (const pl of s.people || []) alpha[pl.slot] = pl.a(e);
    const cam = s.cam(e);
    frames.push({ i: idx, parts: g.parts, people: g.people,
      cam: { pos: cam.pos, tgt: cam.tgt, shell: s.shell(e) }, alpha });
    idx++;
  }
  shotsMeta.push({ name: s.n, f0, f1: idx - 1 });
  console.log(`  ${String(f0).padStart(4)}–${String(idx - 1).padStart(4)}  ${s.n}`);
}
await b.close();

const partDefs = DEFK;

const D = {
  fps: FPS, shots: shotsMeta, partDefs, frames,
  alpha: {},                                  // 逐帧 alpha 已经写在 frames[i].alpha 里
  meta: { AN: { legW: 130, shinW: 100, footW: 80, torsoW: 230, neckW: 150, armW: 78, headR: 115 } },
};
fs.writeFileSync(out, JSON.stringify(D));
console.log(`baked ${frames.length} 帧 / ${shotsMeta.length} 镜 → ${out}（${(fs.statSync(out).size / 1024 / 1024).toFixed(1)}MB）`);
if (errs.length) console.log("页面报错：\n" + errs.join("\n"));
