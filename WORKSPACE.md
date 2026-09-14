# mycar · 项目知识

继承 `../WORKSPACE.md`。这里只写"这个仓库怎么跑、坑在哪"。

## 环境

- Node v24（`fnm`），无需本项目 `npm install`。
- 无头浏览器：Playwright 装在**兄弟仓库**里，直接按绝对路径 import：
  `import { chromium } from '/home/z/vibe/vibeos/node_modules/playwright/index.mjs'`
  （浏览器二进制在 `~/.cache/ms-playwright/chromium-1234`）
- 图片裁剪/拼图：`/home/z/.venv/bin/python3` + Pillow 12；`ffmpeg`、`convert` 可用。

## 怎么跑

```bash
node scripts/render.mjs 蓝图-参数化-v11.html /tmp/mycar-render
```

- 对固定的 4 个模式（默认 / 躺床 / 升顶 / 前排旋转）各出一张 `.panel` 截图；
- 并把 `#root` 下每个 SVG 图元的包围盒用页面自身的 `chain()` 比例反算成**世界毫米**，写进 `measurements.json`；
- 同时收集 `pageerror` / `console.error`（有错会打印）。

```bash
node scripts/check.mjs 蓝图-参数化-v12.html    # 11 条验收判据（自动判定），退出码 0 = 全过
```

**读图顺序**：先看 PNG 判断"看起来对不对"，再查 `measurements.json`/`check.mjs` 判断"数字对不对"——v11 的教训是两者会互相打架，只信一个必然误判。

## 蓝图 HTML 的结构约定（v12 起）

- 单文件、无依赖；`DEF`（参数表：值/范围/步长/单位）+ `P`（当前值）+ `M`（状态）→ `build(P,M)` 返回**世界毫米**图元数组与派生量 `d` → `checks(P,M,B)` 每条判据引用 `d` 里的同一份几何 → `project()` 一次性投影。
- 新增几何量时：先加进 `build()` 的 `d`，再让绘制与判据都读它；**禁止**在绘制或判据里重算第二份。
- 碰撞判定用 `segSeg/inQuad/segQuad/quadQuad`（同文件），不要用包围盒近似（会误报）。
- 页面暴露 `window.MY = {P,M,DEF,AN,build,checks,project,hardOK,set}`，无头脚本据此取数；改动这个接口会同时影响 `scripts/check.mjs`。

## 蓝图 HTML 的结构约定（v11 及以前，仅考古）

- 单文件、无依赖：`P`（参数对象）+ `M`（模式布尔）+ `chain()`（派生几何）→ `render()`（拼 SVG 字符串）。
- `chain()` 与 `render()` 是**全局函数**（classic script），所以可以从 Playwright 里直接 `page.evaluate(() => chain())` 取派生量。v12 请保留"可从外部调用"这一性质，并额外导出一个 `measure()` 返回所有 builder 的输出，便于自动校验。
- `viewBox="0 0 1240 660"`；v11 的投影是 `X(x)=70+x*sc`、`Y(h)=600-h*sc`，`sc=min(980/L,560/总高)` —— 世界毫米与世界毫米相乘的地方**只应出现在投影**。

## 已知坑（别再踩）

1. v7→v11 由 GLM 迭代，**没有事后校验**：画出来的图与它自己的红字校验都不可信。任何继承自 v11 的结论都要重新量一遍。
2. v11 的"看起来像物理错误"里，至少有一条（电池/脚"插在轮子里"）是**侧视图图层混淆**，不是物理错误——侧视图是中心线剖面，轮包在车外两侧。判断这类问题前先问"这在 3D 里真的冲突吗"。
3. 文档里凡是"某个滑块范围"的抱怨，先用随机采样测"有效解占比"，再决定是改范围还是改判据。

## 仓库性质

- 目前**没有远程仓库、没有 CI**；`mycar/` 是 `~/vibe` 工作区下的独立子仓库（非 submodule）。
- `蓝图-*.html` 是历史迭代，不修改、不删除。
