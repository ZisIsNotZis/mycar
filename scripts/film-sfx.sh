#!/usr/bin/env bash
# 音效（全部本地合成，无版权问题）+ 与旁白/配乐混音：
#   · 连杆"咔哒"两声（变形镜）
#   · 顶棚电机（升顶镜）
#   · 鸟叫（环境音，草地/户外场景）
# 用法: bash scripts/film-sfx.sh <片长秒> <已混音轨wav> <输出wav> [咔哒1秒] [咔哒2秒] [电机开始秒] [鸟叫1秒]
set -euo pipefail
DUR=${1:?片长秒}
IN=${2:?已混音轨 wav}
OUT=${3:?输出 wav}
C1=${4:-26.6}
C2=${5:-28.7}
M=${6:-45.4}
B=${7:-3.0}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# 咔哒：40ms 白噪 → 带通 → 快衰减（机械锁止感）
ffmpeg -y -loglevel error -f lavfi -i "anoisesrc=d=0.05:c=white:a=0.9" \
  -af "highpass=f=1400,lowpass=f=4200,afade=t=out:st=0:d=0.04,volume=0.8" "$TMP/click.wav"

# 顶棚电机：155Hz + 轻颤 + 低通，2.6 秒
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=155:d=2.6" \
  -af "vibrato=f=8:d=0.5,lowpass=f=800,afade=t=in:st=0:d=0.3,afade=t=out:st=1.9:d=0.7,volume=0.45" "$TMP/motor.wav"

# 鸟叫一簇：三次短促高频扫频（用 tremolo+低通做出"啾"的音色）
ffmpeg -y -loglevel error \
  -f lavfi -i "sine=frequency=3200:d=0.35" \
  -af "vibrato=f=14:d=0.9,lowpass=f=6000,highpass=f=1800,volume=0.30" "$TMP/bird.wav"

# 混音：咔哒×2 + 电机 + 鸟叫（鸟叫在后段每 9 秒出现一簇）
del() { python3 -c "print(int(round($1*1000)))"; }
B2=$(del "$(python3 -c "print($B + 9)")")
B3=$(del "$(python3 -c "print($B + 17)")")
ffmpeg -y -loglevel error -i "$IN" -i "$TMP/click.wav" -i "$TMP/click.wav" -i "$TMP/motor.wav" \
  -i "$TMP/bird.wav" -i "$TMP/bird.wav" -i "$TMP/bird.wav" \
  -filter_complex \
  "[1]adelay=$(del "$C1")|$(del "$C1"),volume=0.85[c1];
   [2]adelay=$(del "$C2")|$(del "$C2"),volume=0.85[c2];
   [3]adelay=$(del "$M")|$(del "$M"),volume=0.55[m];
   [4]adelay=$(del "$B")|$(del "$B"),volume=0.30[b1];
   [5]adelay=$B2|$B2,volume=0.26[b2];
   [6]adelay=$B3|$B3,volume=0.28[b3];
   [0][c1][c2][m][b1][b2][b3]amix=inputs=7:normalize=0:duration=first,alimiter=limit=0.95[a]" \
  -map "[a]" -t "$DUR" -ar 48000 -ac 2 "$OUT"
echo "→ $OUT"
