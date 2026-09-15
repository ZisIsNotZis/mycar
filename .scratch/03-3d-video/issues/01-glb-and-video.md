# 01 · v17 → .glb → 60s 视频（4460 布局）

Status: done
Blocked by: —
Deliverable: `scripts/export-glb17.mjs`（新）+ 两个 blender 脚本的修复 + `4460-大床-60s.mp4`
Need-review: false（新增分析/展示脚本；`蓝图-v17.html` 只把 `LAYOUTS` 加进 `window.MY` 接口）
Gate: 导出无页面报错；Blender 渲染成功；**逐帧看图**（项目 AGENTS 第 10 条）

## Issue

用户：`Do video for 4460, quick blender render 60s demo/draft`（4460 = 缩小实验的"紧凑"布局）。

## 做了什么

- `scripts/export-glb17.mjs`：把 `derive()` 的同一份几何（实心件 / 骨架 / 上下两排溃缩结构 / 假人胶囊）
  挤成 3D，写单 mesh + 7 材质分组的 .glb（mm→m，车身半透明）。
- 修 `blender-turntable.py`：① 逐帧重摆机位再出图（原来渲染的是同一个角度）；② 新增 `[引擎]`/`[起始帧]`/`[png]`
  参数，支持分块并行；③ 参数校验（不再是裸 `int(argv)`）。
- 修两个渲染脚本共有的老 bug：**没清 Blender 启动场景** → 默认 Cube 渲进画面（第一版视频里的"白盒"）。
- `蓝图-v17.html`：`LAYOUTS` 加进 `window.MY`（导出脚本按名字取布局）。

## 验收 / 证据

- 60s / 24fps / 1440 帧 / 960×690 / EEVEE，4 块并行（每块 360 帧 → PNG → ffmpeg）。
- 产物：`/tmp/mycar-glb17/4460-大床-60s.mp4`（约 5.6MB）、`4460-大床.glb`（个人复核用静帧截图已看过）。
- 逐帧检查发现并修掉两个渲染缺陷：车壳扇形封盖漏出大白板（改凸块拆分）、Blender 默认 Cube（清场景）。

## 已知取舍（draft）

- 车身是半透明玻璃壳 + 块状内饰，不做造型曲面；假人是圆柱胶囊（不是网格人体）。
- 只导了「紧凑 4460 × 大床」一组；换布局/模式只要一条命令（见 `蓝图工具.md`）。
