#!/usr/bin/env bash
# 把 9 段旁白按分镜时长摆到位（每镜开头 0.4s 进旁白），合成一条与片长等长的旁白轨。
# 用法: bash scripts/film-vo-track.sh <out.wav> <每镜秒数,逗号> <vo 目录>
set -euo pipefail
OUT=${1:?out}
SECS=${2:?每镜秒数（逗号分隔，与 bake 的 SHOTS 一一对应）}
VOD=${3:?vo 目录（p1.mp3 … pN.mp3）}
IFS=',' read -ra ARR <<< "$SECS"
n=${#ARR[@]}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

for i in $(seq 1 "$n"); do
  sec=${ARR[$((i-1))]}
  ffmpeg -y -loglevel error -i "$VOD/p$i.mp3" \
    -af "adelay=400|400,apad,aresample=48000" -t "$sec" -ac 2 "$TMP/seg$i.wav"
done

inputs=""; for i in $(seq 1 "$n"); do inputs="$inputs -i $TMP/seg$i.wav"; done
fc=""; for i in $(seq 0 $((n-1))); do fc="$fc[$i]"; done
# shellcheck disable=SC2086
ffmpeg -y -loglevel error $inputs -filter_complex "${fc}concat=n=$n:v=0:a=1[a]" -map "[a]" "$OUT"
echo "→ $OUT"
