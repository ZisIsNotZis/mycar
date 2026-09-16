#!/usr/bin/env bash
# edge-tts 生成旁白：网络/服务不稳，**带退避重试**（用户第 31 轮原话：edge-tts 有时不响应，要多次退避重试）
set -uo pipefail
TXT=${1:?文本文件}
OUT=${2:?输出 mp3}
VOICE=${3:-en-US-AndrewNeural}
RATE=${4:--8%}
TRIES=${5:-12}
for i in $(seq 1 "$TRIES"); do
  echo "[vo] 第 $i 次尝试（$VOICE $RATE）…"
  if edge-tts --voice "$VOICE" --rate="$RATE" --file "$TXT" --write-media "$OUT"; then
    if [ -s "$OUT" ]; then echo "[vo] 成功：$OUT ($(stat -c%s "$OUT") bytes)"; exit 0; fi
    echo "[vo] 输出为空，重试"
  else
    echo "[vo] edge-tts 失败（退出码 $?）"
  fi
  sleep $(( i * 3 ))          # 3s,6s,9s… 线性退避
done
echo "[vo] $TRIES 次都失败" >&2; exit 1
