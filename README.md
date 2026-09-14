# 可变多形态座舱跨界车 · 设计工作区

用极小外轮廓容纳分时可变内部空间：通勤、观影、睡眠、露营、清洗共用一车，变形机构全部纯机械。

- **产品设计（SSOT）**：`docs/design/整车结构设计说明书.md` — 整车定位、功能创新清单、逐部件实现方式与取舍。
- **设计决策与理由**：`docs/design/结构决策.md` — 已拍板的边界（车高 ≤2m、升顶用途、脚坑策略…）。
- **蓝图工具设计**：`docs/design/蓝图工具.md` — 参数化侧视剖面引擎（v12）的技术方案。
- **历史迭代**：`蓝图-*.html` 为 v1→v11 的探索版本，仅作参考，几何与校验均不可信（审计见 `.scratch/01-blueprint-parametric/audit-v11.md`）。

## 状态

| 项 | 状态 |
|---|---|
| 整车结构设计说明书 | 完成（v1.0） |
| 参数化蓝图工具 | v11 = 探索版，**已知几何与校验错误 30+ 处**；v12 剖面引擎待开工 |
| 三维/工程图 | 未开始 |
| 样车/供应链 | 未开始 |

## 打开蓝图

```
xdg-open 蓝图-参数化-v11.html
```

左侧为参数化侧视剖面图，右侧为参数滑块与约束校验。

## 渲染与测量（无头）

```bash
node scripts/render.mjs 蓝图-参数化-v11.html /tmp/mycar-render
# → /tmp/mycar-render/{default,rear-bed,poptop,front-rotated}.png + measurements.json
```

`measurements.json` 把 SVG 里每个图元的包围盒反算回世界毫米，用于核查"画面与数字是否一致"。

## 已知问题

v11 的问题清单（含实测数字与标注图）见 `.scratch/01-blueprint-parametric/audit-v11.md`，摘要：

- 靠背角度与人体躯干反向；
- 二排人体大腿与坐垫反向；
- 轮包弧心画在地面 → 轮包装在轮胎肚子里；
- 躺姿人体"头身分离"940mm，升顶睡人浮在车顶之上；
- 两条校验判据写错，把车强行撑到 4.8 米；
- 说明书 7 章有 3 章（前备箱、尾箱隔板三档位、吊柜）完全没有画。

## 下一步

按 `docs/design/蓝图工具.md` 重写为 v12 剖面引擎，验收标准见 `.scratch/01-blueprint-parametric/issues/01-fix-v11-geometry.md`。
