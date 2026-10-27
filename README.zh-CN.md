[English](README.md) | **简体中文**

<img src="assets/logo.svg" alt="my car" width="200">

# my car

**外面小，里面大** —— 一辆会在通勤、会客、观影、露营和睡觉之间变形的跨界房车。

**一辆 4.46 米的车，能让 1.75 米的人平躺睡下、直立站起，变形全部是纯机械的——唯一的电动件是升顶。** 做它是因为一辆日常用车大部分时间都停在原地：与其把车做大，不如让内部空间分时改变；而每一条主张都由一张参数化蓝图证明，图上的画面和校验用的是同一份几何。

![介绍影片中的半剖画面：座舱里的两个人，双语字幕](.scratch/04-film/evidence/检片-t22s.png)

*99.5 秒介绍片（11 镜）的一帧：近侧车壳被剖掉，座舱、人和床在同一张图里看清楚。*

## 快速开始

不用安装、没有依赖、没有构建步骤——整套工具就是一个 HTML 文件：

```bash
git clone https://github.com/ZisIsNotZis/mycar.git
cd mycar
xdg-open 蓝图-v17.html        # macOS 用：open 蓝图-v17.html
```

左边是侧视剖面图；右边是 37 个参数滑块、机构开关、实时判据和派生尺寸。点预设（`常规` / `对坐` / `大床` / `大床观影` / `小床` / `小床观影` / `升顶` / `升顶站立`），拖动假人的关节，或者按 `落下 / 稳定` 把布偶从空中丢下来，让重力自己找姿势。

## 现在能做什么

- **一份几何，两处使用。** `derive()` 产出零件；`draw()` 画它，`checks()` 校验同一批对象——没有第二份数学。这是项目的一条硬规矩，起因是旧引擎积累过 30 多处几何与校验不一致。
- **三层零坐标链。** 底盘（层A）、座舱（层B）、升顶（层C）各自是一条首尾相接的链，所以车长 `L` 是派生量，零件在构造上就不可能互相压。
- **机构状态是开关，不是参数。** 前排旋转、二排放平、可翻件角度、升顶高度组合成 8 个预设，切换走 760ms 缓动。
- **5 个布局快照**一键套用整套参数——来自缩小实验的结果（`现状 4870`、`紧凑 4460`、`更紧 4350`、`无下限 4080`，再加一个会被溃缩结构判据判红的规则之前的老车）。
- **人是物理算出来的，不是画出来的。** 6 个带半径粒子的 PBD 布偶（踝/膝/髋/肩/头/趾）在重力下落定，压得动软垫、压不进硬实心体；关节可以用鼠标拖。判据和物理共用同一个碰撞内核。
- **C1–C21 硬判据**：链完整性、高度栈、床面连续、腿托顶住前排、床长、站立净空、溃缩结构上下两排、膝前净空、骨架自洽、电池体积……
- **缩小优化器。** `scripts/shrink.mjs` 在参数域里找"八个预设全部判据通过"的最短车长，并报出"每个参数再缩 10mm 会死在哪条判据"。
- **能出 3D。** `scripts/export-glb17.mjs` 把派生几何挤成 glTF；Blender 脚本负责静帧出图和 99.5 秒、带双语烧字幕的旁白影片。

## 架构

```
蓝图-v17.html            当前引擎：单文件、无依赖（侧视剖面 + 物理）
蓝图-*.html              v2–v16 历史版本，只作考古，不修改
scripts/                 无头校验、优化器、glTF 导出、Blender 静帧与影片
docs/design/             设计 SSOT：整车设计、决策记录、工具设计、影片脚本
docs/plan/               待执行的验收工作
.scratch/                工作记录与证据：渲染图、影片帧、字幕、音轨
assets/logo.svg
```

HTML 页面既是产品也是真值源。它暴露 `window.MY`（`derive`、`checks`、`draw`、`settle`、`PRESETS`、`LAYOUTS` 等），无头脚本据此驱动它：Playwright 打开文件，调用和界面同一批函数，导出测量数据或 glTF，Blender 再消费烘焙好的帧。页面之外没有任何地方重新实现一遍几何。

- `docs/design/整车设计.md` —— 整车设计 SSOT：尺寸包络、机构状态、座舱、储物、判据。
- `docs/design/结构决策.md` —— 已拍板的边界及理由（`D1`–`D68`），含被否掉的分支。
- `docs/design/蓝图工具.md` —— 引擎约定与无头验证配方。
- `docs/design/介绍视频脚本.md` —— 影片：11 镜分镜、旁白与工具链。

## 开发

需要 Node 24，以及一份能通过 Playwright 调用的 Chromium。脚本按绝对路径 import Playwright（当前是 `/home/z/vibe/vibeos/node_modules/playwright/index.mjs`），换机器时改成你自己的安装路径。只有渲染才需要 Blender 4.x。

```bash
# 最小车长搜索（确定性；八个预设必须全绿）
node scripts/shrink.mjs

# 派生几何 → glTF
node scripts/export-glb17.mjs /tmp/mycar-glb17/4460.glb --layout=紧凑 --mode=大床

# 静帧：glb → Blender（Cycles）→ 拼图
blender -b -P scripts/blender-render.py -- /tmp/mycar-glb /tmp/mycar-glb/png 2 1000
python3 scripts/contact-sheet.py /tmp/mycar-glb/png /tmp/mycar-glb/sheet.png

# 影片：烘焙帧 → Blender 渲染 → 旁白/配乐/音效 → 字幕
node scripts/bake-frames17.mjs /tmp/mycar-film/frames.json
bash scripts/film-finish.sh
```

验证门禁就是页面里的判据清单：打开页面，走完八个预设，要求每条硬判据都绿、控制台不报错——然后**真的看渲染图**，这个项目不接受只用数字充当证据。完整的无头配方在 `docs/design/蓝图工具.md`。

`scripts/render.mjs`、`check.mjs`、`audit.mjs`、`bake-frames.mjs` 面向旧的 v13 `MY.build/M` 接口，**不能**当作 v17 的门禁。

## 参与

先读 [CONTRIBUTING.md](CONTRIBUTING.md)。设计改动需要项目所有者拍板；代码和工具修复欢迎提交，但要带证据（一张渲染图、一个实测数字、一条失败的判据）。

## 路线图

**已实现**

- v17 引擎：零坐标链、派生尺寸、机构预设、布局快照。
- PBD 布偶（可拖、可丢），绘制、判据和 3D 导出共用同一份状态。
- C1–C21 判据，含溃缩结构上下两排与膝前净空——正是挡住"擦边"取巧的那两条规则。
- 确定性的缩小实验及其布局（紧凑 4460 / 更紧 4350 / 无下限 4080）。
- glTF 导出、Blender 静帧，以及带旁白和双语字幕的 99.5 秒介绍片。

**计划中**

- 真实车身曲面与轮包造型；现在还是盒子拼出来的。
- 更好的座椅几何（现在是带坐垫的木板）和影片景深。
- 正视与俯视图——侧视剖面表达不了车宽、吊柜和幕布这些横向信息。
- 三维工程图、样车与供应链：尚未开始。

远期愿景：这个单文件引擎长成真车建造的尺寸权威——每个零件、每条判据、每个机位都读同一份几何，设计一改，图纸、校验和影片同时跟着变。

## 许可

[GNU Affero General Public License v3.0](LICENSE.md) —— Copyright © ZisIsNotZis。
