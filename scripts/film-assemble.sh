#!/usr/bin/env bash
# 把 blender-film.py 渲出来的 PNG 序列 + 旁白 + 双语字幕合成成片。
# 用法: bash scripts/film-assemble.sh <png目录> <旁白.mp3> <字幕.srt> <输出.mp4> [fps=24] [宽=960]
set -euo pipefail
DIR=${1:?png 目录}
VO=${2:?旁白 mp3}
SRT=${3:?字幕 srt}
OUT=${4:?输出 mp4}
FPS=${5:-24}
W=${6:-960}
H=$(( W * 9 / 16 ))

# 1) 图片序列 → 无声视频（字幕走 subtitles 滤镜烧进画面；字号随宽自适应）
ffmpeg -y -loglevel warning -framerate "$FPS" -i "$DIR/f%04d.png" \
  -vf "scale=${W}:${H},subtitles='${SRT}':force_style='FontName=Noto Sans CJK SC,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=18'" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p "$OUT.noaudio.mp4"

# 2) 配旁白（旁白比片子短就自然结束；长了则截断到片长）
ffmpeg -y -loglevel warning -i "$OUT.noaudio.mp4" -i "$VO" \
  -c:v copy -c:a aac -b:a 160k -shortest "$OUT"

echo "→ $OUT"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
