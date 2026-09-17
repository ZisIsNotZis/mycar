#!/usr/bin/env bash
# 成片收尾脚本（可反复运行 = 续渲）：
#   1) 找出 frames 目录里缺失的帧号，逐段用 blender 补渲（无 timeout —— 机器休眠后进程会自动恢复）；
#   2) 全部补齐后：混音（旁白轨 + 配乐 + 音效）→ 合成成片（片头标题 + 双语字幕）。
# 用法: bash scripts/film-finish.sh
#   环境变量：FRAMES_DIR（帧目录，默认 .tmp/mycar-film/full —— 别用 /tmp，会被定期清理）
#             JSON（frames.json）     OUT（成片 mp4）
#             CAMK / SAMPLES / ENGINE（渲染参数）
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FRAMES_DIR=${FRAMES_DIR:-.tmp/mycar-film/full}
JSON=${JSON:-.tmp/mycar-film/frames.json}
OUT=${OUT:-.tmp/mycar-film/mycar-4460-final.mp4}   # 成片出现后请尽快拷进 .scratch（.tmp 会被清理）
CAMK=${CAMK:-1.0}
SAMPLES=${SAMPLES:-128}
ENGINE=${ENGINE:-cycles}
FONT=$(fc-list 2>/dev/null | grep -i "Noto Sans CJK SC" | head -1 | cut -d: -f2 | sed 's/^ //')
mkdir -p "$FRAMES_DIR"

missing_ranges() {   # 输出缺失帧号段：起 止（一行一段）
  ls "$FRAMES_DIR" 2>/dev/null | sed 's/[^0-9]//g' | sort -n | awk '
    BEGIN { p = 0; first = 1 }
    { n = $1 + 0
      if (n != p + 1) { print p + 1, n - 1 }
      p = n }
    END { if (p < 1992) print p + 1, 1992 }'
}

render_range() {     # render_range 起 止
  local a=$1 b=$2
  echo "[finish] 补渲 $a..$b"
  # 注意：不要放 timeout —— 机器休眠会把挂钟时间也算进去，把渲染误杀
  FILM_CAMK="$CAMK" FILM_SAMPLES="$SAMPLES" FILM_RT=1 \
    blender -b -P scripts/blender-film.py -- "$JSON" "$FRAMES_DIR" "$a" "$b" 1920 "$ENGINE"
}

ROUND=0
while :; do
  ROUND=$((ROUND + 1))
  MAPFILE=()
  declare -a RANGES=()
  while read -r a b; do
    [ -n "$a" ] && RANGES+=("$a $b")
  done < <(missing_ranges)
  if [ ${#RANGES[@]} -eq 0 ]; then
    echo "[finish] 帧已齐（1992）"; break
  fi
  echo "[finish] 第 $ROUND 轮：缺 ${#RANGES[@]} 段"
  for r in "${RANGES[@]}"; do render_range $r; done
done

# ---- 混音：旁白轨 + 配乐 + 音效 ----
VO_TRACK=${VO_TRACK:-.tmp/mycar-film/vo-track.wav}
bash scripts/film-music.sh "$VO_TRACK" 83 .tmp/mycar-film/mix.wav 25,45,54,64.5,75.5
bash scripts/film-sfx.sh 83 .tmp/mycar-film/mix.wav .tmp/mycar-film/mix2.wav 27.1 29.2 46.0

# ---- 合成：片头标题 + 双语字幕 ----
TITLE_FILTER=""
if [ -n "$FONT" ]; then
  TITLE_FILTER="drawtext=fontfile=$FONT:text='my car':fontsize=170:fontcolor=0xe6eef6@1.0:x=(w-text_w)/2:y=h*0.16:alpha='if(lt(t,0.9),0,if(lt(t,1.8),(t-0.9)/0.9,if(lt(t,3.4),1,max(0,(4.8-t)/1.4))))',drawtext=fontfile=$FONT:text='4.46 m\\: small outside\\, big inside':fontsize=48:fontcolor=0xaebfce@1.0:x=(w-text_w)/2:y=h*0.16+230:alpha='if(lt(t,1.4),0,if(lt(t,2.3),(t-1.4)/0.9,if(lt(t,3.4),1,max(0,(4.8-t)/1.4))))',"
fi
ffmpeg -y -loglevel error -framerate 24 -i "$FRAMES_DIR/f%04d.png" -i .tmp/mycar-film/mix2.wav \
  -vf "${TITLE_FILTER}subtitles=${SUBS:-.tmp/mycar-film/subs-v2.srt}:force_style='FontName=Noto Sans CJK SC,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=18'" \
  -map 0:v -map 1:a -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest "$OUT"
echo "→ $OUT"
