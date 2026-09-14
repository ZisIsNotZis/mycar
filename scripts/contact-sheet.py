#!/usr/bin/env python3
"""把一批渲染图拼成对照表（每行一个模型，A/B 视角并排）。

用法: python3 scripts/contact-sheet.py <png目录> <输出png> [每行视角数=2] [标题]
依赖: Pillow（本机在 /home/z/.venv/bin/python3）
"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

src = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mycar-glb/png'
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, 'sheet.png')
per_row = int(sys.argv[3]) if len(sys.argv) > 3 else 2
title = sys.argv[4] if len(sys.argv) > 4 else '可变多形态座舱跨界车 · 形态对照'

FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
try:
    f_title = ImageFont.truetype(FONT, 26)
    f_label = ImageFont.truetype(FONT, 20)
except Exception:
    f_title = f_label = ImageFont.load_default()

files = sorted(glob.glob(os.path.join(src, '*.png')))
files = [f for f in files if os.path.basename(f) not in ('sheet.png',)]
groups = {}
for f in files:
    base = os.path.basename(f)[:-4]
    name, _, view = base.rpartition('_')
    groups.setdefault(name or base, []).append((view or '', f))
names = sorted(groups)

if not names:
    print('没有找到 png'); sys.exit(1)

cols = max(1, per_row)
first = Image.open(groups[names[0]][0][1])
tw, th = first.size
pad, gap, head = 14, 10, 74
rows = (len(names) + cols - 1) // cols
W = pad * 2 + cols * tw + (cols - 1) * gap
H = head + pad + rows * (th + 34 + gap)
sheet = Image.new('RGB', (W, H), (13, 17, 23))
d = ImageDraw.Draw(sheet)
d.text((pad, 20), title, fill=(201, 212, 224), font=f_title)
d.text((pad, 50), f'{len(names)} 个形态 · 每个 {len(groups[names[0]])} 个视角 · 几何由蓝图 v12 参数化导出（非手工建模）',
       fill=(107, 122, 140), font=f_label)

for i, n in enumerate(names):
    r, c = divmod(i, cols)
    x = pad + c * (tw + gap)
    y = head + pad + r * (th + 34 + gap)
    for j, (view, fp) in enumerate(sorted(groups[n])):
        im = Image.open(fp).convert('RGB')
        if im.size != (tw, th):
            im = im.resize((tw, th))
        sheet.paste(im, (x, y))
        if j == 0:
            d.rectangle([x, y + th + 2, x + tw, y + th + 30], fill=(20, 26, 34))
            label = n.replace('-', ' · ')
            d.text((x + 10, y + th + 6), label, fill=(201, 212, 224), font=f_label)
sheet.save(out)
print(f'{out}  {sheet.size[0]}×{sheet.size[1]}  {len(names)} 行 · {len(files)} 张')
