#!/usr/bin/env bash
# 生成"只在转场处响"的配乐，并与旁白混音成一条音轨。
# 音乐是本地合成的（三个正弦 + 慢颤音 + 低通），所以没有版权问题、也不依赖外网曲库。
# 用法: bash scripts/film-music.sh <旁白.mp3> <片长秒> <输出音频.wav> [转场起点,逗号分隔]
set -euo pipefail
VO=${1:?旁白 mp3}
DUR=${2:?片长秒}
OUT=${3:?输出 wav}
MARKS=${4:-21.5,43.5,55.5}          # 转场点（秒）：动作开始 / 抬顶 / 收尾

# 1) 一段 12 秒的软垫（A 小调：110 / 220 / 261.6 / 329.6 Hz），慢起慢落
ffmpeg -y -loglevel error \
  -f lavfi -i "sine=frequency=110:duration=12" \
  -f lavfi -i "sine=frequency=220:duration=12" \
  -f lavfi -i "sine=frequency=261.6:duration=12" \
  -f lavfi -i "sine=frequency=329.6:duration=12" \
  -filter_complex "[0]volume=0.10[a];[1]volume=0.08[b];[2]volume=0.06[c];[3]volume=0.05[d];\
[a][b][c][d]amix=inputs=4:normalize=0,tremolo=f=0.35:d=0.30,lowpass=f=1500,\
afade=t=in:st=0:d=3,afade=t=out:st=9:d=3[m]" -map "[m]" /tmp/mycar-film/music-pad.wav

# 2) 按转场点摆放（每处 12s，重叠部分自然叠加）
inp=""; fc=""
i=0
for m in ${MARKS//,/ }; do
  inp="$inp -i /tmp/mycar-film/music-pad.wav"
  ms=$(python3 -c "print(int(float('$m')*1000))")
  fc="${fc}[${i}]adelay=${ms}|${ms},volume=0.55[p${i}];"
  i=$((i+1))
done
mix=""
for j in $(seq 0 $((i-1))); do mix="${mix}[p${j}]"; done
ffmpeg -y -loglevel error $inp -filter_complex "${fc}${mix}amix=inputs=$i:normalize=0:duration=longest[m]" \
  -map "[m]" -t "$DUR" /tmp/mycar-film/music-track.wav

# 3) 旁白 + 音乐：音乐压到很低（说话时不抢），旁白补到片长
ffmpeg -y -loglevel error -i "$VO" -i /tmp/mycar-film/music-track.wav \
  -filter_complex "[0]volume=1.0,apad,atrim=0:${DUR}[vo];[1]volume=0.30[bg];[vo][bg]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]" \
  -map "[a]" -ar 48000 -ac 2 "$OUT"
echo "→ $OUT"
