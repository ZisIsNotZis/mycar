#!/usr/bin/env python3
# 帧序列 QC：帧间差分找闪烁/跳变、黑帧、冻结帧。多模态看图之外的第二道脚本检查。
# 用法: python3 scripts/qc-frames.py <frames_dir> [stride]
import sys, os
from PIL import Image
import numpy as np

d = sys.argv[1]
stride = int(sys.argv[2]) if len(sys.argv) > 2 else 4
files = sorted(f for f in os.listdir(d) if f.startswith("f") and f.endswith(".png"))
nums = [int(f[1:5]) for f in files]
prev = None
prevn = None
diffs = []
for f, n in zip(files, nums):
    im = Image.open(os.path.join(d, f)).convert("L").resize((480, 270))
    a = np.asarray(im, dtype=np.float32)
    lum = a.mean()
    if lum < 6:
        print(f"黑帧/近黑 f{n:04d} lum={lum:.1f}")
    if prev is not None:
        if n - prevn > 1:
            print(f"缺帧 {prevn+1}..{n-1}")
        md = float(np.abs(a - prev).mean())
        diffs.append((md, prevn, n))
        if prevn != n and md < 0.02:
            print(f"冻结(零变化) f{prevn:04d}->f{n:04d} md={md:.4f}")
    prev, prevn = a, n
diffs.sort(reverse=True)
print("\n帧间差分 Top12（值大 = 画面变化大；正常运镜 1~6，>15 需人工看）：")
for md, a, b in diffs[:12]:
    print(f"  f{a:04d}->f{b:04d} md={md:.2f}")
vals = np.array([x[0] for x in diffs])
print(f"\n统计: 中位 {np.median(vals):.2f} p95 {np.percentile(vals,95):.2f} 最大 {vals.max():.2f}")
print(f"共 {len(nums)} 帧，stride={stride}")
