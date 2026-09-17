#!/usr/bin/env bash
# 影片守护：反复驱动 film-finish.sh 直到成片诞生并拷进 evidence。
# 机器休眠会让渲染暂停（进程不死），唤醒后本循环自动续上 —— 用户回来时影片已经在。
# 用法: nohup bash scripts/film-guard.sh > .tmp/mycar-film/guard.log 2>&1 &
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
EVID=.scratch/04-film/evidence
DEADLINE=$((SECONDS + 6 * 3600))          # 最多守 6 小时，防永转

for round in $(seq 1 60); do
  if [ -s "$EVID/mycar-4460-1080p.mp4" ] && [ -n "$(find "$EVID/mycar-4460-1080p.mp4" -mmin -20)" ]; then
    echo "[guard] $(date '+%H:%M') 成片已是新拷贝，收工"; break
  fi
  if [ -f /tmp/mycar-film/full/f0100.png ] && [ ! -f .tmp/mycar-film/full/f0100.png ]; then
    echo "[guard] $(date '+%H:%M') /tmp 里还有帧目录，先抢救"
  fi
  echo "[guard] $(date '+%H:%M') 第 $round 轮 film-finish…"
  OUT=.tmp/mycar-film/mycar-4460-final.mp4 bash scripts/film-finish.sh
  if [ -s .tmp/mycar-film/mycar-4460-final.mp4 ]; then
    cp .tmp/mycar-film/mycar-4460-final.mp4 "$EVID/mycar-4460-1080p.mp4"
    echo "[guard] $(date '+%H:%M') 成片已拷入 evidence，收工"; break
  fi
  sleep 300
done
