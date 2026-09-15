// v17 → .glb：把侧视剖面引擎的派生几何挤成 3D（D65）。
// 用法: node scripts/export-glb17.mjs <out.glb> [--layout=紧凑|无下限|现状] [--mode=大床|常规|升顶站立]
// 3D 约定：模型 x = 车长 → glTF x；模型 y = 离地高 → glTF y（向上）；模型 z = 车宽（±W/2）。
// 只吃页面里 derive() 的那一份几何（实心体 / 骨架 / 溃缩结构 / 假人），不重算第二份数学。
import { chromium } from "/home/z/vibe/vibeos/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const out = path.resolve(argv.find((a) => !a.startsWith("--")) || "/tmp/mycar-glb17/4460.glb");
const opt = (k, d) => { const a = argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.split("=").slice(1).join("=") : d; };
const LAYOUT = opt("layout", "紧凑");
const MODE = opt("mode", "大床");
const FILE = path.resolve(opt("file", "蓝图-v17.html"));
fs.mkdirSync(path.dirname(out), { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
await p.goto("file://" + FILE);
await p.waitForTimeout(600);

const built = await p.evaluate(([layName, mode]) => {
  /* 1) 套布局 + 模式 */
  const lay = (MY.LAYOUTS || []).find(([n]) => n.indexOf(layName) === 0);
  if (!lay) throw new Error("找不到布局：" + layName);
  if (lay[1]) Object.assign(MY.P, lay[1]);
  Object.assign(MY.P, MY.PRESETS.find(([n]) => n === mode)[1]);
  const d = MY.derive(), P = MY.P;

  /* 2) 三角面收集：groups[name] = {pos:[], idx:[]} */
  const G = {};
  const grp = (n) => (G[n] = G[n] || { pos: [], idx: [] });
  const tri = (g, a, c, e) => { const o = g.pos.length / 3; g.pos.push(...a, ...c, ...e); g.idx.push(o, o + 1, o + 2); };
  const quad = (g, a, c, e, f) => { tri(g, a, c, e); tri(g, a, e, f); };
  const box = (g, x0, x1, y0, y1, z0, z1) => {
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const q = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
    for (const [i, j, k, l] of q) quad(g, v[i], v[j], v[k], v[l]);
  };
  /* 2D 凸多边形（x,y）× z 区间 → 棱柱（扇形封盖：本模型的凸块都星形可见） */
  const prism = (g, poly, z0, z1) => {
    const n = poly.length;
    for (let i = 1; i < n - 1; i++) {
      tri(g, [poly[0][0], poly[0][1], z1], [poly[i][0], poly[i][1], z1], [poly[i + 1][0], poly[i + 1][1], z1]);
      tri(g, [poly[0][0], poly[0][1], z0], [poly[i + 1][0], poly[i + 1][1], z0], [poly[i][0], poly[i][1], z0]);
    }
    for (let i = 0; i < n; i++) {
      const a = poly[i], c = poly[(i + 1) % n];
      quad(g, [a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z1], [a[0], a[1], z1]);
    }
  };
  const cyl = (g, cx, cy, r, z0, z1, seg) => {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = ((i + 1) / seg) * Math.PI * 2;
      const A = [cx + r * Math.cos(a), cy + r * Math.sin(a)], B = [cx + r * Math.cos(c), cy + r * Math.sin(c)];
      quad(g, [A[0], A[1], z0], [B[0], B[1], z0], [B[0], B[1], z1], [A[0], A[1], z1]);
      tri(g, [cx, cy, z1], [A[0], A[1], z1], [B[0], B[1], z1]);
      tri(g, [cx, cy, z0], [B[0], B[1], z0], [A[0], A[1], z0]);
    }
  };
  const sph = (g, cx, cy, cz, r, seg, rng) => {
    for (let i = 0; i < seg; i++) for (let j = 0; j < rng; j++) {
      const t0 = (i / seg) * Math.PI, t1 = ((i + 1) / seg) * Math.PI;
      const f0 = (j / rng) * Math.PI * 2, f1 = ((j + 1) / rng) * Math.PI * 2;
      const pt = (t, f) => [cx + r * Math.sin(t) * Math.cos(f), cy + r * Math.cos(t), cz + r * Math.sin(t) * Math.sin(f)];
      const a = pt(t0, f0), c = pt(t1, f0), e = pt(t1, f1), h = pt(t0, f1);
      quad(g, a, c, e, h);
    }
  };

  const HW = P.W / 2;                       // 内宽 → 全宽件半宽
  const HO = HW + 60;                       // 外皮半宽

  /* 3) 车身壳（半透明外皮）。骨架多边形是**凹**的（机盖 → 风挡 → 顶棚），
     扇形封盖会漏到多边形外（第一版就漏出一大块白板）→ 拆成三块**凸**的：
     机盖段 / 风挡斜段（梯形）/ 顶棚+尾段。 */
  const r0 = d.shell.roof0;
  prism(grp("body"), [[0, P.y0], [P.x10, P.y0], [P.x10, P.y1c], [0, P.y1c]], -HO, HO);
  prism(grp("body"), [[P.x10, P.y0], [r0, P.y0], [r0, P.y3], [P.x10, P.y1c]], -HO, HO);
  prism(grp("body"), [[r0, P.y0], [d.L, P.y0], [d.L, P.y3], [r0, P.y3]], -HO, HO);

  /* 4) 实心件：全宽件按 W，座椅/床件按 0.85W 的一体座 */
  const SEATW = HW * 0.85;
  const FULL = ["前备箱低段", "前备箱高段", "前机能体", "电池", "后机能体", "尾仓低段", "尾仓高段"];
  const SOFTBED = ["腿托", "可翻件", "上铺板", "顶横梁"];
  const gname = (nm) => FULL.includes(nm) ? "chassis" : (SOFTBED.includes(nm) ? "bed" : "seat");
  for (const s of d.solids) {
    const w = FULL.includes(s.nm) ? HW : SEATW;
    prism(grp(gname(s.nm)), s.poly, -w, w);
  }

  /* 5) 溃缩结构：上下两排 × 左右两根（侧视只看得见一根，3D 里就是四根） */
  const BT = 30, railZ = HW - 200, railW = 120;
  for (const [x0, x1, y0] of [[8, P.x10 - 8, P.y1a + 6], [8, P.x00 - 8, P.y0 + 21],
    [d.A.trunk.x0 - P.x15 + 8, d.A.trunk.x1 - 8, P.y1b + 6], [d.A.trunk.x0 + 8, d.A.trunk.x1 - 8, P.y0 + 21]]) {
    for (const z of [-railZ - railW / 2, railZ - railW / 2]) box(grp("beam"), x0, x1, y0, y0 + BT, z, z + railW);
  }

  /* 6) 轮：圆柱，轮底 = 地面 y=0 */
  const R = P.wD / 2, TW = 230, tz = HO - TW;
  for (const ax of [P.axF, P.axR]) for (const s of [-1, 1]) cyl(grp("wheel"), ax, R, R, s * tz, s * (tz + TW), 28);

  /* 7) 假人：胶囊 → 圆柱 + 头球 */
  const CAPS3 = [["大腿", (j) => [j.hip, j.knee], 65], ["小腿", (j) => [j.knee, j.ankle], 50],
    ["足", (j) => [j.ankle, j.toe], 40], ["躯干", (j) => [j.hip, j.shd], 115]];
  const cap = (cx, cy, cz, ux, uy, r, seg) => {   // 沿 (ux,uy,0) 法平面上的一个圆
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2, px = -uy * r * Math.cos(t), py = ux * r * Math.cos(t), pz = r * Math.sin(t);
      pts.push([cx + px, cy + py, cz + pz]);
    }
    return pts;
  };
  const stem = (g, a, c, r) => {                 // 肢体 = 沿 a→c 的圆管（轴线在 x-y 平面内）
    const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const seg = 8, A = cap(a[0], a[1], 0, ux, uy, r, seg), C = cap(c[0], c[1], 0, ux, uy, r, seg);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      quad(g, A[i], A[j], C[j], C[i]);
      tri(g, [a[0], a[1], 0], A[j], A[i]);
      tri(g, [c[0], c[1], 0], C[i], C[j]);
    }
  };
  for (const j of d.dolls) {
    if (!j.knee) continue;
    for (const [, f, r] of CAPS3) { const [a, c] = f(j); stem(grp("person"), a, c, r); }
    sph(grp("person"), j.headC[0], j.headC[1], 0, 115, 10, 14);
  }

  return { groups: G, W: P.W, L: d.L, H: P.y3, preset: mode,
    stats: Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.idx.length / 3])) };
}, [LAYOUT, MODE]);

/* ---------------- 写 GLB ---------------- */
const MAT = {
  body:    { color: [0.62, 0.70, 0.78, 0.22], blend: true,  rough: 0.25, metal: 0.1 },
  chassis: { color: [0.16, 0.20, 0.26, 1],    rough: 0.75 },
  seat:    { color: [0.34, 0.40, 0.48, 1],    rough: 0.85 },
  bed:     { color: [0.60, 0.52, 0.36, 1],    rough: 0.9 },
  beam:    { color: [0.30, 0.34, 0.40, 1],    rough: 0.4, metal: 0.7 },
  wheel:   { color: [0.10, 0.11, 0.13, 1],    rough: 0.95 },
  person:  { color: [0.93, 0.65, 0.60, 1],    rough: 0.75 },
};
const names = Object.keys(built.groups).filter((k) => built.groups[k].idx.length);
const bin = [];
const views = [], accessors = [], prims = [];
let off = 0;
for (const nm of names) {
  const g = built.groups[nm];
  /* 单位：模型是毫米 → glTF 用米（Blender/查看器都按米解释，否则相机裁切面会把车切掉） */
  for (let i = 0; i < g.pos.length; i++) g.pos[i] *= 0.001;
  const pos = new Float32Array(g.pos);
  const idx = new Uint32Array(g.idx);
  const posB = Buffer.from(pos.buffer), idxB = Buffer.from(idx.buffer);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]);
  }
  const posOff = off; bin.push(posB); off += posB.length;
  while (off % 4) { bin.push(Buffer.alloc(1)); off++; }
  const idxOff = off; bin.push(idxB); off += idxB.length;
  while (off % 4) { bin.push(Buffer.alloc(1)); off++; }
  views.push({ buffer: 0, byteOffset: posOff, byteLength: posB.length, target: 34962 });
  views.push({ buffer: 0, byteOffset: idxOff, byteLength: idxB.length, target: 34963 });
  const vi = views.length - 2, ii = views.length - 1;
  accessors.push({ bufferView: vi, componentType: 5126, count: pos.length / 3, type: "VEC3", min: mn, max: mx });
  accessors.push({ bufferView: ii, componentType: 5125, count: idx.length, type: "SCALAR" });
  prims.push({ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, material: names.indexOf(nm) });
}
const materials = names.map((nm) => {
  const m = MAT[nm] || MAT.chassis;
  const o = { name: nm, pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: m.metal ?? 0, roughnessFactor: m.rough ?? 0.8 } };
  o.doubleSided = true;
  if (m.blend) o.alphaMode = "BLEND";
  return o;
});
const gltf = {
  asset: { version: "2.0", generator: "mycar export-glb17.mjs" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "mycar-v17-" + built.preset, mesh: 0 }],
  meshes: [{ name: "car", primitives: prims }],
  materials,
  buffers: [{ byteLength: off }],
  bufferViews: views,
  accessors,
};
const binBuf = Buffer.concat(bin);
let json = Buffer.from(JSON.stringify(gltf), "utf8");
while (json.length % 4) json = Buffer.concat([json, Buffer.from(" ")]);
const head = Buffer.alloc(12);
head.write("glTF", 0); head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + 8 + json.length + 8 + binBuf.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.write("JSON", 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.write("BIN\0", 4);
fs.writeFileSync(out, Buffer.concat([head, jh, json, bh, binBuf]));
const tri = Object.values(built.stats).reduce((a, c) => a + c, 0);
console.log(`写出 ${out}`);
console.log(`  布局=${LAYOUT} 模式=${built.preset} L=${built.L} W=${built.W} H=${built.H} ` +
  `三角面=${tri} 大小=${(fs.statSync(out).size / 1024).toFixed(0)}KB`);
console.log("  分组：" + names.map((n) => `${n}:${built.stats[n]}`).join(" "));
if (errs.length) console.log("页面报错：\n" + errs.join("\n"));
await b.close();
